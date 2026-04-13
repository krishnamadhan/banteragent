import type { BotMessage } from "../types.js";
import { generateContent, generateStructured } from "../claude.js";
import { getAllProfiles } from "./profiles.js";

function getISTToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function randPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ===== MOVIE RECOMMENDATION / INFO =====
export async function handleMovie(args: string, msg: BotMessage): Promise<string> {
  const input = args.trim();

  if (!input) {
    // No args — ask for mood
    return await generateContent(`Recommend ONE Tamil movie with no specific mood — just a great all-rounder.

Format:
🎬 *Movie:* <title> (<year>)
🎭 *Director:* <name> | *Cast:* <lead actors>
⭐ *Rating:* <IMDb or rough fan rating out of 10>
📖 *Plot:* <1 line teaser — no spoilers>
🍿 *Why watch:* <2 lines in Tanglish on what makes it special>
🎯 *Vibe:* <one word or phrase>`);
  }

  // Detect if this looks like a specific movie title vs a mood/genre
  // Heuristics: looks like a movie name if it's a proper-noun-style word (not a generic emotion/genre)
  const moodWords = new Set([
    "action", "comedy", "romance", "romantic", "thriller", "horror", "drama",
    "sad", "happy", "feel good", "feelgood", "fun", "intense", "emotional",
    "emotional", "family", "classic", "old", "new", "recent", "latest",
    "funny", "scary", "inspiring", "motivational", "sad", "cry", "bored",
    "adventure", "suspense", "mystery"
  ]);

  const firstWord = input.split(/\s+/)[0]!.toLowerCase();
  const looksLikeMood = moodWords.has(firstWord) || moodWords.has(input.toLowerCase());

  if (looksLikeMood) {
    const prompt = `Recommend ONE Tamil movie for someone in the mood for: "${input}".

Format:
🎬 *Movie:* <title> (<year>)
🎭 *Director:* <name> | *Cast:* <lead actors>
⭐ *Rating:* <IMDb or rough fan rating out of 10>
📖 *Plot:* <1 line teaser — no spoilers>
🍿 *Why it fits:* <2 lines in Tanglish on why it fits the "${input}" mood>
🎯 *Vibe:* <one word>`;
    return await generateContent(prompt);
  }

  // Treat as a specific movie title lookup
  const today = getISTToday();
  const prompt = `The user asked about the Tamil movie: "${input}". Today's date is ${today}.

Give a movie info card. If you know the movie:
🎬 *Movie:* <exact title> (<release year — if released BEFORE ${today}, state year as released; ONLY say "Upcoming" if it hasn't released yet as of ${today}>)
🎭 *Director:* <name> | *Cast:* <lead actors>
⭐ *Rating:* <IMDb rating out of 10, or "Not yet released" for upcoming films>
📖 *Plot:* <2-line plot without major spoilers>
🍿 *Highlight:* <what makes it special — a scene, dialogue, BGM, performance>
🎤 *Verdict in Tanglish:* <your honest 1-line hot take on the film>

CRITICAL: If the movie released in 2024 or 2025, it has ALREADY been released — do NOT say "Upcoming". Films from before ${today} are released films.
If you genuinely don't know this specific movie, say "Machaan, indha movie en memory-la illai — try !movie <mood> for a recommendation instead."`;

  return await generateContent(prompt);
}

// ===== SHIP — Love compatibility =====
// Score is deterministic so same pair always gets same % (avoids re-rolls for better score)
function shipScore(a: string, b: string): number {
  const combined = [a, b].map((s) => s.toLowerCase().trim()).sort().join("");
  let h = 5381;
  for (let i = 0; i < combined.length; i++) {
    h = ((h << 5) + h + combined.charCodeAt(i)) >>> 0;
  }
  // Map to 30–99 range so extremes aren't too cruel
  return 30 + (h % 70);
}

