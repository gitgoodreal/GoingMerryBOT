# Den Den Mushi Bot

A One Piece-themed Discord bot with persistent player progression, crew management, battles, raids, crew wars, trivia, and daily prompts.

## Requirements

- Node.js 20 or newer
- A Discord application and permission to add its bot to your server

## Setup

1. Create a Discord application at https://discord.com/developers/applications and create a bot.
2. Under **OAuth2 → URL Generator**, select `bot` and `applications.commands`, then invite the bot to a test server with the required channel permissions.
3. Copy `.env.example` to `.env` and set:
   - `DISCORD_TOKEN` — the bot token (keep it secret)
   - `CLIENT_ID` — the Application ID from **General Information**
   - `GUILD_ID` — your test server ID; optional if you want global command registration
   - `DATABASE_PATH` — optional SQLite file path; defaults to `data/den-den-mushi.sqlite`
4. Enable the **Message Content Intent** in the Discord Developer Portal. Daily missions and hero chat XP use regular text messages, so this privileged intent is required for both.
5. Install, register commands, and start the bot:

   ```bash
   npm install
   npm run register
   npm start
   ```

Use `npm run dev` for Node's watch mode and `npm test` to run the automated tests. Keep `.env` and the SQLite database private; both are excluded from Git.

## Features

- Profiles, Berries, daily rewards, bounties, leaderboards, achievements, and transaction history
- Canvas-generated profile, inventory, bounty, wallet, and achievement cards
- Ranked Canvas cards for Berries, bounty, crew, raid damage, and Trivia leaderboards
- Character collection and shop, turn-based player battles with character passives, cooperative raids, and crew wars
- Hero levels and per-character raid energy upgrades
- Crews with invitations, captain/officer roles, member management, and rankings
- Rotating daily chat missions, automatic One Piece trivia with 60+ questions, Prompt of the Day, and social actions
- SQLite persistence

New members can start with `/start`, then try `/daily`, `/profile`, and `/shop` followed by `/buy`. They do not need to learn every command at once; `/help` opens a private dropdown guide for commands, activities, actions, and emotes.

`/profile`, `/inventory`, `/bounty`, `/balance`, and `/achievements` display stats as image cards. `/wanted` remains its own separate poster.
`/leaderboard`, `/bounty-top`, `/crew leaderboard`, `/raid leaderboard`, and `/trivia leaderboard` show ranked image cards. Player cards include avatars and display names, keep ten slots per page, and offer page navigation when more than ten entries exist; a text fallback is used if card rendering fails.

`/start` begins a pirate's journey and opens a private interactive guide. Players who use it become eligible for the global Berries and bounty leaderboards and server activity leaderboards; creating a player record through other commands does not opt them in.

## Automatic character replies

- Messages that mention the Straw Hats or recurring major characters can trigger a character-specific reply. Each Straw Hat has nine original reply options; other major characters have multiple options. If a message mentions more than one, the bot replies once for a randomly selected match.
- Character reply frequency is unchanged: keyword matches follow the existing per-user cooldown, and unrelated chat keeps the existing low random-reply chance.
- To add hand-picked reactions, put one GIF per character in `assets/reactions/` using that character's ID as the filename (for example, `luffy.gif`, `big-mom.gif`, or `bon-clay.gif`). Without a matching file, the character reply is text-only.

## Channel setup

- Server admins with **Manage Server** can run `/setup`, choose a feature from the dropdown, then select its channel. Start with **Player and economy commands** so new members can use `/daily`, `/profile`, `/shop`, and `/buy`; configure other features only if your server wants to use them. You can add or change channels later.
- Player/economy, player battles, crews/crew wars, raids, Trivia, and Prompt of the Day commands and interactive controls are restricted to their selected channels. Configure each feature before using its commands.
- Trivia and Prompt of the Day use the selected channel for scheduled posts as well. A server moderator uses `/trivia-admin start` to begin Trivia; POTD uses its saved/default schedule. Existing Trivia and POTD channel settings are carried forward.
- Trivia waits until its configured channel has been quiet for five minutes before posting, and leaves at least ten minutes between rounds. Only human messages in that Trivia channel affect the quiet period; channel activity is saved across restarts.
- Daily missions, help, and social actions are not part of this channel setup.

## Crews

