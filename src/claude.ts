import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { devlog, startDevServer } from "./devlog.js";
import { monClaude } from "./monitor.js";
import { getISTDateString, getISTYear, buildMainModePrompt } from "./prompts.js";
import { getGroupConfig } from "./group-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODES_FILE = resolve(__dirname, "../data/group-modes.json");

function loadModesFile(): Record<string, string> {
  try {
    if (existsSync(MODES_FILE)) return JSON.parse(readFileSync(MODES_FILE, "utf8"));
  } catch {}
  return {};
}

function saveModesToFile(modes: Record<string, string>): void {
  try {
    mkdirSync(dirname(MODES_FILE), { recursive: true });
    writeFileSync(MODES_FILE, JSON.stringify(modes, null, 2));
  } catch (e) {
    console.warn("[mode] Failed to save modes file:", e);
  }
}

// Start dev dashboard if DEV_LOG env var is set
if (process.env.DEV_LOG === "1") startDevServer();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const HAIKU_MODEL = process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001";
const MODEL = process.env.CLAUDE_CHAT_MODEL || HAIKU_MODEL;

// BASE_SYSTEM_PROMPT for non-chat uses — function so date is fresh on each call
function getBaseSystemPrompt(): string { return buildMainModePrompt("roast"); }

// Wrap a system prompt string as a cacheable content block.
// Reduces input token costs by ~90% when the same prompt is reused within 5 minutes.
function cached(text: string): Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

const STRUCTURED_PROMPT = `You generate content for a Tamil WhatsApp group bot. Follow the requested format EXACTLY. Do not add extra commentary or deviate from the format. When the format says Tanglish, write Tamil in English alphabets.`;

// In-memory conversation history per group
const groupHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
const MAX_HISTORY = 8;

// Per-group bot mode (in-memory; refreshed from DB every 30 min)
const groupModes = new Map<string, string>();
const modeLoadTime = new Map<string, number>();
const MODE_TTL_MS = 30 * 60 * 1000;

export function setGroupMode(groupId: string, mode: string): void {
  groupModes.set(groupId, mode);
  modeLoadTime.set(groupId, Date.now());
  groupHistory.delete(groupId);
  // Persist to file — avoids DB constraint violation (ba_group_settings_bot_mode_check)
  const saved = loadModesFile();
  saved[groupId] = mode;
  saveModesToFile(saved);
}

export async function getGroupMode(groupId: string): Promise<string> {
  const lastLoad = modeLoadTime.get(groupId) ?? 0;
  if (Date.now() - lastLoad > MODE_TTL_MS) {
    // 1. Try file-based persistence (survives restarts, no DB constraint issues)
    const saved = loadModesFile();
    if (saved[groupId]) {
      groupModes.set(groupId, saved[groupId]);
      console.log(`[mode] Loaded "${saved[groupId]}" from file for ${groupId}`);
    } else {
      // 2. Fall back to DB for groups that had mode set before this fix
      try {
        const { supabase } = await import("./supabase.js");
        const { data, error } = await supabase
          .from("ba_group_settings")
          .select("bot_mode")
          .eq("group_id", groupId)
          .maybeSingle();
        if (error) console.warn(`[mode] DB load failed for ${groupId}:`, error.message);
        if (data?.bot_mode) {
          groupModes.set(groupId, data.bot_mode);
          console.log(`[mode] Loaded "${data.bot_mode}" from DB for ${groupId}`);
        }
      } catch (e) {
        console.warn(`[mode] Exception loading mode for ${groupId}:`, e);
      }
    }
    modeLoadTime.set(groupId, Date.now());
  }
  return groupModes.get(groupId) ?? getGroupConfig(groupId).defaultMode;
}


