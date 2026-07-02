/**
 * Banter Picks — party games sourced from irfan-shorts question bank
 *   !battle  — VS bracket battle (group vote per round, !next to advance)
 *   !top10   — Blind ranking (everyone votes a slot per item, avg → nearest open)
 *   !next    — Reveal & advance current round / place current item
 */

import { readFileSync } from "fs";
import type { BotMessage } from "../types.js";
import { getActiveGame, createGame, awardPoints } from "./games.js";
import { supabase } from "../supabase.js";

const QUESTIONS_PATH = "/home/pi/irfan-shorts/questions_clean.json";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VSState {
  question: string;
  team_a: string;
  team_b: string;
  pairs: string[][];
  pairIdx: number;
  scores: number[];
  votes: Record<string, string>;   // phone → '1' | '2'
  names: Record<string, string>;   // phone → display name
  history: Array<{
    pair: string[];
    tally: Record<string, number>;
    winner: "a" | "b" | "draw";
    votes: Record<string, string>;
  }>;
}

interface RankState {
  question: string;
  items: string[];              // full shuffled list
  itemIdx: number;              // index of item currently being voted on
  board: Record<string, string>; // "1"–"N" → item name
  votes: Record<string, number>; // phone → slot vote
  names: Record<string, string>; // phone → display name
  points: Record<string, number>;// phone → cumulative placement-accuracy pts
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadQuestions(): any[] {
  try {
    return JSON.parse(readFileSync(QUESTIONS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function findQuestion(query: string, type: "vs" | "ranking"): any | null {
  const qs = loadQuestions().filter((q) => q.type === type && (q.options?.length ?? 0) > 0);
  if (!query) return qs[Math.floor(Math.random() * qs.length)] ?? null;

  const q = query.toLowerCase();
  // Exact substring match first
  const exact = qs.find((x) => x.question.toLowerCase().includes(q));
  if (exact) return exact;

  // Word-by-word scoring
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const scored = qs
    .map((x) => ({
      q: x,
      score: words.filter((w) => x.question.toLowerCase().includes(w)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.q ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Nearest open slot to avg, searching outward symmetrically, ties go lower */
function nearestOpen(avg: number, board: Record<string, string>, total: number): number {
  const taken = new Set(Object.keys(board).map(Number));
  const base = Math.round(avg);
  for (let delta = 0; delta <= total; delta++) {
    for (const c of delta === 0 ? [base] : [base - delta, base + delta]) {
      if (c >= 1 && c <= total && !taken.has(c)) return c;
    }
  }
  return -1;
}

function renderBoard(board: Record<string, string>, total: number): string {
  const MEDAL = ["🥇", "🥈", "🥉"];
  const half = Math.ceil(total / 2);
  const rows: string[] = [];
  for (let i = 1; i <= half; i++) {
    const leftNum  = MEDAL[i - 1] ?? `${i} `;
    const rightNum = MEDAL[half + i - 1] ?? `${half + i} `;
    const leftItem  = board[String(i)]      ?? "___";
    const rightItem = board[String(half + i)] ?? "___";
    const lStr = `${leftNum} ${leftItem}`.padEnd(22);
    const rStr = half + i <= total ? `${rightNum} ${rightItem}` : "";
    rows.push(lStr + rStr);
  }
  return rows.join("\n");
}

async function checkNoActiveGame(groupId: string): Promise<string | null> {
  const active = await getActiveGame(groupId);
  if (!active) return null;
  const label = active.game_type === "bantervs" ? "Battle"
    : active.game_type === "bankerrank" ? "Top 10 Ranking"
    : active.game_type;
  return `Dei, *${label}* already running da! Finish pannunga first 😤\n(!next to advance, !skip to abandon)`;
}

// ═════════════════════════════════════════════════════
// VS BATTLE
// ═════════════════════════════════════════════════════

export async function startBattle(msg: BotMessage, args: string): Promise<string> {
  const conflict = await checkNoActiveGame(msg.groupId);
  if (conflict) return conflict;

  const q = findQuestion(args.trim(), "vs");
  if (!q) return "No VS question found da. Try *!battle* for random or *!battle <keyword>* (e.g. !battle ajith)";

  // Build pairs: use generated pairs if available, else build from multi-option list,
  // else single pair from options[0] vs options[1]
  let rawPairs: string[][] = [];
  if (q.pairs && q.pairs.length >= 2) {
    rawPairs = shuffle([...q.pairs]);
  } else if (q.options && q.options.length > 2) {
    // Multi-item product VS — pair first-half vs second-half
    const half = Math.ceil(q.options.length / 2);
    const a: string[] = q.options.slice(0, half);
    const b: string[] = q.options.slice(half);
    rawPairs = a.map((x: string, i: number) => [x, b[i] ?? b[b.length - 1]!]);
    rawPairs = shuffle(rawPairs);
  } else {
    rawPairs = [[q.options[0] ?? "Option A", q.options[1] ?? "Option B"]];
  }

  const team_a = q.team_a || q.options?.[0] || "Team A";
  const team_b = q.team_b || q.options?.[1] || "Team B";

  const state: VSState = {
    question: q.question,
    team_a,
    team_b,
    pairs: rawPairs,
    pairIdx: 0,
    scores: [0, 0],
    votes: {},
    names: {},
    history: [],
  };

  await createGame(msg.groupId, "bantervs", state);
  return formatRound(state);
}

function formatRound(state: VSState): string {
  const [a, b] = state.pairs[state.pairIdx]!;
  const [sa, sb] = state.scores;
  const total = state.pairs.length;
  const round = state.pairIdx + 1;
  return [
    `⚔️  *BATTLE: ${state.question}*`,
    ``,
    `🔴 *${state.team_a}* ${sa} — ${sb} *${state.team_b}* 🔵`,
    `Round ${round} of ${total}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `1️⃣  *${a}*`,
    `        vs`,
    `2️⃣  *${b}*`,
    ``,
    `*!a 1* or *!a 2* da 👇`,
    `_(Host: !next to reveal & advance)_`,
  ].join("\n");
}

export async function handleBattleAnswer(
  args: string,
  msg: BotMessage,
  game: any
): Promise<string> {
  const vote = args.trim();
  if (vote !== "1" && vote !== "2") return "Type *!a 1* or *!a 2* da!";

  const state: VSState = game.state;
  const prev = state.votes[msg.from];
  state.votes[msg.from] = vote;
  state.names[msg.from] = msg.senderName;
  await supabase.from("ba_game_state").update({ state }).eq("id", game.id);

  const count = Object.keys(state.votes).length;
  const changed = prev && prev !== vote ? " _(changed)_" : "";
  const [a, b] = state.pairs[state.pairIdx]!;
  const choice = vote === "1" ? a : b;
  return `✅ *${msg.senderName}* → ${choice}${changed}  (${count} voted)`;
}

export async function handleBattleNext(msg: BotMessage, game: any): Promise<string> {
  const state: VSState = game.state;
  const pair = state.pairs[state.pairIdx]!;
  const [a, b] = pair;

  // Tally votes
  const tally: Record<string, number> = { "1": 0, "2": 0 };
  for (const v of Object.values(state.votes)) {
    tally[v] = (tally[v] ?? 0) + 1;
  }

  const winner: "a" | "b" | "draw" =
    tally["1"]! > tally["2"]! ? "a" : tally["2"]! > tally["1"]! ? "b" : "draw";

  if (winner === "a") state.scores[0]!++;
  else if (winner === "b") state.scores[1]!++;

  state.history.push({ pair: [a!, b!], tally, winner, votes: { ...state.votes } });
  state.votes = {};
  state.pairIdx++;

  const winLabel =
    winner === "a" ? `*${a} WINS* 🏆` :
    winner === "b" ? `*${b} WINS* 🏆` :
    `*DRAW* 🤝`;

  const lines: string[] = [
    `Round ${state.history.length} → ${winLabel}  (${tally["1"]}–${tally["2"]})`,
    `🔴 ${state.team_a}: ${state.scores[0]}  🔵 ${state.team_b}: ${state.scores[1]}`,
  ];

  // Last round?
  if (state.pairIdx >= state.pairs.length) {
    await supabase.from("ba_game_state").update({ is_active: false, state }).eq("id", game.id);
    await giveVSPoints(state, msg.groupId);
    return lines.join("\n") + "\n\n" + buildBattleFinal(state);
  }

  await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
  const [na, nb] = state.pairs[state.pairIdx]!;
  const [sa, sb] = state.scores;
  lines.push("");
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`Round ${state.pairIdx + 1} of ${state.pairs.length}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");
  lines.push(`1️⃣  *${na}*`);
  lines.push(`        vs`);
  lines.push(`2️⃣  *${nb}*`);
  lines.push("");
  lines.push(`*!a 1* or *!a 2* 👇`);
  return lines.join("\n");
}

async function giveVSPoints(state: VSState, groupId: string): Promise<void> {
  // +1 per round voted with majority
  const score: Record<string, number> = {};
  for (const h of state.history) {
    const majority = (h.tally["1"] ?? 0) >= (h.tally["2"] ?? 0) ? "1" : "2";
    for (const [phone, vote] of Object.entries(h.votes)) {
      if (vote === majority) score[phone] = (score[phone] ?? 0) + 1;
    }
  }
  for (const [phone, pts] of Object.entries(score)) {
    const name = state.names[phone] ?? phone;
    await awardPoints(groupId, phone, name, "bantervs", pts);
  }
}

function buildBattleFinal(state: VSState): string {
  const [sa, sb] = state.scores;
  const draw = sa === sb;
  const winner = !draw ? (sa! > sb! ? state.team_a : state.team_b) : null;

  const taunts = draw
    ? ["Even match — everybody vibes 🤝", "No wrong answers here 🔥"]
    : [
        `${winner} army undefeated 🔥`,
        `Chat is NOT surviving this 💀`,
        `${winner} — no contest, confirmed 🏆`,
        `Irfan would NOT see this coming 😤`,
      ];
  const taunt = taunts[Math.floor(Math.random() * taunts.length)]!;

  const ARROWS = { a: "◀", b: "▶", draw: "=" } as const;
  const card = state.history
    .map((h) => {
      const [pa, pb] = h.pair;
      return `${pa}  ${ARROWS[h.winner]}  ${pb}  (${h.tally["1"] ?? 0}–${h.tally["2"] ?? 0})`;
    })
    .join("\n");

  // Points leaders
  const score: Record<string, number> = {};
  for (const h of state.history) {
    const majority = (h.tally["1"] ?? 0) >= (h.tally["2"] ?? 0) ? "1" : "2";
    for (const [phone, vote] of Object.entries(h.votes)) {
      if (vote === majority) score[phone] = (score[phone] ?? 0) + 1;
    }
  }
  const MEDALS = ["🥇", "🥈", "🥉"];
  const topVoters = Object.entries(score)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([phone, pts], i) => `${MEDALS[i] ?? "🏅"} ${state.names[phone] ?? phone} — ${pts}/${state.history.length} with majority (+${pts} pts)`)
    .join("\n");

  return [
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚔️  *FINAL SCORE*`,
    ``,
    `🔴 *${state.team_a}*  ${sa}`,
    `🔵 *${state.team_b}*  ${sb}`,
    ``,
    draw ? `🤝 *It's a draw!*` : `🏆 *${winner} WINS!*`,
    taunt,
    ``,
    `*Round-by-round:*`,
    card,
    ...(topVoters ? [``, `*Best picks:*`, topVoters] : []),
    ``,
    `!battle for another ⚔️`,
  ].join("\n");
}

// ═════════════════════════════════════════════════════
// TOP 10 BLIND RANKING
// ═════════════════════════════════════════════════════

export async function startTop10(msg: BotMessage, args: string): Promise<string> {
  const conflict = await checkNoActiveGame(msg.groupId);
  if (conflict) return conflict;

  const q = findQuestion(args.trim(), "ranking");
  if (!q) return "No ranking question found da. Try *!top10* for random or *!top10 <keyword>* (e.g. !top10 superstar)";

  const items = shuffle([...(q.options as string[])]);
  const state: RankState = {
    question: q.question,
    items,
    itemIdx: 0,
    board: {},
    votes: {},
    names: {},
    points: {},
  };

  await createGame(msg.groupId, "bankerrank", state);

  const total = items.length;
  const slots = Array.from({ length: total }, (_, i) => i + 1).join("  ");
  return [
    `🏆  *BLIND RANK: ${q.question}*`,
    ``,
    `${total} items reveal one by one.`,
    `Everyone vote your preferred slot — avg decides placement!`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Item 1 of ${total}:`,
    ``,
    `🎬  *${items[0]}*`,
    ``,
    `Slots: ${slots}`,
    `*!a <slot>* — everyone vote! 👇`,
    `_(Host: !next to lock or !next <slot> to override)_`,
  ].join("\n");
}

export async function handleRankAnswer(
  args: string,
  msg: BotMessage,
  game: any
): Promise<string> {
  const state: RankState = game.state;
  const total = state.items.length;
  const slot = parseInt(args.trim(), 10);

  if (isNaN(slot) || slot < 1 || slot > total) {
    return `Type *!a <1–${total}>* to vote a slot da!`;
  }
  if (state.board[String(slot)]) {
    return `Slot ${slot} already taken da! Pick another.`;
  }

  const prev = state.votes[msg.from];
  state.votes[msg.from] = slot;
  state.names[msg.from] = msg.senderName;
  await supabase.from("ba_game_state").update({ state }).eq("id", game.id);

  const count = Object.keys(state.votes).length;
  const changed = prev !== undefined && prev !== slot ? ` _(changed from ${prev})_` : "";
  return `✅ *${msg.senderName}* → slot ${slot}${changed}  (${count} voted)`;
}

export async function handleRankNext(msg: BotMessage, args: string, game: any): Promise<string> {
  const state: RankState = game.state;
  const total = state.items.length;
  const currentItem = state.items[state.itemIdx]!;

  const allVotes = Object.values(state.votes);
  let slot: number;
  let slotLine: string;

  // Host override: !next <slot>
  const override = parseInt(args.trim(), 10);
  if (!isNaN(override) && override >= 1 && override <= total) {
    if (state.board[String(override)]) {
      return `Slot ${override} already taken da! Pick another.`;
    }
    slot = override;
    slotLine = `Override → Slot ${slot}`;
  } else {
    if (allVotes.length === 0) {
      return `No votes yet da! Type *!a <slot>* first. (or *!next <slot>* to override)`;
    }
    const avg = allVotes.reduce((s, v) => s + v, 0) / allVotes.length;
    slot = nearestOpen(avg, state.board, total);

    const voteSummary = Object.entries(state.votes)
      .map(([p, v]) => `${state.names[p] ?? p}→${v}`)
      .join("  ");
    const rounded = Math.round(avg);
    const collision = slot !== rounded ? ` _(${rounded} taken → nearest open)_` : "";
    slotLine = `Votes: ${voteSummary}\nAvg: ${avg.toFixed(1)} → Slot ${slot}${collision}`;
  }

  // Accuracy points (only for vote-based, not host override)
  if (isNaN(override) || override < 1) {
    for (const [phone, vote] of Object.entries(state.votes)) {
      const dist = Math.abs(vote - slot);
      const pts = dist === 0 ? 3 : dist === 1 ? 2 : dist === 2 ? 1 : 0;
      state.points[phone] = (state.points[phone] ?? 0) + pts;
    }
  }

  state.board[String(slot)] = currentItem;
  state.votes = {};
  state.itemIdx++;

  const lines: string[] = [slotLine, ``, `Slot ${slot} → *${currentItem}* ✅`];

  const placed = Object.keys(state.board).length;

  // Auto-place last item
  if (placed === total - 1 && state.itemIdx < total) {
    const lastItem = state.items[state.itemIdx]!;
    let openSlot = -1;
    for (let i = 1; i <= total; i++) {
      if (!state.board[String(i)]) { openSlot = i; break; }
    }
    if (openSlot > 0) {
      state.board[String(openSlot)] = lastItem;
      state.itemIdx++;
      lines.push(``, `Last spot → Slot ${openSlot} → *${lastItem}* (auto-placed)`);
    }
  }

  // Done?
  if (Object.keys(state.board).length >= total) {
    await supabase.from("ba_game_state").update({ is_active: false, state }).eq("id", game.id);
    await giveRankPoints(state, msg.groupId);
    return lines.join("\n") + "\n\n" + buildRankFinal(state);
  }

  await supabase.from("ba_game_state").update({ state }).eq("id", game.id);

  const nextItem = state.items[state.itemIdx]!;
  const openCount = total - Object.keys(state.board).length;

  lines.push("", "```", renderBoard(state.board, total), "```");
  lines.push(``, `━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`Item ${state.itemIdx + 1} of ${total}:`);
  lines.push(``, `🎬  *${nextItem}*`, ``);
  lines.push(`*!a <slot>* (${openCount} open) 👇`);

  return lines.join("\n");
}

async function giveRankPoints(state: RankState, groupId: string): Promise<void> {
  for (const [phone, pts] of Object.entries(state.points)) {
    if (pts > 0) {
      const name = state.names[phone] ?? phone;
      await awardPoints(groupId, phone, name, "bankerrank", pts);
    }
  }
}

function buildRankFinal(state: RankState): string {
  const MEDAL = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  const total = state.items.length;

  const rows = Array.from({ length: total }, (_, i) => {
    const item = state.board[String(i + 1)] ?? "—";
    return `${MEDAL[i] ?? String(i + 1)}  ${item}`;
  }).join("\n");

  const leaders = Object.entries(state.points)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const lb = leaders.length
    ? "\n*Closest picks:*\n" +
      leaders.map(([phone, pts], i) =>
        `${["🥇", "🥈", "🥉"][i] ?? "🏅"} ${state.names[phone] ?? phone} — ${pts} pts`
      ).join("\n")
    : "";

  return [
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏆  *FINAL RANKING*`,
    `_${state.question}_`,
    ``,
    rows,
    lb,
    ``,
    `!top10 for another 🔥`,
  ].join("\n");
}

// ═════════════════════════════════════════════════════
// PUBLIC DISPATCH — called from router.ts
// ═════════════════════════════════════════════════════

/** Called before handleGameCommand for !a / !answer — returns null if not a picks game */
export async function handlePicksAnswer(
  args: string,
  msg: BotMessage
): Promise<string | null> {
  const game = await getActiveGame(msg.groupId);
  if (!game) return null;
  if (game.game_type === "bantervs")   return handleBattleAnswer(args, msg, game);
  if (game.game_type === "bankerrank") return handleRankAnswer(args, msg, game);
  return null;
}

/** Called for !next — handles both battle and ranking */
export async function handlePicksNext(msg: BotMessage, args: string): Promise<string> {
  const game = await getActiveGame(msg.groupId);
  if (!game) return "Koi game running nahi da. !battle or !top10 start pannu.";
  if (game.game_type === "bantervs")   return handleBattleNext(msg, game);
  if (game.game_type === "bankerrank") return handleRankNext(msg, args, game);
  return "!next works only for !battle and !top10 da.";
}