- Crews, memberships, crew points, and crew wars are isolated per server. A player can join one crew in each server.
- Crew creators become captains; captains can promote officers.
- Captains and officers can invite members. Captains can promote members; officers cannot remove the captain or other officers.
- Captains can use `/crew edit` to update the crew name, tag, and description together or individually. Use `-` for the description to clear it. Name and tag changes are checked against other crews in the server and recorded in the private crew log with before-and-after values.
- Captains can use `/crew banner image:<image>` to upload a PNG or JPEG up to 8 MB (maximum 4096×4096 pixels and 8 megapixels), then use the private preview's arrow and zoom buttons to crop it before saving. The bot adds the crew name and tag and shows the banner in `/crew info`. Use `/crew banner-reset` to remove it.
- The private crew log uses structured activity cards with crew identity, time, change details, and a banner preview when a banner is changed or removed.
- The first crew creation provisions a private `#crew-logs` channel. The bot denies channel visibility to `@everyone` and grants read access to roles with server-management or common moderation permissions. The bot needs **Manage Channels** and **Manage Roles**. Crew creation, membership and role changes, banners, points, and crew-war activity are logged from setup onward; earlier activity is not backfilled.
- `/crew disband confirm:<crew name>` permanently disbands a crew. The exact crew name is required, and crews in an active war must finish it first.
- Crew captains start wars themselves with `/crew-war challenge crew:<crew>`; the challenged crew's captain accepts or declines from the challenge message. Server moderators can still force-start or force-finish a war with `/crew-war-admin`.
- Crew wars use interactive member duels: use `/crew-war fight opponent:<member>` to challenge someone from the opposing crew. The opponent accepts, each player selects an owned fighter, then players take turns using attack, special, defend, and recover actions.
- A duel victory scores one point for the winner's crew. Each member can complete one duel per war; draws and abandoned duels do not score or use up either fighter's match. `/crew-war score` shows the score and recent duel results.
- The first crew to 10 duel wins takes the war automatically; if neither crew has enough unused members to reach 10, the war ends when no more member duels are possible. Other duels already in progress settle before the final result. The winning crew receives 10 crew points. Moderators can force-finish a war or cancel a stuck challenge, but active duels must resolve or time out first.
- Server moderators manage raids with `/raid-admin start` and `/raid-admin end`. Players choose a fighter once from the raid panel, then use its Attack and Special buttons. Attacks cost 20 energy and specials cost 40; whenever energy drops below its maximum, a 60-second recharge countdown starts. Players can keep using moves during the countdown if they have enough energy; when it ends, energy refills to full. `/hero upgrade-energy` permanently adds 10 max energy per upgrade, up to 10 upgrades per character. `/raid status`, `/raid leaderboard`, and `/raid rewards` remain available in the configured channel.

## Player battles

- Challenge a pirate with `/battle challenge member:<member>`. After they accept, both players choose a character they own; the first combat turn is randomized.
- Take turns using Attack, Special, Defend, or Recover. The battle panel shows the round, health, available moves, and whose turn it is; each turn has a 90-second limit.
- Luffy can recover once when low on health, Zoro adds attack damage, Nami boosts her special, Chopper recovers more HP, and Franky reduces incoming damage.
- Characters level globally from 1 to 100. The selected fighter earns XP after a completed duel; the winner gets 30 XP and the other fighter gets 15 XP. Each level requires 100 × the current level XP, and each level above 1 increases HP by 5% and ATK/DEF by 2% (rounded).

## Hero progression

- Use `/hero set-base character:<character>` in each server to choose which owned character earns XP from chat there. The selection is server-specific, while that character's XP and level are shared across servers.
- Eligible non-empty human messages award the base hero 5 XP, at most once per minute and up to 100 chat XP per UTC day. Completing and claiming a daily mission awards the base hero 25 XP. The first raid action by a fighter in each raid awards it 20 XP.
- Whenever chat, mission, raid, or battle XP raises a hero's level, the bot immediately posts a compact image announcement featuring that character's artwork and new level.
- XP is free; ordinary level-ups never spend Berries. A hero's XP progression is complete at level 100.
- Use `/hero upgrade-energy character:<character>` to buy permanent raid energy capacity upgrades. Each adds 10 max energy, up to 10 upgrades (200 max energy). Upgrade costs increase by 1,000 Berries per rank: 1,000 for the first, 2,000 for the second, and so on.
- `/inventory` shows each character's level, XP progress, and raid energy capacity.

## Daily missions

- A different chat mission rotates each UTC day. The default rotations require 3, 5, or 8 messages and award 150, 250, or 400 Berries.
- Non-empty text messages from people count; bot and webhook messages do not. Mission settings, progress, and claims are separate for each server.
- `/mission current` shows progress and `/mission claim` awards the reward once the goal is met. The bot posts a completion message when you reach the goal.
- Members with **Manage Server** permission can use `/admin mission day:<today|tomorrow|day-after>` to set the message goal and reward for a specific UTC day's mission in that server. This avoids needing to know which rotation is active, and does not change missions on other servers. Berries are shared on the player's account; crew points belong to the server-specific crew. `/admin crew-points` adjusts a crew's points.

Player accounts (including Berries, bounties, character collections, and player battle records) and their global leaderboards are shared across servers. Server activities, missions, crews, and wars stay within their server. On upgrade from the older global crew schema, legacy crews are assigned to `GUILD_ID` when it contains a numeric server ID; otherwise they are preserved under `legacy-unassigned` and won't appear in any server.

## Operations

Test the bot in a private server before launching it. Back up the SQLite database before making manual changes. Never commit or share the bot token or `.env` file.
