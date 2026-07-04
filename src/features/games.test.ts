// Games regression suite — run with: npm test
// Uses node:test (built-in). Pure functions + file-backed archive, no live services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.deepEqual(JSON.parse(calls[0]!.init.body), { message: `⚠️ quiz pool low: ${g.LOW_WATERMARK} left. !refreshgames add quiz` });
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test("quality rules: cover words, emoji leak, and prompt basics", () => {
  assert.deepEqual(g.validateGameItemRules("wordle", "about"), []);
  assert.equal(g.validateGameItemRules("wordle", "abcd")[0]!.reason, "word must be exactly 5 A-Z letters");
  assert.equal(g.validateGameItemRules("anagram", "abc12")[0]!.reason, "word must be exactly 5 A-Z letters");
  assert.equal(g.validateGameItemRules("fastfinger", "hello").length, 0);
  assert.equal(g.validateGameItemRules("fastfinger", "bad1")[0]!.reason, "fastfinger word must contain only A-Z letters");
  assert.equal(g.validateGameItemRules("quiz", { emojis: "kaththi", answer: "kaththi", hint: "hint" })[0]!.reason, "emoji clue leaks answer");
  assert.equal(g.validateGameItemRules("trivia", { question: "", answer: "42", hint: "", fact: "" })[0]!.reason, "trivia prompt is missing");
});

test("refreshgames add: dedupes, validates, and appends survivors", async () => {
  g.setGameTestHooks({ generateStructured: async () => JSON.stringify(["newword", "ADYAR", "bad1"]) });
  const response = await g.refreshGamesAdd("g-refresh", "fastfinger", 3);
  assert.match(response, /added 1, rejected 2/);
  const extra = JSON.parse(readFileSync(join(TMP, "pool-extra.json"), "utf8"));
  assert.deepEqual(extra.fastfinger, ["newword"]);
});

test("refreshgames add: semantic checker drops Claude failures", async () => {
  const replies = [
    JSON.stringify([
      { emojis: "🍕🇮🇹", answer: "pizza", hint: "food clue" },
      { emojis: "🎬⚔️", answer: "wrong", hint: "Vijay movie clue" },
    ]),
    "0 PASS\n1 FAIL: wrong Vijay movie",
  ];
  g.setGameTestHooks({ generateStructured: async () => replies.shift()! });
  const response = await g.refreshGamesAdd("g-refresh-semantic", "quiz", 2);
  assert.match(response, /added 1, rejected 1/);
  const extra = JSON.parse(readFileSync(join(TMP, "pool-extra.json"), "utf8"));
  assert.equal(extra.quiz.at(-1).answer, "pizza");
});

test("refreshgames add: supports dialogue-shaped items", async () => {
  g.setGameTestHooks({
    generateStructured: async (prompt) => prompt.startsWith("Quality-check")
      ? "0 PASS"
      : JSON.stringify([
        { dialogue: "Naan vanthutten!", answer: "moonwalk", speaker: "New Star", hint: "iconic entry line" },
      ]),
  });
  const response = await g.refreshGamesAdd("g-refresh-dialogue", "dialogue", 1);
  assert.match(response, /added 1, rejected 0/);
  const extra = JSON.parse(readFileSync(join(TMP, "pool-extra.json"), "utf8"));
  assert.equal(extra.dialogue.at(-1).answer, "moonwalk");
});

test("refreshgames add: validates 2 truths 1 lie shape", async () => {
  g.setGameTestHooks({
    generateStructured: async (prompt) => prompt.startsWith("Quality-check")
      ? "0 PASS"
      : JSON.stringify([
        {
          context: "Rajini debut facts",
          statements: [
            "Rajinikanth worked as a bus conductor in Bangalore",
            "Rajinikanth's real name is Sivaji Rao Gaekwad",
            "Apoorva Raagangal was directed by Mani Ratnam",
          ],
          lieIndex: 3,
          hint: "Think of the director who launched Rajini and Kamal",
          explanation: "Apoorva Raagangal was directed by K. Balachander, not Mani Ratnam.",
        },
        {
          context: "Bad lie index",
          statements: ["one", "two", "three"],
          lieIndex: 4,
          hint: "still ok",
          explanation: "still ok",
        },
      ]),
  });
  const response = await g.refreshGamesAdd("g-refresh-tt", "twotruthsonelie", 2);
  assert.match(response, /added 1, rejected 1/);
  const extra = JSON.parse(readFileSync(join(TMP, "pool-extra.json"), "utf8"));
  assert.equal(extra.twotruthsonelie.at(-1).context, "Rajini debut facts");
});

