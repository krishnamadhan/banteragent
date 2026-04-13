import type { BotMessage } from "../types.js";
import { generateContent, generateStructured } from "../claude.js";
import { supabase } from "../supabase.js";

// ===== Track every message =====
export async function trackMessage(msg: BotMessage): Promise<void> {
  const wordCount = msg.text.split(/\s+/).length;
  const hasEmoji = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/u.test(msg.text);

  const { error } = await supabase.from("ba_message_stats").insert({
    group_id: msg.groupId,
    sender_phone: msg.from,
    sender_name: msg.senderName,
    message_text: msg.text.slice(0, 500),
    word_count: wordCount,
    has_emoji: hasEmoji,
  });
  if (error) console.error("[analytics] trackMessage failed:", error.message);

  // Update the member's name in ba_group_members when we see them chat
  // (group sync only gets phone number; this fills in the real display name)
  void supabase.from("ba_group_members").upsert({
    group_id: msg.groupId,
    member_phone: msg.from,
    member_name: msg.senderName,
    last_seen: new Date().toISOString(),
  }, { onConflict: "group_id,member_phone" });
}

// ===== Group Stats =====
async function getStats(msg: BotMessage): Promise<string> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Total messages this week
  const { count: totalMessages } = await supabase
    .from("ba_message_stats")
    .select("*", { count: "exact", head: true })
    .eq("group_id", msg.groupId)
    .gte("created_at", weekAgo);

  // Messages per person this week — keyed by phone to avoid name-change duplicates
  const { data: perPerson } = await supabase
    .from("ba_message_stats")
    .select("sender_phone, sender_name")
    .eq("group_id", msg.groupId)
    .gte("created_at", weekAgo);

  const counts = new Map<string, number>();       // phone → count
  const phoneToName = new Map<string, string>();  // phone → latest name seen
  for (const row of perPerson ?? []) {
    counts.set(row.sender_phone, (counts.get(row.sender_phone) ?? 0) + 1);
    phoneToName.set(row.sender_phone, row.sender_name); // last name wins
  }

  // Emoji usage this week
  const { count: emojiCount } = await supabase
    .from("ba_message_stats")
    .select("*", { count: "exact", head: true })
    .eq("group_id", msg.groupId)
    .eq("has_emoji", true)
    .gte("created_at", weekAgo);

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const topEntry = sorted[0];
  const topChatterName = topEntry ? (phoneToName.get(topEntry[0]) ?? topEntry[0]) : null;

  let stats = `📊 *GROUP STATS (This Week)*\n\n`;
  stats += `📨 Total messages: ${totalMessages ?? 0}\n`;
  stats += `😀 Messages with emoji: ${emojiCount ?? 0}\n`;
  stats += `👑 Most active: ${topChatterName ? `${topChatterName} (${topEntry![1]} msgs)` : "Nobody 😅"}\n`;
  stats += `👥 Active members: ${counts.size}\n\n`;

  if (sorted.length > 0) {
    stats += `*Message Count:*\n`;
    sorted.forEach(([phone, count]) => {
      const name = phoneToName.get(phone) ?? phone;
      const bar = "█".repeat(Math.min(Math.round((count / (totalMessages ?? 1)) * 20), 20));
      stats += `${name}: ${bar} ${count}\n`;
    });
  }

  return stats;
}

// ===== Top Active Members =====
async function getTopMembers(msg: BotMessage): Promise<string> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("ba_message_stats")
    .select("sender_phone, sender_name, word_count")
    .eq("group_id", msg.groupId)
    .gte("created_at", weekAgo);

  if (!data?.length) return "This week yaarum pesala machaan. Dead group-aa? 💀";

  // Key by phone to prevent same person with different display names being split
  const stats = new Map<string, { msgs: number; words: number; name: string }>();
  for (const row of data) {
    const existing = stats.get(row.sender_phone) ?? { msgs: 0, words: 0, name: row.sender_name };
    existing.msgs += 1;
    existing.words += row.word_count ?? 0;
    existing.name = row.sender_name; // keep latest name
    stats.set(row.sender_phone, existing);
  }

  const sorted = [...stats.values()].sort((a, b) => b.msgs - a.msgs);
  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

  let result = `👑 *TOP CHATTERS THIS WEEK*\n\n`;
  sorted.slice(0, 5).forEach((s, i) => {
    const avgWords = Math.round(s.words / s.msgs);
    result += `${medals[i] ?? "•"} ${s.name} — ${s.msgs} msgs (avg ${avgWords} words/msg)\n`;
  });

  return result;
}

