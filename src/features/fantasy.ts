/**
 * fantasy.ts — IPL Fantasy integration for BanterAgent
 *
 * Bridges BanterAgent (WhatsApp) ↔ the IPL Fantasy app via the /api/bot/* endpoints.
 *
 * Supabase table needed (run in BanterAgent's Supabase):
 * ─────────────────────────────────────────────────────────────────────────────
 * CREATE TABLE ba_fantasy_state (
 *   match_id         text PRIMARY KEY,  -- f11_matches.id
 *   group_id         text NOT NULL,
 *   contest_id       text,
 *   invite_code      text,
 *   team_home        text,
 *   team_away        text,
 *   scheduled_at     timestamptz,
 *   announced_at     timestamptz,
 *   toss_notified_at timestamptz,
 *   locked_at        timestamptz,
 *   completed_at     timestamptz,
 *   created_at       timestamptz DEFAULT now()
 * );
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase } from "../supabase.js";
import type { BotMessage, CommandResult } from "../types.js";

const FANTASY_BASE = process.env.FANTASY_APP_URL ?? "https://ipl11.vercel.app";
const BOT_SECRET = process.env.FANTASY_BOT_SECRET ?? "";

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function botFetch(path: string, opts?: RequestInit): Promise<any> {
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
}

// ─── State helpers ───────────────────────────────────────────────────────────

async function getState(matchId: string) {
  const { data } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();
  return data;
}

async function saveState(matchId: string, update: Record<string, unknown>) {
  await supabase
    .from("ba_fantasy_state")
    .upsert({ match_id: matchId, ...update }, { onConflict: "match_id" });
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function timeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} minutes`;
}

function formatIST(isoDate: string): string {
  return new Date(isoDate).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export function buildMatchAnnouncement(match: any, contest: any): string {
  const kickoff = formatIST(match.scheduled_at);
  const until = timeUntil(match.scheduled_at);
  const appUrl = `${FANTASY_BASE}/matches/${match.id}`;
  const joinUrl = contest?.invite_code
    ? `${FANTASY_BASE}/contests/join?code=${contest.invite_code}`
    : appUrl;

  return (
    `🏏 *IPL Fantasy Alert!*\n\n` +
    `*${match.team_home} vs ${match.team_away}*\n` +
    `📅 ${kickoff} (${until} from now)\n\n` +
    `Dei macha! Namma group-ku oru private contest ready aayiruchu! 🔥\n\n` +
    `💰 Entry: FREE\n` +
    `🎯 Invite Code: *${contest?.invite_code ?? "—"}*\n\n` +
    `📱 Join here:\n${joinUrl}\n\n` +
    `*Ippave team set pannu — toss nadanthathum playing 11 release aagum!*\n` +
    `_(Deadline: match start time)_`
  );
}

export function buildTossAnnouncement(match: any, xi: any): string {
  const { team_home, team_away, toss_winner, toss_decision } = match;

  const homeXI: string[] = (xi?.home ?? []).map((p: any) => `${p.name} (${p.role})`);
  const awayXI: string[] = (xi?.away ?? []).map((p: any) => `${p.name} (${p.role})`);

  let msg = `🪙 *TOSS RESULT!*\n\n`;
  if (toss_winner) {
    msg += `*${toss_winner}* won the toss and chose to *${toss_decision}*\n\n`;
  }
  msg += `⚡ *Playing XI confirmed!* Update your team NOW!\n`;
  msg += `_(Last chance before match starts)_\n\n`;

  if (homeXI.length) {
    msg += `🟡 *${team_home}*\n`;
    msg += homeXI.slice(0, 11).join("\n") + "\n\n";
  }
  if (awayXI.length) {
    msg += `🔵 *${team_away}*\n`;
    msg += awayXI.slice(0, 11).join("\n") + "\n\n";
  }

  msg += `🔗 Update team: ${FANTASY_BASE}/matches/${match.id}`;
  return msg;
}

function buildLeaderboard(leaderboard: any[], matchInfo: string, status: string): string {
  if (!leaderboard.length) return "Leaderboard empty da — koi join pannala still 😅";

  const medals = ["🥇", "🥈", "🥉"];
  let msg = `🏆 *FANTASY LEADERBOARD*\n_${matchInfo}_\n\n`;

  leaderboard.forEach((e, i) => {
    const medal = medals[i] ?? `${i + 1}.`;
    msg += `${medal} *${e.display_name}* — ${e.points} pts\n`;
    if (e.team_name) msg += `   _${e.team_name}_\n`;
  });

  if (status === "live") {
    msg += `\n_Live points — updates every 30 min!_`;
  } else if (status === "completed") {
    msg += `\n_Final standings!_`;
  } else if (status === "locked") {
    msg += `\n_Match starting soon — points will update once live!_`;
  } else {
    msg += `\n_Join panna ippo time irukku!_`;
  }

  return msg;
}

function buildPlayerStats(stats: any[], matchTeams: string): string {
  if (!stats.length) return "Match stats illai da — match start aagala maybe?";

  const top = stats.slice(0, 10);
  let msg = `📊 *FANTASY POINTS — ${matchTeams}*\n\n`;

  for (const s of top) {
    msg += `*${s.name}* (${s.team}) — *${s.points} pts*\n`;
    const parts: string[] = [];
    if (s.runs > 0) parts.push(`${s.runs}R/${s.balls}B`);
    if (s.sixes > 0) parts.push(`${s.sixes}x6`);
    if (s.wickets > 0) parts.push(`${s.wickets}W`);
    if (s.catches > 0) parts.push(`${s.catches}ct`);
    if (s.stumpings > 0) parts.push(`${s.stumpings}st`);
    if (parts.length) msg += `  ↳ ${parts.join(", ")}\n`;
  }

  return msg;
}

// ─── Scheduled actions (called from scheduler.ts) ────────────────────────────

/**
 * Check upcoming matches and drop announcements 3h before start.
 * Call this every 5 minutes from scheduler.
 */
