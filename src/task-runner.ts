/**
 * task-runner.ts
 *
 * All scheduled task implementations live here.
 * pi-scheduler calls /run-task → internal-server → runTask(name).
 * Each task is an independent async function; failures are isolated.
 */

import { sendMessage, sendMentionMessage, getLastGroupMessageTime, addRecentMessage } from "./listener.js";
import { generateContent, addBotMessageToHistory } from "./claude.js";
import { monTaskStart, monTaskEnd, monMsgSent, monError, recordBotMsgTime } from "./monitor.js";
import { generateBirthdayWish, generateWordOfDay } from "./features/fun.js";
import { generateAwards, getMonthlyRecapStats } from "./features/analytics.js";
import { checkDueReminders } from "./features/reminders.js";
import { checkCricketUpdates } from "./features/cricket.js";
import { scheduledNewsDrop } from "./features/news.js";
import { handleGameCommand } from "./features/games.js";
import {
  dailyScheduleSync,
  dailyContestCreate,
  morningWinnerAnnouncement,
  preMatchCheck,
  syncLiveScores,
  sendLiveUpdate,
  enforceDeadlines,
} from "./features/fantasy.js";
import { supabase } from "./supabase.js";
import type { BotMessage } from "./types.js";

// ── Auto-game-drop state (persistent across cron ticks within same process) ──
let autoGameDropCount = 0;
let autoGameDropDate  = "";

// ─── Helper: check a feature toggle from DB ──────────────────────────────────

async function isEnabled(flag: string, groupId: string): Promise<boolean> {
  const { data } = await supabase
    .from("ba_group_settings")
    .select(flag)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!data) return true; // default on if no row yet
  return (data as unknown as Record<string, unknown>)[flag] !== false;
}

// ─── Task implementations ─────────────────────────────────────────────────────

async function taskBirthdayCheck(groupId: string) {
  const { getAllProfiles } = await import("./features/profiles.js");
  const profiles = await getAllProfiles(groupId);

  const istNow   = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayMonth = istNow.getUTCMonth();
  const todayDay   = istNow.getUTCDate();
  const todayYear  = istNow.getUTCFullYear();
  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];

  const wishedPhones: string[] = [];

  for (const p of profiles) {
    if (!p.birthday || p.member_phone.startsWith("unknown_")) continue;
    const parts = p.birthday.split(" ");
    if (parts.length !== 2) continue;
    const bMonth = MONTHS.indexOf(parts[0]!);
    const bDay   = parseInt(parts[1]!);
    if (bMonth === -1 || isNaN(bDay)) continue;
    if (bMonth !== todayMonth || bDay !== todayDay) continue;
    if (p.last_wished_at && new Date(p.last_wished_at).getFullYear() >= todayYear) continue;

    const wish = await generateBirthdayWish(p.nickname ?? p.member_name, p.zodiac_sign);
    if (!wish) continue;
    await sendMentionMessage(groupId, `🎂 *BIRTHDAY ALERT!*\n\n${wish}`, [p.member_phone]);
    wishedPhones.push(p.member_phone);
  }

  if (wishedPhones.length) {
    await supabase.from("ba_member_profiles")
      .update({ last_wished_at: new Date().toISOString().split("T")[0] })
      .eq("group_id", groupId)
      .in("member_phone", wishedPhones);
  }
}

async function taskWordOfDay(groupId: string) {
  const word = await generateWordOfDay();
  if (word) {
    await sendMessage(groupId, word);
    addBotMessageToHistory(groupId, word);
    addRecentMessage(`[Bot]: ${word}`);
  }
}

async function taskMorningRoast(groupId: string) {
  if (!await isEnabled("morning_roast", groupId)) return;

  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const today = days[new Date().getDay()];

  const msg = await generateContent(
    `It's ${today} morning. Write a funny Tanglish good morning message for a WhatsApp group. NOT the typical "Good Morning" uncle forward. Sarcastic about ${today}. Include one Tamil movie reference. End with a savage line about someone probably still sleeping. Max 5 lines.`
  );
  const out = `☀️ *MORNING ROAST*\n\n${msg}`;
  await sendMessage(groupId, out);
  addBotMessageToHistory(groupId, out);
  addRecentMessage(`[Bot]: ${out}`);
}