test("refreshgames all: consolidates every refreshable type into one reply", async () => {
  writeFileSync(join(TMP, "pool-extra.json"), JSON.stringify({}));
  writeFileSync(join(TMP, "used-answers.json"), JSON.stringify({}));
  g.setGameTestHooks({
    generateStructured: async (prompt) => {
      if (prompt.startsWith("Quality-check")) return "0 PASS";
      if (prompt.includes("Tamil movie dialogue items")) {
        return JSON.stringify([{ dialogue: "Naan varuven da!", answer: "moonwalk", speaker: "New Star", hint: "fresh dialogue" }]);
      }
      if (prompt.includes("2 truths 1 lie items")) {
        return JSON.stringify([
          {
            context: "AR Rahman debut",
            statements: [
              "AR Rahman debuted with Roja in 1992",
              "AR Rahman won two Academy Awards for Slumdog Millionaire",
              "AR Rahman composed Mouna Ragam",
            ],
            lieIndex: 3,
            hint: "Think of Ilaiyaraaja vs Rahman",
            explanation: "Mouna Ragam was scored by Ilaiyaraaja, not Rahman.",
          },
        ]);
      }
      if (prompt.includes("\"most likely to\" scenarios")) return JSON.stringify(["forget where they parked their scooter"]);
      if (prompt.includes("story starters for a collaborative WhatsApp story game")) return JSON.stringify(["One Monday morning, the whole group found a mysterious voice note from the bot."]);
      if (prompt.includes("Tamil cultural riddle categories")) return JSON.stringify(["Tamil temple festival traditions"]);
      if (prompt.includes("Would You Rather\" themes")) return JSON.stringify(["Power cut during IPL final"]);
      if (prompt.includes("Tamil song quiz items")) {
        return JSON.stringify([{ lines: ["Line one", "Line two"], answer: "star song", movie: "Moon Movie", hint: "romantic track" }]);
      }
      if (prompt.includes("Generate 1 NEW trivia items")) {
        return JSON.stringify([{ question: "What year did Chennai Metro open?", answer: "2015", hint: "Phase 1", fact: "Chennai Metro started in 2015." }]);
      }
      if (prompt.includes("Generate 1 NEW quiz game items")) {
        return JSON.stringify([{ emojis: "🌙🚌", answer: "moon bus", hint: "space commute" }]);
      }
      if (prompt.includes("Generate 1 NEW brandquiz game items")) {
        return JSON.stringify([{ emojis: "☀️🎧", answer: "sunvox", hint: "audio brand" }]);
      }
      if (prompt.includes("Generate 1 NEW fastfinger words")) return JSON.stringify(["PHOENIX"]);
      if (prompt.includes("Generate 1 NEW wordle game items")) return JSON.stringify(["orbit"]);
      if (prompt.includes("Generate 1 NEW anagram word items")) return JSON.stringify(["cabin"]);
      if (prompt.includes("Generate 1 NEW hangman word items")) return JSON.stringify(["delta"]);
      if (prompt.includes("Generate 1 NEW Tamil movie dialogue items")) {
        return JSON.stringify([{ dialogue: "Naan vanthutten!", answer: "baasha", speaker: "Rajinikanth", hint: "entry line" }]);
      }
      if (prompt.includes("Generate 1 NEW Tamil song quiz items")) {
        return JSON.stringify([{ lines: ["Line one", "Line two"], answer: "moon song", movie: "Moon Movie", hint: "romantic track" }]);
      }
      return JSON.stringify(["fallback"]);
    },
  });
  const response = await g.refreshGamesAll("g-refresh-all", 1);
  assert.match(response, /refreshgames all: refreshed 14 types/);
  assert.match(response, /- dialogue: added 1, rejected 0/);
  assert.match(response, /- wyr: added 1, rejected 0/);
  const extra = JSON.parse(readFileSync(join(TMP, "pool-extra.json"), "utf8"));
  assert.ok(Array.isArray(extra.dialogue) && extra.dialogue.length > 0);
  assert.ok(Array.isArray(extra.wyr) && extra.wyr.length > 0);
});

