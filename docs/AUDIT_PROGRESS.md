# AUDIT_PROGRESS.md — Banter Agent V2 Autonomous Improvement

> **THE resume anchor.** Any session (human-started or watchdog-spawned) reads this
> first and continues from "Next actions". Update after every meaningful milestone.
> Watchdog: `~/scripts/claude-resume-watchdog.sh` (cron */30) auto-resumes when
> STATUS is `active` or `paused-limit`. Kill switch: `touch ~/.claude-watchdog-disabled`.

STATUS: active
LAST CHECKPOINT: 2026-07-02 15:10 IST
CURRENT OBJECTIVE: continuous-improvement loop (charter below)

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
- [ ] Self-review pass over v2 prompts after a few days of real group usage
- [x] docs/FANTASY_REENABLE.md — 6-step checklist

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
