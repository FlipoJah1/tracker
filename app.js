// ... tout le haut du fichier reste identique

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
      content: `🎯 Voici ton lien tracker unique :\n<${trackerUrl}>\n\n🕵️‍♂️ Les connexions détectées à ce lien s'afficheront ici automatiquement.`
    });

    let clients = {};
    if (fs.existsSync(CLIENTS_FILE)) {
      clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
    }

    clients[uniqueId] = privateChannel.id;
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    await interaction.editReply({
      content: `✅ Ton lien a été généré ici : <#${privateChannel.id}>`
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