// ===== Rule-based pre-filter — skip boring messages without calling Claude =====
export function quickAutoRespondCheck(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Too short — single word/emoji reactions
  if (words.length < 3) return false;

  // Pure reactions / acknowledgments
  const boring = new Set([
    "ok", "okay", "k", "haha", "lol", "lmao", "nice", "cool",
    "thanks", "thank you", "noted", "done", "sure", "ya", "yep",
    "seen", "👍", "😂", "❤️", "🔥",
  ]);
  if (boring.has(lower)) return false;

  // High-interest topics — always worth considering
  const hot = ["?", "cricket", "movie", "film", "biryani", "food", "vijay",
    "ajith", "fight", "kaathu", "who", "why", "what", "when", "how"];
  if (hot.some((t) => lower.includes(t))) return true;

  // Random 25% sample for everything else
  return Math.random() < 0.25;
}

export async function getChatResponse(
  groupId: string,
  senderName: string,
  message: string
): Promise<string> {
  if (!groupHistory.has(groupId)) groupHistory.set(groupId, []);
  const history = groupHistory.get(groupId)!;

  history.push({ role: "user", content: `[${senderName}]: ${message}` });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

  const mode = await getGroupMode(groupId);

  // Include member profiles so Claude can personalize responses
  let profileContext = "";
  try {
    const { getGroupProfileContext } = await import("./features/profiles.js");
    profileContext = await getGroupProfileContext(groupId, mode);
  } catch { /* ignore */ }

  // Serious mode: enrich with live DB data when message has fantasy/cricket intent
  let dbContext = "";
  if (mode === "serious") {
    try {
      const { getIplDbContext } = await import("./features/fantasy.js");
      const ctx = await getIplDbContext(message, groupId);
      if (ctx) dbContext = ctx;
    } catch { /* non-fatal */ }
  }

  // Static mode prompt is cached (survives 5-min ephemeral window).
  // Dynamic profile/db context is a separate uncached block so cache key for the
  // static part is stable even when profile data refreshes.
  const staticPrompt = getGroupConfig(groupId).buildPrompt(mode);
  const dynamicContext = profileContext + dbContext;
  const systemBlocks: any[] = [
    ...cached(staticPrompt),
    ...(dynamicContext ? [{ type: "text", text: dynamicContext }] : []),
  ];
  const t0 = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: systemBlocks,
      messages: history,
    });

    const text =
      response.content[0].type === "text"
        ? response.content[0].text
        : "Machaan, en brain hang aagiduchu.";

    history.push({ role: "assistant", content: text });
    const result = truncateForWhatsApp(text);

    devlog({
      type: "chat",
      groupId,
      sender: senderName,
      mode,
      systemPrompt: staticPrompt + dynamicContext,
      history: [...history.slice(0, -1)],
      response: result,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs: Date.now() - t0,
    });
    monClaude({
      type: "chat",
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: (response.usage as any).cache_read_input_tokens ?? 0,
      dur_ms: Date.now() - t0,
    });

    return result;
  } catch (error) {
    devlog({ type: "chat", groupId, sender: senderName, mode, systemPrompt: staticPrompt + dynamicContext, error: String(error), durationMs: Date.now() - t0 });
    console.error("Claude API error:", error);
    return "Machaan, server-la signal illai. Konjam wait pannunga.";
  }
}

export async function generateStructured(prompt: string): Promise<string> {
  const t0 = Date.now();
  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      system: cached(STRUCTURED_PROMPT),
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text"
      ? response.content[0].text
      : "Content generate panna mudiyala machaan.";
    devlog({ type: "structured", prompt, response: text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, durationMs: Date.now() - t0 });
    monClaude({ type: "structured", input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, cache_read_tokens: (response.usage as any).cache_read_input_tokens ?? 0, dur_ms: Date.now() - t0 });
    return text;
  } catch (error) {
    devlog({ type: "structured", prompt, error: String(error), durationMs: Date.now() - t0 });
    console.error("Claude structured error:", error);
    return "Oops, brain freeze aayiduchu.";
  }
}

