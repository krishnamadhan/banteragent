import cron from "node-cron";
import { sendMessage, sendMentionMessage, getLastGroupMessageTime, addRecentMessage } from "./listener.js";
import { generateContent, generateStructured, addBotMessageToHistory } from "./claude.js";
import { generateBirthdayWish, generateWordOfDay } from "./features/fun.js";
import { generateAwards, getMonthlyRecapStats } from "./features/analytics.js";
import { checkDueReminders } from "./features/reminders.js";
import { checkCricketUpdates } from "./features/cricket.js";
import { scheduledNewsDrop } from "./features/news.js";
import { handleGameCommand } from "./features/games.js";
import {
  dailyScheduleSync,
  dailyContestCreate,
  preMatchCheck,
  syncLiveScores,
  sendLiveUpdate,
} from "./features/fantasy.js";
import { supabase } from "./supabase.js";
import type { BotMessage } from "./types.js";

// IST is UTC+5:30 — node-cron runs in system timezone
// We use cron option timezone: "Asia/Kolkata"
const TZ = "Asia/Kolkata";

function getGroupId(): string {
  return process.env.BOT_GROUP_ID ?? "";
}

export function startScheduler() {
  const groupId = getGroupId();
  if (!groupId) {
    console.log("⚠️  BOT_GROUP_ID not set — scheduled messages disabled.");
    console.log("   Set it in .env after finding your group ID from startup logs.\n");
    return;
  }

  console.log("⏰ Scheduler started (IST timezone)\n");

  // Helper: fetch group settings toggle
  async function isEnabled(flag: string): Promise<boolean> {
    const { data } = await supabase
      .from("ba_group_settings")
      .select(flag)
      .eq("group_id", groupId)
      .maybeSingle();
    // If no row exists yet, default to enabled
    if (!data) return true;
    return (data as unknown as Record<string, unknown>)[flag] !== false;
  }

  // ===== BIRTHDAY WISHES — Daily 7:00 AM IST =====
  cron.schedule("0 7 * * *", async () => {
    const { getAllProfiles } = await import("./features/profiles.js");
    const profiles = await getAllProfiles(groupId);

    // IST today as "Month Day" — match birthday storage format
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayMonth = istNow.getUTCMonth(); // 0-indexed for Date constructor
    const todayDay   = istNow.getUTCDate();
    const todayYear  = istNow.getUTCFullYear();

    const MONTH_NAMES = ["January","February","March","April","May","June",
      "July","August","September","October","November","December"];

    const wishedPhones: string[] = [];

    for (const p of profiles) {
      if (!p.birthday || p.member_phone.startsWith("unknown_")) continue;

      const parts = p.birthday.split(" "); // "July 15"
      if (parts.length !== 2) continue;

      const bMonth = MONTH_NAMES.indexOf(parts[0]!);
      const bDay   = parseInt(parts[1]!);
      if (bMonth === -1 || isNaN(bDay)) continue;
      if (bMonth !== todayMonth || bDay !== todayDay) continue;

      // Check if we already wished this year
      if (p.last_wished_at) {
        const wishedYear = new Date(p.last_wished_at).getFullYear();
        if (wishedYear >= todayYear) continue;
      }

      const wish = await generateBirthdayWish(p.nickname ?? p.member_name, p.zodiac_sign);
      if (!wish) continue;

      await sendMentionMessage(groupId, `🎂 *BIRTHDAY ALERT!*\n\n${wish}`, [p.member_phone]);
      wishedPhones.push(p.member_phone);
    }

    // Batch-update last_wished_at in one query (same value for all)
    if (wishedPhones.length > 0) {
      const { supabase: sb } = await import("./supabase.js");
      await sb.from("ba_member_profiles")
        .update({ last_wished_at: new Date().toISOString().split("T")[0] })
        .eq("group_id", groupId)
        .in("member_phone", wishedPhones);
    }
  }, { timezone: TZ });

  // ===== WORD OF THE DAY — Daily 9:00 AM IST =====
  cron.schedule("0 9 * * *", async () => {
    const word = await generateWordOfDay();
    if (word) {
      await sendMessage(groupId, word);
      addBotMessageToHistory(groupId, word);
      addRecentMessage(`[Bot]: ${word}`);
    }
  }, { timezone: TZ });

  // ===== MORNING ROAST — Daily 8:00 AM IST =====
  cron.schedule("0 8 * * *", async () => {
    if (!await isEnabled("morning_roast")) return;

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const today = days[new Date().getDay()];

    const msg = await generateContent(
      `It's ${today} morning. Write a funny Tanglish good morning message for a WhatsApp group. NOT the typical "Good Morning" uncle forward. Sarcastic about ${today}. Include one Tamil movie reference. End with a savage line about someone probably still sleeping. Max 5 lines.`
    );
    const morningMsg = `☀️ *MORNING ROAST*\n\n${msg}`;
    await sendMessage(groupId, morningMsg);
    addBotMessageToHistory(groupId, morningMsg);
    addRecentMessage(`[Bot]: ${morningMsg}`);
  }, { timezone: TZ });

  // ===== PERSONALIZED HOROSCOPE — Daily 7:30 AM IST =====
  cron.schedule("30 7 * * *", async () => {
    if (!await isEnabled("horoscope")) return;
    const { getAllProfiles } = await import("./features/profiles.js");
    const profiles = await getAllProfiles(groupId);
    const withZodiac = profiles.filter(
      (p) => p.zodiac_sign && !p.member_phone.startsWith("unknown_")
    );

    if (!withZodiac.length) {
      // Fallback: generic 12-sign horoscope
      const todayStr = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      const msg = await generateContent(
        `Today is ${todayStr}. Write TODAY's FAKE funny horoscope in Tanglish for all 12 zodiac signs (Mesham, Rishabam, Mithunam, Kadagam, Simmam, Kanni, Thulam, Viruchigam, Dhanusu, Makaram, Kumbam, Meenam). 2 lines per sign. Relatable to Tamil Nadu life. Include 3 Tamil movie references. Comedy horoscope, not real astrology. Start with "Today (${todayStr}):" on the first line.`
      );
      const horoscopeMsg = `🔮 *INDRU RAASI PALAN (Fake Edition)*\n\n${msg}`;
    await sendMessage(groupId, horoscopeMsg);
    addBotMessageToHistory(groupId, horoscopeMsg);
    addRecentMessage(`[Bot]: ${horoscopeMsg}`);
      return;
    }

    // Build a name→nickname map so we can resolve partner_name aliases
    const nameToDisplay = new Map<string, string>();
    const allProfiles = profiles.filter((p) => !p.member_phone.startsWith("unknown_"));
    for (const p of allProfiles) {
      const display = p.nickname ?? p.member_name;
      nameToDisplay.set(p.member_name.toLowerCase(), display);
      if (p.nickname) nameToDisplay.set(p.nickname.toLowerCase(), display);
    }

    const memberList = withZodiac
      .map((p) => {
        // Use nickname as primary display name so Claude uses it naturally
        const displayName = p.nickname ?? p.member_name;
        const parts = [`${displayName} (${p.zodiac_sign})`];
        if (p.occupation) parts.push(p.occupation);
        if (p.partner_name) {
          // Resolve partner name to their display name (handles nickname aliases like Thoonga=Madhan)
          const resolvedPartner = nameToDisplay.get(p.partner_name.toLowerCase()) ?? p.partner_name;
          parts.push(`married to ${resolvedPartner}`);
        }
        return parts.join(", ");
      })
      .join("\n");

    // Build a couples clarification so Claude never confuses nicknames with separate people
    const couplesInGroup = withZodiac
      .filter((p) => p.partner_name)
      .map((p) => {
        const me = p.nickname ?? p.member_name;
        const partner = nameToDisplay.get(p.partner_name!.toLowerCase()) ?? p.partner_name!;
        return `${me} ↔ ${partner}`;
      });
    const couplesNote = couplesInGroup.length
      ? `\nCOUPLES IN THIS GROUP (all partners are group members — DO NOT treat partner names as outside people):\n${[...new Set(couplesInGroup)].join(", ")}\n`
      : "";

    const todayStr = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const msg = await generateStructured(
      `Today is ${todayStr}. Write a FAKE funny personalized daily horoscope in Tanglish for these specific people:\n${memberList}\n${couplesNote}\nRules:\n- Start with "🗓️ ${todayStr}" on the first line\n- Use each person's display name (first entry before the sign) — that is how they are known in the group\n- 2-3 lines per person, roast-style prediction\n- Reference their job/partner if listed — e.g. "office la aaj boss-u unna paakamatten"\n- When roasting a couple, reference BOTH people by name — do not just say "your spouse"\n- End with one funny "Group Prediction" line\n- Comedy horoscope, NOT real astrology\n- NO disclaimers, no "Note:", pure Tanglish`
    );

    // Build mention-aware text: replace "Name" with "@phone" for WA mentions
    const phones = withZodiac.map((p) => p.member_phone);
    const personalizedHoro = `🔮 *INDRU RAASI PALAN (Personalized!)*\n\n${msg}`;
    await sendMentionMessage(groupId, personalizedHoro, phones);
    addBotMessageToHistory(groupId, personalizedHoro);
    addRecentMessage(`[Bot]: ${personalizedHoro}`);
  }, { timezone: TZ });

  // ===== THIS DAY IN TAMIL HISTORY — Daily 12:00 PM IST =====
  cron.schedule("0 12 * * *", async () => {
    const today = new Date();
    const dateStr = `${today.toLocaleString("en", { month: "long", timeZone: "Asia/Kolkata" })} ${today.getDate()}`;

    const msg = await generateContent(
      `Tell an interesting fact about what happened on ${dateStr} in Tamil Nadu or South Indian history. Could be a movie release, political event, sports achievement, cultural milestone, or famous person's birthday. Write in Tanglish. Give the fact + your funny commentary. Max 5 lines.`
    );
    const historyMsg = `📜 *THIS DAY IN TAMIL HISTORY*\n\n${msg}`;
    await sendMessage(groupId, historyMsg);
    addBotMessageToHistory(groupId, historyMsg);
    addRecentMessage(`[Bot]: ${historyMsg}`);
  }, { timezone: TZ });

  // ===== RANDOM MOVIE FACT — Daily 6:00 PM IST =====
  cron.schedule("0 18 * * *", async () => {
    const msg = await generateContent(
      `Share ONE interesting Tamil movie trivia or behind-the-scenes fact. Could be about casting, box office records, deleted scenes, dialogues that were improvised, or funny shooting incidents. Write in Tanglish. Be entertaining. Max 5 lines.`
    );
    const movieMsg = `🎬 *RANDOM MOVIE FACT*\n\n${msg}`;
    await sendMessage(groupId, movieMsg);
    addBotMessageToHistory(groupId, movieMsg);
    addRecentMessage(`[Bot]: ${movieMsg}`);
  }, { timezone: TZ });

  // ===== WEEKEND PLANS PROMPT — Friday 6:00 PM IST =====
  cron.schedule("0 18 * * 5", async () => {
    const msg = await generateContent(
      `It's Friday evening! Ask the group about their weekend plans in Tanglish. Be funny, suggest some ridiculous activities, and try to start a fun debate about something (like best weekend biryani spot, beach vs mall, sleeping vs going out). Max 5 lines. Make it engaging so people respond.`
    );
    const weekendMsg = `🎉 *WEEKEND VANDAACHU*\n\n${msg}`;
    await sendMessage(groupId, weekendMsg);
    addBotMessageToHistory(groupId, weekendMsg);
    addRecentMessage(`[Bot]: ${weekendMsg}`);
  }, { timezone: TZ });

  // ===== DAILY FINANCE UPDATE — 9:30 AM IST =====
  cron.schedule("30 9 * * *", async () => {
    const { sendFinanceUpdate } = await import("./features/finance.js");
    const msg = await sendFinanceUpdate();
    if (msg) {
      await sendMessage(groupId, msg);
      addBotMessageToHistory(groupId, msg);
      addRecentMessage(`[Bot]: ${msg}`);
    }
  }, { timezone: TZ });

  // ===== DAILY NEWS DROP — 10:30 AM IST (mix: cricket + movies + india) =====
  cron.schedule("30 10 * * *", async () => {
    if (!await isEnabled("news_drops")) return;
    const news = await scheduledNewsDrop(groupId, "mix");
    await sendMessage(groupId, news);
    addBotMessageToHistory(groupId, news);
    addRecentMessage(`[Bot]: ${news}`);
  }, { timezone: TZ });

  // ===== EVENING SPORTS UPDATE — 9:30 PM IST (IPL season: catches post-match scores) =====
  cron.schedule("30 21 * * *", async () => {
    if (!await isEnabled("news_drops")) return;
    const news = await scheduledNewsDrop(groupId, "ipl");
    await sendMessage(groupId, news);
    addBotMessageToHistory(groupId, news);
    addRecentMessage(`[Bot]: ${news}`);
  }, { timezone: TZ });

  // ===== WEEKLY AWARDS — Sunday 8:00 PM IST =====
  cron.schedule("0 20 * * 0", async () => {
    if (!await isEnabled("weekly_awards")) return;
    const awards = await generateAwards(groupId);
    await sendMessage(groupId, `🏆 *WEEKLY AWARDS CEREMONY*\n🎤 Host: TanglishBot\n\n${awards}`);
  }, { timezone: TZ });

  // ===== CHECK REMINDERS — Every minute =====
  cron.schedule("* * * * *", async () => {
    const notifications = await checkDueReminders();
    for (const notif of notifications) {
      await sendMessage(
        notif.isGroup ? groupId : notif.phone,
        notif.message
      );
    }
  }, { timezone: TZ });

  // ===== CRICKET ALERTS — Every 5 minutes =====
  cron.schedule("*/5 * * * *", async () => {
    const updates = await checkCricketUpdates(groupId);
    for (const update of updates) {
      await sendMessage(groupId, update.message);
    }
  }, { timezone: TZ });

  // ===== MONTHLY GROUP RECAP — 1st of month, 10:00 AM IST =====
  cron.schedule("0 10 1 * *", async () => {
    const now = new Date();
    // Use previous month's name (recap runs on 1st, we're recapping the month that just ended)
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = prevMonth.toLocaleString("en", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
    const stats = await getMonthlyRecapStats(groupId).catch(() => null);
    const statsBlock = stats
      ? `Real stats from the group in ${month}:
- Top chatter: ${stats.topChatter} (${stats.topCount} messages)
- Most used emoji: ${stats.topEmoji}
- Most active day: ${stats.mostActiveDay}
- Top quiz/game scorer: ${stats.topScorer} (${stats.topScore} pts)

Use these REAL stats as the foundation. Add Vijay TV award ceremony comedy on top in Tanglish — but don't invent numbers you don't have. Max 12 lines.`
      : `Write a funny Tamil WhatsApp group monthly recap for ${month}. Style it like a Vijay TV award ceremony in Tanglish. Max 12 lines.`;
    const msg = await generateContent(statsBlock);
    await sendMessage(groupId, `📅 *${month.toUpperCase()} RECAP*\n\n${msg}`);
  }, { timezone: TZ });

  // ===== AUTO-GAME DROP — Every 30 minutes, only 9AM–10PM IST =====
  let autoGameDropCount = 0;
  let autoGameDropDate = "";

  cron.schedule("*/30 * * * *", async () => {
    const istHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
    if (istHour < 9 || istHour >= 22) return;

    const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0]!;
    if (today !== autoGameDropDate) {
      autoGameDropCount = 0;
      autoGameDropDate = today;
    }
    if (autoGameDropCount >= 2) return;

    const lastMsg = getLastGroupMessageTime();
    if (lastMsg === 0) return; // no messages recorded yet
    if (Date.now() - lastMsg < 2 * 60 * 60 * 1000) return; // not quiet enough

    const { data: settings } = await supabase
      .from("ba_group_settings")
      .select("auto_game_drop, muted")
      .eq("group_id", groupId)
      .maybeSingle();
    if (settings?.muted) return; // don't drop games when bot is muted
    if (settings && settings.auto_game_drop === false) return;

    const games = ["quiz", "trivia", "wyr"] as const;
    const game = games[Math.floor(Math.random() * games.length)]!;

    const fakeMsg: BotMessage = {
      from: "bot",
      senderName: "Bot",
      text: `!${game}`,
      groupId,
      messageId: `auto-${Date.now()}`,
      isGroup: true,
      timestamp: Math.floor(Date.now() / 1000),
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
    console.log(`🎮 Auto-game drop #${autoGameDropCount}: ${game}`);
  }, { timezone: TZ });

  // ===== WEEKLY GAME SCORE RESET — Monday 12:00 AM IST =====
  cron.schedule("0 0 * * 1", async () => {
    // Calculate last week's start (Monday 7 days ago)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const prevWeekStart = new Date(Date.now() + istOffset - 7 * 24 * 60 * 60 * 1000);
    const prevWeekKey = prevWeekStart.toISOString().split("T")[0]!.slice(0, 10);
    // Align to Monday
    const dayOfWeek = prevWeekStart.getUTCDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayDate = new Date(prevWeekStart);
    mondayDate.setUTCDate(prevWeekStart.getUTCDate() - daysFromMonday);
    const weekKey = mondayDate.toISOString().split("T")[0]!;

    // Fetch last week's scores
    const { data } = await supabase
      .from("ba_game_scores")
      .select("player_name, points")
      .eq("group_id", groupId)
      .eq("week_start", weekKey)
      .order("points", { ascending: false });

    if (data?.length) {
      const totals = new Map<string, number>();
      for (const row of data) {
        totals.set(row.player_name, (totals.get(row.player_name) ?? 0) + row.points);
      }
      const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      const medals = ["🥇", "🥈", "🥉"];
      let board = `🏁 *LAST WEEK FINAL SCORES*\n\n`;
      sorted.forEach(([name, pts], i) => {
        const medal = medals[i] ?? `${i + 1}.`;
        board += `${medal} ${name} — ${pts} pts\n`;
      });
      const winner = sorted[0]?.[0] ?? "yaarumey";
      board += `\nCongrats ${winner}! 🎉 New week starts now — !quiz pannu!`;
      await sendMessage(groupId, board);
    }

    // Prune old weekly records (keep only last 4 weeks to avoid unlimited growth)
    const cutoff = new Date(Date.now() + istOffset - 28 * 24 * 60 * 60 * 1000);
    const cutoffKey = cutoff.toISOString().split("T")[0]!;
    await supabase
      .from("ba_game_scores")
      .delete()
      .eq("group_id", groupId)
      .lt("week_start", cutoffKey);
  }, { timezone: TZ });

  // ─── IPL FANTASY PIPELINE ────────────────────────────────────────────────

  // 10:00 AM — Sync schedule from Cricbuzz + post today's matches
  cron.schedule("0 10 * * *", async () => {
    if (!process.env.FANTASY_BOT_SECRET) return;
    try {
      const msg = await dailyScheduleSync(groupId);
      if (msg) {
        await sendMessage(groupId, msg);
        addBotMessageToHistory(groupId, msg);
        addRecentMessage(`[Bot]: ${msg}`);
        console.log("🏏 Fantasy schedule posted");
      }
    } catch (e) { console.error("Fantasy schedule sync error:", e); }
  }, { timezone: TZ });

  // 11:00 AM — Create contests for today's matches + post announcements
  cron.schedule("0 11 * * *", async () => {
    if (!process.env.FANTASY_BOT_SECRET) return;
    try {
      const msg = await dailyContestCreate(groupId);
      if (msg) {
        await sendMessage(groupId, msg);
        addBotMessageToHistory(groupId, msg);
        addRecentMessage(`[Bot]: ${msg}`);
        console.log("🏏 Fantasy contests created");
      }
    } catch (e) { console.error("Fantasy contest create error:", e); }
  }, { timezone: TZ });

  // 3:10 PM — Pre-match check for 3:30 PM slot (toss sync + poll every 15 min)
  cron.schedule("10 15 * * *", async () => {
    if (!process.env.FANTASY_BOT_SECRET) return;
    try {
      const msg = await preMatchCheck(groupId, 15, 30, sendMessage);
      if (msg) {
        await sendMessage(groupId, msg);
        addBotMessageToHistory(groupId, msg);
        addRecentMessage(`[Bot]: ${msg}`);
        console.log("🏏 Fantasy pre-match (3:30 PM slot) triggered");
      }
    } catch (e) { console.error("Fantasy pre-match (3:30 PM) error:", e); }
  }, { timezone: TZ });

  // 7:10 PM — Pre-match check for 7:30 PM slot (toss sync + poll every 15 min)
  cron.schedule("10 19 * * *", async () => {
    if (!process.env.FANTASY_BOT_SECRET) return;
    try {
      const msg = await preMatchCheck(groupId, 19, 30, sendMessage);
      if (msg) {
        await sendMessage(groupId, msg);
        addBotMessageToHistory(groupId, msg);
        addRecentMessage(`[Bot]: ${msg}`);
        console.log("🏏 Fantasy pre-match (7:30 PM slot) triggered");
      }
    } catch (e) { console.error("Fantasy pre-match (7:30 PM) error:", e); }
  }, { timezone: TZ });

  // Every 5 min — Sync live scores silently (no WhatsApp message)
  cron.schedule("*/5 * * * *", async () => {
    if (!process.env.FANTASY_BOT_SECRET) return;
    try {
      await syncLiveScores(groupId);
    } catch (e) { console.error("Fantasy score sync error:", e); }
  }, { timezone: TZ });

  // Every hour at :30 — Post leaderboard update during live match
  cron.schedule("30 * * * *", async () => {
    if (!process.env.FANTASY_BOT_SECRET) return;
    try {
      const msg = await sendLiveUpdate(groupId);
      if (msg) {
        await sendMessage(groupId, msg);
        addBotMessageToHistory(groupId, msg);
        addRecentMessage(`[Bot]: ${msg}`);
        console.log("🏏 Fantasy hourly leaderboard sent");
      }
    } catch (e) { console.error("Fantasy leaderboard error:", e); }
  }, { timezone: TZ });
}
