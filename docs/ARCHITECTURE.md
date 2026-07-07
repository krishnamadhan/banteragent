# BanterAgent — Architecture (one page for a cold-start agent)

> Verified against the code 2026-07-08. Rules live in `CLAUDE.md`; this is the map.
> TypeScript + Node ESM, run by `tsx` (no build step). PM2 name: `banteragent`.
> **THE invariant: never restart this process manually — the WhatsApp auth session
> (`auth/`, chromium profile) is irreplaceable. All deploys are DORMANT until the
> next natural restart** (crash, reboot, or Madhan-approved `!pi restart bot`).

## Runtime model

```
index.ts            boots whatsapp-web.js client (QR auth → auth/), wires:
 ├─ listener.ts     every inbound message → group-config gating, DM-vs-group,
 │                  owner gate (BOT_OWNER_PHONE), !pi intercept → pi-admin.ts,
 │                  then handleMessage → router
 ├─ router.ts       ONE giant switch (~128 `case`s): !quiz !fantasy !led !cosmo
 │                  !roast … → features/*; free chat ("dei claude") → claude.ts
 ├─ scheduler.ts    thin residue — startScheduler(); real cron lives in
 │                  pi-scheduler (separate PM2 app) which POSTs here
 └─ internal-server.ts  HTTP on 127.0.0.1:3099 (LOCAL ONLY):
      POST /        {task: name} → task-runner.ts runTask() — this is how
                    pi-scheduler triggers every scheduled job (morning-roast,
                    fantasy-sync, birthday-check, …)
      POST /cosmo-notify  robot (cognition/notifications.py) + agentboard
                    standup (10:00 IST) send owner-DM messages through this
```

## Key subsystems

- **claude.ts** — all Anthropic calls (Haiku default), personality modes
  (roast/nanban/peter/paati), Tanglish system prompts.
- **features/games.ts** — 17 game types; curated pools + `pool-extra.json`
  (refresh pipeline `!refreshgames add|all` generates + quality-checks new items
  via Claude); used-answer archival per group → `data/used-answers.json` mirrored
  to Supabase `ba_question_archive`; scores → `ba_game_scores(_alltime)`.
- **features/fantasy.ts** — IPL fantasy bridge → ipl11.vercel.app + Supabase
  (`ba_fantasy_state`, `ba_fantasy_ranking`). Season-gated (off-season: AB-016).
- **pi-admin.ts** — `!pi` command tree (health/selfcheck/drift/led/cosmo/restart-
  with-confirm). Restart paths are the ONLY sanctioned way to restart anything.
- **Expenses / construction** — separate group-scoped feature routers (own
  `!help`), tables `ba_expenses`, `ba_expense_settlements`.

## State

- **Supabase** (`supabase.ts`): `ba_game_state` (active games), `ba_game_scores`,
  `ba_game_scores_alltime`, `ba_question_archive`, `ba_group_settings`,
  `ba_group_members`, `ba_member_profiles`, `ba_message_stats`, `ba_polls`,
  `ba_fantasy_state`, `ba_fantasy_ranking`, `ba_cricket_state`,
  `ba_fitness_scores`, `ba_expenses`, `ba_expense_settlements`.
- **Disk**: `.env` (secrets), `data/` (pools, used-answers, stickers, memes),
  `auth/` (WhatsApp session). All three in the 04:00 nightly backup
  (see `/home/pi/RUNBOOK.md`).

## Scheduler interplay

`pi-scheduler` (PM2, `/home/pi/pi-scheduler/index.js`) owns ALL cron timings
(schedule table in its header) and fires them as `POST 127.0.0.1:3099 {task}`.
banteragent's task-runner executes them with full WhatsApp/Supabase context.
System-level cron (backups, lights, drift checks) lives in the pi user crontab —
ownership doc is AB-015.

## Deploy / verify loop

Edit → `npx tsc --noEmit` (must stay clean) → `npm test` (node:test via tsx) →
commit → **wait**. Changes activate at the next natural restart; AB-011 is the
post-restart verification checklist. Never validate by restarting.
