import type { BotMessage } from "../types.js";
import { supabase } from "../supabase.js";

// IST offset in milliseconds
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Build a UTC Date from IST hours/minutes on a given IST date string ("YYYY-MM-DD")
function istToUtc(istDateStr: string, hours: number, minutes: number): Date {
  // e.g. "2024-03-15T17:00:00+05:30" → parsed as IST 5pm → UTC 11:30am
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${istDateStr}T${pad(hours)}:${pad(minutes)}:00+05:30`);
}

// Get today's and tomorrow's date in IST as "YYYY-MM-DD"
function istDateStrings(): { today: string; tomorrow: string } {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const today = istNow.toISOString().slice(0, 10);
  const nextDay = new Date(istNow);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const tomorrow = nextDay.toISOString().slice(0, 10);
  return { today, tomorrow };
}

// ===== Parse reminder time from natural language =====
// All times are interpreted as IST regardless of server timezone.
function parseReminderTime(text: string): { task: string; time: Date } | null {
  // Pattern: !remind me/group <task> at <time>
  const match = text.match(/^(me|group)\s+(.+?)\s+at\s+(.+)$/i);
  if (!match) return null;

  const task = match[2].trim();
  const timeStr = match[3].trim().toLowerCase();
  const now = new Date();
  const { today, tomorrow } = istDateStrings();

  let targetDate: Date | null = null;

  // "5pm", "5:30pm", "17:00"
  const timeMatch = timeStr.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2] ?? "0");
    const ampm = timeMatch[3]?.toLowerCase();

    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    // Build as IST today
    targetDate = istToUtc(today, hours, minutes);
    // If that time already passed, use tomorrow IST
    if (targetDate <= now) {
      targetDate = istToUtc(tomorrow, hours, minutes);
    }
  }

  // "in 30 minutes", "in 2 hours" — relative from now, no timezone needed
  const relativeMatch = timeStr.match(
    /^in\s+(\d+)\s*(min|mins|minutes|hour|hours|hr|hrs)$/i
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    targetDate = new Date(now);
    if (unit.startsWith("min")) {
      targetDate.setMinutes(targetDate.getMinutes() + amount);
    } else {
      targetDate.setHours(targetDate.getHours() + amount);
    }
  }

  // "tomorrow 9am"
  const tomorrowMatch = timeStr.match(
    /^tomorrow\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i
  );
  if (tomorrowMatch) {
    let hours = parseInt(tomorrowMatch[1]);
    const minutes = parseInt(tomorrowMatch[2] ?? "0");
    const ampm = tomorrowMatch[3]?.toLowerCase();

    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    targetDate = istToUtc(tomorrow, hours, minutes);
  }

  if (!targetDate || !task) return null;

  return { task, time: targetDate };
}

// ===== Set Reminder =====
async function setReminder(args: string, msg: BotMessage): Promise<string> {
  const parsed = parseReminderTime(args);

  if (!parsed) {
    return `Format sari illa machaan! Examples:\n\n!remind me call amma at 6pm\n!remind group meeting at in 30 minutes\n!remind me gym at tomorrow 7am`;
  }

  const isGroup = args.trim().toLowerCase().startsWith("group");

  await supabase.from("ba_reminders").insert({
    group_id: msg.groupId,
    sender_phone: msg.from,
    sender_name: msg.senderName,
    reminder_text: parsed.task,
    remind_at: parsed.time.toISOString(),
    is_group_reminder: isGroup,
  });

  // Format time for display in IST
  const istTime = parsed.time.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    day: "numeric",
    month: "short",
  });

  return `⏰ Reminder set!\n\n📝 ${parsed.task}\n🕐 ${istTime}\n${isGroup ? "📢 Group reminder — ellaarukkum solluven" : "🔒 Personal — unakku mattum solluven"}`;
}

// ===== List Reminders =====
async function listReminders(msg: BotMessage): Promise<string> {
  const { data } = await supabase
    .from("ba_reminders")
    .select("*")
    .eq("group_id", msg.groupId)
    .eq("is_sent", false)
    .or(`sender_phone.eq.${msg.from},is_group_reminder.eq.true`)
    .order("remind_at", { ascending: true })
    .limit(10);

  if (!data?.length) return "Active reminders onnum illa machaan.";

  let result = "⏰ *ACTIVE REMINDERS*\n\n";
  data.forEach((r, i) => {
    const time = new Date(r.remind_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      day: "numeric",
      month: "short",
    });
    const icon = r.is_group_reminder ? "📢" : "🔒";
    result += `${i + 1}. ${icon} ${r.reminder_text} — ${time}\n`;
  });

  return result;
}

// ===== Check & Send Due Reminders (called by cron) =====
export async function checkDueReminders(): Promise<
  Array<{ phone: string; message: string; isGroup: boolean; groupId: string }>
> {
  const now = new Date().toISOString();

  const { data: dueReminders } = await supabase
    .from("ba_reminders")
    .select("*")
    .eq("is_sent", false)
    .lte("remind_at", now);

  if (!dueReminders?.length) return [];

  const notifications: Array<{
    phone: string;
    message: string;
    isGroup: boolean;
    groupId: string;
  }> = [];

  for (const reminder of dueReminders) {
    const message = `⏰ *REMINDER!*\n\n📝 ${reminder.reminder_text}\n👤 Set by: ${reminder.sender_name}`;

    notifications.push({
      phone: reminder.is_group_reminder ? reminder.group_id : reminder.sender_phone,
      message,
      isGroup: reminder.is_group_reminder,
      groupId: reminder.group_id,
    });

    await supabase
      .from("ba_reminders")
      .update({ is_sent: true })
      .eq("id", reminder.id);
  }

  return notifications;
}

// ===== Main Handler =====
export async function handleReminderCommand(
  command: string,
  args: string,
  msg: BotMessage
): Promise<{ response: string }> {
  if (command === "remind") {
    return { response: await setReminder(args, msg) };
  }
  return { response: await listReminders(msg) };
}
