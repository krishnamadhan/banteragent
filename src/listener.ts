import { handleAdminCommand } from "./admin-handler.js";
import { handlePiAdminMessage } from "./pi-admin.js";
import type { BotMessage } from "./types.js";
import { monGroupMsg } from "./monitor.js";
import { routeMessage } from "./router.js";
import { trackMessage } from "./features/analytics.js";
import { shouldAutoRespond, quickAutoRespondCheck, getGroupMode, addBotMessageToHistory } from "./claude.js";
import { getGroupSettings } from "./group-settings-cache.js";
import { extractProfileInfo, getZodiacQuestion } from "./features/profiles.js";
import { pickMeme, sendMeme } from "./features/memes.js";

// ===== Auto-response state (per-group) =====
const lastAutoResponseTime = new Map<string, number>();
const lastAutoRespondCheckTime = new Map<string, number>();
const autoResponsesCount = new Map<string, number>();
const autoResponseDate = new Map<string, string>();
let lastGroupMessageAt = 0;
export function getLastGroupMessageTime(): number { return lastGroupMessageAt; }

// ===== Per-user command rate limiting =====
const userLastCommand = new Map<string, number>();
const COMMAND_COOLDOWN_MS = 8_000; // 8 seconds between commands per user

// Recent messages buffer for auto-response context
const recentMessages: string[] = [];
const MAX_RECENT = 15;
export function getRecentMessages(): string[] { return [...recentMessages]; }
export function addRecentMessage(text: string): void {
  recentMessages.push(text);
  if (recentMessages.length > MAX_RECENT) recentMessages.shift();
}

// Trigger keywords for direct bot invocation
const TRIGGERS = ["dei bot", "da bot", "@bot", "banteragent", "claude"];

/**
 * Main message handler — called for every incoming message
 */
