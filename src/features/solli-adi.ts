/**
 * solli-adi.ts — Over-run prediction game (inspired by Hello FM Solli Adi)
 *
 * Round lifecycle:
 *   pending  → waiting for the target over to start (opened mid-over)
 *   open     → target over started, accepting predictions & tracking runs
 *   resolved → over completed, points awarded
 *   void     → match ended / innings changed before resolution
 *
 * Commands:
 *   !solli            — Start prediction for next over
 *   !predict <N>      — Submit your guess (0-36 runs)
 *   !solli status     — See current round and predictions
 *   !solli lb         — Solli Adi leaderboard for this match
 *
 * Scoring: Exact = +50 pts | ±1 = +25 pts
 * Bonus pts update f11_entries.bonus_points if WA phone is linked.
 */

import { supabase } from "../supabase.js";
import type { BotMessage, CommandResult } from "../types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const FANTASY_BASE = process.env.FANTASY_APP_URL ?? "https://ipl11.vercel.app";
const BOT_SECRET = process.env.FANTASY_BOT_SECRET ?? "";
const EXACT_PTS = 50;
const CLOSE_PTS = 25; // ±1 run
const MAX_OVERS = 20; // T20 innings cap

// ─── Types ───────────────────────────────────────────────────────────────────

interface LiveScore {
  battingTeam: string;
  runs: number;
  completedOvers: number; // integer, balls already counted in over index
  balls: number;          // 0-5 balls into the current over
  oversStr: string;       // e.g. "14.2"
  wickets: number;
  innings: number;        // 1 or 2
}

interface Round {
  id: string;
  match_id: string;
  group_id: string;
  over_number: number;      // 0-based index: over_number=14 means "over 15"
  score_at_start: number;   // score when !solli was triggered
  score_at_over_start: number | null; // score at the exact start of target over (set when pending→open)
  balls_at_open: number;
  status: "pending" | "open" | "resolved" | "void";
}

// ─── Bot API helper ───────────────────────────────────────────────────────────

async function botFetch(path: string, opts?: RequestInit): Promise<any> {
  try {
    const res = await fetch(`${FANTASY_BASE}/api/bot${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BOT_SECRET}`,
        ...(opts?.headers ?? {}),
      },
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: text }; }
  } catch (e: any) {
    return { error: e?.message };
  }
}

// ─── Score helpers ────────────────────────────────────────────────────────────

function parseOvers(s: string | number): { completed: number; balls: number } {
  const str = String(s ?? "0").trim();
  // Handle "20" (no dot = exactly 20 overs)
  if (!str.includes(".")) return { completed: parseInt(str) || 0, balls: 0 };
  const [c, b] = str.split(".");
  return { completed: parseInt(c ?? "0") || 0, balls: parseInt(b ?? "0") || 0 };
}

async function getLiveScore(matchId: string): Promise<LiveScore | null> {
  const summary = await botFetch(`/match-summary?match_id=${matchId}`);
  if (!summary?.match?.live_score) return null;
  const ls = summary.match.live_score;
  if (!ls.current_batting) return null;

  const batting = ls.current_batting as string;
  const isTeam1 = ls.team1 === batting;
  const runs     = isTeam1 ? (ls.team1_runs ?? 0)    : (ls.team2_runs ?? 0);
  const oversStr = isTeam1 ? (ls.team1_overs ?? "0")  : (ls.team2_overs ?? "0");
  const wickets  = isTeam1 ? (ls.team1_wickets ?? 0)  : (ls.team2_wickets ?? 0);
  const { completed, balls } = parseOvers(oversStr);

  // Determine innings: if team1 is done (overs="20" or status changed), we're in innings 2
  const team1Done = parseOvers(ls.team1_overs ?? "0").completed >= MAX_OVERS;
  const innings = (isTeam1 && !team1Done) ? 1 : (team1Done ? 2 : 1);

  return { battingTeam: batting, runs, completedOvers: completed, balls, oversStr, wickets, innings };
}