async function taskHistory(groupId: string) {
  const today   = new Date();
  const dateStr = `${today.toLocaleString("en", { month: "long", timeZone: "Asia/Kolkata" })} ${today.getDate()}`;
  const msg     = await generateContent(
    `Tell an interesting fact about what happened on ${dateStr} in Tamil Nadu or South Indian history. Could be a movie release, political event, sports achievement, cultural milestone, or famous person's birthday. Write in Tanglish. Give the fact + your funny commentary. Max 5 lines.`
  );
  const out = `📜 *THIS DAY IN TAMIL HISTORY*\n\n${msg}`;
  await sendMessage(groupId, out);
  addBotMessageToHistory(groupId, out);
  addRecentMessage(`[Bot]: ${out}`);
}

async function taskMovieFact(groupId: string) {
  const msg = await generateContent(
    `Share ONE interesting Tamil movie trivia or behind-the-scenes fact. Could be about casting, box office records, deleted scenes, dialogues that were improvised, or funny shooting incidents. Write in Tanglish. Max 5 lines.`
  );
  const out = `🎬 *RANDOM MOVIE FACT*\n\n${msg}`;
  await sendMessage(groupId, out);
  addBotMessageToHistory(groupId, out);
  addRecentMessage(`[Bot]: ${out}`);
}

async function taskWeekendPrompt(groupId: string) {
  const msg = await generateContent(
    `It's Friday evening! Ask the group about their weekend plans in Tanglish. Be funny, suggest some ridiculous activities, and try to start a fun debate. Max 5 lines. Make it engaging.`
  );
  const out = `🎉 *WEEKEND VANDAACHU*\n\n${msg}`;
  await sendMessage(groupId, out);
  addBotMessageToHistory(groupId, out);
  addRecentMessage(`[Bot]: ${out}`);
}

async function taskFinanceUpdate(groupId: string) {
  const { sendFinanceUpdate } = await import("./features/finance.js");
  const msg = await sendFinanceUpdate();
  if (msg) {
    await sendMessage(groupId, msg);
    addBotMessageToHistory(groupId, msg);
    addRecentMessage(`[Bot]: ${msg}`);
  }
}

async function taskNewsMorning(groupId: string) {
  if (!await isEnabled("news_drops", groupId)) return;
  const news = await scheduledNewsDrop(groupId, "mix");
  await sendMessage(groupId, news);
  addBotMessageToHistory(groupId, news);
  addRecentMessage(`[Bot]: ${news}`);
}

async function taskWeeklyAwards(groupId: string) {
  if (!await isEnabled("weekly_awards", groupId)) return;
  const awards = await generateAwards(groupId);
  await sendMessage(groupId, `🏆 *WEEKLY AWARDS CEREMONY*\n🎤 Host: TanglishBot\n\n${awards}`);
}

async function taskRemindersCheck(groupId: string) {
  const notifications = await checkDueReminders();
  for (const n of notifications) {
    await sendMessage(n.isGroup ? groupId : n.phone, n.message);
  }
}

async function taskCricketAlerts(groupId: string) {
  const updates = await checkCricketUpdates(groupId);
  for (const u of updates) {
    await sendMessage(groupId, u.message);
  }
}

