# TanglishBot v3 — Claude Code Context

## What This Is
A WhatsApp group bot that acts like a real funny Tamil friend. It speaks in Tanglish (Tamil written in English alphabets), plays games, tracks cricket scores, gives weekly awards, and auto-responds to conversations naturally. Built for a single friend group of ~7 people.

## Tech Stack
- **Runtime**: Node.js + TypeScript (ESM modules)
- **WhatsApp**: Baileys (unofficial WhatsApp Web API via WebSocket)
- **AI**: Claude API (Sonnet 4) for all responses
- **Database**: Supabase (Postgres)
- **Scheduler**: node-cron (replaces Vercel cron — this is a persistent process, NOT serverless)
- **Hosting**: Runs on home PC with PM2 for auto-restart

## Architecture
This is a **persistent Node.js process** (NOT serverless). Baileys maintains a WebSocket connection to WhatsApp. The bot:
1. Connects to WhatsApp via QR code scan (linked device)
2. Receives ALL group messages via Baileys event listener
3. Decides whether to respond (command, mention, reply, or auto-response)
4. Sends responses back through Baileys
5. Runs cron jobs for scheduled content (morning roast, horoscope, etc.)

## Key Files
- `src/index.ts` — Baileys connection, QR code, auto-reconnect, group listing
- `src/listener.ts` — Message handler, trigger detection, auto-response engine
- `src/router.ts` — Command routing (!quiz, !cricket, etc.)
- `src/claude.ts` — Claude API (chat, structured output, auto-respond evaluation)
- `src/scheduler.ts` — node-cron jobs for scheduled messages
- `src/features/games.ts` — 7 games (quiz, dialogue, songlyric, wyr, wordchain, antakshari, trivia)
- `src/features/analytics.ts` — Message tracking, stats, awards, lurker detection
- `src/features/cricket.ts` — Live scores + Tanglish commentary
- `src/features/polls.ts` — Polls with Claude-generated options
- `src/features/reminders.ts` — Chat-based reminders with natural time parsing
- `supabase/schema.sql` — Full database schema

## Known Bugs To Fix
1. **cricket.ts**: `checkCricketUpdates` needs to accept `groupId` param (scheduler passes it). Add dedup — store last sent match+score hash to avoid sending same update every 5 mins.
2. **analytics.ts**: Remove `active_groups` table references — not needed for Baileys single-group setup. The `trackMessage` function should just insert into `message_stats`.
3. **games.ts**: `!dialogue` and `!songlyric` commands are in the router but not implemented in games.ts yet. Build them following the same pattern as quiz/trivia.
4. **All feature files**: Import paths use `"../types.js"` etc. with `.js` extension for ESM compatibility. Keep this pattern.
5. **listener.ts**: The `sendMessage` function has a circular import with `index.ts` via `getSock()`. Consider passing the socket instance differently or using a shared module.

## Features From PRD Not Yet Built
Reference: TanglishBot-v2-PRD.docx (in project root or downloaded separately)

### Must Build:
- **Auto-Response Engine**: Core logic exists in listener.ts but needs tuning — the `shouldAutoRespond` Claude call needs testing and the "active chatting detection" (3+ msgs in 2 mins) is just a comment, not implemented
- **!dialogue game**: Guess Tamil movie from a famous dialogue
- **!songlyric game**: Complete the Tamil song lyric
- **!score alltime**: All-time leaderboard (currently only weekly)
- **Weekly leaderboard reset**: Run Monday 12 AM IST, archive weekly scores
- **Auto-game drop**: When group is quiet 2+ hours (9AM-10PM), bot randomly starts a quiz/trivia. Max 2 auto-games per day.
- **Monthly Group Recap**: 1st of each month at 10 AM IST
- **!settings, !mute, !unmute**: Bot settings commands
- **!schedule <feature> on/off**: Toggle scheduled content

### Important Design Decisions:
- Bot personality: Tanglish only, max 3 emojis, short punchy responses, Chennai slang
- Auto-responses: Max 8/day, 45-min cooldown, no night mode (11PM-7AM), silent when humans are actively chatting
- Games: One active game per group, 30-min expiry, leaderboard has weekly reset + all-time
- Cricket: Key moments only (wickets, milestones, results), NOT every ball/over
- All times are IST
- The bot only operates in ONE configured group (BOT_GROUP_ID in .env)

## Commands to Run
```bash
npm install          # Install dependencies
npm run dev          # Dev mode with hot reload (tsx watch)
npm run start        # Production mode
```

## First Run Flow
1. `npm run dev` → QR code appears in terminal
2. Scan with spare phone's WhatsApp (Settings → Linked Devices)
3. Bot connects and lists all groups with their IDs
4. Copy target group ID → paste into `.env` as BOT_GROUP_ID
5. Restart → bot is live in your group

## Ban Risk Mitigation (Baileys)
- Use a SPARE number, never your main WhatsApp
- Don't send too many messages too fast
- The auto-response cooldowns help with this
- If banned: get new SIM, re-scan QR, bot is back
- Your main number and friend group are never at risk