export async function handleShip(args: string, msg: BotMessage): Promise<string> {
  // Accept "Name1 and Name2" or "Name1 Name2"
  const parts = args.replace(/\band\b/gi, " ").trim().split(/\s+/);
  if (parts.length < 2) {
    return "Yaara ship panrathu? !ship Name1 Name2 — sollu!";
  }
  const name1 = parts[0]!;
  const name2 = parts.slice(1).join(" ");
  const score = shipScore(name1, name2);

  const tier =
    score >= 90 ? "soulmates — destined by the Tamil cosmos itself" :
    score >= 75 ? "solid match — filter coffee and murukku level compatibility" :
    score >= 60 ? "okay pairing — some work needed but not hopeless" :
    score >= 45 ? "chaotic combo — will fight but make up over biryani" :
                  "disaster — but hey, Baasha also had impossible odds";

  const prompt = `Two people named ${name1} and ${name2} got a love compatibility score of ${score}% (${tier}).

Write a short 3-line Tanglish compatibility verdict. Be funny, specific to Tamil life. Reference the score and tier. Don't be mean if low score — make it funny instead.`;

  const commentary = await generateContent(prompt);
  return `💘 *SHIP CALCULATOR*\n\n${name1} ❤️ ${name2}\n\n🔢 Score: *${score}%* — ${tier}\n\n${commentary}`;
}

// ===== DARE =====
const DARE_TYPES = [
  "WhatsApp voice note dare",
  "send a specific embarrassing message in the group",
  "change your WhatsApp status dare",
  "call someone dare",
  "forward something dare",
  "profile pic dare",
];

export async function handleDare(msg: BotMessage): Promise<string> {
  const type = DARE_TYPES[Math.floor(Math.random() * DARE_TYPES.length)]!;
  const prompt = `Generate ONE funny dare for a Tamil WhatsApp group. Type: ${type}.

Rules: doable via WhatsApp, funny, harmless, Tamil/Chennai themed, 2-3 lines in Tanglish.
Start with "🎯 *DARE:*"`;

  return await generateContent(prompt);
}

// ===== DEBATE / HOT TAKE =====
const DEBATE_TOPICS = [
  "Rajini vs Kamal — who is the GOAT of Tamil cinema",
  "Biryani vs Meals — what is the real Tamil food",
  "Chennai vs Coimbatore — which is the better Tamil city",
  "Vijay vs Ajith — who has the better fanbase",
  "AR Rahman vs Ilaiyaraaja — greatest Tamil composer",
  "filter coffee vs tea — the real Tamil morning drink",
  "beach vs mall — the ideal Chennai weekend plan",
  "Mani Ratnam vs Shankar — greatest Tamil director",
  "auto vs Ola/Uber — the real Chennai transport",
  "morning person vs night owl — which is more Tamil",
  "Kamal's acting vs Rajini's screen presence — which matters more",
  "old Kollywood vs new Kollywood — which era was better",
  "vadai vs samosa — the real teatime snack",
  "IPL vs Test cricket — what real fans watch",
];

export async function handleDebate(msg: BotMessage): Promise<string> {
  const topic = DEBATE_TOPICS[Math.floor(Math.random() * DEBATE_TOPICS.length)]!;
  const prompt = `Give a HOT TAKE on: "${topic}" for a Tamil WhatsApp group.

Pick a side. Defend it PASSIONATELY in Tanglish. Be controversial enough to start a debate.
3-4 lines. End with a question directed at the group to get them responding.`;

  const take = await generateContent(prompt);
  return `🔥 *HOT TAKE TIME*\n\nToday's debate: *${topic}*\n\n${take}`;
}

// ===== GOSSIP =====
export async function handleGossip(msg: BotMessage): Promise<string> {
  const profiles = await getAllProfiles(msg.groupId);
  const names = profiles
    .map((p) => p.nickname ?? p.member_name)
    .filter((n) => !n.startsWith("unknown_"))
    .slice(0, 8);

  if (names.length < 2) {
    return "En kita enough people info illa! Group-la irukkavarellam !myinfo type pannattum, appo nalla gossip varum 🗣️";
  }

  const nameList = names.join(", ");
  const prompt = `You are the gossip columnist of a Tamil WhatsApp group. Make up ONE totally fictional, funny, harmless gossip involving these members: ${nameList}.

Rules: 100% made-up and obviously silly, no romantic/affair gossip, Tamil life themes (food, cricket, shopping, family, work, traffic), 3-4 lines in Tanglish.
Start with "🗣️ *Breaking Gossip:*"`;

  return await generateContent(prompt);
}

