/**
 * One-shot script: send today's schedule + contest announcement to WhatsApp.
 * Usage: npx tsx scripts/trigger-today.ts
 */
import { sendMessage } from "../src/listener.js";
import { dailyScheduleSync, dailyContestCreate } from "../src/features/fantasy.js";

const GROUP_ID = process.env.BOT_GROUP_ID ?? "";

if (!GROUP_ID) {
  console.error("BOT_GROUP_ID not set in .env");
  process.exit(1);
}

console.log("📅 Sending today's schedule...");
const scheduleMsg = await dailyScheduleSync(GROUP_ID);
if (scheduleMsg) {
  await sendMessage(GROUP_ID, scheduleMsg);
  console.log("✅ Schedule sent.");
} else {
  console.log("⚠️  No matches today (or sync returned nothing).");
}

await new Promise((r) => setTimeout(r, 2000));

console.log("🏏 Creating contests + sending announcements...");
const contestMsg = await dailyContestCreate(GROUP_ID);
if (contestMsg) {
  await sendMessage(GROUP_ID, contestMsg);
  console.log("✅ Contest announcement sent.");
} else {
  console.log("⚠️  No new contests to announce (may already exist in state).");
}

process.exit(0);
