const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "data.json");
if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify({ tickets: {} }, null, 2));

let db = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function saveDB() {
  fs.writeFileSync(dataPath, JSON.stringify(db, null, 2));
}

async function createTicket(interaction, middlemanRoleId) {
  const user = interaction.user;

  // Prevent duplicate tickets
  if (Object.values(db.tickets).some(t => t.users.includes(user.id))) {
    return interaction.reply({ content: "❌ You already have an open ticket.", ephemeral: true });
  }

  // Create channel
  const channel = await interaction.guild.channels.create({
    name: `ticket-${user.username}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: middlemanRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]
  });

  // Save to DB
  db.tickets[channel.id] = {
    users: [user.id],
    created: Date.now(),
    status: "open"
  };
  saveDB();

  // Send intro message
  const embed = new EmbedBuilder()
    .setColor("#2b2d31")
    .setTitle("Middleman Ticket")
    .setDescription(`Welcome ${user}, please wait for a middleman.\nA middleman will verify both parties and complete your trade.`)
    .setFooter({ text: "Use .claim to claim, .close to close." });

  await channel.send({ content: `<@&${middlemanRoleId}>`, embeds: [embed] });

  await interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
}

async function claimTicket(message, middlemanRoleId) {
  const channel = message.channel;

  if (!db.tickets[channel.id]) {
    return message.reply("❌ This channel is not a valid ticket.");
  }

  if (!message.member.roles.cache.has(middlemanRoleId)) {
    return message.reply("❌ Only middlemen can claim tickets.");
  }

  db.tickets[channel.id].claimedBy = message.author.id;
  saveDB();

  const embed = new EmbedBuilder()
    .setColor("#00b0f4")
    .setTitle("Ticket Claimed")
    .setDescription(`${message.author} has claimed this ticket. Please send your payment QR/code.`)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

async function closeTicket(message) {
  const channel = message.channel;

  if (!db.tickets[channel.id]) {
    return message.reply("❌ This channel is not a valid ticket.");
  }

  db.tickets[channel.id].status = "closed";
  saveDB();

  await message.reply("Ticket will be deleted in 5 seconds...");
  setTimeout(() => channel.delete().catch(() => {}), 5000);
}

module.exports = {
  name: "middleman",
  async execute(client) {
    client.on("interactionCreate", async (interaction) => {
      if (!interaction.isButton()) return;
      if (interaction.customId.startsWith("open_ticket")) {
        const middlemanRoleId = interaction.customId.split(":")[1];
        await createTicket(interaction, middlemanRoleId);
      }
    });

    client.on("messageCreate", async (message) => {
      if (message.author.bot) return;
      const prefix = ".";

      if (!message.content.startsWith(prefix)) return;
      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      // .claim
      if (cmd === "claim") {
        const middlemanRoleId = process.env.MIDDLEMAN_ROLE_ID;
        await claimTicket(message, middlemanRoleId);
      }

      // .close
      else if (cmd === "close") {
        await closeTicket(message);
      }
    });
  }
};