// ===== MAGIC 8 BALL (no Claude) =====
const EIGHT_BALL = [
  "Ayyo pakka YES da! Go for it 💯",
  "Scene set machaan! Universe approve pannuthu 🔥",
  "100% seri da. Don't second-guess.",
  "Nalla sign irukku. Fortune is on your side 🍀",
  "Absolutely. Like Rajini said — Naan solran, seiran.",
  "Aiyoo illai da 😬 Bad idea. Very bad.",
  "Kena plan bro. Skip and eat biryani instead.",
  "Chance-e illa machaan. Move on already.",
  "Hard no. Even my Chennai auto driver knows better.",
  "Pakka waste. Don't.",
  "Ask again after filter coffee ☕",
  "Universe traffic jam la irukku — unclear now.",
  "Maybe da. Coin toss panni decide pannu.",
  "Signs are mixed like Chennai weather. Try tomorrow.",
  "Intha question-ku answer tharla. Ask differently.",
];

export function handle8Ball(question: string): string {
  if (!question.trim()) return "Enna kelkara nu sollu! !8ball <your question>";
  const response = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)]!;
  return `🎱 *MAGIC 8 BALL*\n\n❓ "${question}"\n\n${response}`;
}

// ===== COIN TOSS (no Claude) =====
export function handleToss(args: string): string {
  const result = Math.random() < 0.5 ? "HEADS" : "TAILS";
  const emoji = result === "HEADS" ? "🪙" : "🪙";
  const tanglish = result === "HEADS"
    ? "Mela irukku! Heads! 🏆"
    : "Kela irukku! Tails! 🎰";
  return `${emoji} *COIN TOSS*\n\n${args.trim() ? `"${args.trim()}" →` : "Result:"} *${tanglish}*`;
}

// ===== BILL SPLITTER (no Claude) =====
export function handleSplit(args: string): string {
  const parts = args.trim().split(/\s+/);
  const amount = parseFloat(parts[0] ?? "");
  const people = parseInt(parts[1] ?? "");

  if (isNaN(amount) || isNaN(people) || people < 2) {
    return "Format: !split <amount> <people>\nExample: !split 1200 4";
  }

  const perHead = (amount / people).toFixed(2);
  const rounded = Math.ceil(amount / people);

  return `💸 *BILL SPLIT*\n\n💰 Total: ₹${amount.toFixed(2)}\n👥 People: ${people}\n\n✅ Per head: *₹${perHead}*\n🔁 Rounded up: ₹${rounded} each\n\n(Total if rounded: ₹${rounded * people} — overshoot by ₹${(rounded * people - amount).toFixed(2)})`;
}

// ===== CHAT SUMMARY / CATCHUP =====
export async function handleSummary(groupId: string): Promise<string> {
  const { getRecentMessages } = await import("../listener.js");
  const msgs = getRecentMessages();

  if (msgs.length < 3) {
    return "Machaan, group-la konjam messages irundha summary tharean! Innum pesu.";
  }

  const prompt = `Here are the last ${msgs.length} messages from a Tamil friends WhatsApp group:

${msgs.join("\n")}

Write a quick Tanglish "missed messages" catchup — 5-7 lines MAX.
- What topics were discussed
- Any drama or debates
- Any funny moments or decisions
- Your own hot take at the end
Style: casual, like a friend briefing you. NOT bullet points — flowing Tanglish.
Start with "📋 *CATCHUP — what you missed:*"`;

  return await generateContent(prompt);
}

