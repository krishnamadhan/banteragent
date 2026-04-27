import type { BotMessage } from "../types.js";
import { generateContent, generateStructured } from "../claude.js";
import { supabase } from "../supabase.js";

const CRICKET_API_BASE = "https://api.cricapi.com/v1";

interface CricketMatch {
  id: string;
  name: string;
  status: string;
  score?: Array<{ r: number; w: number; o: number; inning: string }>;
  dateTimeGMT: string;
  matchType: string;
}

// ===== Fetch live cricket scores =====
async function fetchLiveScores(): Promise<CricketMatch[]> {
  const apiKey = process.env.CRICKET_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `${CRICKET_API_BASE}/currentMatches?apikey=${apiKey}&offset=0`
    );
    const data = await res.json() as { data?: CricketMatch[] };
    return data.data ?? [];
  } catch (error) {
    console.error("Cricket API error:", error);
    return [];
  }
}

// ===== Format score for display =====
function formatScore(match: CricketMatch): string {
  let text = `🏏 *${match.name}*\n`;
  text += `📋 ${match.status}\n`;

  if (match.score?.length) {
    for (const s of match.score) {
      text += `${s.inning}: ${s.r}/${s.w} (${s.o} ov)\n`;
    }
  }

  return text;
}

function isIPL(match: CricketMatch): boolean {
  return (
    match.name.includes("Indian Premier League") ||
    match.name.includes("IPL") ||
    (match.matchType === "t20" && match.name.includes("vs") &&
      /\b(CSK|MI|RCB|KKR|DC|PBKS|RR|SRH|GT|LSG)\b/.test(match.name))
  );
}

// ===== Get live scores command =====
async function getLiveScores(): Promise<string> {
  const matches = await fetchLiveScores();

  if (!matches.length) {
    return "Ipo live match onnum illa machaan. Cricket drought 🏜️";
  }

  const active = matches.filter((m) => m.status && !m.status.includes("not started"));

  if (!active.length) {
    return "Matches irukkum aana ipo live-la onnum nadakkala. Wait pannu machaan.";
  }

  // IPL first — users want IPL scores, not Legends League or other tournaments
  const ipl = active.filter(isIPL);
  const toShow = (ipl.length ? ipl : active).slice(0, 3);

  let response = "🏏 *LIVE CRICKET SCORES*\n\n";
  toShow.forEach((match) => {
    response += formatScore(match) + "\n";
  });

  return response;
}

// ===== Toggle cricket alerts =====
async function toggleAlerts(
  args: string,
  msg: BotMessage
): Promise<string> {
  const enabled = args.trim().toLowerCase().includes("on");

  await supabase.from("ba_group_settings").upsert({
    group_id: msg.groupId,
    cricket_alerts: enabled,
    updated_at: new Date().toISOString(),
  });

  return enabled
    ? "🏏 Cricket alerts ON! Match updates varumpo Tanglish commentary-oda solluven 🔥"
    : "Cricket alerts OFF pannitten. No more score updates.";
}

// ===== Generate Tanglish cricket commentary =====
export async function generateCricketCommentary(
  match: CricketMatch
): Promise<string> {
  const scoreText = match.score
    ?.map((s) => `${s.inning}: ${s.r}/${s.w} (${s.o} overs)`)
    .join("\n");

  const prompt = `You're a cricket commentator who speaks in Tanglish. Give a SHORT (3-4 lines) exciting update about this match. Be dramatic like a Tamil cricket fan watching with friends.

Match: ${match.name}
Status: ${match.status}
Score:
${scoreText ?? "No score yet"}

Don't just repeat the score — add your funny Tanglish reaction to it. Be dramatic about wickets, big scores, or close matches.`;

  return await generateContent(prompt);
}

// ===== Check for score updates (called by cron) =====
export async function checkCricketUpdates(groupId: string): Promise<
  Array<{ groupId: string; message: string }>
> {
  // Guard: only poll during IPL match windows (3:30 PM – 11:00 PM IST)
  const istNow = Date.now() + 5.5 * 60 * 60 * 1000;
  const istHour = new Date(istNow).getUTCHours();
  const istMin  = new Date(istNow).getUTCMinutes();
  const istTotalMins = istHour * 60 + istMin;
  if (istTotalMins < 15 * 60 + 30 || istTotalMins >= 23 * 60) return [];

  const { data: settings } = await supabase
    .from("ba_group_settings")
    .select("cricket_alerts")
    .eq("group_id", groupId)
    .maybeSingle();

  if (!settings?.cricket_alerts) return [];

  const matches = await fetchLiveScores();
  if (!matches.length) return [];

  const activeMatches = matches.filter(
    (m) =>
      m.status &&
      (m.status.includes("innings") ||
        m.status.includes("won") ||
        m.status.includes("wicket"))
  );

  if (!activeMatches.length) return [];

  const iplMatches = activeMatches.filter(isIPL);
  const candidates = iplMatches.length ? iplMatches : activeMatches;
  const topMatch = candidates[0];
  const currentScore = topMatch.score
    ?.map((s) => `${s.inning}:${s.r}/${s.w}`)
    .join("|") ?? topMatch.status;

  const { data: existing } = await supabase
    .from("ba_cricket_state")
    .select("last_score, match_status, last_sent_at")
    .eq("group_id", groupId)
    .eq("match_id", topMatch.id)
    .maybeSingle();

  if (existing?.last_score === currentScore) return [];
  if (existing?.match_status === "completed") return [];

  // Rate-limit commentary: at most once every 20 minutes (DB-backed so restarts don't reset it)
  if (existing?.last_sent_at) {
    const msSinceLastSent = Date.now() - new Date(existing.last_sent_at).getTime();
    if (msSinceLastSent < 20 * 60 * 1000) {
      // Score changed but within rate limit — update state silently, no message
      await supabase.from("ba_cricket_state").upsert({
        group_id: groupId, match_id: topMatch.id,
        last_score: currentScore,
        match_status: topMatch.status.toLowerCase().includes("won") ? "completed" : "live",
      }, { onConflict: "group_id,match_id" });
      return [];
    }
  }

  await supabase.from("ba_cricket_state").upsert({
    group_id: groupId, match_id: topMatch.id,
    last_score: currentScore,
    last_sent_at: new Date().toISOString(),
    match_status: topMatch.status.toLowerCase().includes("won") ? "completed" : "live",
  }, { onConflict: "group_id,match_id" });

  const commentary = await generateCricketCommentary(topMatch);
  const message = `${formatScore(topMatch)}\n${commentary}`;

  return [{ groupId, message }];
}

// ===== Main Handler =====
export async function handleCricketCommand(
  args: string,
  msg: BotMessage
): Promise<{ response: string }> {
  if (args.toLowerCase().includes("alert")) {
    return { response: await toggleAlerts(args, msg) };
  }

  return { response: await getLiveScores() };
}
