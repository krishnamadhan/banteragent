import Anthropic from "@anthropic-ai/sdk";
import { devlog, startDevServer } from "./devlog.js";
import { monClaude } from "./monitor.js";
import { getISTDateString, getISTYear, buildMainModePrompt } from "./prompts.js";
import { getGroupConfig } from "./group-config.js";

// Start dev dashboard if DEV_LOG env var is set
if (process.env.DEV_LOG === "1") startDevServer();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL = "claude-sonnet-4-20250514";

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
const MAX_HISTORY = 15;

// Per-group bot mode (in-memory; refreshed from DB every 30 min)
const groupModes = new Map<string, string>();
const modeLoadTime = new Map<string, number>();
const MODE_TTL_MS = 30 * 60 * 1000;

export function setGroupMode(groupId: string, mode: string): void {
  groupModes.set(groupId, mode);
  modeLoadTime.set(groupId, Date.now());
  groupHistory.delete(groupId);
}

export async function getGroupMode(groupId: string): Promise<string> {
  const lastLoad = modeLoadTime.get(groupId) ?? 0;
  if (Date.now() - lastLoad > MODE_TTL_MS) {
    // Lazy-load from DB once per session
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
      } else {
        console.log(`[mode] No saved mode for ${groupId}, defaulting to nanban`);
      }
    } catch (e) {
      console.warn(`[mode] Exception loading mode for ${groupId}:`, e);
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

  const systemPrompt = getGroupConfig(groupId).buildPrompt(mode) + profileContext + dbContext;
  const t0 = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: cached(systemPrompt),
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
      systemPrompt,
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
    devlog({ type: "chat", groupId, sender: senderName, mode, systemPrompt, error: String(error), durationMs: Date.now() - t0 });
    console.error("Claude API error:", error);
    return "Machaan, server-la signal illai. Konjam wait pannunga.";
  }
}

export async function generateStructured(prompt: string): Promise<string> {
  const t0 = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
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
      model: MODEL,
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

Should the bot jump in? Only respond if:
- Someone asked a question that nobody answered
- Something genuinely funny or roast-worthy
- Topic is cricket, movies, food, or Chennai — bot has strong opinions
- Someone shared something interesting

If yes: write your Tanglish response directly.
If no: reply EXACTLY: __SILENT__

Less is more — only jump in when it adds value or comedy.`;

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("shouldAutoRespond timeout")), 8000)
    );
    const response = await Promise.race([
      client.messages.create({
        model: MODEL,
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
 * Add a bot-generated scheduled message to a group's conversation history
 * so the bot doesn't reply confused when users react to its own messages.
 */
export function addBotMessageToHistory(groupId: string, text: string): void {
  if (!groupHistory.has(groupId)) groupHistory.set(groupId, []);
  const history = groupHistory.get(groupId)!;
  history.push({ role: "assistant", content: text });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}