export async function generateContent(prompt: string): Promise<string> {
  const t0 = Date.now();
  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      system: cached(getBaseSystemPrompt()),
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text"
      ? truncateForWhatsApp(response.content[0].text)
      : "Content generate panna mudiyala machaan.";
    devlog({ type: "content", prompt, response: text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, durationMs: Date.now() - t0 });
    monClaude({ type: "content", input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, cache_read_tokens: (response.usage as any).cache_read_input_tokens ?? 0, dur_ms: Date.now() - t0 });
    return text;
  } catch (error) {
    devlog({ type: "content", prompt, error: String(error), durationMs: Date.now() - t0 });
    console.error("Claude generate error:", error);
    return "Oops, brain freeze aayiduchu.";
  }
}

/**
 * Ask Claude whether the bot should auto-respond.
 * Only called AFTER quickAutoRespondCheck passes — saves ~75% of auto-response API calls.
 */
export async function shouldAutoRespond(
  recentMessages: string[],
  latestMessage: string,
  senderName: string,
  mode: string = "roast"
): Promise<string | null> {
  const prompt = `You're monitoring a Tamil WhatsApp group chat. Here are the last few messages:

${recentMessages.join("\n")}

Latest message from ${senderName}: "${latestMessage}"

Should the bot jump in? The bar is HIGH — you are the friend who speaks rarely but lands every time. Only respond if at least one:
- Someone asked a question that sat unanswered
- A genuinely funny setup is hanging there waiting for a punchline (the BEST reason)
- A perfect callback to something said earlier in these messages
- Strong-opinion territory: cricket, Tamil movies, food, Chennai — and you'd take a SIDE
- A debate is 50/50 and one spicy line would tip it into chaos (the fun kind)

NEVER jump in when:
- Two people are having a real 1:1 moment (emotional, personal, planning)
- Your reply would just be agreement or "haha" energy — silence beats filler
- You'd repeat a joke shape you've already used in these messages

If yes: ONE short Tanglish line (two max). Punchline energy, not paragraph energy.
If no: reply EXACTLY: __SILENT__

Silence is your superpower — a rare perfect interjection is worth 10 mid ones.`;

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("shouldAutoRespond timeout")), 8000)
    );
    const response = await Promise.race([
      client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 200,
        system: cached(buildMainModePrompt(mode)),
        messages: [{ role: "user", content: prompt }],
      }),
      timeout,
    ]);

    const text = response.content[0].type === "text" ? response.content[0].text : "__SILENT__";
    const silent = text.includes("__SILENT__");
    const result = silent ? null : truncateForWhatsApp(text);
    devlog({ type: "auto", sender: senderName, mode, silent, recentMessages, response: result ?? undefined });
    return result;
  } catch {
    return null;
  }
}

function truncateForWhatsApp(text: string): string {
  if (text.length <= 4096) return text;
  return text.slice(0, 4050) + "\n\n... (truncated)";
}

/**
 * Analyze an image with Claude Vision and respond in the bot's Tanglish personality.
 * imageBase64: raw base64 string from whatsapp-web.js downloadMedia()
 * mimetype: e.g. "image/jpeg"
 * caption: any text the sender included with the image (may be empty)
 */
export async function getImageResponse(
  groupId: string,
  senderName: string,
  imageBase64: string,
  mimetype: string,
  caption: string
): Promise<string> {
  const mode = await getGroupMode(groupId);
  const systemPrompt = getGroupConfig(groupId).buildPrompt(mode);

  const safeMediaType = (mimetype && mimetype.startsWith("image/") ? mimetype : "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  const userContent: Array<any> = [
    {
      type: "image",
      source: { type: "base64", media_type: safeMediaType, data: imageBase64 },
    },
    {
      type: "text",
      text: caption
        ? `[${senderName}] shared this image and said: "${caption}". React or respond in your Tanglish style. IMPORTANT: If you can read any text/badge/logo in the image (e.g. car model name, product label), trust that text over your training memory — do NOT guess a different model name.`
        : `[${senderName}] shared this image in the group. Describe what you see and react to it in your Tanglish style. Keep it short and punchy. IMPORTANT: If you can read any text/badge/logo in the image (e.g. car model name, product label), trust that text over your training memory — do NOT guess a different model name.`,
    },
  ];

  const t0 = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: cached(systemPrompt),
      messages: [{ role: "user", content: userContent }],
    });
    const text =
      response.content[0].type === "text"
        ? response.content[0].text
        : "Image pakuren machaan, aana en brain freeze aagiduchu.";
    monClaude({
      type: "image",
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: (response.usage as any).cache_read_input_tokens ?? 0,
      dur_ms: Date.now() - t0,
    });
    return truncateForWhatsApp(text);
  } catch (error) {
    console.error("Claude image error:", error);
    return "Image load aagala machaan, try again pannu.";
  }
}

