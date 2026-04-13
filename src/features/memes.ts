import pkg from "whatsapp-web.js";
const { MessageMedia } = pkg;
import path from "path";
import fs from "fs";

const MEMES_DIR = path.resolve("memes");

// Supported extensions tried in order of preference
const EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];

// Resolves a base name to the actual file path, trying all extensions
function resolveFile(baseName: string): string | null {
  for (const ext of EXTS) {
    const p = path.join(MEMES_DIR, baseName + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

interface MemeConfig {
  base: string;       // filename without extension inside memes/ folder
  tags: string[];     // keywords in bot response OR user message that trigger this
  weight: number;     // higher = picked more often when multiple match
  caption?: string;   // optional caption sent with image
}

// ===== MEME LIBRARY =====
// Drop image files in memes/ — any extension works (.jpg .jpeg .png .webp .avif)
const MEME_LIBRARY: MemeConfig[] = [
  {
    base: "vadivelu_shock",
    tags: ["seriously", "unbelievable", "ipdi", "what", "no way", "pakka wrong", "wrong answer", "incorrect"],
    weight: 4,
  },
  {
    base: "vadivelu_cry",
    tags: ["roast", "destroyed", "burn", "finish", "loser", "kadaikuda", "azhungida"],
    weight: 4,
  },
  {
    base: "vadivelu_laugh",
    tags: ["haha", "funny", "joke", "mokka", "comedy", "irukku"],
    weight: 3,
  },
  {
    base: "goundamani_insult",
    tags: ["loosu", "fool", "kena", "waste fellow", "useless", "paavam", "mokkai", "vetti"],
    weight: 4,
  },
  {
    base: "goundamani_point",
    tags: ["caught", "exposed", "aahaa", "paarunga", "pakkanga", "avan thaan"],
    weight: 3,
  },
  {
    base: "rajini_style",
    tags: ["style", "mass", "boss", "thalaiva", "swag", "legendary", "goat"],
    weight: 2,
  },
  {
    base: "rajini_sunglasses",
    tags: ["correct answer", "right", "winner", "score", "champion", "first place"],
    weight: 2,
  },
  {
    base: "santhanam_disgusted",
    tags: ["terrible", "worst", "disgusting", "pathetic", "bad joke", "cringe", "scene podra"],
    weight: 3,
  },
  {
    base: "vijay_happy",
    tags: ["celebrate", "party", "vandaachu", "nalla iruku", "superb"],
    weight: 2,
  },
  {
    base: "kamal_thinking",
    tags: ["interesting", "enna logic", "explain", "how", "why", "philosophy", "deep"],
    weight: 2,
  },
];

// ===== RATE LIMIT =====
// Max 3 memes per hour to avoid spamming
let memesSentThisHour = 0;
let memeHourKey = "";

function isMemeAllowed(): boolean {
  // IST-aware hour key
  const key = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 13); // "YYYY-MM-DDTHH"
  if (key !== memeHourKey) {
    memesSentThisHour = 0;
    memeHourKey = key;
  }
  return memesSentThisHour < 3;
}

// ===== MEME PICKER =====
// Returns a meme config if the situation calls for one, otherwise null.
// Called after the bot's text response is composed.
export function pickMeme(
  botResponse: string,
  userMessage: string,
  mode: string
): MemeConfig | null {
  if (mode === "nanban") return null; // no memes in warm nanban mode
  if (!isMemeAllowed()) return null;

  const combined = (botResponse + " " + userMessage).toLowerCase();

  // Filter to memes whose file exists (any extension) AND whose tags match
  const matches = MEME_LIBRARY.filter((m) => {
    if (!resolveFile(m.base)) return false;
    return m.tags.some((tag) => combined.includes(tag));
  });

  if (!matches.length) return null;

  // Probability gate: peter gets slightly higher (verbose = more comedic moments)
  const threshold = mode === "peter" ? 0.45 : 0.35;
  if (Math.random() > threshold) return null;

  // Weighted random pick
  const totalWeight = matches.reduce((s, m) => s + m.weight, 0);
  let r = Math.random() * totalWeight;
  for (const m of matches) {
    r -= m.weight;
    if (r <= 0) return m;
  }
  return matches[matches.length - 1]!;
}

// ===== MEME SENDER =====
export async function sendMeme(rawMsg: any, meme: MemeConfig): Promise<void> {
  const filePath = resolveFile(meme.base);
  if (!filePath) return; // file disappeared between pick and send
  const media = MessageMedia.fromFilePath(filePath);
  await rawMsg.reply(media, undefined, meme.caption ? { caption: meme.caption } : undefined);
  memesSentThisHour++;
}
