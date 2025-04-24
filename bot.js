const {
  Client,
  GatewayIntentBits,
  Partials,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ChannelType,
  Events,
  PermissionsBitField
} = require('discord.js');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config(); // ← utilisé en local uniquement

// ✅ Vérification que le token est bien lu
console.log("💡 Token Discord reçu par Render :", process.env.DISCORD_TOKEN);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ✅ Token via variable d’environnement
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// ✅ Base URL de ton tracker
const TRACKER_BASE_URL = "https://tracker-09q2.onrender.com/image.jpg?u=";

// ✅ Nom du salon avec le bouton
const BUTTON_CHANNEL_NAME = "📎・génère-lien-tracker";

// ✅ Nom du salon privé
const PRIVATE_CHANNEL_NAME = "🔍・suivi-en-direct";

// ✅ Fichier pour stocker les utilisateurs
const CLIENTS_FILE = './clients.json';

client.once(Events.ClientReady, async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  const guild = client.guilds.cache.first();
  if (!guild) return console.error("❌ Aucune guilde trouvée");

  const channel = guild.channels.cache.find(c =>
    c.name.includes("génère") && c.type === ChannelType.GuildText
  );
  if (!channel) return console.error("❌ Salon 'génère-lien-tracker' introuvable");

  const bouton = new ButtonBuilder()
    .setCustomId("generate_tracker")
    .setLabel("🔗 Générer mon lien")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(bouton);

  await channel.send({
    content: "🎯 Clique sur le bouton ci-dessous pour générer ton lien tracker personnalisé 👇",
    components: [row]
  });

  console.log("✅ Message avec bouton envoyé !");
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "generate_tracker") return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const user = interaction.user;

    let privateChannel = guild.channels.cache.find(c =>
      c.name === PRIVATE_CHANNEL_NAME &&
      c.type === ChannelType.GuildText &&
      c.permissionOverwrites.cache.has(user.id)
    );

    if (!privateChannel) {
      privateChannel = await guild.channels.create({
        name: PRIVATE_CHANNEL_NAME,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
            deny: [PermissionsBitField.Flags.SendMessages]
          },
          {
            id: client.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          }
        ]
      });
    }

    const uniqueId = `${user.id}_${crypto.randomBytes(3).toString("hex")}`;
    const trackerUrl = `${TRACKER_BASE_URL}${uniqueId}`;

    await privateChannel.send({
      content: `🎯 Voici ton lien tracker unique :\n${trackerUrl}`
    });

    let clients = {};
    if (fs.existsSync(CLIENTS_FILE)) {
      clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
    }

    clients[uniqueId] = privateChannel.id;
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    await interaction.editReply({
      content: `✅ Ton lien unique a été généré ici : <#${privateChannel.id}>`
    });

  } catch (err) {
    console.error("❌ Erreur interaction :", err);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: "❌ Une erreur est survenue. Contacte l’administrateur."
      });
    } else {
      await interaction.reply({
        content: "❌ Impossible de traiter ta demande.",
        ephemeral: true
      });
    }
  }
});

client.login(DISCORD_TOKEN);