// ===== Expose Lurkers =====
async function getLurkers(msg: BotMessage): Promise<string> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // All known group members (from sync)
  const { data: allMembers } = await supabase
    .from("ba_group_members")
    .select("member_name, member_phone")
    .eq("group_id", msg.groupId);

  // People who messaged this week
  const { data: weekData } = await supabase
    .from("ba_message_stats")
    .select("sender_phone")
    .eq("group_id", msg.groupId)
    .gte("created_at", weekAgo);

  const weekPhones = new Set((weekData ?? []).map((r) => r.sender_phone));

  // If no member sync data, fall back to month-based detection
  if (!allMembers?.length) {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: monthData } = await supabase
      .from("ba_message_stats")
      .select("sender_name, sender_phone")
      .eq("group_id", msg.groupId)
      .gte("created_at", monthAgo);

    const seen = new Map<string, string>();
    for (const r of monthData ?? []) seen.set(r.sender_phone, r.sender_name);
    const lurkers = [...seen.entries()].filter(([phone]) => !weekPhones.has(phone));

    if (!lurkers.length) return "Yaaru lurk pannalai — ellaarum active-aa irukaanga! Group alive 🔥";

    let result = `👀 *LURKER ALERT*\n\nIndha week silent-aa irukkaanga:\n\n`;
    lurkers.forEach(([, name]) => { result += `🤫 ${name}\n`; });
    result += `\nDei ${lurkers[0]![1]}, alive-aa? Oru "da" aachum type pannunga! 😤`;
    return result;
  }

  // Use actual member list — catches truly silent members (never messaged at all)
  const lurkers = allMembers.filter((m) => !weekPhones.has(m.member_phone));

  if (!lurkers.length) {
    return "Yaaru lurk pannalai — ellaarum active-aa irukaanga! Group alive 🔥";
  }

  // Get last-seen dates for context
  const { data: lastSeenData } = await supabase
    .from("ba_group_members")
    .select("member_phone, last_seen")
    .eq("group_id", msg.groupId)
    .in("member_phone", lurkers.map((l) => l.member_phone));

  const lastSeen = new Map((lastSeenData ?? []).map((r) => [r.member_phone, r.last_seen]));

  let result = `👀 *LURKER ALERT*\n\nIndha week silent-aa irukkaanga:\n\n`;
  lurkers.forEach((m) => {
    const seen = lastSeen.get(m.member_phone);
    const daysAgo = seen
      ? Math.floor((Date.now() - new Date(seen).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const tag = daysAgo === null ? "(never chatted)" : daysAgo === 0 ? "(seen today)" : `(last seen ${daysAgo}d ago)`;
    result += `🤫 ${m.member_name} ${tag}\n`;
  });
  result += `\nDei ${lurkers[0]!.member_name}, alive-aa? Oru "da" aachum type pannunga! 😤`;

  return result;
}

// ===== Auto Awards =====
export async function generateAwards(groupId: string): Promise<string> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("ba_message_stats")
    .select("sender_phone, sender_name, message_text, word_count, has_emoji, created_at")
    .eq("group_id", groupId)
    .gte("created_at", weekAgo);

  if (!data?.length) return "This week data illa machaan. Next week try pannunga.";

  // Key by phone to prevent name-change duplicates (same fix as getStats/getTopMembers)
  const memberStats = new Map<
    string,
    { name: string; msgs: number; words: number; emojis: number; lateNight: number; samples: string[] }
  >();

  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  for (const row of data) {
    const phone = row.sender_phone;
    const s = memberStats.get(phone) ?? {
      name: row.sender_name, msgs: 0, words: 0, emojis: 0, lateNight: 0, samples: [] as string[],
    };
    s.name = row.sender_name; // keep latest name
    s.msgs += 1;
    s.words += row.word_count ?? 0;
    if (row.has_emoji) s.emojis += 1;
    // Convert to IST hour to correctly identify late-night messages
    const istHour = new Date(new Date(row.created_at).getTime() + IST_OFFSET_MS).getUTCHours();
    if (istHour >= 0 && istHour < 5) s.lateNight += 1;
    if (s.samples.length < 3 && row.message_text) {
      s.samples.push(row.message_text.slice(0, 100));
    }
    memberStats.set(phone, s);
  }

  let summary = "Group members and their chat behavior this week:\n\n";
  for (const [, s] of memberStats) {
    summary += `${s.name}: ${s.msgs} messages, avg ${Math.round(s.words / s.msgs)} words/msg, ${s.emojis} emoji msgs, ${s.lateNight} late night msgs\n`;
    summary += `  Sample messages: ${s.samples.join(" | ")}\n\n`;
  }

  const prompt = `Based on this WhatsApp group data from this week, give out FUNNY awards to each member. Write in Tanglish. Be SPECIFIC about each person's behavior based on the data. Give each person exactly ONE award with a savage one-liner roast.

Award categories can include (pick the most fitting ones):
- Most Kattipudi Award (most messages)
- Silent Assassin Award (least messages)  
- Emoji Vomit Award (most emojis)
- Night Owl / Insomnia Award (late night messages)
- One Word Wonder (shortest avg messages)
- Essay Writer Award (longest avg messages)
- Or make up your own funny award names!

Format it like a Vijay TV award ceremony. Keep it punchy — max 2 lines per person.

${summary}`;

  return await generateContent(prompt);
}

