// Games regression suite — run with: npm test
// Uses node:test (built-in). Pure functions + file-backed archive, no live services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the archive to a temp dir and satisfy import-time service clients BEFORE
// importing games.ts (its constants read these at module load).
const TMP = mkdtempSync(join(tmpdir(), "ba-games-"));
process.env.BANTERAGENT_DATA_DIR = TMP;
process.env.SUPABASE_URL ||= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";
process.env.SUPABASE_ANON_KEY ||= "test-key";
process.env.ANTHROPIC_API_KEY ||= "test-key";

const g = await import("./games.js");
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

// ── Wordle result (the classic duplicate-letter minefield) ──
test("wordle: all correct", () => {
  assert.deepEqual(g.computeWordleResult("LEVEL", "LEVEL"),
    ["correct", "correct", "correct", "correct", "correct"]);
});
test("wordle: none present", () => {
  assert.deepEqual(g.computeWordleResult("BOXER", "MUNCH").filter(r => r !== "absent"), []);
});
test("wordle: duplicate guess letters vs single target (HELLO/LEVEL)", () => {
  // greens: E@1; the two L's in guess map to the two L's in LEVEL as present; H,O absent
  assert.deepEqual(g.computeWordleResult("HELLO", "LEVEL"),
    ["absent", "correct", "present", "present", "absent"]);
});
test("wordle: extra duplicate in guess doesn't over-count (SPEED/ERASE)", () => {
  const r = g.computeWordleResult("SPEED", "ERASE");
  // ERASE has two E's; both E's in SPEED can be present, S present, P/D absent
  assert.deepEqual(r, ["present", "absent", "present", "present", "absent"]);
});

// ── Fuzzy matching (typo tolerance without false positives) ──
test("fuzzy: exact + case/punctuation insensitive", () => {
  assert.equal(g.fuzzyMatch("Mersal!", "mersal"), true);
  assert.equal(g.fuzzyMatch("vikram vedha", "Vikram-Vedha"), true);
});
test("fuzzy: accepts a small typo on long words", () => {
  assert.equal(g.fuzzyMatch("baahubali", "bahubali"), true); // 1 edit, len>=5
});
test("fuzzy: rejects a genuinely wrong answer", () => {
  assert.equal(g.fuzzyMatch("anniyan", "mersal"), false);
});
test("fuzzy: short words need exact (no typo tolerance under 5 chars)", () => {
  assert.equal(g.fuzzyMatch("quis", "quiz"), false); // maxDist floor(4/5)=0
});

// ── Anagram scramble ──
test("anagram: scramble is a permutation and (for distinct letters) not the original", () => {
  const w = "planet";
  const s = g.scramble(w);
  assert.equal([...s].sort().join(""), [...w].sort().join(""));
  assert.notEqual(s, w);
});

// ── Hangman rendering ──
test("hangman: reveals guessed letters, masks the rest", () => {
  assert.equal(g.renderHangman("APPLE", ["A", "P"]), "A P P ⬜ ⬜");
  assert.equal(g.renderHangman("APPLE", []), "⬜ ⬜ ⬜ ⬜ ⬜");
});

// ── Archive: no repeats until exhaustion, then reset ──
test("archive: archiveAnswer records, getArchived returns it, resetArchive clears", () => {
  const gid = "gtest1";
  assert.deepEqual(g.getArchived(gid, "quiz"), []);
  g.archiveAnswer(gid, "quiz", "MERSAL");
  g.archiveAnswer(gid, "quiz", "VIKRAM");
  const arch = g.getArchived(gid, "quiz").map(x => x.toUpperCase());
  assert.ok(arch.includes("MERSAL") && arch.includes("VIKRAM"));
  g.resetArchive(gid, "quiz");
  assert.deepEqual(g.getArchived(gid, "quiz"), []);
});
test("archive: per-group and per-type isolation", () => {
  g.archiveAnswer("groupA", "quiz", "A1");
  g.archiveAnswer("groupB", "quiz", "B1");
  g.archiveAnswer("groupA", "trivia", "T1");
  assert.ok(!g.getArchived("groupB", "quiz").map(x => x.toUpperCase()).includes("A1"));
  assert.ok(!g.getArchived("groupA", "quiz").map(x => x.toUpperCase()).includes("T1"));
});
test("archive: a fresh pick never repeats an archived item until pool exhausts", () => {
  const gid = "gtest-pool";
  const pool = ["one", "two", "three"];
  const picked: string[] = [];
  for (let i = 0; i < pool.length; i++) {
    const remaining = pool.filter(w => !g.getArchived(gid, "wordle500").includes(w));
    assert.ok(remaining.length > 0, "pool should have fresh items until exhausted");
    const w = remaining[0]!;
    g.archiveAnswer(gid, "wordle500", w);
    picked.push(w);
  }
  assert.equal(new Set(picked).size, pool.length); // no repeats across the full pool
});


test("pool status: finite curated pools report total used remaining", () => {
  const gid = "gtest-status";
  g.archiveAnswer(gid, "quiz", "kaththi");
  g.archiveAnswer(gid, "wordle500", "about");
  const stats = g.getPoolStatus(gid);
  assert.deepEqual(stats.map(s => s.type), ["quiz", "brandquiz", "trivia", "fastfinger", "wordle"]);
  const quiz = stats.find(s => s.type === "quiz")!;
  const wordle = stats.find(s => s.type === "wordle")!;
  assert.equal(quiz.used, 1);
  assert.equal(quiz.remaining, quiz.total - 1);
  assert.equal(wordle.used, 1);
  assert.equal(wordle.remaining, wordle.total - 1);
});

test("low pool notify: posts once per game per IST day", async () => {
  const calls: Array<{ url: unknown; init: any }> = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    const now = new Date("2026-07-03T10:00:00.000Z");
    assert.equal(await g.maybeNotifyLowPool("quiz", g.LOW_WATERMARK, now), true);
    assert.equal(await g.maybeNotifyLowPool("quiz", g.LOW_WATERMARK - 1, now), false);
    assert.equal(await g.maybeNotifyLowPool("trivia", g.LOW_WATERMARK, now), true);
    assert.equal(await g.maybeNotifyLowPool("wordle", g.LOW_WATERMARK + 1, now), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.url, "http://127.0.0.1:3099/cosmo-notify");
    assert.deepEqual(JSON.parse(calls[0]!.init.body), { message: `?? quiz pool low: ${g.LOW_WATERMARK} left. !refreshgames add quiz` });
  } finally {
    globalThis.fetch = oldFetch;
  }
});