async function taskMonthlyRecap(groupId: string) {
  const now       = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month     = prevMonth.toLocaleString("en", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const stats     = await getMonthlyRecapStats(groupId).catch(() => null);

  const prompt = stats
    ? `Real stats for ${month}:
- Top chatter: ${stats.topChatter} (${stats.topCount} messages)
- Most used emoji: ${stats.topEmoji}
- Most active day: ${stats.mostActiveDay}
- Top game scorer: ${stats.topScorer} (${stats.topScore} pts)
Use these REAL stats. Add Vijay TV award ceremony comedy in Tanglish. Max 12 lines.`
    : `Write a funny Tamil WhatsApp group monthly recap for ${month}. Vijay TV award ceremony style in Tanglish. Max 12 lines.`;

  const msg = await generateContent(prompt);
  await sendMessage(groupId, `📅 *${month.toUpperCase()} RECAP*\n\n${msg}`);
}

async function taskAutoGameDrop(groupId: string) {
  const istHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
  if (istHour < 9 || istHour >= 22) return;

  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0]!;
  if (today !== autoGameDropDate) {
    autoGameDropCount = 0;
    autoGameDropDate  = today;
  }
  if (autoGameDropCount >= 2) return;

  const lastMsg = getLastGroupMessageTime();
  if (lastMsg === 0) return;
  if (Date.now() - lastMsg < 2 * 60 * 60 * 1000) return;

  const { data: settings } = await supabase
    .from("ba_group_settings")
    .select("auto_game_drop, muted")
    .eq("group_id", groupId)
    .maybeSingle();
  if (settings?.muted) return;
  if (settings && settings.auto_game_drop === false) return;

  const games = ["quiz", "trivia", "wyr"] as const;
  const game  = games[Math.floor(Math.random() * games.length)]!;

  const fakeMsg: BotMessage = {
    from: "bot", senderName: "Bot", text: `!${game}`,
    groupId, messageId: `auto-${Date.now()}`,
    isGroup: true, timestamp: Math.floor(Date.now() / 1000),
  };
  const { response } = await handleGameCommand(game, "", fakeMsg);

  const intros = [
    "2 hours-aa yaarum pesala! Group dead-aa? Game time da:",
    "Ayyo silence! Oru game start pannalam:",
    "Group la kazhuthai maari quiet — let's play:",
  ];
  const intro = intros[Math.floor(Math.random() * intros.length)]!;
  await sendMessage(groupId, `🎮 ${intro}\n\n${response}`);
  autoGameDropCount++;
}

async function taskWeeklyScoreReset(groupId: string) {
  const istOffset   = 5.5 * 60 * 60 * 1000;
  const prevWeekStart = new Date(Date.now() + istOffset - 7 * 24 * 60 * 60 * 1000);
  const dow         = prevWeekStart.getUTCDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const mondayDate  = new Date(prevWeekStart);
  mondayDate.setUTCDate(prevWeekStart.getUTCDate() - daysFromMon);
  const weekKey     = mondayDate.toISOString().split("T")[0]!;

  const { data } = await supabase
    .from("ba_game_scores")
    .select("player_name, points")
    .eq("group_id", groupId)
    .eq("week_start", weekKey)
    .order("points", { ascending: false });

  if (data?.length) {
    const totals = new Map<string, number>();
    for (const row of data) totals.set(row.player_name, (totals.get(row.player_name) ?? 0) + row.points);
    const sorted  = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const medals  = ["🥇","🥈","🥉"];
    let board = `🏁 *LAST WEEK FINAL SCORES*\n\n`;
    sorted.forEach(([name, pts], i) => { board += `${medals[i] ?? `${i+1}.`} ${name} — ${pts} pts\n`; });
    const winner = sorted[0]?.[0] ?? "yaarumey";
    board += `\nCongrats ${winner}! 🎉 New week starts now — !quiz pannu!`;
    await sendMessage(groupId, board);
  }

  // Prune old records older than 4 weeks
  const cutoff    = new Date(Date.now() + istOffset - 28 * 24 * 60 * 60 * 1000);
  const cutoffKey = cutoff.toISOString().split("T")[0]!;
  await supabase.from("ba_game_scores").delete().eq("group_id", groupId).lt("week_start", cutoffKey);
}

// ─── Fantasy pipeline ─────────────────────────────────────────────────────────

async function taskFantasyMorningWinners(groupId: string) {
  if (!process.env.FANTASY_BOT_SECRET) return;
  const msg = await morningWinnerAnnouncement(groupId);
  if (msg) { await sendMessage(groupId, msg); addBotMessageToHistory(groupId, msg); }
}

async function taskFantasyScheduleSync(groupId: string) {
  if (!process.env.FANTASY_BOT_SECRET) return;
  const msg = await dailyScheduleSync(groupId);
  if (msg) { await sendMessage(groupId, msg); addBotMessageToHistory(groupId, msg); }
}

async function taskFantasyContestCreate(groupId: string) {
  if (!process.env.FANTASY_BOT_SECRET) return;
  const msg = await dailyContestCreate(groupId);
  if (msg) { await sendMessage(groupId, msg); addBotMessageToHistory(groupId, msg); }
}

async function taskFantasyPrematch1530(groupId: string) {
  if (!process.env.FANTASY_BOT_SECRET) return;
  const msg = await preMatchCheck(groupId, 15, 30, sendMessage);
  if (msg) { await sendMessage(groupId, msg); addBotMessageToHistory(groupId, msg); }
}