export async function checkAndAnnounceMatches(groupId: string): Promise<string | null> {
  if (!BOT_SECRET) return null;

  const data = await botFetch("/upcoming");
  if (!data?.matches?.length) return null;

  const THREE_HOURS = 3 * 60 * 60 * 1000;

  for (const match of data.matches) {
    if (match.status !== "scheduled" && match.status !== "open") continue;

    const msUntil = new Date(match.scheduled_at).getTime() - Date.now();
    if (msUntil > THREE_HOURS + 5 * 60 * 1000) continue; // more than 3h5m away → skip
    if (msUntil < 0) continue; // already started

    // Check if already announced
    const state = await getState(match.id);
    if (state?.announced_at) continue; // already done

    // Create group contest
    const contestData = await botFetch("/contest", {
      method: "POST",
      body: JSON.stringify({ match_id: match.id, group_name: "Squad Goals" }),
    });

    const contest = contestData?.contest;

    // Save state
    await saveState(match.id, {
      group_id: groupId,
      contest_id: contest?.id ?? null,
      invite_code: contest?.invite_code ?? null,
      team_home: match.team_home,
      team_away: match.team_away,
      scheduled_at: match.scheduled_at,
      announced_at: new Date().toISOString(),
    });

    return buildMatchAnnouncement(match, contest);
  }

  return null;
}

/**
 * Check for toss results and send playing XI.
 * Call every 5 minutes from scheduler during match window.
 */
export async function checkAndSendToss(groupId: string): Promise<string | null> {
  if (!BOT_SECRET) return null;

  // Find matches that were announced but toss not yet notified
  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", groupId)
    .not("announced_at", "is", null)
    .is("toss_notified_at", null)
    .is("locked_at", null);

  if (!states?.length) return null;

  for (const state of states) {
    const msUntil = state.scheduled_at
      ? new Date(state.scheduled_at).getTime() - Date.now()
      : 9e9;

    // Only check within 2h of match start
    if (msUntil > 2 * 60 * 60 * 1000) continue;

    const xiData = await botFetch(`/playing-xi?match_id=${state.match_id}`);
    if (!xiData?.match) continue;

    const hasToss = xiData.match.toss_winner || xiData.playing_xi?.home?.length > 0;
    if (!hasToss) continue;

    await saveState(state.match_id, { toss_notified_at: new Date().toISOString() });
    return buildTossAnnouncement(xiData.match, xiData.playing_xi);
  }

  return null;
}

/**
 * Send live leaderboard update every 30 min during match.
 * Call every 30 min from scheduler.
 */
