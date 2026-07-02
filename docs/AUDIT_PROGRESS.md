# AUDIT_PROGRESS.md — Banter Agent V2 Autonomous Improvement

> **THE resume anchor.** Any session (human-started or watchdog-spawned) reads this
> first and continues from "Next actions". Update after every meaningful milestone.
> Watchdog: `~/scripts/claude-resume-watchdog.sh` (cron */30) auto-resumes when
> STATUS is `active` or `paused-limit`. Kill switch: `touch ~/.claude-watchdog-disabled`.

STATUS: idle
LAST CHECKPOINT: 2026-07-03 03:35 IST
CURRENT OBJECTIVE: caught up — watchdog stood down (see note)

> **WHY IDLE (2026-07-03 03:35):** The autonomous loop has completed every safely-
> actionable item. Both remaining Pending items are GATED, not skipped:
>   1. Usage-data prompt tuning — needs live group logs; revisit ~2026-07-06.
>   2. recentMessages per-group refactor — needs SUPERVISED live-bot testing.
> Rather than spawn a full session every hour to conclude "nothing to do" (burning
> the 6/day cap + tokens), STATUS is `idle` so the watchdog stands down cleanly.
> **TO RESUME:** set `STATUS: active` when (a) it's ~2026-07-06 and logs exist, or
> (b) you start a supervised session for the recentMessages fix, or (c) new work is
> queued below. Usage-limit recovery still works: a session that hits a limit sets
> `STATUS: paused-limit` itself, which the watchdog also acts on.

---

## Charter (improved version of Madhan's 2026-07-02 directive)

Transform the BanterAgent + Pi ecosystem into polished, self-sustaining production
quality. Never consider it "done" — after each milestone, self-review and pick the
next highest-value item. Amendments to the original prompt (documented reasoning):

1. **Supervisor**: PM2 `claude-remote` (boot via systemd pm2-pi.service → pm2
   resurrect) IS the supervisor — restart-on-crash, fast-restart backoff guard,
   logrotate. A parallel systemd+tmux supervisor is REJECTED: duplicate Claude
   sessions caused the mypi/Pi-Control conflict fixed 2026-07-02 morning.
2. **Camera colour**: current output APPROVED by Madhan (2026-07-02). Achieved by:
   R/B swap fix + auto-AWB + neutral color.toml + fast path that skips ALL software
   colour math. Do NOT re-add modifiers; do NOT delete the dormant dashboard tuning
   path (zero runtime cost, useful for future manual tuning). Memory:
   feedback_camera_colour.md.
3. **Usage limits**: cannot be bypassed. Recovery = external cron watchdog
   (backoff, daily cap 6, kill switch) that spawns `claude -c -p` resume runs.
4. **Questions**: programmatic dedupe + targeted quality pass (not full regen).
5. **Hardware tests**: sensors/motors/OLED not wired — unit+mock+API tests only.

## Completed (2026-07-02, all pushed)

- **Pi audit + cleanup**: 4.5GB reclaimed; lightdm/cups/tor/openvpn disabled;
  duplicate systemd claude-remote killed; hardware watchdog (15s) enabled;
  nightly backups (WhatsApp session + state + pi-infra, retention 3, 04:00 cron);
  logrotate for ~/logs; pi-monitor stderr→stdout fix.
- **BanterAgent v2** (LIVE since 11:21 IST restart; release announced to group):
  scoped to Banter Squad + Construction (fantasy/expenses groups disabled: flag);
  election+RCB removed; paati mode; !detective game; 7 rotating morning formats;
  high-bar auto-response; !pi health/backup/top; restart confirm gates; !cosmo mem;
  /cosmo-notify @c.us fix verified end-to-end; reconnect guard.
- **Cosmo** (LIVE): R/B channel-swap colour fix (root cause of blue cast);
  yolo11n.onnx detector (torch uninstalled — was dead weight after broken
  torchvision, HOG fallback); CPU 327%→17%, RSS 1031→837MB, temp 64→55°C;
  stream 503 slot-leak fix (inline encode + 30s write watchdog).
- pi-scheduler: fantasy crons disabled off-season; dead code removed.
- Docs: banteragent CLAUDE.md rewritten (was describing Baileys), GROUPS.md,
  robot STATE.md, KI-025 (face re-enroll needed).

## Pending (priority order)