export async function handleMessage(client: any, rawMsg: any) {
  // Skip messages from self
  if (rawMsg.fromMe) return;

  // Handle text messages AND video pushup submissions
  const text: string = rawMsg.body?.trim() ?? "";
  const isVideoPushup =
    rawMsg.hasMedia &&
    rawMsg.type === "video" &&
    text.toLowerCase().startsWith("!pushup");
  if (!text && !isVideoPushup) return;

  const chat = await rawMsg.getChat();
  const isGroup = chat.isGroup;
  const contact = await rawMsg.getContact();

  const senderPhone = contact.id._serialized; // e.g. "919876543210@c.us"
  const senderName = contact.pushname || contact.name || senderPhone.replace("@c.us", "");

  // Skip Meta AI messages — it's a bot, not a real person, no point responding to it
  if (senderName.toLowerCase().includes("meta ai")) return;

  const groupId = isGroup ? chat.id._serialized : senderPhone;

  const msg: BotMessage = {
    from: senderPhone,
    senderName,
    text,
    groupId,
    messageId: rawMsg.id._serialized,
    isGroup,
    timestamp: rawMsg.timestamp,
    quotedMessageId: rawMsg.hasQuotedMsg ? (await rawMsg.getQuotedMessage())?.id?._serialized : undefined,
  };

  // Only respond in the configured groups (main + IPL group 2)
  const targetGroup = process.env.BOT_GROUP_ID;
  const targetGroup2 = process.env.BOT_GROUP2_ID;
  const allowedGroups = [targetGroup, targetGroup2].filter(Boolean) as string[];
  if (isGroup && allowedGroups.length > 0 && allowedGroups[0] !== "120363xxxx@g.us" && !allowedGroups.includes(msg.groupId)) return;

  // Only respond to DMs from the bot owner — block all other DMs (prevents Dominos/promo loops)
  const ownerPhone = process.env.BOT_OWNER_PHONE;
  if (!isGroup && senderPhone !== ownerPhone) return;

  // Handle admin commands from owner personal chat
  if (await handleAdminCommand(client, senderPhone, isGroup, text)) return;

  // Handle !pi admin commands (works in DM + group, checks admin internally)
  if (text.trim().toLowerCase().startsWith("!pi")) {
    const replyTo = isGroup ? groupId : senderPhone;
    if (await handlePiAdminMessage(client, senderPhone, isGroup, replyTo, text.trim())) return;
  }

  // Track last message time for auto-game-drop
  if (isGroup) lastGroupMessageAt = Date.now();

  // Check if bot is muted (allow !unmute through). Uses 30s cache to avoid serial DB hits.
  if (isGroup && text.trim().toLowerCase() !== "!unmute") {
    const { muted } = await getGroupSettings(groupId);
    if (muted) return;
  }

  // ===== VIDEO PUSHUP INTERCEPTION =====
  if (isVideoPushup) {
    const repMatch = text.match(/!pushup\s+(\d+)/i);
    const claimedReps = repMatch ? parseInt(repMatch[1]!, 10) : null;
    if (!claimedReps || claimedReps <= 0) {
      await rawMsg.reply("Machaan, reps count sollu! Caption: *!pushup 20* (20 = your count) nu video send pannu.");
      return;
    }
    const { handlePushupVideo } = await import("./features/fitness.js");
    // Fire-and-forget: processing takes 15-30s, bot sends reply when done
    handlePushupVideo(rawMsg, claimedReps, senderPhone, senderName, groupId).catch(console.error);
    return;
  }

  // Track message for analytics
  trackMessage(msg).catch(console.error);
  // Monitor: log group activity for engagement analysis
  if (isGroup) monGroupMsg(senderName, text.startsWith("!"));
  // Extract profile info only from natural chat, not command messages
  if (!text.startsWith("!")) extractProfileInfo(msg).catch(() => {});

  // Add to recent messages buffer
  recentMessages.push(`[${senderName}]: ${text}`);
  if (recentMessages.length > MAX_RECENT) recentMessages.shift();

  // ===== DETERMINE IF BOT SHOULD RESPOND =====
  const lowerText = text.toLowerCase();

  const isCommand = lowerText.startsWith("!");
  // "machi" anywhere as a standalone word counts as addressing the bot
  const machiAnywhere = /\bmachi\b/.test(lowerText);
  const isMentioned = machiAnywhere || TRIGGERS.some((t) => lowerText.includes(t));
  const isReplyToBot = rawMsg.hasQuotedMsg && (await rawMsg.getQuotedMessage())?.fromMe;
  const isDM = !isGroup;

  if (isCommand || isMentioned || isReplyToBot || isDM) {
    // Rate limit commands — silently drop if same user spams within 8s
    // Exempt !a / !answer (game answers are time-sensitive — players must respond quickly)
    const cmdWord = lowerText.startsWith("!") ? lowerText.slice(1).split(/\s+/)[0] : "";
    const isAnswerCmd = cmdWord === "a" || cmdWord === "answer";
    // Bug reports are instant file writes — no reason to rate-limit them, and we never
    // want the command AFTER a !bug to get silently dropped (Bug #42).
    const isBugCmd = cmdWord === "bug";
    if (isCommand && !isAnswerCmd && !isBugCmd) {
      const lastCmd = userLastCommand.get(senderPhone) ?? 0;
      if (Date.now() - lastCmd < COMMAND_COOLDOWN_MS) return;
      userLastCommand.set(senderPhone, Date.now());
    }

    let cleanText = text.trim();

    if (!isCommand) {
      for (const trigger of TRIGGERS) {
        cleanText = cleanText.replace(new RegExp(trigger, "gi"), "").trim();
      }
      if (!cleanText) cleanText = "Enna machaan, solla?";
    }

    msg.text = cleanText;
    const { response, mentions, additionalMessages } = await routeMessage(msg, recentMessages);

    // Append zodiac question if this person's profile is empty (max once per week)
    let fullResponse = response;
    if (isGroup) {
      const zodiacQ = await getZodiacQuestion(msg.groupId, msg.from, msg.senderName).catch(() => null);
      if (zodiacQ) fullResponse = response + "\n\n" + zodiacQ;
    }

    // Empty response = handler already sent its own message (e.g. memory game sends + schedules deletion)
    if (!fullResponse.trim()) return;

    await sendReply(client, rawMsg, fullResponse, mentions);

    // Send any additional chained messages (e.g. multi-part welcome sequence)
    if (additionalMessages?.length) {
      for (const m of additionalMessages) {
        if (m.delayMs) await new Promise(r => setTimeout(r, m.delayMs));
        await sendMessage(isGroup ? msg.groupId : msg.from, m.text);
      }
    }

    // Track bot's own response so it has context when users follow up
    if (isGroup) {
      addBotMessageToHistory(msg.groupId, fullResponse);
      addRecentMessage(`[Bot]: ${fullResponse.slice(0, 200)}`);
    }

    // Occasionally follow up with a reaction meme (only for free-chat responses, not commands)
    if (isGroup && !isCommand) {
      const mode = await getGroupMode(msg.groupId);
      const meme = pickMeme(response, msg.text, mode);
      if (meme) {
        // Small delay so it feels like a separate reaction, not the same message
        setTimeout(() => sendMeme(rawMsg, meme).catch(() => {}), 1500);
      }
    }

    return;
  }

  // ===== AUTO-RESPONSE ENGINE =====
  if (isGroup) {
    const autoResponse = await evaluateAutoResponse(msg);
    if (autoResponse) {
      await sendReply(client, rawMsg, autoResponse);
      addBotMessageToHistory(msg.groupId, autoResponse);
      addRecentMessage(`[Bot]: ${autoResponse.slice(0, 200)}`);
    }
  }
}