// ===== RANK — Opinionated ranking to spark debate =====
export async function handleRank(args: string): Promise<string> {
  if (!args.trim()) return "Enna rank panrathu? !rank Tamil actors by screen presence — try pannu!";
  return await generateContent(
    `Rank the following in Tanglish for a Tamil WhatsApp group: "${args}".
Pick CONTROVERSIAL rankings that will spark debate. Be opinionated and specific.
Format: numbered list, one entry per line, with a punchy 1-line reason each. Max 8 items.
End with: ONE savage hot-take verdict that will get at least 3 people furious.
Start with "📊 *RANKING: ${args}*"`
  );
}

// ===== TRANSLATE — Tamil/Tanglish ↔ English =====
export async function handleTranslate(args: string): Promise<string> {
  if (!args.trim()) return "Enna translate panrathu? !translate <text>\nExample: !translate I will try my best";
  return await generateContent(
    `Translate this accurately:
"${args}"

If it's English → translate to natural conversational Tanglish (Tamil in English letters).
If it's Tanglish/Tamil → translate to natural professional English.
Reply with ONLY the translation on a single line. No labels, no explanation.`
  );
}

// ===== VIBE CHECK — Mood analysis of recent messages =====
export async function handleVibeCheck(): Promise<string> {
  const { getRecentMessages } = await import("../listener.js");
  const msgs = getRecentMessages();
  if (msgs.length < 5) return "Group-la konjam messages irukaanum machaan! Pesa pesa vibe check pannalam.";

  return await generateContent(
    `Analyze the vibe of this Tamil WhatsApp group based on the last ${msgs.length} messages:

${msgs.slice(-20).join("\n")}

Write a "Group Vibe Report" in Tanglish:
- Current mood (one word: Lit / Chill / Tense / Dead / Chaotic / Wholesome / Funny)
- Who's carrying the whole conversation
- What topic has been beaten to death
- Recommendation (needs a quiz? a roast? silence?)
- Your verdict in ONE savage Tanglish line

Start with "🌡️ *VIBE CHECK RESULTS*"`
  );
}

// ===== IMAGINE — AI scenario generator =====
export async function handleImagine(args: string): Promise<string> {
  if (!args.trim()) return "Enna imagine panrathu? !imagine Rajini as a Zomato delivery guy — try pannu!";
  return await generateContent(
    `Tamil WhatsApp group prompt: imagine "${args}".
Write a funny 4-5 line Tanglish scenario. Be vivid, culturally Tamil, make it absurd enough to be funny.
Do NOT start with "Imagine" — jump straight into the scene like it's already happening.`
  );
}

// ===== DIALECT TRANSLATOR — Convert text to Tamil regional dialect =====
const DIALECTS = ["Madurai", "Tirunelveli", "Coimbatore", "Thanjavur", "Iyengar"];

export async function handleDialect(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const matchedDialect = DIALECTS.find((d) => parts[0]?.toLowerCase() === d.toLowerCase());
  const dialect = matchedDialect ?? randPick(DIALECTS);
  const text = matchedDialect ? parts.slice(1).join(" ") : args.trim();

  if (!text) return `Format: !dialect madurai <text>\nOR !dialect <text> (random dialect)\nDialects: ${DIALECTS.join(", ")}`;

  return await generateContent(
    `Phonetically transliterate this into the *${dialect}* Tamil dialect, written in English letters (Tanglish):
"${text}"

Capture exactly how it sounds in ${dialect} dialect — the accent, the unique words, the regional slang.
Format: *Original:* ${text}\n*${dialect}:* [phonetic ${dialect} version]
Keep it authentic and funny — Tamil people from other regions should immediately recognise the dialect.`
  );
}

// ===== ASTRO MATCH — Tamil rasi compatibility =====
export async function handleAstroMatch(args: string): Promise<string> {
  const RASIS = ["Mesham", "Rishabam", "Mithunam", "Kadagam", "Simmam", "Kanni", "Thulam", "Viruchigam", "Dhanusu", "Makaram", "Kumbam", "Meenam"];
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) return `Format: !astro Mesham Simmam\nRasis: ${RASIS.join(", ")}`;

  const rasi1 = parts[0]!;
  const rasi2 = parts.slice(1).join(" ");

  return await generateContent(
    `Vedic Tamil rasi (astrology) compatibility between *${rasi1}* and *${rasi2}*.
Write in Tanglish. Cover: friendship chemistry, work compatibility, and how they argue.
Give a score 1–10 for each: Friendship / Work / Love.
Balance genuine Vedic tradition with modern humor.
End with: "Romba serious-aa eduthukaadheenga — stars just for fun da 😄"
Max 6 lines.`
  );
}