- [x] Usage-limit resume watchdog — installed, cron */30, dry-run verified (clean skip on active session)
- [x] Camera colour memory file — feedback_camera_colour.md + MEMORY.md index
- [x] UPS mock drain restored (sensor_manager.py) — robot suite 214 passed, 0 failed
- [x] Question pools: 305 scanned, 0 true dupes; FIXED Baasha/Padaiyappa swapped attributions + replaced duplicate variant with real Padaiyappa line
- [x] project_banteragent.md rewritten (was 58d stale, pre-v2) · remaining stale: bspl/ipl/esp32/llm_bench/other/credentials/ipl_spec — verify on next relevant session, not blind-bumped
- [x] devlog audited: gated behind DEV_LOG=1, localhost:4321, zero prod cost — KEEP
- [x] listener.ts: quoted message fetched ONCE per handleMessage (was 3×) — dac670f
- [x] pino removed from dependencies (console.* is the logging reality) — dac670f
- [x] Startup speed: 5s process→WhatsApp-connected (14:22 restart logs) — no action needed
- [x] Latency: routeMessage timed in listener; >3s logged with [latency] tag — dac670f
- [x] Security review: pi-admin args exact-matched/parseInt-capped; cosmo pm2 branch gated to literal start/stop; /trigger paths hardcoded; :3099 localhost-only. NO injection paths.
- [x] Sticker picker hardened: deterministic low-cost pass first; Claude JSON output must resolve to a real candidate ID or 1-based candidate index; routine commands skip sticker picking.
- [x] Stale Claude model IDs removed from fantasy/fitness feature calls; defaults now flow through CLAUDE_* model env vars with Haiku fallback.
- [x] Reminder dispatch bug fixed: due group reminders now send to each reminder row's stored group_id, not the scheduler loop group.
- [x] Owner/admin phone normalization centralized: exact bare-number comparison for BOT_OWNER_PHONE/PI_ADMIN_NUMBER and normalized @c.us outbound owner/admin DMs.
- [x] Stale active game cleanup + loud create failures: expired rows are deactivated before lookup/create; failed game/lobby DB writes now log and surface a retry message.
- [x] Quote persistence: quotes now lazy-load/save to data/quotes.json instead of disappearing on restart.
- [x] Question-bank linter added: npm run lint:irfan validates /home/pi/irfan-shorts/questions_clean.json shape. Current data intentionally fails with 10 shape errors to fix in the Irfan dataset.
- [x] Self-review pass over v2 prompt TEXT (quality/consistency) — found + fixed: peter
      mode had NO safety rules (omitted sharedRules); split safetyRules() from style so
      every mode carries the caste/religion/gender + politics + cricket + game guards.
- [x] docs/FANTASY_REENABLE.md — 6-step checklist
- [ ] Usage-data-driven prompt tuning — revisit ~2026-07-06 after real group logs
      accumulate (tone calibration, auto-response hit rate). Deferred: needs live data.
