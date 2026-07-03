# Codex Task Brief — BanterAgent Game Reliability, Archival, Refresh & Quality

Paste the block below into Codex, pointed at this repo (`/home/pi/banteragent`).
It is self-contained. Work through the phases in order; commit per phase.

---

You are working on **BanterAgent**, a TypeScript (Node + ESM) WhatsApp group bot
running on a Raspberry Pi. Your mission: make the **games** bulletproof — a real
test suite, correct no-repeat archival, exhaustion/low-buffer awareness, an admin
refresh that adds NEW questions, and automated question-quality checks. Do NOT
change unrelated features.

## Environment & hard rules
- Stack: Node + TypeScript, ESM modules (**every relative import ends in `.js`**),
  run via `tsx` (no build step in prod). Package manager: npm.
- **NEVER restart the `banteragent` PM2 process** and never run `pm2` — your changes
  are validated by `npx tsc --noEmit` and by the test suite, not by restarting.
- `npx tsc --noEmit` MUST stay clean at every commit.
- Secrets are in `.env` (gitignored). Supabase creds: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`. Never commit them or print values.
- Commit per logical phase with clear messages. Keep the repo recoverable.

## Where the games live
- `src/features/games.ts` — ALL game logic. Curated pools are top-level arrays:
  `CURATED_QUIZZES` (emoji→movie), `CURATED_BRAND_QUIZZES`, `CURATED_TRIVIA`,
  `FASTFINGER_WORDS`, `src/features/wordlewords.ts` `WORDLE500` (721 words), plus
  Claude-generated games (detective).
- Active games: `createGame`/`getActiveGame`/`awardPoints` write to Supabase table
  `ba_game_state`. Answers come via `!a` (`handleAnswer`) or `!w` (`handleWordleGuess`).
- **Archive (no-repeat) system**: `getArchived(groupId, type)`,
  `archiveAnswer(groupId, type, answer)`, `resetArchive(groupId, type)`,
  `getArchiveStats(groupId)`. File-backed at `data/used-answers.json` (+ Supabase for
  TTL games). Known invariant from past bugs: `archiveAnswer` MUST be called BEFORE
  `await createGame` (a race let two simultaneous `!quiz` pick the same item — see
  bugs.md #~40). Preserve that ordering everywhere.
- Active games after the 2026-07-03 cull: **quiz, brandquiz, trivia, fastfinger,
  wordle (Squad, 5-letter), anagram, hangman, detective**, plus picks (battle/top10).
  Do not resurrect removed games (riddle, song, dialogue, songlyric, wyr, 2t1l,
  storytime, wordchain, antakshari, mostlikely).

---

## PHASE 1 — Test framework + pure-function tests
1. Add **Vitest** as a devDependency; add `"test": "vitest run"` and `"test:watch"`
   scripts. Configure it for ESM/TS (`vitest.config.ts`). Do not touch prod deps.
2. Refactor **only as needed** to export the pure functions for testing (keep runtime
   behaviour identical): `computeWordleResult`, `buildWordleBoard`, `fuzzyMatch`,
   `levenshtein`, the anagram scramble, `renderHangman`, and the archive helpers.
   Prefer exporting from `games.ts` (or a small `games-core.ts`) without changing
   call sites' behaviour.
3. Write thorough unit tests (`src/features/__tests__/`):
   - **Wordle result**: exact green/yellow/grey for tricky cases — duplicate letters
     in guess vs answer (e.g. answer `LEVEL`, guess `HELLO`), all-correct, none-correct,
     yellow-then-green precedence. This is the classic Wordle edge case; cover it hard.
   - **fuzzyMatch**: accept minor typos/spacing/case; reject wrong answers. Pin the
     Levenshtein threshold behaviour so it can't silently drift.
   - **Anagram**: scramble is a permutation of the word and (for len>1) never equal to
     the original; solver accepts the word case-insensitively.
   - **Hangman**: correct letter reveals all occurrences; wrong letter costs one life;
     6 wrong = loss; full-word guess wins or costs a life; already-guessed letter is a
     no-op; win when all letters revealed.

## PHASE 2 — Archival correctness (no repeats, ever)
Write tests + fix any gaps so that, per group + per game:
1. Every **option actually used** (each question/word/movie) is archived — assert that
   after a game starts, `getArchived` contains that item, and a subsequent start never
   returns it until the pool is exhausted.
2. `archiveAnswer` is called **before** `createGame` in EVERY start function (audit
   quiz, brandquiz, trivia, fastfinger, wordle squad + kollywood, anagram, hangman).
   Add a regression test that would fail if the order is swapped.
3. When a pool is exhausted, `resetArchive` fires exactly once and the cycle restarts
   with no crash. Test the boundary (last item, then the reset).
4. The file archive (`data/used-answers.json`) round-trips across a simulated restart
   (write → reload → still no repeats). Mock the fs layer or use a temp dir.

## PHASE 3 — Exhaustion tracking + low-buffer awareness
1. Extend `getArchiveStats` (or add `getPoolStatus(groupId)`) to return, per active
   game: `{ total, used, remaining }` for the CURATED pools (quiz, brandquiz, trivia,
   fastfinger, wordle500).
2. When a game starts and `remaining <= LOW_WATERMARK` (default 10, a named const),
   the bot should **notify the owner** once per game+day via the internal notify path
   (`POST http://127.0.0.1:3099/cosmo-notify` with `{message}`) — e.g. "⚠️ Quiz pool
   low: 8 questions left. `!refreshgames quiz` to top up." Debounce so it fires at most
   once per game per day (persist a small flag in `data/`).