// ===== RECIPE — Tamil recipe on demand =====
export async function handleRecipe(args: string): Promise<string> {
  if (!args.trim()) return "Enna recipe venum? !recipe sambar OR !recipe what to make with brinjal and tomato";
  return await generateContent(
    `Quick Tamil recipe for: "${args}". Write in Tanglish.

Format:
🍛 *[DISH NAME]*

*Ingredients:*
• [quick bullet list]

*Steps (simple, 3–5):*
1. [step]

💡 *Paati tip:* [one authentic Tamil cooking secret]

Keep it practical — someone who can't cook should be able to follow this.`
  );
}

// ===== TRAILER — Movie trailer reaction =====
export async function handleTrailer(args: string): Promise<string> {
  if (!args.trim()) return "Enna movie? !trailer Coolie — try pannu!";
  return await generateContent(
    `React to the Tamil movie "${args}" like an excited Tamil fan who JUST watched the trailer/teaser.
Tanglish, 4–5 lines. Mix genuine hype with one honest observation.
Use natural phrases: "machaan", "namba", "scene-e vera level", "paatha unna pethavan".
Skip "Here's my reaction" intros — jump straight into it.`
  );
}

// ===== CHARACTER SORTER — Assign movie characters to group members =====
export async function handleCharacterSorter(args: string, msg: BotMessage): Promise<string> {
  const movie = args.trim();
  if (!movie) return "Enna movie? !character Baasha — try pannu!";

  const profiles = await getAllProfiles(msg.groupId);
  const members = profiles
    .filter((p) => !p.member_phone.startsWith("unknown_"))
    .map((p) => {
      const info = [p.nickname ?? p.member_name];
      if (p.occupation) info.push(p.occupation);
      if (p.zodiac_sign) info.push(p.zodiac_sign);
      return info.join(" / ");
    })
    .slice(0, 8);

  if (members.length < 2) return "Need konjam more members with profiles! !myinfo pannu first.";

  return await generateContent(
    `Assign characters from the Tamil movie "${movie}" to these group members based on their personality:
${members.join("\n")}

Rules:
- Match personality/job/zodiac hints to character traits where possible
- Be funny and specific about WHY each person = that character
- Format: *[Name]* = [Character Name] — [1-line funny reason]
- End with: who got robbed with their character and who got the best one
Tanglish throughout. Max 10 lines.`
  );
}

// ===== ROAST BATTLE — Claude-narrated roast battle between two people =====
export async function handleRoastBattle(args: string): Promise<string> {
  const vsMatch = args.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  const parts = args.trim().split(/\s+/);
  let personA: string, personB: string;

  if (vsMatch) {
    personA = vsMatch[1]!.trim();
    personB = vsMatch[2]!.trim();
  } else if (parts.length >= 2) {
    personA = parts[0]!;
    personB = parts.slice(1).join(" ");
  } else {
    return "Format: !roastbattle Hari vs Siva\nExample: !roastbattle Krishna vs Madhu";
  }

  return await generateContent(
    `Generate an epic Tamil-style roast battle between *${personA}* and *${personB}* for a Tamil WhatsApp group.

🥊 *ROAST BATTLE: ${personA} vs ${personB}*

Round 1 — ${personA} fires:
[2-line savage Tanglish roast of ${personB} — specific, creative, loving not cruel]

Round 2 — ${personB} fires BACK:
[2-line Tanglish comeback — must be more creative than Round 1]

🏆 *WINNER: [pick one] — [one funny reason why they won]*

Keep it in the spirit of Tamil cinema roast culture — the goal is to make both people laugh at themselves.`
  );
}