async function taskFantasyPrematch1930(groupId: string) {
  if (!process.env.FANTASY_BOT_SECRET) return;
  const msg = await preMatchCheck(groupId, 19, 30, sendMessage);
  if (msg) { await sendMessage(groupId, msg); addBotMessageToHistory(groupId, msg); }
}

async function taskFantasySyncLive(groupId: string) {
  if (!process.env.FANTASY_BOT_SECRET) return;
  const msg = await syncLiveScores(groupId);
  if (msg) {
    await sendMessage(groupId, msg);
    addBotMessageToHistory(groupId, msg);
  }
}

async function taskFantasyLeaderboard(groupId: string) {
  if (!process.env.FANTASY_BOT_SECRET) return;
  const msg = await sendLiveUpdate(groupId);
  if (msg) { await sendMessage(groupId, msg); addBotMessageToHistory(groupId, msg); }
}

async function taskFantasyEnforceDeadlines(_groupId: string) {
  await enforceDeadlines();
}

async function taskPiHealthReport(groupId: string) {
  const adminNum = process.env.PI_ADMIN_NUMBER ?? process.env.BOT_OWNER_PHONE;
  if (!adminNum) return;

  const fsMod   = await import("fs");
  const pathMod = await import("path");
  const statusFile = pathMod.join(process.env.HOME ?? "/home/pi", "pi-monitor/status.json");
  if (!fsMod.existsSync(statusFile)) return;

  const age = Date.now() - fsMod.statSync(statusFile).mtimeMs;
  if (age > 10 * 60 * 1000) return; // stale

  const s     = JSON.parse(fsMod.readFileSync(statusFile, "utf8"));
  const d     = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  const pm2   = (s.pm2 ?? {}) as Record<string, any>;
  const ba    = pm2["banteragent"] ?? {};
  const tempOk = s.cpu_temp === null || s.cpu_temp < 65;
  const allGood = tempOk && s.ram_percent < 80 && s.disk_percent < 80 && s.internet_ok && ba.status === "online";

  const lines = [
    `*Daily Pi Report — ${d}*`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `Temp:    ${s.cpu_temp ?? "N/A"}°C ${tempOk ? "✅" : "⚠️"}`,
    `RAM:     ${s.ram_percent}% ${s.ram_percent < 80 ? "✅" : "⚠️"}`,
    `Disk:    ${s.disk_percent}% ${s.disk_percent < 80 ? "✅" : "⚠️"}`,
    `Battery: ${s.battery_level ?? "unknown"}`,
    `Net:     ${s.internet_ok ? "Online ✅" : "DOWN 🚨"}`,
    `Uptime:  ${Math.floor(s.uptime_secs / 86400)}d ${Math.floor((s.uptime_secs % 86400) / 3600)}h`,
    `Bot:     ${ba.status === "online" ? "Online ✅" : "DOWN 🚨"} (${ba.restarts ?? 0} restarts)`,
    "",
    allGood ? "All systems healthy 🟢" : "⚠️ Check metrics above",
  ];
  await sendMessage(adminNum, lines.join("\n"));
}

async function taskHoroscope(groupId: string) {
  if (!await isEnabled("horoscope", groupId)) return;

  const { data: profiles } = await supabase
    .from("ba_member_profiles")
    .select("nickname, member_name, zodiac_sign")
    .eq("group_id", groupId)
    .not("zodiac_sign", "is", null);

  const known = (profiles ?? []).filter((p) => p.zodiac_sign);

  let prompt: string;
  if (known.length) {
    const list = known.map((p) => `${p.nickname ?? p.member_name}: ${p.zodiac_sign}`).join(", ");
    prompt = `Daily horoscope for a Tamil WhatsApp group. Members and their zodiac signs: ${list}.
Write each person's horoscope in 1 funny Tanglish line — be specific to their sign but make it hilarious and slightly sarcastic. Don't be generic. End with a group forecast line. Max 10 lines total.`;
  } else {
    prompt = `Write a funny daily horoscope for a Tamil WhatsApp friend group in Tanglish. Pick 3-4 random zodiac signs and write one sarcastic funny prediction each. End with "Ellaarukkum: unga fate already fixed, just enjoy pannunga 😂". Max 8 lines.`;
  }

  const msg = await generateContent(prompt);
  const out = `🔮 *DAILY HOROSCOPE*\n\n${msg}`;
  await sendMessage(groupId, out);
  addBotMessageToHistory(groupId, out);
  addRecentMessage(`[Bot]: ${out}`);
}

