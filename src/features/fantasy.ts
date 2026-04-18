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
  const { error } = await supabase
    .from("ba_fantasy_state")
    .upsert({ match_id: matchId, ...update }, { onConflict: "match_id" });
  if (error) throw new Error(`saveState failed for ${matchId}: ${error.message}`);
}

/**
 * Returns the "active" contest state for a group.
 *
 * On a double-header day, ORDER BY scheduled_at DESC picks the LATER match
 * (the one still in the future), not the one currently live.
 *
 * Correct priority:
 *   1. Most recently STARTED, not-yet-completed match (scheduled_at ≤ now)
 *   2. Soonest UPCOMING match (scheduled_at > now)
 */
async function getActiveState(groupId: string) {
  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", groupId)
    .not("announced_at", "is", null)
    .is("completed_at", null);

  if (!states?.length) return null;

  const now = Date.now();
  const started = states.filter((s) => new Date(s.scheduled_at).getTime() <= now);
  const future  = states.filter((s) => new Date(s.scheduled_at).getTime() >  now);

  if (started.length) {
    // Most recently started first
    return started.sort(
      (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
    )[0]!;
  }
  // Nothing live yet — soonest upcoming
  return future.sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  )[0] ?? null;
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

const ROLE_LABEL: Record<string, string> = { AR: "AR", WK: "WK 🧤", BAT: "BAT", BOWL: "BOWL" };

export async function buildMatchAnnouncement(match: any, contest: any): Promise<string> {
  const kickoff = formatIST(match.scheduled_at);
  const until = timeUntil(match.scheduled_at);
  const joinUrl = contest?.invite_code
    ? `${FANTASY_BASE}/contests/join?code=${contest.invite_code}`
    : `${FANTASY_BASE}/matches/${match.id}`;

  let msg =
    `🏏 *IPL Fantasy Alert!*\n\n` +
    `*${match.team_home} vs ${match.team_away}*\n` +
    `📅 ${kickoff} (${until} from now)\n`;

  if (match.venue) msg += `📍 ${match.venue}\n`;

  msg +=
    `\nDei macha! Namma group-ku oru private contest ready aayiruchu! 🔥\n\n` +
    `💰 Entry: FREE\n` +
    `🎯 Invite Code: *${contest?.invite_code ?? "—"}*\n\n` +
    `📱 Join here:\n${joinUrl}\n\n`;

  // Fetch live preview from API
  try {
    const preview = await botFetch(`/team-preview?match_id=${match.id}`);
    if (preview && !preview.error) {
      msg += `━━━━━━━━━━━━━━━━━━\n`;
      msg += `🏟️ *GROUND PREDICTION*\n${preview.venue_tip}\n\n`;

      if (preview.home_picks?.length || preview.away_picks?.length) {
        msg += `⭐ *PLAYERS TO WATCH*\n`;
        if (preview.home_picks?.length) {
          const picks = preview.home_picks.map((p: any) => `${p.name} (${ROLE_LABEL[p.role] ?? p.role})`).join(", ");
          msg += `🔵 ${match.team_home.split(" ").pop()}: ${picks}\n`;
        }
        if (preview.away_picks?.length) {
          const picks = preview.away_picks.map((p: any) => `${p.name} (${ROLE_LABEL[p.role] ?? p.role})`).join(", ");
          msg += `🟡 ${match.team_away.split(" ").pop()}: ${picks}\n`;
        }
        msg += `\n`;
      }
    }
  } catch {
    // Non-fatal — announcement still goes out without preview
  }

  msg +=
    `*Ippave team set pannu — toss nadanthathum playing 11 release aagum!*\n` +
    `_(Deadline: match start time)_`;

  return msg;
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

  const SIX_HOURS = 6 * 60 * 60 * 1000;

  for (const match of data.matches) {
    // Allow scheduled/open (pre-match) — locked/live means we missed the window
    // but we still try to announce so users can see the leaderboard
    const isAnnounceable = ["scheduled", "open", "locked", "live"].includes(match.status);
    if (!isAnnounceable) continue;

    const msUntil = new Date(match.scheduled_at).getTime() - Date.now();

    // Too far in the future — wait until 6h before
    if (msUntil > SIX_HOURS + 5 * 60 * 1000) continue;

    // Match started more than 4h ago — too late to create a contest
    if (msUntil < -4 * 60 * 60 * 1000) continue;

    // Check if already announced
    const state = await getState(match.id);
    if (state?.announced_at) continue; // already done

    // Create group contest (idempotent — returns existing if already in DB)
    const contestData = await botFetch("/contest", {
      method: "POST",
      body: JSON.stringify({ match_id: match.id, group_name: "Squad Goals" }),
    });

    const contest = contestData?.contest;

    if (!contest?.id) {
      // Contest creation failed (e.g. match already locked on app side) — do NOT mark
      // as announced so the next cron cycle retries
      console.error(`Fantasy contest creation failed for ${match.id}:`, contestData?.error ?? "no contest returned");
      continue;
    }

    // Only mark announced once we have a real contest
    await saveState(match.id, {
      group_id: groupId,
      contest_id: contest.id,
      invite_code: contest.invite_code ?? null,
      team_home: match.team_home,
      team_away: match.team_away,
      scheduled_at: match.scheduled_at,
      announced_at: new Date().toISOString(),
    });

    return await buildMatchAnnouncement(match, contest);
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

    // Require actual toss_winner — probable XI without toss must not trigger this
    const hasToss = !!xiData.match.toss_winner;
    if (!hasToss) continue;

    // Auto-transition match to live so scoring cron picks it up.
    // Step 1: lock (open → locked, idempotent if already locked)
    const lockRes = await botFetch("/lock", {
      method: "POST",
      body: JSON.stringify({ match_id: state.match_id }),
    });
    if (lockRes?.error) {
      console.error(`[fantasy] lock failed for match ${state.match_id}:`, lockRes.error);
      continue;
    }
    // Step 2: go live (locked → live)
    const goLiveRes = await botFetch("/lock", {
      method: "POST",
      body: JSON.stringify({ match_id: state.match_id, action: "go_live" }),
    });
    if (goLiveRes?.error) {
      console.error(`[fantasy] go_live failed for match ${state.match_id}:`, goLiveRes.error);
      continue;
    }

    await saveState(state.match_id, {
      toss_notified_at: new Date().toISOString(),
      locked_at: new Date().toISOString(),
    });
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

  const now = new Date().toISOString();

  // Trigger live updates when:
  //   a) admin ran !fantasy lock  (locked_at set), OR
  //   b) toss happened + scheduled_at passed (auto-detect match going live)
  // Previously required locked_at, which meant live updates never fired unless
  // someone manually typed !fantasy lock in the group.
  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", groupId)
    .or("locked_at.not.is.null,toss_notified_at.not.is.null")
    .lte("scheduled_at", now)   // match time has passed
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

// ─── Seamless scheduled pipeline ─────────────────────────────────────────────

type SendFn = (jid: string, text: string) => Promise<void>;

/**
 * 10:00 AM — Sync IPL schedule from Cricbuzz and post today's matches.
 */
export async function dailyScheduleSync(groupId: string): Promise<string | null> {
  if (!BOT_SECRET) return null;

  await botFetch("/sync-schedule", { method: "POST" });

  const data = await botFetch("/upcoming");
  if (!data?.matches?.length) return null;

  const todayIST = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const todayMatches = (data.matches as any[]).filter((m) => {
    const matchDateIST = new Date(m.scheduled_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    return matchDateIST === todayIST;
  });

  if (!todayMatches.length) return null;

  let msg = `🏏 *TODAY'S IPL FANTASY MATCHES*\n\n`;
  for (const m of todayMatches) {
    msg += `*${m.team_home} vs ${m.team_away}*\n`;
    msg += `🕐 ${formatIST(m.scheduled_at)}\n\n`;
  }
  msg += `Join at ${FANTASY_BASE} 🔗\n`;
  msg += `_Contest + invite code coming at 11 AM!_`;
  return msg;
}

/**
 * 11:00 AM — Create contests for today's matches and post announcements.
 */
export async function dailyContestCreate(groupId: string): Promise<string | null> {
  if (!BOT_SECRET) return null;

  const data = await botFetch("/upcoming");
  if (!data?.matches?.length) return null;

  const todayIST = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const todayMatches = (data.matches as any[]).filter((m) => {
    const matchDateIST = new Date(m.scheduled_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    return matchDateIST === todayIST && ["scheduled", "open"].includes(m.status);
  });

  if (!todayMatches.length) return null;

  const announcements: string[] = [];

  for (const match of todayMatches) {
    const state = await getState(match.id);
    if (state?.announced_at) continue;

    const contestRes = await botFetch("/contest", {
      method: "POST",
      body: JSON.stringify({ match_id: match.id, group_name: "Banter FC" }),
    });

    if (!contestRes?.contest?.id) {
      console.error(`[fantasy] Contest creation failed for ${match.id}:`, contestRes?.error);
      continue;
    }

    await saveState(match.id, {
      group_id: groupId,
      contest_id: contestRes.contest.id,
      invite_code: contestRes.contest.invite_code ?? null,
      team_home: match.team_home,
      team_away: match.team_away,
      scheduled_at: match.scheduled_at,
      announced_at: new Date().toISOString(),
    });

    announcements.push(await buildMatchAnnouncement(match, contestRes.contest));
  }

  return announcements.length ? announcements.join("\n\n─────────────\n\n") : null;
}

/**
 * Lock teams and return a toss announcement message.
 */
async function lockAndAnnounce(matchId: string, xiData: any): Promise<string> {
  const lockRes = await botFetch("/lock", {
    method: "POST",
    body: JSON.stringify({ match_id: matchId }),
  });
  if (lockRes?.error) {
    console.error(`[fantasy] lock failed for ${matchId}:`, lockRes.error);
  } else {
    const goLiveRes = await botFetch("/lock", {
      method: "POST",
      body: JSON.stringify({ match_id: matchId, action: "go_live" }),
    });
    if (goLiveRes?.error) {
      console.error(`[fantasy] go_live failed for ${matchId}:`, goLiveRes.error);
    }
  }
  await saveState(matchId, {
    toss_notified_at: new Date().toISOString(),
    locked_at: new Date().toISOString(),
  });
  return buildTossAnnouncement(xiData.match, xiData.playing_xi);
}

/**
 * 3:10 PM / 7:10 PM — Sync playing XI, check toss, lock teams.
 * If toss not done yet, polls every 15 min via setTimeout until toss confirmed
 * or the deadline (90 min past scheduled start) is reached.
 *
 * @param slotHourIST  Target match hour in IST (15 for 3:30 PM, 19 for 7:30 PM)
 * @param slotMinIST   Target match minute in IST (30)
 * @param sendFn       sendMessage callback — used for async poll results
 */
export async function preMatchCheck(
  groupId: string,
  slotHourIST: number,
  slotMinIST: number,
  sendFn: SendFn
): Promise<string | null> {
  if (!BOT_SECRET) return null;

  // Find an announced, not-yet-tossed match in this time slot.
  // Constrain scheduled_at to ±3h of now so stale matches from previous days
  // (where toss_notified_at / completed_at were never set) can't sneak through.
  // The subsequent HH:MM check narrows it to the exact cron slot.
  const now = new Date();
  const windowStart = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const windowEnd   = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();

  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", groupId)
    .not("announced_at", "is", null)
    .is("toss_notified_at", null)
    .is("completed_at", null)
    .gte("scheduled_at", windowStart)
    .lte("scheduled_at", windowEnd);

  if (!states?.length) return null;

  const targetMins = slotHourIST * 60 + slotMinIST;
  const slotMatch = (states as any[]).find((s) => {
    if (!s.scheduled_at) return false;
    const d = new Date(s.scheduled_at);
    const h = parseInt(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
    const mi = d.toLocaleString("en-US", { timeZone: "Asia/Kolkata", minute: "numeric" });
    return Math.abs(h * 60 + parseInt(mi) - targetMins) <= 35;
  });

  if (!slotMatch) return null;

  // Always sync XI from Cricbuzz first
  await botFetch("/playing-xi", {
    method: "POST",
    body: JSON.stringify({ match_id: slotMatch.match_id }),
  });

  const xiData = await botFetch(`/playing-xi?match_id=${slotMatch.match_id}`);

  if (xiData?.match?.toss_winner) {
    // Toss already done — lock and announce immediately
    return await lockAndAnnounce(slotMatch.match_id, xiData);
  }

  // Toss not done — send reminder and start 15-min polling
  const reminderMsg =
    `⏰ *MATCH ALERT!*\n\n` +
    `*${slotMatch.team_home} vs ${slotMatch.team_away}*\n` +
    `🕐 ${formatIST(slotMatch.scheduled_at)}\n\n` +
    `Join now before toss: ${FANTASY_BASE}/contests/join?code=${slotMatch.invite_code}\n\n` +
    `_Waiting for toss result... 🪙 Will post playing XI as soon as it's done!_`;

  const deadlineMs = new Date(slotMatch.scheduled_at).getTime() + 90 * 60 * 1000;
  let pollsLeft = 6; // max 6 × 15 min = 90 min

  const poll = async () => {
    pollsLeft--;

    if (Date.now() >= deadlineMs || pollsLeft < 0) {
      await sendFn(
        groupId,
        `⚠️ *${slotMatch.team_home} vs ${slotMatch.team_away}*\n\nNo toss update after 90 minutes. Match may be delayed or abandoned.`
      );
      return;
    }

    await botFetch("/playing-xi", {
      method: "POST",
      body: JSON.stringify({ match_id: slotMatch.match_id }),
    });

    const fresh = await botFetch(`/playing-xi?match_id=${slotMatch.match_id}`);
    if (fresh?.match?.toss_winner) {
      const msg = await lockAndAnnounce(slotMatch.match_id, fresh);
      await sendFn(groupId, msg);
    } else if (pollsLeft > 0) {
      setTimeout(poll, 15 * 60 * 1000);
    } else {
      await sendFn(
        groupId,
        `⚠️ *${slotMatch.team_home} vs ${slotMatch.team_away}*\n\nNo toss update after 90 minutes. Match may be delayed or abandoned.`
      );
    }
  };

  setTimeout(poll, 15 * 60 * 1000);
  return reminderMsg;
}

/**
 * Every 5 min — Sync live scores for all active matches.
 * Silent — no WhatsApp message. Just keeps the fantasy app data fresh.
 */
export async function syncLiveScores(groupId: string): Promise<void> {
  if (!BOT_SECRET) return;

  const now = new Date().toISOString();
  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("match_id")
    .eq("group_id", groupId)
    .or("locked_at.not.is.null,toss_notified_at.not.is.null")
    .lte("scheduled_at", now)
    .is("completed_at", null);

  if (!states?.length) return;

  for (const state of states) {
    await botFetch("/sync", {
      method: "POST",
      body: JSON.stringify({ match_id: state.match_id }),
    }).catch((e: any) => console.error(`[fantasy] sync error for ${state.match_id}:`, e));
  }
}

// ─── Team diff formatter ─────────────────────────────────────────────────────

function roleEmoji(role: string): string {
  switch (role) {
    case "WK":   return "🧤";
    case "BAT":  return "🏏";
    case "AR":   return "⚡";
    case "BOWL": return "🎯";
    default:     return "•";
  }
}

function formatDiff(data: any): string {
  const { team1, team2, only_in_1, only_in_2, common } = data;

  const name1 = team1.display_name + (team1.rank ? ` (#${team1.rank})` : "");
  const name2 = team2.display_name + (team2.rank ? ` (#${team2.rank})` : "");

  const sep = "━━━━━━━━━━━━━━━━━━";
  let msg = `🔄 *TEAM DIFF*\n${name1} vs ${name2}\n\n`;

  // ── Different players ──
  msg += `${sep}\n🔀 *DIFFERENT PLAYERS*\n${sep}\n`;

  if (!only_in_1.length && !only_in_2.length) {
    msg += `Both teams are identical! 😳\n`;
  } else {
    if (only_in_1.length) {
      msg += `\n👤 *Only ${team1.display_name} has:*\n`;
      for (const p of only_in_1) {
        const pts = p.points > 0 ? ` — ${p.points}pts` : "";
        msg += `${roleEmoji(p.role)} ${p.name} (${p.ipl_team})${pts}\n`;
      }
    }
    if (only_in_2.length) {
      msg += `\n👤 *Only ${team2.display_name} has:*\n`;
      for (const p of only_in_2) {
        const pts = p.points > 0 ? ` — ${p.points}pts` : "";
        msg += `${roleEmoji(p.role)} ${p.name} (${p.ipl_team})${pts}\n`;
      }
    }
  }

  // ── Captain / VC ──
  msg += `\n${sep}\n👑 *CAPTAIN / VC*\n${sep}\n`;

  const c1 = team1.captain?.name ?? "—";
  const v1 = team1.vc?.name ?? "—";
  const c2 = team2.captain?.name ?? "—";
  const v2 = team2.vc?.name ?? "—";

  const capSame = team1.captain?.id === team2.captain?.id;
  const vcSame  = team1.vc?.id === team2.vc?.id;

  msg += `👑 C: *${c1}*${capSame ? " ✅" : ""} vs *${c2}*${capSame ? " ✅" : ""}\n`;
  msg += `⭐ VC: *${v1}*${vcSame ? " ✅" : ""} vs *${v2}*${vcSame ? " ✅" : ""}\n`;

  if (!capSame && !vcSame) {
    msg += `_(C & VC both different — big points swing possible!)_\n`;
  } else if (!capSame) {
    msg += `_(C different — VC same)_\n`;
  } else if (!vcSame) {
    msg += `_(C same — VC different)_\n`;
  } else {
    msg += `_(Same C & VC — result depends on team selection)_\n`;
  }

  // ── Common players ──
  msg += `\n${sep}\n✅ *COMMON (${common.length}/11)*\n${sep}\n`;
  if (common.length) {
    const chunks: string[] = [];
    for (const p of common) {
      chunks.push(`${roleEmoji(p.role)} ${p.name}`);
    }
    // Group into lines of 2 to keep it compact
    for (let i = 0; i < chunks.length; i += 2) {
      msg += chunks.slice(i, i + 2).join("  ") + "\n";
    }
  } else {
    msg += `No common players! Maximum variance.\n`;
  }

  msg += `\n_${only_in_1.length + only_in_2.length} different · ${common.length} shared_`;
  return msg;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleJoin(msg: BotMessage): Promise<string> {
  const appUrl = `${FANTASY_BASE}/matches`;
  const state = await getActiveState(msg.groupId);

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
  const state = await getActiveState(msg.groupId);

  if (!state) return "Active contest illai da! Match announce aagum pothu solluven.";

  // Trigger live score sync before showing results — ensures fresh data.
  // 12s cap: Cricbuzz fetch + upsert + leaderboard update can take 6-8s.
  if (state.match_id) {
    try {
      await Promise.race([
        botFetch("/sync", { method: "POST", body: JSON.stringify({ match_id: state.match_id }) }),
        new Promise((res) => setTimeout(res, 12000)),
      ]);
    } catch {
      // Sync failed — fall through with cached leaderboard
    }
  }

  const lb = await botFetch(`/leaderboard?match_id=${state.match_id}&limit=10`);
  if (lb?.error) return "Leaderboard fetch panna mudiyala. Try again!";
  if (!lb?.leaderboard?.length) return "Innum yaarum join pannala da 😅 Join pannu: !fantasy join";

  const contestStatus = lb.contest_status ?? "open";

  // If match is live but all scores are 0, the sync hasn't populated yet.
  // Show a helpful message instead of a misleading all-zero leaderboard.
  if (contestStatus === "live") {
    const allZero = (lb.leaderboard as any[]).every((e: any) => (e.points ?? 0) === 0);
    if (allZero) {
      return `🏆 *FANTASY LEADERBOARD*\n_${state.team_home} vs ${state.team_away}_\n\n⏳ Scores still syncing da — 2 nimisham wait panni !fl again try pannu! Cricket points API update aaguthu 🏏`;
    }
  }

  return buildLeaderboard(
    lb.leaderboard,
    `${state.team_home} vs ${state.team_away}`,
    contestStatus
  );
}

async function handleStats(msg: BotMessage, args: string): Promise<string> {
  const state = await getActiveState(msg.groupId);

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
  const state = await getActiveState(msg.groupId);

  if (!state) return "Active match illai da!";

  const xiData = await botFetch(`/playing-xi?match_id=${state.match_id}`);
  if (!xiData?.playing_xi) return "Playing XI illai — toss nadakkavilai maybe.";

  const xi = xiData.playing_xi;
  if (!xi.home?.length && !xi.away?.length) {
    return "Playing XI innum confirm aagala da. Toss result wait pannu! 🕐";
  }

  return buildTossAnnouncement(xiData.match, xi);
}

async function handleDiff(msg: BotMessage, args: string): Promise<string> {
  const state = await getActiveState(msg.groupId);

  if (!state) return "Active contest illai da! Match announce aagum pothu solluven.";

  // Parse optional names: "diff Krish Madhan" or "diff" (top 2)
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const user1 = parts[0] ?? "";
  const user2 = parts[1] ?? "";

  const qs = new URLSearchParams({ match_id: state.match_id });
  if (user1) qs.set("user1", user1);
  if (user2) qs.set("user2", user2);

  const data = await botFetch(`/team-diff?${qs.toString()}`);

  if (!data || data?.error) {
    const msg = typeof data?.error === "string" && !data.error.includes("<!DOCTYPE")
      ? data.error
      : "Diff fetch pannala, try again!";
    return msg;
  }

  return formatDiff(data);
}

// Admin commands

async function handleLock(msg: BotMessage): Promise<string> {
  void msg; // everyone can run admin commands

  const state = await getActiveState(msg.groupId);

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

  // Must be locked (locked_at not null) — can't use getActiveState here
  const { data: states } = await supabase
    .from("ba_fantasy_state")
    .select("*")
    .eq("group_id", msg.groupId)
    .not("locked_at", "is", null)
    .is("completed_at", null);

  if (!states?.length) return "Go live panna locked match illai!";

  const now = Date.now();
  const started = states.filter((s) => new Date(s.scheduled_at).getTime() <= now);
  const future  = states.filter((s) => new Date(s.scheduled_at).getTime() > now);
  const state = started.length
    ? started.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0]!
    : future.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]!;

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

  return await buildMatchAnnouncement(match, contest);
}

async function handleSyncXI(msg: BotMessage): Promise<string> {
  void msg; // everyone can run admin commands

  const state = await getActiveState(msg.groupId);

  if (!state) return "Active match illai!";

  const res = await botFetch("/playing-xi", {
    method: "POST",
    body: JSON.stringify({ match_id: state.match_id }),
  });

  if (res?.error) return `Sync failed: ${res.error}`;
  return "Playing XI synced from Cricbuzz! Use !fantasy xi to see.";
}

async function handleContest(msg: BotMessage): Promise<string> {
  // Fetch all upcoming open/scheduled matches in the next 48h
  const data = await botFetch("/upcoming");
  if (!data?.matches?.length) return "No open matches found in the next 48h.";

  const openMatches = (data.matches as any[]).filter(
    (m) => m.status === "open" || m.status === "scheduled"
  );
  if (!openMatches.length) return "No open/scheduled matches right now. Try again closer to match time.";

  const lines: string[] = [];
  let created = 0;

  for (const match of openMatches) {
    // Skip if already announced for this group
    const state = await getState(match.id);
    if (state?.announced_at) {
      const code = state.invite_code;
      lines.push(
        `✅ *${match.team_home} vs ${match.team_away}* — contest already exists!\n` +
        `🎯 Code: *${code ?? "—"}*\n` +
        `📱 ${FANTASY_BASE}/contests/join?code=${code}`
      );
      continue;
    }

    const contestData = await botFetch("/contest", {
      method: "POST",
      body: JSON.stringify({ match_id: match.id, group_name: "Squad Goals" }),
    });

    const contest = contestData?.contest;
    if (!contest?.id) {
      lines.push(`❌ *${match.team_home} vs ${match.team_away}* — contest creation failed: ${contestData?.error ?? "unknown"}`);
      continue;
    }

    await saveState(match.id, {
      group_id: msg.groupId,
      contest_id: contest.id,
      invite_code: contest.invite_code ?? null,
      team_home: match.team_home,
      team_away: match.team_away,
      scheduled_at: match.scheduled_at,
      announced_at: new Date().toISOString(),
    });

    lines.push(await buildMatchAnnouncement(match, contest));
    created++;
  }

  if (!lines.length) return "Nothing to create.";

  // If multiple matches, join with separator
  return lines.join("\n\n─────────────────\n\n");
}

async function handleSyncSchedule(msg: BotMessage): Promise<string> {
  void msg;

  const res = await botFetch("/sync-schedule", { method: "POST" });
  if (res?.error) return `Schedule sync failed: ${res.error}`;
  if (!res?.ok) return "Schedule sync returned unexpected response.";

  const { matchesSynced, totalFound, matches } = res as any;

  if (matchesSynced === 0) return `Schedule synced — no new IPL matches found yet. (${totalFound} total in API)`;

  let msg2 = `📅 *Schedule synced!* ${matchesSynced} matches updated.\n\n`;
  for (const m of (matches as any[]).slice(0, 5)) {
    const kickoff = formatIST(m.scheduled_at);
    msg2 += `• *${m.team_home} vs ${m.team_away}* — ${kickoff} [${m.status.toUpperCase()}]\n`;
  }
  if (matchesSynced > 5) msg2 += `...and ${matchesSynced - 5} more.\n`;
  msg2 += `\nUse *!fantasy announce* to create group contests.`;
  return msg2;
}

function buildHelp(): string {
  return (
    `🏏 *Fantasy Cricket Commands*\n\n` +
    `!fantasy join — Join group contest\n` +
    `!fantasy lb — Leaderboard (syncs live scores first)\n` +
    `!fantasy diff — Compare top 2 teams side-by-side\n` +
    `!fantasy diff Krish Madhan — Compare two specific teams\n` +
    `!fantasy stats — Top scorer points\n` +
    `!fantasy score <player> — Specific player stats\n` +
    `!fantasy xi — Playing XI (post-toss)\n\n` +
    `_Admin:_\n` +
    `!fantasy contest — Create contests for all open matches\n` +
    `!fantasy schedule — Sync match schedule from Cricbuzz\n` +
    `!fantasy announce — Force announcement for next match\n` +
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

    case "diff":
    case "compare":
    case "vs":
      return { response: await handleDiff(msg, rest) };

    case "xi":
    case "playing11":
    case "lineup":
      return { response: await handlePlayingXI(msg) };

    case "lock":
      return { response: await handleLock(msg) };

    case "live":
      return { response: await handleGoLive(msg) };

    case "contest":
    case "create":
      return { response: await handleContest(msg) };

    case "schedule":
    case "sync-schedule":
      return { response: await handleSyncSchedule(msg) };

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
