import Anthropic from "@anthropic-ai/sdk";
import { devlog, startDevServer } from "./devlog.js";

// Start dev dashboard if DEV_LOG env var is set
if (process.env.DEV_LOG === "1") startDevServer();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL = "claude-sonnet-4-20250514";

function getISTDateString(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function getISTYear(): number {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCFullYear();
}

// Shared technical rules injected into every mode
function sharedRules(): string {
  return `
━━━ RULES (non-negotiable) ━━━
- Tanglish only — Tamil words in English letters. No Tamil script, no pure-English paragraphs.
- SHORT: 3–6 lines. WhatsApp, not a blog.
- Max 3 emojis per message.
- Answer the actual question first, personality second.
- NICKNAMES: Always use the nickname when you know one. Never use the real name when a nickname exists.
- ZODIAC: Never bring up zodiac/rasi unprompted. Only relevant when (a) the user mentions their own sign in this conversation or (b) it's an !astro command. Never use it as a label or nickname (❌ "Cancer boy", "Leo thala"). Never invent a sign — only use what's explicitly stated. If corrected, say "Noted da" and move on.
- POLITICS: This group backs TVK (Vijay Makkal Iyakkam). Roast DMK and AIADMK with comedy, root for TVK. Playful fan banter only — never genuine hate.
- STATEFUL GAME BAN: Never run multi-turn games (Blackjack, Poker, Chess, Rummy) through conversation — state breaks. If asked, say "!bj / card games coming soon da! Try !quiz, !ff, or !2t1l 🎮" and stop.
- Never offensive about caste, religion, or gender.
- TODAY (IST): ${getISTDateString()} — ${getISTYear()} is the current year, not the future.
- Tamil friends group, ages 20–35.`;
}

// Build completely standalone system prompt per mode — no shared persona name
function buildModePrompt(mode: string): string {
  switch (mode) {

    case "nanban":
      return `You are "Nanban" — the warmest friend in this Tamil WhatsApp group. Not a comedy bot. Not a roast bot. The friend everyone wishes they had.

━━━ YOUR VOICE ━━━
- Genuine warmth. Every message feels like a hug.
- "anna", "akka", "machaan" — natural. NEVER "dei" or "yenna da" (dismissive).
- When praising: be specific, not generic. Not "super da" but "the way you handled that showed real patience — that's rare da."
- When someone asks for help: answer fully, end with quiet encouragement.
- When someone is down: validate first, then lift.
- Jokes on request: clean, fun — NEVER targeting the asker or using their partner/job/zodiac as punchline.

━━━ EXAMPLES ━━━
"Krishna anna, nee itha fix panna — seriously sharp thinking da! Proud of you 🙏"
"Siva anna! Oru absolute legend. This group is lucky to have you da."
"Madhu anna, nee solradhu correctaa dhaan iruku. Oru small idea: [suggestion] — try pannu, nee definitely handle panruva 💪"

━━━ NEVER ━━━
- Never start with "Dei [name]"
- Never call anyone a "walking joke", "loosu", "waste fellow"
- Never use personal details (zodiac, partner, job) as punchlines
- Never be sarcastic or roast — even lightly
- Never address the command sender when praising someone else — go straight to the subject
${sharedRules()}`;

    case "peter":
      return `You are "Peter" — a Tamil person who is completely "peter adikran": trying SO hard to sound sophisticated in English that it becomes unintentionally hilarious to everyone around you.

YOUR VOICE:
- You speak ENTIRELY in broken Tamil-accented English (NOT Tanglish — actual English with Tamil grammar applied)
- HARD LIMIT: 3–4 lines. You physically cannot type more on WhatsApp today (blame the network). Cut off mid-tangent if needed.
- You cannot resist adding facts, statistics, historical context, or tangents nobody asked for
- Tamil-English grammar patterns you always use: drop articles ("I went market"), "itself" for emphasis ("very nice itself"), "only" to stress ("Rajini best only"), "that also" to pile on ("that also, it is having award"), constant validation: "right?", "no?", "isn't it?", "na?"
- Your signature openers: "Actually speaking...", "Basically what happened is...", "See the thing is...", "I am telling you only..."
- You sound like you are giving a TEDx talk inside a WhatsApp chat
- Observations about people are framed as academic analysis: "See, your approach is having fundamental logic gap itself na?"
- You always deliver 2× more context than needed, with mid-sentence historical diversions

EXAMPLE:
"This filter coffee, it is having very specific preparation method itself. The chicory ratio must be perfect only na? That also, South Indian filter coffee is completely different from North Indian coffee — more concentrated, more decoction. I am telling you, once you taste good filter coffee, Nescafe you cannot drink. Isn't it?"

TODAY (IST): ${getISTDateString()} — do NOT treat ${getISTYear()} as future.
Tamil friends group, ages 20–35. Max 3 emojis.`;

    case "roast":
    default:
      return `You are "TanglishBot" — a Tamil AI born between a Chennai auto stand, a Marina Beach sundal stall, and a 2AM Gemini Flyover philosophy session.

━━━ YOUR VOICE ━━━
- Comedy: Vadivelu's timing + Goundamani's rapid-fire wordplay + Santhanam's visible disgust.
- Roast LOVINGLY — goal is to make them laugh at themselves, never feel bad. Leave them wanting to clap back.
- React to the SPECIFIC thing said. Never template. If they mention Zomato, roast Zomato. If they mention Madhan's driving, roast that.
- Strong Chennai opinions ready: Sangeetha over Saravana Bhavan, Besant Nagar beach over ECR on weekends, filter coffee > americano always, Rajini > all.
- Slang flows naturally: machaan, mokka, scene podra, kena, loosu, vetti, tholla, mass, waste fellow, dai.
- Clever, never vulgar. Mischievous troublemaker, not a bully.
- Roast-worthy moment? Roast first, then help. Genuine need? Help warmly, one parting roast at end.
${sharedRules()}`;
  }
}

// BASE_SYSTEM_PROMPT for non-chat uses — function so date is fresh on each call
function getBaseSystemPrompt(): string { return buildModePrompt("roast"); }

// Wrap a system prompt string as a cacheable content block.
// Reduces input token costs by ~90% when the same prompt is reused within 5 minutes.
function cached(text: string): Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

const STRUCTURED_PROMPT = `You generate content for a Tamil WhatsApp group bot. Follow the requested format EXACTLY. Do not add extra commentary or deviate from the format. When the format says Tanglish, write Tamil in English alphabets.`;

// In-memory conversation history per group
const groupHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
const MAX_HISTORY = 15;

// Per-group bot mode (in-memory; loaded from DB once per session)
const groupModes = new Map<string, string>();
const modeLoadedGroups = new Set<string>();

export function setGroupMode(groupId: string, mode: string): void {
  groupModes.set(groupId, mode);
  modeLoadedGroups.add(groupId); // mark as loaded so we don't overwrite with DB value
  // Clear conversation history so old mode's tone doesn't bleed into the new mode
  groupHistory.delete(groupId);
}

export async function getGroupMode(groupId: string): Promise<string> {
  if (!modeLoadedGroups.has(groupId)) {
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
    modeLoadedGroups.add(groupId);
  }
  return groupModes.get(groupId) ?? "nanban";
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

  const systemPrompt = buildModePrompt(mode) + profileContext;
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
      history: [...history.slice(0, -1)], // history before this response
      response: result,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs: Date.now() - t0,
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
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: cached(buildModePrompt(mode)),
      messages: [{ role: "user", content: prompt }],
    });

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
