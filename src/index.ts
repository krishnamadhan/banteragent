import "dotenv/config";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import { handleMessage, sendMessage as _sendMessage } from "./listener.js";
import { startScheduler } from "./scheduler.js";
import { supabase } from "./supabase.js";
import { seedKnownCouples } from "./features/profiles.js";
import { syncArchiveFromSupabase } from "./features/games.js";
import { startInternalServer } from "./internal-server.js";

let client: InstanceType<typeof Client>;

export function getClient() {
  return client;
}

async function connectToWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: "./auth" }),
    puppeteer: {
      headless: true,
      pipe: true,
      executablePath: process.env.CHROME_PATH ?? (
        process.platform === "win32"
          ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
          : "/usr/bin/chromium-browser"
      ),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
      ],
    },
  });

  // ===== QR CODE =====
  client.on("qr", async (qr) => {
    const qrPath = path.resolve("qr.png");
    await QRCode.toFile(qrPath, qr, { width: 400 });
    console.log("\n📱 QR code saved! Open this file and scan with your spare phone:");
    console.log(`   ${qrPath}`);
    console.log("   (WhatsApp → Settings → Linked Devices → Link a Device)\n");
  });

  // ===== CONNECTED =====
  client.on("ready", () => {
    console.log("\n✅ BanterAgent connected to WhatsApp!");
    console.log("🤖 Bot is now listening for messages...\n");
    listGroups();
    startScheduler();
    // Sync group members after a short delay (so getChats() has data)
    setTimeout(() => syncGroupMembers().catch(console.error), 5000);
    // Sync question archive from Supabase so no repeats survive restarts
    syncArchiveFromSupabase().catch(console.error);
    // Seed known couples so bot knows relationships from day 1
    const targetGid = process.env.BOT_GROUP_ID;
    if (targetGid && targetGid !== "120363xxxx@g.us") {
      setTimeout(() => seedKnownCouples(targetGid).catch(console.error), 8000);
      // Send pending release announcement if one is queued
      setTimeout(() => sendReleaseAnnouncement(targetGid), 15000);
    }
  });

  // ===== DISCONNECTED =====
  client.on("disconnected", async (reason) => {
    console.log(`❌ Disconnected: ${reason}. Restarting...`);
    try { await client.destroy(); } catch {}
    setTimeout(connectToWhatsApp, 5000);
  });

  // ===== MESSAGES =====
  client.on("message", async (msg) => {
    try {
      await handleMessage(client, msg);
    } catch (error) {
      console.error("Error handling message:", error);
    }
  });

  await client.initialize();
}

async function listGroups() {
  try {
    await new Promise((r) => setTimeout(r, 3000));
    const chats = await client.getChats();
    const groups = chats.filter((c) => c.isGroup);

    if (groups.length > 0) {
      console.log("📋 Your groups:\n");
      for (const g of groups) {
        console.log(`   ${g.name} → ${g.id._serialized}`);
      }
      console.log("\n💡 Copy your target group ID to BOT_GROUP_ID in .env\n");
    }
  } catch (error) {
    console.error("Failed to list groups:", error);
  }
}

// ===== SYNC GROUP MEMBERS (so bot knows everyone, not just those who've chatted) =====
async function syncGroupMembers() {
  const targetGroupId = process.env.BOT_GROUP_ID;
  if (!targetGroupId || targetGroupId === "120363xxxx@g.us") return;

  try {
    const chats = await client.getChats();
    const group = chats.find((c) => c.isGroup && c.id._serialized === targetGroupId) as any;
    if (!group?.participants?.length) return;

    const upserts = group.participants.map((p: any) => ({
      group_id: targetGroupId,
      member_phone: p.id._serialized,
      member_name: p.id.user, // phone number as fallback; updated when they message
    }));

    await supabase.from("ba_group_members").upsert(upserts, { onConflict: "group_id,member_phone" });
    console.log(`👥 Synced ${upserts.length} group members`);
  } catch (error) {
    console.error("Failed to sync group members:", error);
  }
}

// ===== RELEASE ANNOUNCEMENT =====
// Create "pending-release.txt" at project root before restarting the bot.
// Its contents will be sent to the group once, then moved to "last-release.txt".
async function sendReleaseAnnouncement(groupId: string) {
  const pendingPath = path.resolve("pending-release.txt");
  if (!fs.existsSync(pendingPath)) return;
  try {
    const content = fs.readFileSync(pendingPath, "utf-8").trim();
    if (!content) return;
    await client.sendMessage(groupId, content);
    fs.renameSync(pendingPath, path.resolve("last-release.txt"));
    console.log("📢 Release announcement sent to group!");
  } catch (e) {
    console.error("Failed to send release announcement:", e);
  }
}

// ===== GRACEFUL SHUTDOWN =====
async function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  try { await client.destroy(); } catch {}
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ===== STARTUP =====
console.log("🤖 BanterAgent v3 (whatsapp-web.js Edition)");
console.log("=============================================\n");
console.log("⏳ Starting browser... (first run takes ~30 seconds)\n");
startInternalServer();
connectToWhatsApp();
