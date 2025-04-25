require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

const PORT = process.env.PORT || 3000;
const TRACKER_DOMAIN = process.env.TRACKER_DOMAIN;
const CHANNEL_GENERATE_LINK_ID = process.env.CHANNEL_GENERATE_LINK_ID;
const CATEGORY_TRACKERS_ID = process.env.CATEGORY_TRACKERS_ID;
const MAXMIND_API = process.env.MAXMIND_API;
const IPINFO_TOKEN = process.env.IPINFO_TOKEN;

let messageLinkButton;

client.once('ready', async () => {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);

    const channel = await client.channels.fetch(CHANNEL_GENERATE_LINK_ID);
    if (!channel) {
        console.error('❌ Salon de génération de lien introuvable.');
        return;
    }

    const messages = await channel.messages.fetch({ limit: 10 });
    const existingMessage = messages.find(m => m.author.id === client.user.id && m.components.length > 0);

    if (!existingMessage) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('generate_link')
                .setLabel('🎯 Générer mon lien')
                .setStyle(ButtonStyle.Primary)
        );

        const msg = await channel.send({
            content: 'Clique sur le bouton pour générer ton lien tracker 👇',
            components: [row]
        });
        await msg.pin();
        messageLinkButton = msg;
    } else {
        messageLinkButton = existingMessage;
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'generate_link') {
        const uniqueId = uuidv4().split('-')[0];

        const channelName = `🔗・mon-lien-tracker-${uniqueId}`;
        const existingChannel = interaction.guild.channels.cache.find(c => c.name === channelName);
        if (existingChannel) {
            await interaction.reply({ content: `Tu as déjà un salon ici : ${existingChannel}`, ephemeral: true });
            return;
        }

        const trackerUrl = `${TRACKER_DOMAIN}/${uniqueId}`;

        const newChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: CATEGORY_TRACKERS_ID || null,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ],
                    deny: [
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.MentionEveryone,
                        PermissionsBitField.Flags.AddReactions,
                    ],
                },
                {
                    id: client.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ManageChannels
                    ],
                },
            ],
        });
        await newChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🔗 Ton lien tracker est prêt !')
                    .setDescription(`[Clique ici pour accéder à ton lien](${trackerUrl})\n\nToutes les connexions seront affichées ici.`)
                    .setColor(0x00AE86)
                    .setTimestamp()
            ]
        });

        await interaction.reply({ content: `Ton salon privé a été créé : ${newChannel}`, ephemeral: true });

        setTimeout(async () => {
            if (newChannel.deletable) {
                await newChannel.delete().catch(console.error);
            }
        }, 15 * 60 * 1000); // 15 minutes
    }
});

app.get('/:id', async (req, res) => {
    const id = req.params.id;
    const channel = client.channels.cache.find(c => c.name.includes(id));

    if (!channel) return res.redirect('https://google.com');

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

    let dataMaxmind = {};
    let dataIpinfo = {};

    try {
        const resMaxmind = await axios.get(`https://geoip.maxmind.com/geoip/v2.1/city/${ip}`, {
            headers: { Authorization: `Basic ${MAXMIND_API}` }
        });
        dataMaxmind = resMaxmind.data;
    } catch (err) {
        console.error('Erreur MaxMind:', err.message);
    }

    try {
        const resIpinfo = await axios.get(`https://ipinfo.io/${ip}?token=${IPINFO_TOKEN}`);
        dataIpinfo = resIpinfo.data;
    } catch (err) {
        console.error('Erreur IPInfo:', err.message);
    }

    function compareFields(field1, field2) {
        if (!field1 && !field2) return 'Inconnu';
        if (field1 && field2) {
            if (field1.toLowerCase() === field2.toLowerCase()) return `✅ ${field1}`;
            else return `⚠️ ${field1} / ${field2}`;
        }
        return `⚠️ ${field1 || field2}`;
    }
    const locMaxmind = dataMaxmind?.location;
    const locIpinfo = dataIpinfo?.loc?.split(',');

    let latitude = locIpinfo?.[0] || locMaxmind?.latitude;
    let longitude = locIpinfo?.[1] || locMaxmind?.longitude;
    let mapsUrl = (latitude && longitude) ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` : 'Non disponible';

    const embed = new EmbedBuilder()
        .setTitle('📥 Nouvelle connexion détectée !')
        .addFields(
            { name: 'Adresse IP', value: `\`\`\`${ip}\`\`\``, inline: false },
            { name: 'Pays', value: compareFields(dataIpinfo?.country, dataMaxmind?.country?.iso_code), inline: true },
            { name: 'Région', value: compareFields(dataIpinfo?.region, dataMaxmind?.subdivisions?.[0]?.names?.en), inline: true },
            { name: 'Ville', value: compareFields(dataIpinfo?.city, dataMaxmind?.city?.names?.en), inline: true },
            { name: 'Code Postal', value: compareFields(dataIpinfo?.postal, dataMaxmind?.postal?.code), inline: true },
            { name: 'FAI', value: compareFields(dataIpinfo?.org, dataMaxmind?.traits?.isp), inline: true },
            { name: 'Coordonnées GPS', value: latitude && longitude ? `[Voir sur Google Maps](${mapsUrl})` : 'Inconnues', inline: false }
        )
        .setColor(0x3498db)
        .setTimestamp();

    channel.send({ embeds: [embed] });

    res.send(`
    <html>
        <head>
            <title>Chargement...</title>
            <meta http-equiv="refresh" content="2;url=https://google.com" />
        </head>
        <body>
            Redirection en cours...
        </body>
    </html>
    `);
});
app.listen(PORT, () => {
    console.log(`🌐 Serveur web actif sur le port ${PORT}`);
});

client.login(process.env.TOKEN);