// ===== Monthly Recap Stats (real data for the scheduler) =====
export async function getMonthlyRecapStats(groupId: string): Promise<{
  topChatter: string; topCount: number;
  topEmoji: string;
  mostActiveDay: string;
  topScorer: string; topScore: number;
}> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const { data: msgs } = await supabase
    .from("ba_message_stats")
    .select("sender_phone, sender_name, message_text, created_at")
    .eq("group_id", groupId)
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  const rows = msgs ?? [];

  // Top chatter
  const chatCount = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    const prev = chatCount.get(r.sender_phone) ?? { name: r.sender_name, count: 0 };
    chatCount.set(r.sender_phone, { name: r.sender_name, count: prev.count + 1 });
  }
  const topChatterEntry = [...chatCount.values()].sort((a, b) => b.count - a.count)[0];
  const topChatter = topChatterEntry?.name ?? "unknown";
  const topCount   = topChatterEntry?.count ?? 0;

  // Most used emoji
  const emojiCounts = new Map<string, number>();
  const emojiRe = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
  for (const r of rows) {
    for (const em of r.message_text.match(emojiRe) ?? []) {
      emojiCounts.set(em, (emojiCounts.get(em) ?? 0) + 1);
    }
  }
  const topEmoji = [...emojiCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "😂";

  // Most active day
  const dayCounts = new Map<string, number>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10); // YYYY-MM-DD
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const mostActiveIso  = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const mostActiveDay  = mostActiveIso
    ? new Date(mostActiveIso).toLocaleDateString("en-IN", { day: "numeric", month: "long", weekday: "long" })
    : "unknown";

  // Top scorer this month from ba_game_scores
  const { data: scores } = await supabase
    .from("ba_game_scores")
    .select("player_name, score")
    .eq("group_id", groupId)
    .gte("week_start", monthStart.slice(0, 10));

  const scoreTotals = new Map<string, number>();
  for (const s of scores ?? []) {
    scoreTotals.set(s.player_name, (scoreTotals.get(s.player_name) ?? 0) + s.score);
  }
  const topScorerEntry = [...scoreTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const topScorer = topScorerEntry?.[0] ?? "unknown";
  const topScore  = topScorerEntry?.[1] ?? 0;

  return { topChatter, topCount, topEmoji, mostActiveDay, topScorer, topScore };
}

// ===== Main Handler =====
export async function handleStatsCommand(
  command: string,
  msg: BotMessage
): Promise<{ response: string }> {
  let response: string;

  switch (command) {
    case "stats":
      response = await getStats(msg);
      break;
    case "top":
      response = await getTopMembers(msg);
      break;
    case "lurkers":
      response = await getLurkers(msg);
      break;
    case "awards":
      response = await generateAwards(msg.groupId);
      break;
    default:
      response = "Unknown stats command.";
  }

  return { response };
}