test("archive: new curated string pools exclude used items and reset cleanly", () => {
  const gid = "gtest-new-archive";
  const storyPool = [
    "Madhan opened Google Maps to navigate to Velachery.",
    "The group accidentally created a second WhatsApp group.",
  ];
  const wyrPool = ["Tamil hostel life", "Chennai summer survival"];

  g.archiveAnswer(gid, "storytime", storyPool[0]!);
  const storyRemaining = storyPool.filter((line) => !g.getArchived(gid, "storytime").includes(line.toLowerCase().slice(0, 60)));
  assert.deepEqual(storyRemaining, [storyPool[1]]);

  g.archiveAnswer(gid, "wyr", wyrPool[0]!);
  const wyrRemaining = wyrPool.filter((theme) => !g.getArchived(gid, "wyr").includes(theme.toLowerCase()));
  assert.deepEqual(wyrRemaining, [wyrPool[1]]);

  g.resetArchive(gid, "storytime");
  g.resetArchive(gid, "wyr");
  assert.deepEqual(g.getArchived(gid, "storytime"), []);
  assert.deepEqual(g.getArchived(gid, "wyr"), []);
});

test("gamecheck: unparseable semantic response fails closed", async () => {
  writeFileSync(join(TMP, "pool-extra.json"), JSON.stringify({ quiz: [{ emojis: "🎬🍿", answer: "movie", hint: "cinema clue" }] }));
  g.setGameTestHooks({ generateStructured: async () => "not parseable" });
  const result = await g.runGameCheck("quiz", false);
  assert.ok(result.failures.some(f => f.key === "movie" && f.reason.includes("unparseable")));
});

test("gamecheck quarantine: writes failing keys and excludes them from pools", async () => {
  writeFileSync(join(TMP, "pool-extra.json"), JSON.stringify({ fastfinger: ["bad1"] }));
  const before = g.getPoolStatus("g-quarantine").find(s => s.type === "fastfinger")!;
  const result = await g.runGameCheck("fastfinger", true);
  const after = g.getPoolStatus("g-quarantine").find(s => s.type === "fastfinger")!;
  assert.equal(result.quarantined, 1);
  assert.ok(result.failures.some(f => f.key === "bad1"));
  assert.equal(after.total, before.total - 1);
  const quarantine = JSON.parse(readFileSync(join(TMP, "pool-quarantine.json"), "utf8"));
  assert.ok(quarantine.fastfinger.includes("bad1"));
});

test("archive: refreshed string pools are picked by the real start functions", async () => {
  writeFileSync(join(TMP, "pool-extra.json"), JSON.stringify({
    dialogue: [{
      dialogue: "REFRESHED DIALOGUE LINE",
      answer: "fresh dialogue answer",
      speaker: "Fresh Speaker",
      hint: "fresh dialogue hint",
    }],
    song: [{
      lines: ["REFRESHED SONG LINE", "SECOND REFRESHED LINE"],
      answer: "fresh song answer",
      movie: "Fresh Movie",
      hint: "fresh song hint",
    }],
  }));

  const oldRandom = Math.random;
  Math.random = () => 0.999999;
  g.setGameTestHooks({ createGame: async () => null as never });
  try {
    const msg = {
      groupId: "g-refresh-start",
      from: "15550000000@s.whatsapp.net",
      senderName: "Tester",
      text: "",
    } as never;

    const dialogue = await g.startDialogue(msg);
    assert.match(dialogue, /REFRESHED DIALOGUE LINE/);
    assert.ok(g.getArchived("g-refresh-start", "dialogue").includes("fresh dialogue answer"));

    const song = await g.startSongQuiz(msg);
    assert.match(song, /REFRESHED SONG LINE/);
    assert.ok(g.getArchived("g-refresh-start", "song").includes("fresh song answer"));
  } finally {
    g.setGameTestHooks({ createGame: g.createGame });
    Math.random = oldRandom;
  }
});