async function getLiveMatchForGroup(groupId: string): Promise<{ matchId: string; score: LiveScore } | null> {
  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("match_id, team_home, team_away, scheduled_at")
    .eq("group_id", groupId)
    .not("locked_at", "is", null)
    .is("completed_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(1);

  const state = states?.[0];
  if (!state) return null;

  const score = await getLiveScore(state.match_id);
  if (!score) return null;

  return { matchId: state.match_id, score };
}

// ─── Round helpers ────────────────────────────────────────────────────────────

async function syncActiveMatch(groupId: string): Promise<void> {
  const { data } = await supabase
    .from("ba_fantasy_state")
    .select("match_id")
    .eq("group_id", groupId)
    .not("locked_at", "is", null)
    .is("completed_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.match_id) return;
  await Promise.race([
    botFetch("/sync", { method: "POST", body: JSON.stringify({ match_id: data.match_id }) }),
    new Promise((res) => setTimeout(res, 8000)),
  ]).catch(() => {/* non-fatal */});
}

async function getActiveRound(matchId: string, groupId: string): Promise<Round | null> {
  const { data } = await supabase
    .from("ba_solli_adi")
    .select("*")
    .eq("match_id", matchId)
    .eq("group_id", groupId)
    .in("status", ["pending", "open"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as Round | null;
}

function nextOverIndex(completedOvers: number, balls: number): number {
  // If at an over boundary (balls=0): the NEXT over is about to start → predict it
  // If mid-over (balls>0): current over is in progress → predict the one AFTER
  return balls === 0 ? completedOvers : completedOvers + 1;
}

function overLabel(index: number): number {
  return index + 1; // 0-based index → 1-based display
}

// ─── Bonus point helper ───────────────────────────────────────────────────────

async function awardBonusToUser(matchId: string, groupId: string, userPhone: string, pts: number): Promise<void> {
  try {
    // Look up the user by WA phone in f11_profiles
    const { data: profile } = await supabase
      .from("f11_profiles")
      .select("id")
      .eq("whatsapp_phone", userPhone)
      .maybeSingle();

    if (!profile?.id) return; // Not linked

    // Find the contest for this match/group
    const { data: state } = await supabase
      .from("ba_fantasy_state")
      .select("contest_id")
      .eq("match_id", matchId)
      .eq("group_id", groupId)
      .maybeSingle();

    if (!state?.contest_id) return;

    // Find the entry and increment bonus_points
    const { data: entry } = await supabase
      .from("f11_entries")
      .select("id, bonus_points")
      .eq("contest_id", state.contest_id)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!entry) return;
    await supabase
      .from("f11_entries")
      .update({ bonus_points: (entry.bonus_points ?? 0) + pts })
      .eq("id", entry.id);
  } catch (e: any) {
    console.error("[solli-adi] awardBonusToUser failed:", e?.message);
  }
}

// ─── !solli — Start a round ───────────────────────────────────────────────────

export async function handleSolliAdiTrigger(msg: BotMessage): Promise<CommandResult> {
  if (!BOT_SECRET) return { response: "Fantasy not configured da." };

  // Sync live score before creating a round — ensures targetOver and score are fresh
  await syncActiveMatch(msg.groupId);

  const live = await getLiveMatchForGroup(msg.groupId);
  if (!live) {
    return { response: "📻 No live match right now — Solli Adi only during IPL matches!" };
  }

  const { completedOvers, balls, runs, wickets, oversStr } = live.score;

  // Block at the end of innings / match
  if (completedOvers >= MAX_OVERS && balls === 0) {
    return { response: "📻 Innings over da! Solli Adi ends with the match." };
  }

  const existingRound = await getActiveRound(live.matchId, msg.groupId);
  if (existingRound) {
    return showRoundStatus(existingRound, live.score);
  }

  const targetOver = nextOverIndex(completedOvers, balls);

  if (targetOver >= MAX_OVERS) {
    return { response: `📻 Last over already! No more full overs to predict da.` };
  }

  const isPending = balls > 0; // mid-over → wait for current over to finish
  const displayOv = overLabel(targetOver);

  const { data: round, error } = await supabase
    .from("ba_solli_adi")
    .insert({
      match_id: live.matchId,
      group_id: msg.groupId,
      over_number: targetOver,
      balls_at_open: balls,
      score_at_start: runs,
      score_at_over_start: isPending ? null : runs, // set immediately if at boundary
      status: isPending ? "pending" : "open",
    })
    .select()
    .single();

  if (error || !round) {
    console.error("[solli-adi] create round failed:", error?.message);
    return { response: "Solli Adi start panna mudiyala. Try again!" };
  }

  if (isPending) {
    return {
      response:
        `📻 *SOLLI ADI — Incoming!*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🏏 ${live.score.battingTeam}: *${runs}/${wickets}* (${oversStr} ov)\n\n` +
        `Over ${completedOvers + 1} in progress — prediction opens for *over ${displayOv}* once it ends.\n\n` +
        `📝 Lock in early: *!predict <runs>* now\n` +
        `_(Exact: +${EXACT_PTS} pts | ±1 run: +${CLOSE_PTS} pts)_`,
    };
  }

  return {
    response:
      `📻 *SOLLI ADI — Over ${displayOv} Prediction!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🏏 ${live.score.battingTeam}: *${runs}/${wickets}* (${oversStr} ov)\n\n` +
      `🎙️ Over ${displayOv} just started — how many runs?\n\n` +
      `Reply: *!predict <number>*\n` +
      `_(Exact: +${EXACT_PTS} pts | ±1 run: +${CLOSE_PTS} pts)_\n` +
      `Results announced after the over 🏆`,
  };
}

// ─── !predict — Submit prediction ────────────────────────────────────────────

export async function handleSolliAdiPredict(msg: BotMessage, runsStr: string): Promise<CommandResult> {
  if (!BOT_SECRET) return { response: "Fantasy not configured da." };

  const runs = parseInt(runsStr?.trim() ?? "");
  if (isNaN(runs) || runs < 0 || runs > 36) {
    return { response: "Invalid da! Use *!predict <number>* — between 0 and 36 runs." };
  }

  // Sync live score from Cricbuzz before resolving
  await syncActiveMatch(msg.groupId);

  const live = await getLiveMatchForGroup(msg.groupId);
  if (!live) {
    return { response: "No live match — predictions only during live IPL!" };
  }

  const round = await getActiveRound(live.matchId, msg.groupId);
  if (!round) {
    return { response: "No active round da! Start one with *!solli*" };
  }

  const userPhone = msg.from.split("@")[0] ?? msg.from;
  const displayOv = overLabel(round.over_number);

  // Reject if user already has a prediction for this round — no changes allowed
  const { data: existingPred } = await supabase
    .from("ba_solli_adi_prediction")
    .select("id, predicted_runs")
    .eq("round_id", round.id)
    .eq("user_phone", userPhone)
    .maybeSingle();

  if (existingPred) {
    return {
      response: `📻 *${msg.senderName}*, nee already *${existingPred.predicted_runs} runs* predict pannirukke! Change panna mudiyaadhu da.`,
      mentions: [msg.from],
    };
  }

  const { error } = await supabase
    .from("ba_solli_adi_prediction")
    .insert({ round_id: round.id, user_phone: userPhone, user_name: msg.senderName, predicted_runs: runs });

  if (error) {
    console.error("[solli-adi] save prediction failed:", error.message);
    return { response: "Save panna mudiyala. Try again!" };
  }

  const pendingNote = round.status === "pending"
    ? `\n_(Over ${completedOverLabel(round)} still going — yours is locked in for over ${displayOv})_`
    : "";

  // Immediately check if the over is already resolved (sync on prediction)
  const resolveMessages = await checkAndResolveSolliAdi(
    live.matchId, msg.groupId,
    live.score.runs, live.score.completedOvers,
    undefined
  );

  const baseResponse = `📻 *${msg.senderName}* bets *${runs} runs* in over ${displayOv}! 🤞${pendingNote}`;
  const fullResponse = resolveMessages.length > 0
    ? `${baseResponse}\n\n${resolveMessages.join("\n\n")}`
    : baseResponse;

  return { response: fullResponse, mentions: [msg.from] };
}

function completedOverLabel(round: Round): number {
  // The over currently in progress (1-based)
  return round.over_number; // over_number is the TARGET, current in-progress = over_number (1-based same since pending means current = target-1)
}

// ─── !solli status ────────────────────────────────────────────────────────────

export async function handleSolliAdiStatus(msg: BotMessage): Promise<CommandResult> {
  await syncActiveMatch(msg.groupId);
  const live = await getLiveMatchForGroup(msg.groupId);
  if (!live) return { response: "📻 No live match da." };

  const round = await getActiveRound(live.matchId, msg.groupId);
  if (!round) {
    const { completedOvers, balls, runs, wickets, oversStr } = live.score;
    const nextOv = overLabel(nextOverIndex(completedOvers, balls));
    return {
      response:
        `📻 No active round.\n` +
        `Score: *${runs}/${wickets}* (${oversStr} ov)\n\n` +
        `Type *!solli* to predict over ${nextOv}!`,
    };
  }

  // Catch up on any pending→open or open→resolved transitions the cron may have missed
  const transitionMsgs = await checkAndResolveSolliAdi(
    live.matchId, msg.groupId,
    live.score.runs, live.score.completedOvers,
    undefined,
  );

  // Re-fetch after potential transition (round may now be resolved/voided)
  const currentRound = await getActiveRound(live.matchId, msg.groupId);
  if (!currentRound) {
    // Round was just resolved/voided by the transition check
    return { response: transitionMsgs.join("\n\n") || "📻 Round just ended!" };
  }

  const statusResult = await showRoundStatus(currentRound, live.score);
  if (transitionMsgs.length > 0) {
    return { response: transitionMsgs.join("\n\n") + "\n\n" + statusResult.response };
  }
  return statusResult;
}

async function showRoundStatus(round: Round, score: LiveScore): Promise<CommandResult> {
  const { data: preds } = await supabase
    .from("ba_solli_adi_prediction")
    .select("user_name, predicted_runs")
    .eq("round_id", round.id)
    .order("created_at");

  const displayOv = overLabel(round.over_number);
  const list = (preds ?? [])
    .map((p: any) => `  • ${p.user_name}: *${p.predicted_runs}* runs`)
    .join("\n");

  const statusTag = round.status === "pending"
    ? `⏳ Predictions locked — waiting for over ${round.over_number} to end (then over ${displayOv} begins!)`
    : `🟢 Open — over ${displayOv} in progress`;

  return {
    response:
      `📻 *Solli Adi — Over ${displayOv}*\n` +
      `Score: *${score.runs}/${score.wickets}* (${score.oversStr} ov)\n` +
      `${statusTag}\n\n` +
      (list || "No predictions yet — be first!\n") +
      `\n*!predict <runs>* to enter`,
  };
}

// ─── !solli lb — Solli Adi leaderboard ───────────────────────────────────────

export async function handleSolliAdiLeaderboard(msg: BotMessage): Promise<CommandResult> {
  const live = await getLiveMatchForGroup(msg.groupId);
  const matchId = live?.matchId;

  if (!matchId) {
    return { response: "📻 No live/recent match found." };
  }

  const lb = await getSolliAdiMatchLeaderboard(matchId, msg.groupId);
  return { response: lb ?? "📻 No Solli Adi rounds completed yet this match." };
}

export async function getSolliAdiMatchLeaderboard(matchId: string, groupId: string): Promise<string | null> {
  const { data: rounds } = await supabase
    .from("ba_solli_adi")
    .select("id, over_number, actual_runs, resolved_at")
    .eq("match_id", matchId)
    .eq("group_id", groupId)
    .eq("status", "resolved")
    .order("resolved_at");

  if (!rounds?.length) return null;

  const roundIds = rounds.map((r: any) => r.id as string);
  const { data: allPreds } = await supabase
    .from("ba_solli_adi_prediction")
    .select("user_name, user_phone, points_awarded")
    .in("round_id", roundIds);

  if (!allPreds?.length) return null;

  const totals = new Map<string, { name: string; pts: number; correct: number }>();
  for (const p of allPreds) {
    const key = p.user_phone as string;
    const cur = totals.get(key) ?? { name: p.user_name, pts: 0, correct: 0 };
    cur.pts += (p.points_awarded ?? 0);
    if ((p.points_awarded ?? 0) > 0) cur.correct++;
    totals.set(key, cur);
  }

  const sorted = [...totals.values()]
    .filter((e) => e.pts > 0)
    .sort((a, b) => b.pts - a.pts);

  if (!sorted.length) return null;

  const medals = ["🥇", "🥈", "🥉"];
  const lines = sorted
    .map((e, i) => `${medals[i] ?? `${i + 1}.`} *${e.name}* — ${e.pts} pts (${e.correct} hit${e.correct !== 1 ? "s" : ""})`)
    .join("\n");

  return (
    `📻 *Solli Adi Scoreboard*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    lines
  );
}

// ─── Auto-resolve (called from syncLiveScores) ────────────────────────────────

/**
 * Returns an array of WhatsApp messages to send.
 * May return 2 messages: one for pending→open transition, one for resolution.
 */
export async function checkAndResolveSolliAdi(
  matchId: string,
  groupId: string,
  currentRuns: number,
  completedOvers: number,
  matchStatus?: string,
): Promise<string[]> {
  const round = await getActiveRound(matchId, groupId);
  if (!round) return [];

  const messages: string[] = [];

  // ── Void if match ended before resolution ────────────────────────────────
  if (matchStatus === "completed") {
    await supabase
      .from("ba_solli_adi")
      .update({ status: "void" })
      .eq("id", round.id);
    const { count } = await supabase
      .from("ba_solli_adi_prediction")
      .select("id", { count: "exact", head: true })
      .eq("round_id", round.id);
    if ((count ?? 0) > 0) {
      messages.push(`📻 Match ended — Solli Adi over ${overLabel(round.over_number)} voided (no result).`);
    }
    return messages;
  }

  // ── Void if innings changed (runs decreased — new batting team) ───────────
  if (currentRuns < round.score_at_start) {
    await supabase.from("ba_solli_adi").update({ status: "void" }).eq("id", round.id);
    const { count } = await supabase
      .from("ba_solli_adi_prediction")
      .select("id", { count: "exact", head: true })
      .eq("round_id", round.id);
    if ((count ?? 0) > 0) {
      messages.push(`📻 Innings changed — Solli Adi over ${overLabel(round.over_number)} voided!`);
    }
    return messages;
  }

  // ── pending → open: target over just started ──────────────────────────────
  if (round.status === "pending" && completedOvers >= round.over_number) {
    const displayOv = overLabel(round.over_number);

    // If we're PAST the target over, the sync missed the start — can't compute
    // score_at_over_start accurately. Void to prevent incorrect 0-run resolutions.
    if (completedOvers > round.over_number) {
      await supabase.from("ba_solli_adi").update({ status: "void" }).eq("id", round.id);
      const { count } = await supabase
        .from("ba_solli_adi_prediction")
        .select("id", { count: "exact", head: true })
        .eq("round_id", round.id);
      if ((count ?? 0) > 0) {
        messages.push(`📻 Over ${displayOv} voided — sync missed the start, couldn't track score accurately. Sorry da!`);
      }
      return messages;
    }

    // completedOvers === over_number: target over just started → open it
    await supabase
      .from("ba_solli_adi")
      .update({ status: "open", score_at_over_start: currentRuns })
      .eq("id", round.id);

    const { count } = await supabase
      .from("ba_solli_adi_prediction")
      .select("id", { count: "exact", head: true })
      .eq("round_id", round.id);

    messages.push(
      `📻 *Over ${displayOv} starts NOW!*\n` +
      `${(count ?? 0) > 0 ? `${count} prediction(s) already in.` : "No predictions yet!"}\n` +
      `Still time — *!predict <runs>*`
    );

    // Re-fetch to get updated score_at_over_start for the check below
    const updated = { ...round, status: "open" as const, score_at_over_start: currentRuns };
    const resolution = await resolveIfComplete(updated, currentRuns, completedOvers, matchId, groupId);
    if (resolution) messages.push(resolution);
    return messages;
  }

  // ── open → resolved: target over completed ────────────────────────────────
  if (round.status === "open") {
    const resolution = await resolveIfComplete(round, currentRuns, completedOvers, matchId, groupId);
    if (resolution) messages.push(resolution);
  }

  return messages;
}

async function resolveIfComplete(
  round: Round,
  currentRuns: number,
  completedOvers: number,
  matchId: string,
  groupId: string,
): Promise<string | null> {
  // The over completes when completedOvers has passed over_number
  // over_number=14 → resolves when completedOvers >= 15
  if (completedOvers <= round.over_number) return null;

  // Guard against double-resolve (concurrent !predict + cron): re-fetch status
  const { data: fresh } = await supabase
    .from("ba_solli_adi").select("status").eq("id", round.id).maybeSingle();
  if (fresh?.status !== "open") return null; // already resolved or voided

  const overStartScore = round.score_at_over_start ?? round.score_at_start;
  const actualRuns = currentRuns - overStartScore;

  if (actualRuns < 0) return null; // safety: shouldn't happen here

  const { data: preds } = await supabase
    .from("ba_solli_adi_prediction")
    .select("*")
    .eq("round_id", round.id);

  const predictions = preds ?? [];

  type Result = { name: string; phone: string; predicted: number; pts: number; emoji: string };
  const results: Result[] = [];

  for (const pred of predictions) {
    const diff = Math.abs(pred.predicted_runs - actualRuns);
    let pts = 0;
    let emoji = "❌";
    if (diff === 0)      { pts = EXACT_PTS; emoji = "🎯"; }
    else if (diff === 1) { pts = CLOSE_PTS; emoji = "🔥"; }

    results.push({ name: pred.user_name, phone: pred.user_phone, predicted: pred.predicted_runs, pts, emoji });

    await supabase
      .from("ba_solli_adi_prediction")
      .update({ is_correct: diff === 0, points_awarded: pts })
      .eq("id", pred.id);

    if (pts > 0) {
      await awardBonusToUser(matchId, groupId, pred.user_phone, pts);
    }
  }

  await supabase
    .from("ba_solli_adi")
    .update({ status: "resolved", actual_runs: actualRuns, resolved_at: new Date().toISOString() })
    .eq("id", round.id);

  if (!predictions.length) return null;

  const displayOv = overLabel(round.over_number);
  const winners = results.filter((r) => r.pts > 0);
  const sorted = [...results].sort((a, b) => b.pts - a.pts);

  let msg = `📻 *SOLLI ADI — Over ${displayOv} Result!*\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏏 Actual runs: *${actualRuns}*\n\n`;

  if (winners.length > 0) {
    msg += `🏆 *Winner${winners.length > 1 ? "s" : ""}:*\n`;
    for (const w of winners) {
      msg += `  ${w.emoji} *${w.name}* — predicted ${w.predicted} → *+${w.pts} pts!*\n`;
    }
  } else {
    msg += `😅 Nobody nailed it! Closest misses:\n`;
    const top2 = sorted.slice(0, 2);
    for (const r of top2) {
      const diff = Math.abs(r.predicted - actualRuns);
      msg += `  • ${r.name}: ${r.predicted} (${diff > 0 ? `off by ${diff}` : "exact"})\n`;
    }
  }

  if (sorted.length > winners.length) {
    msg += `\n📊 All entries:\n`;
    for (const r of sorted) {
      const tag = r.pts > 0 ? ` ✅ +${r.pts}` : " ❌";
      msg += `  • ${r.name}: ${r.predicted}${tag}\n`;
    }
  }

  return msg;
}