3. Surface it in `!gamestats` too (already exists) with a 🔴/🟡/🟢 per game.

## PHASE 4 — Admin refresh that ADDS new questions (not just reset)
Today `!refreshgames` only RESETS the archive (letting old items repeat). Add a true
top-up:
1. New owner-only command **`!refreshgames add <game> [N]`** (default N=20). It calls
   Claude (`generateStructured` in `claude.ts`) to generate N NEW, high-quality items
   for that curated game in the exact pool format, then:
   - Validates each (Phase 5 quality checks) and DROPS bad ones.
   - Dedupes against the existing pool AND the archive (case-insensitive).
   - Appends the survivors to a **persistent supplemental pool** file
     (`data/pool-extra.json`, shape `{ quiz: [...], trivia: [...], ... }`) that the
     start functions merge with the hardcoded arrays at load. (Do NOT rewrite the big
     hardcoded arrays in source.)
   - Replies with how many were added / rejected and the new `remaining`.
2. Keep the existing reset behaviour available as `!refreshgames reset <game>`.
3. Tests: generation is mocked; assert dedup, quality-drop, and file append work.

## PHASE 5 — Question quality checks (the "Vijay movie but wrong options" bug)
Add an automated validator used by BOTH the refresh generator (Phase 4) and a new
`!gamecheck <game>` owner command that audits the EXISTING pool:
1. Rule-based checks per game type, e.g.:
   - Quiz/brandquiz: `answer` is non-empty, emojis present, answer isn't leaked
     verbatim in the emojis, answer length sane.
   - Trivia: question ends with `?` or is a clear prompt; answer present and short.
   - Fastfinger/wordle/anagram: word is A–Z only and the right length.
2. **Semantic check via Claude** for the subtle cases (the real complaint): send the
   clue + answer to Claude with a strict yes/no prompt — "Does this answer correctly
   and unambiguously match this clue? Is the category consistent (e.g. a Vijay-movie
   clue must have a Vijay movie as the answer)? Reply PASS or FAIL: <reason>." Batch to
   control cost; cache results by hash so you don't re-check unchanged items.
3. `!gamecheck <game>` reports the count of FAILs with reasons and can auto-quarantine
   failing items (move them to `data/pool-quarantine.json`, excluded from play).
4. Tests: rule checks fully covered; the Claude call mocked.

## Deliverables & agreement
- `npm test` green; `npx tsc --noEmit` clean. Add a short `docs/GAMES_TESTING.md`
  describing how to run tests and how the archive/refresh/quality systems work.
- Do NOT change WhatsApp wiring, prompts of other features, or restart anything.
- If you find an actual game bug while testing, fix it and add the regression test that
  proves it — note it in `bugs.md` with a fix note.
- Trace carefully: prefer many small, named test cases over a few broad ones, so a
  future change tells us exactly what broke.
