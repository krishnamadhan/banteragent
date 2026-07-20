# BanterAgent v3 — Claude Code Context

WhatsApp group bot for one friend group (~7 people). Acts like a funny Tamil friend: Tanglish replies, games, fantasy cricket, expenses/construction tracking, awards, auto-responses.

## Hard Rules
- **Restarting `banteragent` PM2 is SAFE** — WhatsApp auth persists across pm2 restarts (corrected 2026-07-20; Madhan uses `!restart` from his phone as a recovery tool). Avoid gratuitous restarts (drops in-flight messages, ~30s downtime). Code edits stay dormant until restart — ship changes, verify `npx tsc --noEmit`, then restart only when explicitly needed.
- WhatsApp auth lives in `auth/` (puppeteer Chromium profile, gitignored). Never delete or modify. Nightly backup: `~/scripts/nightly-backup.sh` → `~/backups/nightly/`.
- Secrets in `.env` (gitignored). Never commit; never print values.
- Ban-risk: this uses whatsapp-web.js (unofficial). Keep cooldowns/rate limits intact; don't add bulk-send loops.

## Stack (actual — do not trust old docs mentioning Baileys)
- Node.js + TypeScript ESM, run via `tsx src/index.ts` under PM2 (no build step in prod)
- **whatsapp-web.js + puppeteer/Chromium** (`LocalAuth`, dataPath `./auth`)
- Claude API (@anthropic-ai/sdk) · Supabase (Postgres) · sharp/exceljs/qrcode
- Scheduling is EXTERNAL: `~/pi-scheduler` (separate PM2 app) fires cron → `POST 127.0.0.1:3099/run-task` → `src/task-runner.ts`

## Architecture
```
index.ts            client boot, QR, reconnect guard, graceful shutdown
listener.ts         every message: rate-limit, triggers, stickers, auto-response engine
router.ts           !command dispatch (936 lines)
task-runner.ts      named scheduled tasks (called via internal server)
internal-server.ts  HTTP :3099 (localhost): /run-task /notify /send-media /send-sticker /cosmo-notify /apply-fix
claude.ts           Claude API: chat, auto-respond eval, vision
group-config.ts     multi-group support, per-group disabled tasks (reads .env live)
pi-admin.ts         !pi admin commands · admin-handler.ts: owner DM commands
features/           games (2232 ln), fantasy (2190 ln), construction/, expenses/,
                    stickers, picks, solli-adi, profiles, analytics, fun, ...
```

## Conventions & Gotchas
- ESM: relative imports need `.js` extension (`"./listener.js"`)
- JIDs are whatsapp-web.js format: `<phone>@c.us` (person), `<id>@g.us` (group). **Never `@s.whatsapp.net`** — that's Baileys and silently fails here.
- `BOT_OWNER_PHONE` in .env is a bare number (no suffix)
- Runtime state in `data/` (gitignored): sticker-library.json, group-modes.json, used-answers.json
- `bugs.md` = the bug tracker (users file via !bug). GROUPS.md = group registry.
- Heavy features are lazy-imported inside handlers — keep that pattern (startup time)
- Bot replies only in configured groups + owner DMs; Meta AI messages filtered

## Verify Changes
```bash
npx tsc --noEmit        # must be clean — this is the only pre-restart check possible
```
Logs: `pm2 logs banteragent` · `~/logs/banteragent-*.log` · event trail `~/logs/monitor.jsonl`
Internal server test: `curl -X POST 127.0.0.1:3099/run-task -d '{"task":"..."}'`

## Related Docs
- Global Pi rules + port registry: `~/.claude/CLAUDE.md` (3000/3001/3099 belong to this app)
- PM2 topology: `ecosystem.config.cjs` (reconciled with live dump 2026-07-02)
- Design decisions from the original PRD: max 3 emojis, short punchy Tanglish, auto-response max 8/day + 45-min cooldown + night silence 11PM–7AM, one active game per group, IST everywhere