/**
 * Analyze a sticker image and return description + when_to_use tags.
 * contextMessages: recent group messages before this sticker was sent.
 */
export async function analyzeStickerVision(
  imageBase64: string,
  mimetype: string,
  contextMessages: string[] = []
): Promise<{ description: string; when_to_use: string }> {
  const safeMediaType = (mimetype?.startsWith("image/") ? mimetype : "image/webp") as
    | "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  const contextBlock = contextMessages.length
    ? `\nChat context before this sticker was sent:\n${contextMessages.slice(-5).join("\n")}\n`
    : "";

  const userContent: Array<any> = [
    { type: "image", source: { type: "base64", media_type: safeMediaType, data: imageBase64 } },
    {
      type: "text",
      text: `${contextBlock}
Analyze this WhatsApp sticker. Reply with JSON only (no markdown):
{
  "description": "one sentence describing the visual and emotion (e.g. 'cat facepalming in disbelief')",
  "when_to_use": "comma-separated situations e.g. 'when something is unbelievable, to react to stupidity, after a facepalm moment'"
}`,
    },
  ];

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 150,
      system: cached(STRUCTURED_PROMPT),
      messages: [{ role: "user", content: userContent }],
    });
    const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
    const parsed = JSON.parse(raw.replace(/^```json\n?|```$/g, "").trim());
    return {
      description: parsed.description ?? "expressive sticker",
      when_to_use: parsed.when_to_use ?? "general reactions",
    };
  } catch (e) {
    console.error("[sticker] analyzeStickerVision error:", e);
    return { description: "expressive sticker", when_to_use: "general reactions" };
  }
}

/**
 * Given a bot response text and the sticker library, pick the best matching sticker ID.
 * Returns null if no sticker fits well enough.
 */
export async function pickStickerForContext(
  responseText: string,
  stickers: Array<{ id: string; description: string; when_to_use: string }>
): Promise<string | null> {
  if (stickers.length === 0) return null;

  const stickerList = stickers
    .map((s, i) => `${i + 1}. [${s.id}] ${s.description} — use when: ${s.when_to_use}`)
    .join("\n");

  const prompt = `You're a Tamil WhatsApp bot choosing a sticker reaction.

Bot's response text:
"${responseText}"

Sticker library:
${stickerList}

Pick the sticker whose emotion or vibe BEST matches the bot's response. Only pick one if it's a really strong match — not every message needs a sticker.
Reply with JSON only: {"id": "<sticker_id>"} or {"id": null} if none fits.`;

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 60,
      system: cached(STRUCTURED_PROMPT),
      messages: [{ role: "user", content: prompt }],
    });
    const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
    const parsed = JSON.parse(raw.replace(/^```json\n?|```$/g, "").trim());
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Add a bot-generated scheduled message to a group's conversation history
 * so the bot doesn't reply confused when users react to its own messages.
 */
export function addBotMessageToHistory(groupId: string, text: string): void {
  if (!groupHistory.has(groupId)) groupHistory.set(groupId, []);
  const history = groupHistory.get(groupId)!;
  history.push({ role: "assistant", content: text });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}
