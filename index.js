// index.js - Middleman Bot (single-file ready for Acode)
// IMPORTANT: put your TOKEN in Render env var named TOKEN, or in config.json for local testing.

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  Partials: DiscordPartials,
  Events
} = require('discord.js');

const DATA_PATH = path.join(__dirname, 'data.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// load or init data
let data = { config: {}, tickets: {} };
if (fs.existsSync(DATA_PATH)) {
  try { data = fs.readJsonSync(DATA_PATH); } catch (e) { console.error('read data fail', e); }
} else {
  fs.writeJsonSync(DATA_PATH, data, { spaces: 2 });
}

// load config (env overrides file)
let fileConfig = {};
if (fs.existsSync(CONFIG_PATH)) {
  try { fileConfig = fs.readJsonSync(CONFIG_PATH); } catch (e) { console.error('read config fail', e); }
}
const cfg = {
  guildId: process.env.GUILD_ID || fileConfig.guildId || data.config.guildId || "",
  middlemanRoleId: process.env.MIDDLEMAN_ROLE_ID || fileConfig.middlemanRoleId || data.config.middlemanRoleId || "",
  buyerRoleId: process.env.BUYER_ROLE_ID || fileConfig.buyerRoleId || data.config.buyerRoleId || "",
  sellerRoleId: process.env.SELLER_ROLE_ID || fileConfig.sellerRoleId || data.config.sellerRoleId || "",
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || fileConfig.ticketCategoryId || data.config.ticketCategoryId || "",
  logChannelId: process.env.LOG_CHANNEL_ID || fileConfig.logChannelId || data.config.logChannelId || "",
  usdToInr: Number(process.env.USD_TO_INR || fileConfig.usdToInr || data.config.usdToInr || 83),
  fixedFeeInr: Number(process.env.FIXED_FEE_INR || fileConfig.fixedFeeInr || data.config.fixedFeeInr || 5),
  percentFee: Number(process.env.PERCENT_FEE || fileConfig.percentFee || data.config.percentFee || 1.0),
  token: process.env.TOKEN || fileConfig.token || data.config.token || null
};

// persist config into data file (so admin can change later with .setrole/.setfee)
data.config = { ...data.config, ...cfg };
fs.writeJsonSync(DATA_PATH, data, { spaces: 2 });

// simple helper to persist tickets/config
function saveData() { fs.writeJsonSync(DATA_PATH, data, { spaces: 2 }); }

// instantiate client with intents (MessageContent + GuildMembers are required)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [DiscordPartials.Channel]
});

if (!cfg.token) {
  console.error("Bot token not set. Set TOKEN env var or config.json token value.");
  process.exit(1);
}

// util: permission checks
function isAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}
function isMiddleman(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  if (!cfg.middlemanRoleId) return false;
  return member.roles.cache.has(cfg.middlemanRoleId);
}

// util: compute fee (input: amount, currencyType'INR' or 'CRYPTO'; amount in INR for INR; for crypto amount, we keep numeric in USD for comparison)
function computeFee(amount, type, coin) {
  // For type INR: amount is INR
  // For type CRYPTO: amount is USD (we ask buyer to enter USD equivalent or raw USD; to keep simple we treat amount as USD for threshold)
  const thresholdInInr = 50 * cfg.usdToInr;
  if (type === 'INR') {
    if (amount <= thresholdInInr) return { text: `₹${cfg.fixedFeeInr}`, valueInInr: cfg.fixedFeeInr };
    const fee = Math.round(amount * (cfg.percentFee / 100));
    return { text: `₹${fee} (1%)`, valueInInr: fee };
  } else {
    // crypto: amount is USD; threshold is $50
    if (amount <= 50) return { text: `₹${cfg.fixedFeeInr} worth of ${coin || 'crypto'}`, valueInInr: cfg.fixedFeeInr };
    const feeInUsd = amount * (cfg.percentFee / 100);
    const feeInInr = Math.round(feeInUsd * cfg.usdToInr);
    return { text: `${cfg.percentFee}% (~₹${feeInInr})`, valueInInr: feeInInr };
  }
}