- [ ] recentMessages buffer is GLOBAL across groups (listener.ts) — with 2 groups active,
      Banter Squad auto-response context can include Construction messages. Fix: per-group
      Map keyed by groupId. Touches exported API (listener/task-runner/fun, ~20 call sites)
      → do SUPERVISED so the bot can be tested after restart, not in an unattended run.
      Low current impact (Construction doesn't auto-respond/free-chat).

## Known issues / constraints

- banteragent restart requires WhatsApp session care — !pi confirm restart flow
- Cosmo RSS 837MB vs 500MB budget: legit residency (whisper base.en ~200MB).
  Levers: tiny.en (worse STT) or FER-5 emotion (ADR-014). Awaiting Madhan call.
- KI-025: face re-enrollment needs Madhan+Indhu present.
- (resolved) Robot unit suite green: 214 passed.

## Restart instructions (for a fresh session)

1. Read this file + `git -C /home/pi/banteragent log --oneline -10` +
   `git -C /home/pi/robot log --oneline -5`.
2. NEVER restart banteragent without !pi confirm flow / explicit Madhan approval.
3. Work top-down through "Pending". Commit per logical change, push, update this
   file, then continue. Self-review after each milestone.
4. Cosmo may be restarted freely. banteragent may NOT.

## Log

- 2026-07-02 12:40 — Charter accepted with amendments; progress file created.
- 2026-07-02 13:05 — Watchdog installed+verified; camera memory locked; UPS mock fixed
  (robot suite green 214); question pools audited (3 attribution fixes); banteragent
  memory rewritten; devlog audited. Next: pino removal, quoted-msg perf, latency logging.
- 2026-07-02 15:10 — (watchdog resume) Landed work stranded uncommitted by session cutoff:
  Bug #90 !skip fix + model-ID env overrides (4d84cb2, from interim session) and
  quoted-msg single-fetch + latency log + pino removal (dac670f). tsc clean, tree clean,
  pushed. All dormant until next banteragent restart. Next: startup-speed measurement,
  !pi runSafe arg hardening.
- 2026-07-02 14:45 — Perf (quoted-msg, latency log, pino), Bug #90 (!skip, other stream),
  startup measured (5s, fine), security review clean, FANTASY_REENABLE.md. All initial
  charter pending items DONE. Remaining continuous-improvement: prompt self-review after
  real usage (queued for +3 days), Cosmo RSS budget decision (Madhan), face re-enroll.
- 2026-07-02 15:05 — Watchdog hardened after self-review: explicit PATH/HOME for cron
  env; fresh-session fallback when `-c` resume is unusable (AUDIT_PROGRESS + memory
  carry enough context without conversation history). VERIFIED: headless spawn under
  cron-equivalent env (`env -i`) returned WATCHDOG-SPAWN-OK. Untestable until a real
  limit: the -c path against a limit-stuck conversation — covered by the fallback.
- 2026-07-02 15:50 — Watchdog POST-MORTEM from first real limit (12:40-14:40): resume
  WORKED (15:00 run completed Bug #90 items, 20 min after reset) but limit errors at
  13:00/14:00 were mislabeled "finished" — real message says "session limit", regex
  only matched "usage limit". FIXED: broadened regex (verified vs real message), parse
  exact reset time from error → wake 5 min after reset (verified: "2:40pm"→14:40),
  limit hits no longer consume the daily spawn cap.
- 2026-07-02 18:50 — BanterAgent audit follow-up: sticker selection now validates
  Claude output against actual candidates (including numeric list choices), uses a
  deterministic local match before Claude, and skips sticker matching for routine
  commands. Fantasy/fitness Claude calls no longer hardcode stale Sonnet IDs and
  default through env-overridable Haiku-class model names. Dormant until restart.
- 2026-07-02 19:20 — Audit priority batch: fixed reminder routing to stored
  reminder targets, centralized exact owner/admin phone matching, cleaned expired
  game rows before lookup/create, made game DB create failures visible, moved quote
  storage to data/quotes.json, and added scripts/lint-irfan-questions.mjs. The
  Irfan linter currently reports 10 real shape errors in questions_clean.json; no
  data rewrite done in this BanterAgent pass.
- 2026-07-03 01:35 — (watchdog resume) v2 prompt self-review (text/quality pass). Found
  peter mode carried ZERO safety rules — it omits sharedRules() because its broken-English
  identity contradicts Tanglish-only, but that also dropped the caste/religion/gender +
  politics + cricket-score + stateful-game guards. Split safetyRules() (universal) from
  sharedRules() (Tanglish style); all 4 modes now verified to include the safety floor.
  tsc clean, committed, pushed. Dormant until banteragent restart. Usage-data-driven tuning
  re-queued for ~2026-07-06 (needs live logs). No other Pending items remain actionable now.
- 2026-07-03 02:35 — (watchdog resume) Sole remaining Pending item (usage-data prompt
  tuning) is NOT due — dated ~2026-07-06 and needs live group logs that don't exist yet;
  did NOT fabricate it. Assessed the recentMessages-global-buffer bug: real but low current
  impact + moderate cross-file API refactor (~20 call sites) → queued as SUPERVISED item,
  not rushed unattended. Instead did a zero-risk high-value fix: reconciled robot
  docs/STATE.md (was falsely claiming cosmo REMOVED / LED API down / ambilight inactive —
  cosmo is online with led_service + fully colour-calibrated ambilight). Pushed to robot
  repo. banteragent tree untouched this run.
- 2026-07-03 03:35 — (watchdog resume #4) Autonomous loop CAUGHT UP. Both remaining
  Pending items are gated (usage-tuning needs data ~2026-07-06; recentMessages needs
  supervised testing) — neither is safe/appropriate for an unattended run. Rather than
  fabricate work or rush the refactor, set STATUS: idle so the watchdog stands down
  (it was spawning hourly, 3/6 daily cap, each concluding "nothing to do" — wasteful).
  Fully reversible: flip STATUS: active to resume. Usage-limit recovery unaffected
  (paused-limit path still honored). No code touched this run.
