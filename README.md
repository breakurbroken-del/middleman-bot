# Discord Middleman Bot

A Midman ticket system for Discord (INR / Crypto deals).  
This repository includes a single-file bot suitable for Acode/mobile, GitHub, and Render deployment.

## Quick setup (mobile-only, no Termux)
1. Create a repo on GitHub (new).
2. In Acode, create files: `index.js`, `package.json`, `config.example.json` (copy to `config.json` locally for testing).
3. Replace values in `config.json` (guildId, role IDs, category ID).
4. Locally test (optional), or push to GitHub and deploy on Render.

## Environment variables (recommended for Render)
- `TOKEN` - Discord bot token (REQUIRED)
- `GUILD_ID` - Guild ID
- `MIDDLEMAN_ROLE_ID` - Role ID for middlemen
- `BUYER_ROLE_ID`, `SELLER_ROLE_ID` - optional
- `TICKET_CATEGORY_ID` - category where tickets create
- `LOG_CHANNEL_ID` - optional log channel
- `USD_TO_INR` - exchange rate (default 83)
- `FIXED_FEE_INR` - default 5
- `PERCENT_FEE` - default 1.0

> On Render, add these in Service → Environment → Environment Variables. Render injects them at runtime; do not commit your `.env`. (Render docs: environment variables). 2

## Important: Discord Intents
Enable **Message Content Intent** and **Server Members Intent** for the bot in the Developer Portal. The bot uses `GatewayIntentBits.MessageContent` and `GuildMembers`. (discord.js docs). 3

## Commands (prefix `.`, use inside ticket)
- `.panel` - admin posts panel with Open Ticket button
- `.claim` - middleman claims the ticket
- `.unclaim` - release claim
- `.tos` - middleman post fee reminder + ask to send QR
- `.paydone` - mark mm payment done
- `.role @buyer @seller @role` - assign role
- `.dealdone @seller` - ask seller to confirm
- `.mmdone` - mm confirms payout to seller; transcript DM and close
- `.close` - force close (admin or mm)
- `.setrole <roleId>` - admin set mm role
- `.setfee <fixed> <percent>` - admin set fees
- `.help` - command list

## Deploy to Render
1. Connect GitHub → Select repo → New Web Service.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add environment variables in Render dashboard (TOKEN etc.).
5. Deploy. See Render docs for details. 4

## Notes & TODO
- This is a single-file starter. For production split into command & event files.
- For persistent DB across restarts consider MongoDB (Render can connect to a cloud Mongo service).
- The file `data.json` will store tickets and config — do not commit secrets to GitHub.