// helper: create transcriptand DM to parties
async function sendTranscript(channel, participants) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = Array.from(messages.values()).reverse();
    let text = `Transcript for ${channel.name}\n\n`;
    for (const m of sorted) {
      const time = new Date(m.createdTimestamp).toISOString();
      text += `[${time}] ${m.author.tag}: ${m.content}\n`;
    }
    // save temporary file
    const fname = path.join(__dirname, `transcript-${channel.id}.txt`);
    fs.writeFileSync(fname, text);
    // DM each participant
    for (const id of participants) {
      try {
        const user = await client.users.fetch(id);
        await user.send({ content: `Transcript for channel ${channel.name}`, files: [fname] }).catch(()=>null);
      } catch(e){ console.error('dm fail', e); }
    }
    // cleanup file
    fs.unlinkSync(fname);
  } catch (e) {
    console.error('transcript error', e);
  }
}

// ---------- Command parsingfrom messages (prefix commands) ----------
client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.startsWith('.')) return;
  const args = content.slice(1).split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // .panel -> admin posts panel in current channel
  if (cmd === 'panel') {
    if (!isAdmin(message.member)) return message.reply('Only admins can post panel.');
    const embed = new EmbedBuilder()
      .setTitle('Open a Middleman Ticket')
      .setDescription('Click **Open Ticket** to start a deal. Choose INR or Crypto inside the ticket.')
      .setColor(0x2b90d9);
    const openBtn = new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Success);
    await message.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(openBtn)] });
    return message.reply('Panel posted.');
  }

  // .claim -> middleman claims the ticket
  if (cmd === 'claim') {
    const ch = message.channel;
    const ticketId = `ticket-${ch.id}`;
    const ticket = data.tickets[ticketId];
    if (!ticket) return message.reply('This command must be used inside a ticket channel.');
    if (!isMiddleman(message.member)) return message.reply('Only middlemen can claim.');
    if (ticket.claimedBy) return message.reply(`Already claimed by <@${ticket.claimedBy}>`);
    ticket.claimedBy = message.author.id;
    ticket.claimedAt = Date.now();
    saveData();
    await ch.send(`Ticket claimed by <@${message.author.id}>. Only this middleman can run deal commands now.`);
    return;
  }

  // .unclaim -> release
  if (cmd === 'unclaim') {
    const ch = message.channel;
    const ticketId = `ticket-${ch.id}`;
    const ticket = data.tickets[ticketId];
    if (!ticket) return message.reply('This command must be used inside a ticket channel.');
    if (!isMiddleman(message.member) && !isAdmin(message.member)) return message.reply('Only middlemen or admins can unclaim.');
    ticket.claimedBy = null;
    saveData();
    return message.reply('Ticket unclaimed.');
  }

  // .tos -> middleman posts fee embed + instruct to send QR (only claimed mm)
  if (cmd === 'tos') {
    const ch = message.channel;
    const ticketId = `ticket-${ch.id}`;
    const ticket = data.tickets[ticketId];
    if (!ticket) return message.reply('This must be used inside a ticket channel.');
    if (!ticket.claimedBy || ticket.claimedBy !== message.author.id) return message.reply('Only the claimed middleman can run this.');
    // compute fee
    const fee = computeFee(ticket.amountInInr || 0, ticket.type === 'CRYPTO', ticket.coin);
    const embed = new EmbedBuilder()
      .setTitle('Middleman Fee & Payment')
      .setDescription(`Middleman: <@${message.author.id}>\nFee: ${fee.text}\n\nPlease wait for the middleman to send their payment QR / UPI details here.`)
      .setColor(0xffc107);
    if (cfg.logChannelId) {
      const log = message.guild.channels.cache.get(cfg.logChannelId);
      if (log) log.send({ embeds: [embed] }).catch(()=>null);
    }
    await ch.send({ embeds: [embed] });
    return;
  }

  // .paydone -> mm confirms payment from buyer to mm (or mm got paid)
  if (cmd === 'paydone') {
    const ch = message.channel;
    const ticketId = `ticket-${ch.id}`;
    const ticket = data.tickets[ticketId];
    if (!ticket) return message.reply('This must be used inside a ticket channel.');
    if (!ticket.claimedBy || ticket.claimedBy !== message.author.id) return message.reply('Only the claimed middleman can mark payment done.');
    // notify buyer & seller
    const buyer = ticket.buyerId, seller = ticket.sellerId;
    await ch.send({ content: `Payment noted by middleman <@${message.author.id}>. <@${buyer}>, <@${seller}> please proceed.` });
    return;
  }
  // .role @user roleId -> assign the given roleId to two users
  if (cmd === 'role') {
    if (!isMiddleman(message.member) && !isAdmin(message.member)) return message.reply('You don\'t have permission to run this.');
    const mentions = message.mentions.members;
    if (mentions.size < 2 && args.length < 2) {
      return message.reply('Usage: .role @buyer @seller <roleId or @role>');
    }
    // Accept either: .role @buyer @seller @role  OR  .role @buyer @seller ROLE_ID
    const buyer = mentions.at(0);
    const seller = mentions.at(1);
    let roleId = null;
    if (mentions.size >= 3) {
      // third mention role may appear as role mention
      const third = message.mentions.roles?.first();
      if (third) roleId = third.id;
    }
    if (!roleId && args.length) {
      roleId = args[args.length - 1];
      // if role mention like <@&id>
      roleId = roleId.replace(/<@&|>/g, '');
    }
    if (!roleId) return message.reply('Role not provided.');
    try {
      await buyer.roles.add(roleId);
      await seller.roles.add(roleId);
      return message.channel.send(`Assigned role <@&${roleId}> to ${buyer} and ${seller}.`);
    } catch (e) {
      console.error(e);
      return message.reply('Failed to assign role — check bot permissions and role hierarchy.');
    }
  }

  // .dealdone -> buyer&seller tag middleman then mm triggers confirm to seller
  if (cmd === 'dealdone') {
    // syntax .dealdone @seller
    const ch = message.channel;
    const ticketId = `ticket-${ch.id}`;
    const ticket = data.tickets[ticketId];
    if (!ticket) return message.reply('This must be used inside a ticket channel.');
    if (!ticket.claimedBy || ticket.claimedBy !== message.author.id) return message.reply('Only the claimed middleman can run this.');
    const sellerMention = message.mentions.users.first();
    if (!sellerMention) return message.reply('Tag the seller in message: .dealdone @seller');
    // prompt seller to confirm/cancel
    const confirmBtn = new ButtonBuilder().setCustomId(`seller_confirm:${ticketId}`).setLabel('Confirm').setStyle(ButtonStyle.Success);
    const cancelBtn = new ButtonBuilder().setCustomId(`seller_cancel:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger);
    await ch.send({ content: `<@${sellerMention.id}> please confirm this deal.`, components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)] });
    return;
  }

  // .mmdone -> middleman has released payment to seller; close ticket & send transcript
  if (cmd === 'mmdone') {
    const ch = message.channel;
    const ticketId = `ticket-${ch.id}`;
    const ticket = data.tickets[ticketId];
    if (!ticket) return message.reply('This must be used inside a ticket channel.');
    if (!ticket.claimedBy || ticket.claimedBy !== message.author.id) return message.reply('Only the claimed middleman can run this.');
    await ch.send('Middleman confirmed payout to seller. Closing ticket...');
    // create transcript and DM
    const participants = [ticket.openerId, ticket.otherId, ticket.claimedBy].filter(Boolean);
    await sendTranscript(ch, participants);
    // archive/delete channel (we'll simply lock and rename)
    try {
      await ch.permissionOverwrites.edit(ticket.openerId, { ViewChannel: false });
      await ch.permissionOverwrites.edit(ticket.otherId, { ViewChannel: false });
      await ch.setName(`closed-${ch.name}`).catch(()=>null);
      delete data.tickets[ticketId];
      saveData();
      return;
    } catch (e) {
      console.error(e);
      return;
    }
  }

  // .close -> admin or claimed mm can close without mmdone (force close)
  if (cmd === 'close') {
    const ch = message.channel;
    const ticketId = `ticket-${ch.id}`;
    const ticket = data.tickets[ticketId];
    if (!ticket) return message.reply('Not a ticket channel.');
    if (!isAdmin(message.member) && ticket.claimedBy !== message.author.id) return message.reply('Only admin or claimed middleman can close.');
    await ch.send('Ticket forcibly closed. Transcript will be sent.');
    const participants = [ticket.openerId, ticket.otherId, ticket.claimedBy].filter(Boolean);
    await sendTranscript(ch, participants);
    try {
      await ch.permissionOverwrites.edit(ticket.openerId, { ViewChannel: false });
      await ch.permissionOverwrites.edit(ticket.otherId, { ViewChannel: false });
      await ch.setName(`closed-${ch.name}`).catch(()=>null);
      delete data.tickets[ticketId];
      saveData();
      return;
    } catch (e) { console.error(e); }
  }

  // .help
  if (cmd === 'help') {
    const h = new EmbedBuilder()
      .setTitle('Middleman Bot Commands')
      .setDescription(`Prefix: \`.command\`\n\n`.concat(
        [
          '.panel (admin) - post open ticket panel',
          '.claim - claim this ticket (middleman)',
          '.unclaim - release ticket',
          '.tos - post fee + ask middleman to send QR',
          '.paydone - mark payment to middleman done',
          '.role @buyer @seller @role - assign role',
          '.dealdone @seller - ask seller to confirm',
          '.mmdone - after paying seller, close & transcript',
          '.close - force close (admin or claimed mm)'
        ].join('\n')
      ))
      .setColor(0x6a8cff);
    return message.channel.send({ embeds: [h] });
  }

  // .setrole <middlemanRoleId> (admin)
  if (cmd === 'setrole') {
    if (!isAdmin(message.member)) return message.reply('Only admin can set role.');
    const roleId = args[0];
    if (!roleId) return message.reply('Provide role id or mention.');
    data.config.middlemanRoleId = roleId.replace(/<@&|>/g, '') ;
    saveData();
    return message.reply(`Middleman role set to <@&${data.config.middlemanRoleId}>`);
  }

  // .setfee <fixedFeeInr> <percentFee>
  if (cmd === 'setfee') {
    if (!isAdmin(message.member)) return message.reply('Only admin can set fee.');
    const fixed = Number(args[0]);
    const pct = Number(args[1]);
    if (isNaN(fixed) || isNaN(pct)) return message.reply('Usage: .setfee <fixedInr> <percent>');
    data.config.fixedFeeInr = fixed;
    data.config.percentFee = pct;
    saveData();
    return message.reply(`Fees updated: fixed ₹${fixed}, percent ${pct}%`);
  }
});

