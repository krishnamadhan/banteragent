# BanterAgent — STATE.md
> Single source of truth for session continuity. Updated 2026-07-20.
> Architecture → docs/ARCHITECTURE.md. Board → board list --assignee banteragent.

## Current State (2026-07-20)
**Service:** PM2 `banteragent` — TypeScript/Node ESM via `tsx`. Port 3099 (localhost).
WhatsApp auth in `auth/` (chromium LocalAuth). **ONLINE, ~47MB RSS, 0 restarts today.**
Active groups: Banter Squad (Tanglish/games/AI) + Construction Tracker (expenses).

## Live Feature Categories (see src/help.ts for full command list)
Games (17): `!quiz !riddle !trivia !brandquiz !fastfinger !wordle !anagram !hangman !detective !battle !top10` + control cmds
Chat: `dei claude` (Haiku, 4 personality modes) · Cricket: `!cricket` · Polls: `!poll !vote`
Social: `!roast !praise !ship !vibecheck !summary !roastbattle !gossip !movie !translate !recipe !news`
Utility: `!remind !toss !split !8ball !countdown !quote !pushup !fitboard !myinfo`
Fantasy: `!fantasy !f11 !fl !win` (season-gated, currently off-season)
Solli Adi prediction: `!solli !predict` · Admin: `!pi !led !cosmo !refreshgames !gamecheck`

## Staged-Dormant (merged to master, activates on next natural restart)
- AB-055: closed unguarded restart paths; fixed stale `!run` session context
- AB-056: owner-DM fall-through — admin-handler no longer swallows router cmds
- AB-059: `!riddle` handler; mute duration fix; welcome rewrite; update-bot check
- AB-066: per-chat `recentMessages` buffer (was global — cross-group leak closed)
- `!led bulb` banteragent half (AB-014), `!cosmo` proxy + `/cosmo-notify` (AB-007)

## Next Priorities
| ID | Title | Status |
|----|-------|--------|
| AB-058 | schedule.json SOT + drift validation + !pi jobs | [in progress on board] |
| AB-060 | Command registry → router dispatch + generated !help | [in progress on board] |
| AB-067 | Group memory: !remember / !forget + chat context | [in progress on board] |
| AB-073 | !pi ops: logs \<svc\>, WA session health, offsite backup status | [in progress on board] |
| AB-063 | Strip dead devlog; surface into monitor.jsonl | review |

## Known Issues (none critical post-2026-07-20 merges)
- `pino` dep unused (console.* everywhere) — queued removal
- Per-chat buffer fix (AB-066) staged but not live until restart
- Fantasy crons commented out for off-season (re-enable in task-runner.ts)
- Irfan quiz dataset: 10 shape errors (`npm run lint:irfan` fails) — data fix pending

## Component Status
| Component | Status | Notes |
|-----------|--------|-------|
| PM2 banteragent | ONLINE | :3099 localhost, 47MB RSS |
| WhatsApp client | LIVE | LocalAuth auth/ — never delete |
| Internal HTTP :3099 | LIVE | /run-task /notify /send-media /cosmo-notify |
| pi-scheduler | ONLINE | cron → POST :3099/run-task |
| Supabase (ba_* tables) | LIVE | all active |
| Claude API (Haiku) | LIVE | chat, stickers, game gen |
| !pi admin tree | LIVE | pi-admin.ts |
| !led / robot API bridge | STAGED | activates on restart |
| Voice clone (!clone) | STAGED | AB-050; voicebox PC tunnel :17493 |
| Group memory (!remember) | BACKLOG | AB-067 |

## Deploy Notes
Edit → `npx tsc --noEmit` (must pass) → `npm test` → commit. Changes dormant until restart.
Write `pending-release.txt` before restart → announced → renamed `last-release.txt`.
Restart: `!pi restart bot` + `!pi confirm restart` (owner only, ~30s downtime).
Last verified: 2026-07-20
