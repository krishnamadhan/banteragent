# BanterAgent v2 Overhaul — Plan & Live Status

> **Resume protocol:** if a session dies (usage limit etc.), the next session reads this
> file + `git log --oneline -10`. Every phase commits separately. Update checkboxes as
> phases land. NEVER restart the banteragent PM2 process — all changes stay dormant
> until its next natural restart.

**Directive (Madhan, 2026-07-02):** Overhaul Banter Squad experience (v2) — refresh
features/prompts/interactions, add/remove games, keep Tanglish. Clean codebase (unwanted
files, outdated features, duplicate commands). Construction group: UNTOUCHED. Disable
agent in ALL other groups (Fantasy League, Expenses*, temp features Election/RCB).
Improve admin commands: observability, routine checks, Pi/Cosmo control.
(*Expenses = "other group" by the letter of the directive — flagged to Madhan, re-enable
is a one-line change in group-config.ts.)

After banteragent v2 → Cosmo phase: memory bloat + bluish camera (separate plan).

---

## Phase 1 — Scoping: disable other groups, remove temp features ✅ pending
- [ ] group-config.ts: add `disabled` flag; disable Fantasy League + Expenses groups
      (registry entries kept for easy re-enable; listener/tasks skip disabled groups)
- [ ] Remove election feature: src/features/election.ts + router !tn/!tnlist cases
- [ ] Remove RCB finals: src/features/rcb-finals.ts, !jinx/!antijinx, rcb_fan mode,
      task-runner rcb-finals-live, pi-scheduler commented cron
- [ ] pi-scheduler: disable fantasy-* crons (season over; they hit Cricbuzz/Supabase
      every 5 min for nothing) — keep code in fantasy.ts for next season
- [ ] tsc clean + commit

## Phase 2 — Codebase cleanup ✅ pending
- [ ] Remove src/devlog.ts if unused/stale (check imports first)
- [ ] Remove send_video.mjs (May one-off)
- [ ] Dedupe commands: !summary (expenses vs catchup collision), !split (expenses vs
      random-teams collision), !toss vs !8ball overlap — resolve per-group
- [ ] Prune !help to match reality; remove dead command listings
- [ ] tsc clean + commit

## Phase 3 — v2 experience: prompts + engagement (the creative core) ✅ pending
- [ ] prompts.ts: rewrite buildMainModePrompt — sharper Tanglish personality, current
      (post-IPL) context, better memory of group lore; drop rcb_fan mode; consider new
      mode ("thala"? "kadhal"? decide while writing)
- [ ] Auto-response: refresh shouldAutoRespond prompt for wittier, rarer, higher-quality
      interjections
- [ ] Games refresh in games.ts:
      - CUT stale/low-effort: memory (unclear UX), tamilproverb (repetitive)
      - KEEP core: quiz, trivia, wordle, dialogue, songlyric, antakshari, wordchain,
        fastfinger, mostlikely, storytime, riddle, battle/top10
      - ADD (pick 2-3): !confession (anonymous confession drop via DM→group),
        !thisorthat (rapid-fire Tamil culture edition), !detective (daily one-clue
        mystery, group guesses), !dubsmash (bot gives a dialogue, members voice-note it,
        bot judges) — feasibility check first
- [ ] Scheduled content refresh in task-runner: morning-roast → rotate formats
      (roast/appreciation/throwback/prediction); retire weekend-prompt if stale
- [ ] tsc clean + commit (may be several commits)

## Phase 4 — Admin: observability + Pi/Cosmo control ✅ pending
- [ ] !pi: add `backup` (last nightly-backup status), `disk`, `top`, `uptime`, `net`
      (tailscale status), consolidated `!pi health` one-shot dashboard
- [ ] !pi checks — routine check runner: pm2 status, disk, temp, backup age, log errors
      count, banteragent internal-server ping — one command, traffic-light output
- [ ] !cosmo: add `mem` (RSS + budget check), `cam` (snapshot status), keep existing
- [ ] Wire pi-monitor alert → owner DM when backup missing >48h (config.json has hooks?)
- [ ] tsc clean + commit

## Phase 5 — Docs + wrap ✅ pending
- [ ] Update GROUPS.md (2 active groups), CLAUDE.md commands section, bugs.md sweep
- [ ] Final report to Madhan

## Phase 6 — Cosmo (separate directive, after v2)
- [ ] Investigate memory bloat (sudden RSS growth; RSS ~1GB, budget 500MB)
- [ ] Camera bluish tint (sw_b 0.88 calibration seems insufficient — check tuning file
      loading + AWB gains actually applied)

---

## Status log
- 2026-07-02 10:25 — Plan written. Starting Phase 1.
