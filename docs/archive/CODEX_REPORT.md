# Codex Report: Games Hardening V2

## Summary

Built the requested games extensions on the Pi production checkout only, from fresh `origin/master`: pool exhaustion status, low-buffer alerts, owner refresh-add/reset, persistent supplemental pools, rule and semantic quality checks, quarantine support, and updated docs. Final state: implemented and verified with mocked tests; no PM2 restart was run.

## Per-Phase Status

| Phase | Done? | Delivered | Gaps/shortcuts |
|---|---:|---|---|
| Step 0 sync | ? | Ran `git checkout master`, `git fetch origin`, `git reset --hard origin/master`, `npm install`, baseline `npm test`, and `npx tsc --noEmit` on `/home/pi/banteragent`. Baseline showed 13 pass / 0 fail. | None. |
| Phase A | ? | `LOW_WATERMARK`, `getPoolStatus(groupId)`, low-pool POST debounce via `data/low-pool-alerts.json`, start hooks for quiz/brandquiz/trivia/fastfinger/default Wordle, and `!gamestats` remaining/color output. | Low-pool POST is tested with mocked `fetch`, not the live Cosmo endpoint. |
| Phase B | ? | Owner-only `!refreshgames add <game> [N]`, `!refreshgames reset <game>`, mocked generation, dedupe vs pool/archive, append to `data/pool-extra.json`, merged pools at pick time. | Legacy `!refreshgames confirm` remains for backward compatibility. |
| Phase C | ? | Rule validator, batched Claude semantic validator, SHA-256 cache in `data/game-quality-cache.json`, owner-only `!gamecheck <game> [quarantine]`, quarantine file exclusion. | Claude behavior is mocked in tests; a small live owner check is recommended before relying on generated content. |
| Docs/final | ? | `docs/GAMES_TESTING.md` and this report. | None. |

## Test Coverage

Final `npm test` pass line: `# pass 20`, `# fail 0`.

Coverage by area:

- Existing baseline pure tests: 13.
- Pool status and low-pool notify: 2.
- Quality rules, refresh add, semantic drop, semantic fail-closed, quarantine: 5.

Skipped/xfail tests: none.

## Bugs Found & Fixed

No new production bug was confirmed during this work, so no `bugs.md` entry was added.

## New Commands/Behavior

- `!refreshgames add <game> [N=20]`: owner-only. Supports `quiz`, `brandquiz`, `trivia`, `fastfinger`, `wordle`, `anagram`, and `hangman`. Generates, validates, dedupes, appends survivors, and replies with added/rejected/remaining.
- `!refreshgames reset <game>`: owner-only. Resets only that game archive. For `wordle`, it resets the `wordle500` archive.
- `!gamecheck <game> [quarantine]`: owner-only. Reports failure count and reasons; optional `quarantine` excludes failures from pick logic.
- Low-pool alert: posts once per game per IST day to `http://127.0.0.1:3099/cosmo-notify` with `{"message":"?? <game> pool low: N left. !refreshgames add <game>"}`.
- `!gamestats`: now shows red/yellow/green status and remaining counts.

## Files Changed

- `src/features/games.ts`: pool status, low-buffer alerts, supplemental/quarantine pools, refresh add, validators, semantic cache, test hook.
- `src/router.ts`: owner command routing for refresh add/reset and gamecheck; gamestats status output.
- `src/features/games.test.ts`: node:test coverage for new behavior with mocked `fetch` and mocked `generateStructured`.
- `docs/GAMES_TESTING.md`: testing guide and runtime data files.
- `docs/CODEX_REPORT.md`: this handoff report.

## Assumptions & Risks

- Work was performed only on the Pi at `/home/pi/banteragent` after the correction.
- PM2 was not run or restarted.
- Supabase and Claude live services were not exercised by tests.
- `WORDLE500` is the default 5-letter Wordle pool; `!wordle tamil` remains the old Kollywood mode and is not included in finite low-buffer status.
- Generated semantic responses fail closed when unparseable, which is safer but can reject good generated items if Claude formats badly.

## Recommended Next Steps

1. Review prompt wording in `refreshPrompt` and semantic quality prompt.
2. Run one live owner-only `!gamecheck quiz` and one small `!refreshgames add fastfinger 2` after review.
3. Decide later whether to remove the legacy `!refreshgames confirm` path in a separate cleanup.