// ─── Central dispatcher ───────────────────────────────────────────────────────

const TASK_MAP: Record<string, (g: string) => Promise<void>> = {
  "horoscope":               taskHoroscope,
  "birthday-check":          taskBirthdayCheck,
  "word-of-day":             taskWordOfDay,
  "morning-roast":           taskMorningRoast,
  "history":                 taskHistory,
  "movie-fact":              taskMovieFact,
  "weekend-prompt":          taskWeekendPrompt,
  "finance-update":          taskFinanceUpdate,
  "news-morning":            taskNewsMorning,
  "weekly-awards":           taskWeeklyAwards,
  "reminders-check":         taskRemindersCheck,
  "cricket-alerts":          taskCricketAlerts,
  "monthly-recap":           taskMonthlyRecap,
  "auto-game-drop":          taskAutoGameDrop,
  "weekly-score-reset":      taskWeeklyScoreReset,
  "fantasy-morning-winners": taskFantasyMorningWinners,
  "fantasy-schedule-sync":   taskFantasyScheduleSync,
  "fantasy-contest-create":  taskFantasyContestCreate,
  "fantasy-prematch-1530":   taskFantasyPrematch1530,
  "fantasy-prematch-1930":   taskFantasyPrematch1930,
  "fantasy-sync-live":       taskFantasySyncLive,
  "fantasy-leaderboard":     taskFantasyLeaderboard,
  "fantasy-enforce-deadlines": taskFantasyEnforceDeadlines,
  "pi-health-report":        taskPiHealthReport,
};

// Tracks whether sendMessage was called during the current task
let _taskSentMsg = false;

// Wrap sendMessage so monitor can detect if a task produced output
const _origSendMessage = sendMessage;
const _instrumentedSend = async (to: string, msg: string) => {
  _taskSentMsg = true;
  recordBotMsgTime();
  monMsgSent({ task: _currentTaskName, preview: msg.slice(0, 80), chars: msg.length });
  return _origSendMessage(to, msg);
};
// Patch at module level so all task functions use the instrumented version
// (tasks import sendMessage from listener directly — we shadow it via re-export trick)
// Instead, we detect via the monMsgSent calls in individual task wrappers above.
// The flag _taskSentMsg is reset per runTask call.

let _currentTaskName = "";

// Once-per-day tasks: skip if already ran today (guards against pi-scheduler restart dupes)
const ONCE_DAILY_TASKS = new Set([
  "morning-roast", "horoscope", "word-of-day", "history", "movie-fact",
  "finance-update", "news-morning", "birthday-check",
  "fantasy-morning-winners", "fantasy-schedule-sync", "fantasy-contest-create",
  "weekend-prompt", "monthly-recap", "pi-health-report",
]);
const _taskRanOnDate = new Map<string, string>(); // "taskName:groupId" → IST date

function istDateStr(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function runTask(name: string, groupId: string): Promise<{ ok: boolean; error?: string }> {
  const fn = TASK_MAP[name];
  if (!fn) return { ok: false, error: `Unknown task: ${name}` };

  if (ONCE_DAILY_TASKS.has(name)) {
    const key  = `${name}:${groupId}`;
    const today = istDateStr();
    if (_taskRanOnDate.get(key) === today) {
      console.log(`[task-runner] ${name} already ran today — skipping dupe`);
      return { ok: true };
    }
    _taskRanOnDate.set(key, today);
  }

  _taskSentMsg = false;
  _currentTaskName = name;
  monTaskStart(name);

  try {
    await fn(groupId);
    monTaskEnd(name, { ok: true, sent: _taskSentMsg });
    return { ok: true };
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    console.error(`[task-runner] ${name} failed:`, errMsg);
    monTaskEnd(name, { ok: false, sent: _taskSentMsg, error: errMsg });
    monError(name, e);
    return { ok: false, error: errMsg };
  } finally {
    _currentTaskName = "";
  }
}

export const TASK_NAMES = Object.keys(TASK_MAP);