// ===== COUNTDOWN — In-memory event countdown =====
interface Countdown { groupId: string; name: string; targetDate: Date; createdBy: string; }
const countdowns: Countdown[] = [];

export function handleCountdown(args: string, msg: BotMessage): string {
  const trimmed = args.trim();
  const subCmd = trimmed.split(/\s+/)[0]?.toLowerCase();

  // List active countdowns
  if (!trimmed || subCmd === "list") {
    const now = new Date();
    const active = countdowns.filter((c) => c.groupId === msg.groupId && c.targetDate > now);
    if (!active.length) return "No active countdowns! Create one:\n!countdown create IPL Final 2025-05-25";

    let resp = "⏳ *ACTIVE COUNTDOWNS*\n\n";
    for (const cd of active) {
      const diff = cd.targetDate.getTime() - now.getTime();
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      resp += `🎯 *${cd.name}* — ${days}d ${hours}h remaining\n`;
    }
    return resp.trim();
  }

  // Create countdown
  if (subCmd === "create") {
    const rest = trimmed.replace(/^create\s+/i, "").trim();
    const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2})$/);
    if (!dateMatch) return "Format: !countdown create <event name> YYYY-MM-DD\nExample: !countdown create Coolie Release 2026-07-25";

    const name = rest.slice(0, rest.lastIndexOf(dateMatch[0]!)).trim();
    const targetDate = new Date(dateMatch[1]!);
    if (isNaN(targetDate.getTime())) return "Invalid date! Use YYYY-MM-DD format.";
    if (targetDate < new Date()) return "That date is already past da! Pick a future date.";
    if (!name) return "Event name venum! !countdown create <name> <date>";

    countdowns.push({ groupId: msg.groupId, name, targetDate, createdBy: msg.senderName });
    const days = Math.floor((targetDate.getTime() - Date.now()) / 86400000);
    return `✅ Countdown created!\n\n🎯 *${name}*\n📅 ${targetDate.toDateString()}\n⏳ ${days} days to go!`;
  }

  return "!countdown — list all\n!countdown create <name> YYYY-MM-DD — create new";
}

// ===== BIRTHDAY WISH (used by scheduler) =====
export async function generateBirthdayWish(name: string, zodiac?: string | null): Promise<string> {
  const zodiacLine = zodiac ? ` They are a ${zodiac}.` : "";
  const prompt = `Write a warm, funny birthday wish in Tanglish for ${name} who is in a Tamil friends group.${zodiacLine} Make it personal, celebratory and heartfelt. Max 4 lines. Start with their name. Add one Tamil birthday blessing.`;
  return await generateContent(prompt);
}

// ===== WORD OF THE DAY (used by scheduler) =====
export async function generateWordOfDay(): Promise<string> {
  const categories = [
    "everyday Chennai slang", "classic Tamil cinema dialogue words",
    "Tamil food words", "Tamil emotion words", "Tamil relationship words",
  ];
  const cat = categories[Math.floor(Math.random() * categories.length)]!;

  const prompt = `Generate a Tamil Word of the Day from the category: ${cat}.

Format EXACTLY (no extra text):
WORD: <Tamil word in English alphabets>
MEANING: <English meaning>
USAGE: <a funny Tanglish example sentence>
FUN_FACT: <interesting origin or cultural note in Tanglish, 1 line>`;

  const content = await generateStructured(prompt);

  const word    = content.match(/WORD:\s*(.+)/)?.[1]?.trim();
  const meaning = content.match(/MEANING:\s*(.+)/)?.[1]?.trim();
  const usage   = content.match(/USAGE:\s*(.+)/)?.[1]?.trim();
  const fact    = content.match(/FUN_FACT:\s*(.+)/)?.[1]?.trim();

  if (!word || !meaning) return "";

  let msg = `📚 *WORD OF THE DAY*\n\n🔤 *${word}*\n📖 ${meaning}`;
  if (usage) msg += `\n💬 "${usage}"`;
  if (fact) msg += `\n💡 ${fact}`;
  return msg;
}
