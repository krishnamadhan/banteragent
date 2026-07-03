# Games Testing

Run from `/home/pi/banteragent`:

```bash
npm test
npx tsc --noEmit
```

The games suite uses Node built-in `node:test` via `tsx --test src/features/*.test.ts`. Do not add Vitest.

## What Is Covered

- Wordle scoring, including duplicate-letter precedence.
- Fuzzy matching thresholds.
- Anagram scramble permutation behavior.
- Hangman rendering.
- File-backed archive isolation and no-repeat selection.
- `getPoolStatus(groupId)` for `quiz`, `brandquiz`, `trivia`, `fastfinger`, and default Squad Wordle (`WORDLE500`).
- Low-pool owner notification debounce through `data/low-pool-alerts.json`, with `fetch` mocked in tests.
- `!refreshgames add <game> [N]` generation flow with mocked `generateStructured`.
- Dedupe against hardcoded pools and archive, rule validation drops, semantic validation drops, and append to `data/pool-extra.json`.
- `!gamecheck <game> [quarantine]`, rule failures, semantic fail-closed behavior, and quarantine exclusion through `data/pool-quarantine.json`.

## Runtime Data Files

- `data/used-answers.json`: permanent no-repeat archive.
- `data/low-pool-alerts.json`: once-per-game-per-IST-day low-buffer flags.
- `data/pool-extra.json`: supplemental generated pools appended by refresh.
- `data/pool-quarantine.json`: failing keys excluded from pick logic.
- `data/game-quality-cache.json`: semantic quality cache keyed by SHA-256 hash.

Tests set `BANTERAGENT_DATA_DIR` to a temp directory, so they do not touch production `data/`.