/**
 * Evaluate whether bot should auto-respond
 */
async function evaluateAutoResponse(msg: BotMessage): Promise<string | null> {
  const gid = msg.groupId;
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10); // IST date
  if (today !== autoResponseDate.get(gid)) {
    autoResponsesCount.set(gid, 0);
    autoResponseDate.set(gid, today);
  }

  const dailyMax = parseInt(process.env.AUTO_RESPONSE_DAILY_MAX ?? "8");
  if ((autoResponsesCount.get(gid) ?? 0) >= dailyMax) return null;

  // 45-min cooldown after a SUCCESSFUL auto-response
  const cooldownMs = parseInt(process.env.AUTO_RESPONSE_COOLDOWN_MINS ?? "45") * 60 * 1000;
  if (Date.now() - (lastAutoResponseTime.get(gid) ?? 0) < cooldownMs) return null;

  const istHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
  const nightStart = parseInt(process.env.NIGHT_MODE_START ?? "23");
  const nightEnd = parseInt(process.env.NIGHT_MODE_END ?? "7");
  if (istHour >= nightStart || istHour < nightEnd) return null;

  // Check DB auto_response toggle (allows disabling unprompted replies entirely). Served from cache.
  const { auto_response } = await getGroupSettings(msg.groupId);
  if (!auto_response) return null;

  // Rule-based pre-filter — skip obviously boring messages without calling Claude
  if (!quickAutoRespondCheck(msg.text)) return null;

  // 10-min cooldown between ANY Claude shouldAutoRespond calls (prevents burst spending
  // when the group is active but Claude keeps saying __SILENT__)
  const checkCooldownMs = 10 * 60 * 1000;
  if (Date.now() - (lastAutoRespondCheckTime.get(gid) ?? 0) < checkCooldownMs) return null;

  const mode = await getGroupMode(msg.groupId);
  const response = await shouldAutoRespond(
    recentMessages.slice(-10),
    msg.text,
    msg.senderName,
    mode
  );
  lastAutoRespondCheckTime.set(gid, Date.now()); // update regardless of SILENT or response

  if (response) {
    lastAutoResponseTime.set(gid, Date.now());
    autoResponsesCount.set(gid, (autoResponsesCount.get(gid) ?? 0) + 1);
    console.log(`Auto-response #${autoResponsesCount.get(gid)} to [${msg.senderName}]`);
  }

  return response;
}

/**
 * Reply to a message, optionally with @mentions
 */
async function sendReply(client: any, rawMsg: any, text: string, mentions?: string[]) {
  try {
    if (mentions?.length) {
      const mentionContacts = (
        await Promise.allSettled(mentions.map((jid) => client.getContactById(jid)))
      )
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<any>).value);
      const chat = await rawMsg.getChat();
      await client.sendMessage(chat.id._serialized, text, { mentions: mentionContacts });
    } else {
      await rawMsg.reply(text);
    }
  } catch (error) {
    console.error("Failed to send reply:", error);
  }
}

/**
 * Send a message to a JID (used by scheduler)
 */
export async function sendMessage(jid: string, text: string) {
  const { getClient } = await import("./index.js");
  const client = getClient();
  if (!client || !client.info) {
    console.error("Client not ready, cannot send message");
    return;
  }
  try {
    await client.sendMessage(jid, text);
  } catch (error) {
    console.error("Failed to send scheduled message:", error);
  }
}

/**
 * Send a message with @mentions (for personalized messages)
 * phones: array of phone JIDs like "919876543210@c.us"
 * In the text, use @PhoneName or just the person's name — this adds the WA mention tag
 */
export async function sendMentionMessage(jid: string, text: string, phones: string[]) {
  const { getClient } = await import("./index.js");
  const client = getClient();
  if (!client || !client.info) {
    console.error("Client not ready, cannot send mention message");
    return;
  }
  try {
    const mentions = (
      await Promise.allSettled(phones.map((p) => client.getContactById(p)))
    )
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    await client.sendMessage(jid, text, { mentions });
  } catch (error) {
    console.error("Failed to send mention message, falling back:", error);
    try {
      await client.sendMessage(jid, text);
    } catch {}
  }
}