export async function sendLiveUpdate(groupId: string): Promise<string | null> {
  if (!BOT_SECRET) return null;

  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", groupId)
    .not("locked_at", "is", null)
    .is("completed_at", null);

  if (!states?.length) return null;

  // Take first active match
  const state = states[0]!;
  const summary = await botFetch(`/match-summary?match_id=${state.match_id}`);
  if (!summary?.match) return null;

  const { match, top_performers } = summary;

  // Match is done — send final results then mark completed
  if (match.status === "completed" || match.status === "in_review") {
    const lb = await botFetch(`/leaderboard?match_id=${state.match_id}&limit=5`);
    await saveState(state.match_id, { completed_at: new Date().toISOString() });

    let msg = `🏁 *MATCH OVER!* ${state.team_home} vs ${state.team_away}\n\n`;
    if (match.result_summary) msg += `📢 ${match.result_summary}\n\n`;

    if (lb?.leaderboard?.length) {
      msg += `🏆 *FANTASY FINAL STANDINGS*\n`;
      const medals = ["🥇", "🥈", "🥉"];
      lb.leaderboard.forEach((e: any, i: number) => {
        const medal = medals[i] ?? `${i + 1}.`;
        msg += `${medal} *${e.display_name}* — ${e.points} pts`;
        if (e.prize_won > 0) msg += ` · 🎉 Won ${e.prize_won} pts`;
        msg += `\n`;
        if (e.team_name) msg += `   _${e.team_name}_\n`;
      });
    }

    if (top_performers?.length) {
      msg += `\n⭐ *Top performer:* ${top_performers[0].name} — ${top_performers[0].points} pts\n`;
    }

    msg += `\nGG everyone! 🏏`;
    return msg;
  }

  if (match.status !== "live") return null;

  const lb = await botFetch(`/leaderboard?match_id=${state.match_id}&limit=5`);

  let msg = "";

  // Live score
  const ls = match.live_score;
  if (ls) {
    msg += `🏏 *LIVE:* ${ls.team1} ${ls.team1_runs}/${ls.team1_wickets} (${ls.team1_overs})\n`;
    if (ls.team2_runs > 0) {
      msg += `         ${ls.team2} ${ls.team2_runs}/${ls.team2_wickets} (${ls.team2_overs})\n`;
    }
    if (ls.situation) msg += `📢 ${ls.situation}\n`;
    msg += "\n";
  }

  // Top performers
  if (top_performers?.length) {
    msg += `⭐ *Top performers:*\n`;
    for (const p of top_performers) {
      msg += `• ${p.name} (${p.team}) — *${p.points} pts* _(${p.summary})_\n`;
    }
    msg += "\n";
  }

  // Leaderboard
  if (lb?.leaderboard?.length) {
    msg += buildLeaderboard(lb.leaderboard, `${state.team_home} vs ${state.team_away}`, "live");
  }

  return msg || null;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleJoin(msg: BotMessage): Promise<string> {
  const appUrl = `${FANTASY_BASE}/matches`;
  // Find the latest announced match for this group
  const { data: state } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("announced_at", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!state) {
    return `Ipo active contest illai da! Next match announce aagum pothu soluven 🏏`;
  }

  const joinUrl = state.invite_code
    ? `${FANTASY_BASE}/contests/join?code=${state.invite_code}`
    : appUrl;

  return (
    `🏏 *Join the Group Contest!*\n\n` +
    `*${state.team_home} vs ${state.team_away}*\n\n` +
    `🎯 Invite Code: *${state.invite_code ?? "N/A"}*\n` +
    `📱 Link: ${joinUrl}\n\n` +
    `App-la register pannitu inga join pannu! FREE entry 🔥`
  );
}

async function handleLeaderboard(msg: BotMessage): Promise<string> {
  const { data: state } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("announced_at", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!state) return "Active contest illai da! Match announce aagum pothu solluven.";

  const lb = await botFetch(`/leaderboard?match_id=${state.match_id}&limit=10`);
  if (lb?.error) return "Leaderboard fetch panna mudiyala. Try again!";
  if (!lb?.leaderboard?.length) return "Innum yaarum join pannala da 😅 Join pannu: !fantasy join";

  return buildLeaderboard(
    lb.leaderboard,
    `${state.team_home} vs ${state.team_away}`,
    lb.contest_status ?? "open"
  );
}

async function handleStats(msg: BotMessage, args: string): Promise<string> {
  const { data: state } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("announced_at", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!state) return "Active match illai da!";

  const search = args.trim() || undefined;
  const url = `/player-stats?match_id=${state.match_id}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
  const data = await botFetch(url);

  if (data?.error) return "Stats fetch panna mudiyala. Try again!";
  if (!data?.stats?.length) {
    return search
      ? `"${search}" stats illai — player name check pannu!`
      : "Match stats illai da — match start aagala or no data yet.";
  }

  return buildPlayerStats(data.stats, `${state.team_home} vs ${state.team_away}`);
}

async function handlePlayingXI(msg: BotMessage): Promise<string> {
  const { data: state } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("announced_at", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!state) return "Active match illai da!";

  const xiData = await botFetch(`/playing-xi?match_id=${state.match_id}`);
  if (!xiData?.playing_xi) return "Playing XI illai — toss nadakkavilai maybe.";

  const xi = xiData.playing_xi;
  if (!xi.home?.length && !xi.away?.length) {
    return "Playing XI innum confirm aagala da. Toss result wait pannu! 🕐";
  }

  return buildTossAnnouncement(xiData.match, xi);
}

// Admin commands

async function handleLock(msg: BotMessage): Promise<string> {
  void msg; // everyone can run admin commands

  const { data: state } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("announced_at", "is", null)
    .is("completed_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!state) return "Lock panna active match illai!";

  const res = await botFetch("/lock", {
    method: "POST",
    body: JSON.stringify({ match_id: state.match_id }),
  });

  if (res?.error) return `Lock failed: ${res.error}`;
  if (res?.already) return `Already ${res.status} da!`;

  await saveState(state.match_id, { locked_at: new Date().toISOString() });

  return (
    `🔒 *Contest LOCKED!*\n\n` +
    `*${state.team_home} vs ${state.team_away}* — no more team changes!\n` +
    `Match starts soon. Good luck everyone! 🏏`
  );
}

async function handleGoLive(msg: BotMessage): Promise<string> {
  void msg; // everyone can run admin commands

  const { data: state } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("locked_at", "is", null)
    .is("completed_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!state) return "Go live panna locked match illai!";

  const res = await botFetch("/lock", {
    method: "POST",
    body: JSON.stringify({ match_id: state.match_id, action: "go_live" }),
  });

  if (res?.error) return `Go live failed: ${res.error}`;

  return `🟢 *MATCH IS LIVE!* Scoring started. !fantasy leaderboard for updates 🔥`;
}

async function handleAnnounce(msg: BotMessage): Promise<string> {
  void msg; // everyone can run admin commands

  const data = await botFetch("/upcoming");
  if (!data?.matches?.length) return "No upcoming matches found in next 48h.";

  const match = data.matches[0];
  const contestData = await botFetch("/contest", {
    method: "POST",
    body: JSON.stringify({ match_id: match.id, group_name: "Squad Goals" }),
  });

  const contest = contestData?.contest;

  await saveState(match.id, {
    group_id: msg.groupId,
    contest_id: contest?.id ?? null,
    invite_code: contest?.invite_code ?? null,
    team_home: match.team_home,
    team_away: match.team_away,
    scheduled_at: match.scheduled_at,
    announced_at: new Date().toISOString(),
  });

  return buildMatchAnnouncement(match, contest);
}

async function handleSyncXI(msg: BotMessage): Promise<string> {
  void msg; // everyone can run admin commands

  const { data: state } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("announced_at", "is", null)
    .is("completed_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!state) return "Active match illai!";

  const res = await botFetch("/playing-xi", {
    method: "POST",
    body: JSON.stringify({ match_id: state.match_id }),
  });

  if (res?.error) return `Sync failed: ${res.error}`;
  return "Playing XI synced from Cricbuzz! Use !fantasy xi to see.";
}

function buildHelp(): string {
  return (
    `🏏 *Fantasy Cricket Commands*\n\n` +
    `!fantasy join — Join group contest\n` +
    `!fantasy lb — Leaderboard\n` +
    `!fantasy stats — Top scorer points\n` +
    `!fantasy score <player> — Specific player stats\n` +
    `!fantasy xi — Playing XI (post-toss)\n\n` +
    `_Admin:_\n` +
    `!fantasy announce — Force match announcement\n` +
    `!fantasy lock — Lock teams (match start)\n` +
    `!fantasy live — Go live (start scoring)\n` +
    `!fantasy sync — Sync playing XI\n\n` +
    `App: ${FANTASY_BASE}`
  );
}

// ─── Main router ─────────────────────────────────────────────────────────────

export async function handleFantasyCommand(
  args: string,
  msg: BotMessage
): Promise<CommandResult> {
  const parts = args.trim().split(/\s+/);
  const sub = (parts[0] ?? "").toLowerCase();
  const rest = parts.slice(1).join(" ");

  switch (sub) {
    case "join":
    case "j":
      return { response: await handleJoin(msg) };

    case "leaderboard":
    case "lb":
    case "rank":
      return { response: await handleLeaderboard(msg) };

    case "stats":
    case "points":
      return { response: await handleStats(msg, rest) };

    case "score":
      return { response: await handleStats(msg, rest) };

    case "xi":
    case "playing11":
    case "lineup":
      return { response: await handlePlayingXI(msg) };

    case "lock":
      return { response: await handleLock(msg) };

    case "live":
      return { response: await handleGoLive(msg) };

    case "announce":
      return { response: await handleAnnounce(msg) };

    case "sync":
      return { response: await handleSyncXI(msg) };

    case "help":
    case "":
      return { response: buildHelp() };

    default:
      return { response: `Unknown sub-command. Try *!fantasy help*` };
  }
}