// ---------- InteractionCreate for buttons/selects/modals ----------
client.on('interactionCreate', async (interaction) => {
  try {
    // Panel open button
    if (interaction.isButton() && interaction.customId === 'open_ticket') {
      // create a ticket channel under category
      const guild = interaction.guild;
      const opener = interaction.user;
      const name = `ticket-${opener.username}`.replace(/[^a-z0-9-]/gi,'-').toLowerCase();
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: data.config.ticketCategoryId || undefined,
        topic: `ticket-${opener.id}`,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });
      // allow opener & middleman role
      await channel.permissionOverwrites.create(opener.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      if (data.config.middlemanRoleId) await channel.permissionOverwrites.create(data.config.middlemanRoleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });

      // store ticket minimal info
      const ticketId = `ticket-${channel.id}`;
      data.tickets[ticketId] = {
        id: ticketId,
        channelId: channel.id,
        openerId: opener.id,
        otherId: null,
        type: null,
        buyerId: null,
        sellerId: null,
        amount: null,
        amountInInr: null,
        coin: null,
        claimedBy: null,
        tos: null
      };
      saveData();

      // send deal type selection in the ticket
      const emb = new EmbedBuilder().setTitle('Choose Deal Type').setDescription('Select which deal type: INR or Crypto').setColor(0x00AAFF);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`deal_inr:${ticketId}`).setLabel('INR').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`deal_crypto:${ticketId}`).setLabel('Crypto').setStyle(ButtonStyle.Secondary)
      );
      await channel.send({ content: `<@${opener.id}> Welcome! Middlemen will be pinged automatically.`, embeds: [emb], components: [row] });
      await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
      return;
    }

    // Deal type button (INR or Crypto)
    if (interaction.isButton() && (interaction.customId.startsWith('deal_inr:') || interaction.customId.startsWith('deal_crypto:'))) {
      const [action, ticketId] = interaction.customId.split(':');
      const ticket = data.tickets[ticketId];
      if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });
      ticket.type = action === 'deal_inr' ? 'INR' : 'CRYPTO';
      saveData();
      // prompt for other user id
      await interaction.reply({ content: 'Enter the Discord ID of the other party (the one you are trading with). Use the `/adduser` command or type the ID in chat now.', ephemeral: true });
      const ch = await client.channels.fetch(ticket.channelId);
      await ch.send('Please provide the other user ID here (or use /adduser <id>).');
      return;
    }

    // seller confirm/cancel buttons after .dealdone
    if (interaction.isButton() && (interaction.customId.startsWith('seller_confirm:') || interaction.customId.startsWith('seller_cancel:'))) {
      const [act, ticketId] = interaction.customId.split(':');
      const ticket = data.tickets[ticketId];
      if (!ticket) return interaction.reply({ content: 'Ticket gone', ephemeral: true });
      if (act === 'seller_cancel') {
        await interaction.reply({ content: 'Seller cancelled. Middleman will handle disputes.', ephemeral: true });
        return;
      }
      // seller confirmed -> notify mm to release
      await interaction.reply({ content: 'Seller confirmed. Middleman please release payment to seller when ready.', ephemeral: true });
      const ch = await client.channels.fetch(ticket.channelId);
      await ch.send(`Seller confirmed. <@${ticket.claimedBy}>, please release payment to seller's address when ready. After payout, run \`.mmdone\``);
      return;
    }

    // string select menu for confirm roles (buyer/seller)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('confirmRole:')) {
      const [, ticketId] = interaction.customId.split(':');
      const ticket = data.tickets[ticketId];
      if (!ticket) return interaction.reply({ content: 'Ticket not found', ephemeral: true });
      const val = interaction.values[0]; // 'buyer' or 'seller'
      const uid = interaction.user.id;
      if (![ticket.openerId, ticket.otherId].includes(uid)) return interaction.reply({ content: 'You are not in this deal.', ephemeral: true });
      if (val === 'buyer') ticket.buyerId = uid;
      if (val === 'seller') ticket.sellerId = uid;
      saveData();
      await interaction.reply({ content: `You selected ${val}`, ephemeral: true });
      // if both chosen, ask seller for TOS
      if (ticket.buyerId && ticket.sellerId) {
        const ch = await client.channels.fetch(ticket.channelId);
        await ch.send({ embeds: [ new EmbedBuilder().setTitle('Roles locked').setDescription(`Buyer: <@${ticket.buyerId}>\nSeller: <@${ticket.sellerId}>`).setColor(0x00FF00) ] });
        // prompt seller to open modal
        const modal = new ModalBuilder()
          .setCustomId(`sellertos:${ticketId}`)
          .setTitle('Seller Terms of Sale');
        const tos = new TextInputBuilder()
          .setCustomId('tosText')
          .setLabel('Enter Terms of Sale')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000);
        const row = new ActionRowBuilder().addComponents(tos);        modal.addComponents(row);
        // show modal to seller user only if seller is the interaction user or else tell seller to click
        if (interaction.user.id === ticket.sellerId) {
          await interaction.showModal(modal);
        } else {
          await ch.send(`<@${ticket.sellerId}> please submit your Terms of Sale by using the 'Submit ToS' button below.`);
          const btn = new ButtonBuilder().setCustomId(`tos_open:${ticketId}`).setLabel('Submit ToS').setStyle(ButtonStyle.Primary);
          await ch.send({ components: [new ActionRowBuilder().addComponents(btn)] });
        }
      }
      return;
    }

    // seller submitted ToS modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('sellertos:')) {
      const [, ticketId] = interaction.customId.split(':');
      const ticket = data.tickets[ticketId];
      if (!ticket) return interaction.reply({ content: 'Ticket not found', ephemeral: true });
      const tosText = interaction.fields.getTextInputValue('tosText');
      ticket.tos = tosText;
      saveData();
      const ch = await client.channels.fetch(ticket.channelId);
      await ch.send({ embeds: [ new EmbedBuilder().setTitle('Seller Terms of Sale').setDescription(tosText).setColor(0xFFFF00) ] });
      // send accept/deny to buyer
      const accept = new ButtonBuilder().setCustomId(`buyer_accept:${ticketId}`).setLabel('Accept').setStyle(ButtonStyle.Success);
      const deny = new ButtonBuilder().setCustomId(`buyer_deny:${ticketId}`).setLabel('Deny').setStyle(ButtonStyle.Danger);
      await ch.send({ content: `<@${ticket.buyerId}> Please Accept or Deny seller's Terms of Sale.`, components: [new ActionRowBuilder().addComponents(accept, deny)] });
      await interaction.reply({ content: 'ToS submitted.', ephemeral: true });
      return;
    }

    // buyer accept/deny
    if (interaction.isButton() && (interaction.customId.startsWith('buyer_accept:') || interaction.customId.startsWith('buyer_deny:'))) {
      const [act, ticketId] = interaction.customId.split(':');
      const ticket = data.tickets[ticketId];
      if (!ticket) return interaction.reply({ content: 'Ticket not found', ephemeral: true });
      if (act === 'buyer_deny') {
        await interaction.reply({ content: 'Buyer denied ToS. Ticket will be paused until seller updates Terms.', ephemeral: true });
        return;
      }
      // buyer accepted -> ask for amount via modal
      const modal = new ModalBuilder().setCustomId(`amountmodal:${ticketId}`).setTitle('Enter Deal Amount');
      const amountInput = new TextInputBuilder().setCustomId('amountVal').setLabel(ticket.type === 'INR' ? 'Enter amount in ₹ (numbers only)' : 'Enter USD amount (for crypto, enter USD equivalent)')
        .setStyle(TextInputStyle.Short).setRequired(true);
      const coinInput = new TextInputBuilder().setCustomId('coinVal').setLabel(ticket.type === 'CRYPTO' ? 'Enter coin symbol (BTC/USDT/ETH) — optional' : 'Ignore')
        .setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(amountInput), new ActionRowBuilder().addComponents(coinInput));
      await interaction.showModal(modal);
      return;
    }
    // amount modal submission
    if (interaction.isModalSubmit() && interaction.customId.startsWith('amountmodal:')) {
      const [, ticketId] = interaction.customId.split(':');
      const ticket = data.tickets[ticketId];
      if (!ticket) return interaction.reply({ content: 'Ticket not found', ephemeral: true });
      const amountRaw = interaction.fields.getTextInputValue('amountVal');
      const coin = interaction.fields.getTextInputValue('coinVal') || null;
      let amount = Number(amountRaw.replace(/[^\d.]/g,''));
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content: 'Invalid amount provided.', ephemeral: true });
      if (ticket.type === 'INR') {
        ticket.amount = amount;
        ticket.amountInInr = amount;
      } else {
        ticket.amount = amount; // USD amount
        ticket.amountInInr = Math.round(amount * cfg.usdToInr);
        ticket.coin = coin;
      }
      saveData();
      const ch = await client.channels.fetch(ticket.channelId);
      await ch.send({ embeds: [ new EmbedBuilder().setTitle('Deal Amount Set').setDescription(`Amount: ${ticket.type === 'INR' ? `₹${ticket.amount}` : `${ticket.amount} USD (${ticket.coin||'crypto'}) ~₹${ticket.amountInInr}`}`).setColor(0x00FF00) ] });
      return interaction.reply({ content: 'Amount recorded.', ephemeral: true });
    }
    // open ToS modal button (if seller was asked to click)
    if (interaction.isButton() && interaction.customId.startsWith('tos_open:')) {
      const [, ticketId] = interaction.customId.split(':');
      const ticket = data.tickets[ticketId];
      if (!ticket) return interaction.reply({ content: 'Ticket gone', ephemeral: true });
      if (interaction.user.id !== ticket.sellerId) return interaction.reply({ content: 'Only seller can submit ToS.', ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`sellertos:${ticketId}`).setTitle('Seller Terms of Sale');
      const tos = new TextInputBuilder().setCustomId('tosText').setLabel('Enter Terms of Sale').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
      modal.addComponents(new ActionRowBuilder().addComponents(tos));
      await interaction.showModal(modal);
      return;
    }
    // buyer accept/deny buttons handled above
    // seller confirm/cancel handled above

  } catch (err) {
    console.error('interaction error', err);
    if (interaction.replied || interaction.deferred) {
      try { await interaction.followUp({ content: 'An error occurred', ephemeral: true }); } catch(e){} 
    } else {
      try { await interaction.reply({ content: 'An error occurred', ephemeral: true }); } catch(e){} 
    }
  }
});

// LOGIN
client.login(cfg.token).catch(err => console.error('Login failed', err));


---