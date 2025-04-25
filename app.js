// ... (tout le haut du fichier Express, imports, MaxMind, etc.)

// DISCORD BOT
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const TRACKER_MESSAGE_FILE = './tracker-message.json';

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);

  const guild = client.guilds.cache.first();
  const channel = guild.channels.cache.find(c => c.name.includes("génère") && c.isTextBased());

  if (!channel) return console.log("❌ Salon 'génère-lien-tracker' introuvable");

  let messageId;

  // Vérifie s'il existe un message ID stocké
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

  // Sauvegarde l’ID pour éviter de le recréer à chaque redémarrage
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
    const channelName = `🔍・suivi-${user.username.toLowerCase()}-${shortId}`;

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

    // 🔁 Affiche un message éphémère pour "téléporter" l'utilisateur via lien cliquable
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
