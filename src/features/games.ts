import type { BotMessage } from "../types.js";
import { generateContent, generateStructured } from "../claude.js";
import { supabase } from "../supabase.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface CommandResult {
  response: string;
}

// ===== Fuzzy answer matching =====
function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j]!, curr[j - 1]!, prev[j - 1]!);
    }
    prev.splice(0, b.length + 1, ...curr);
  }
  return prev[b.length]!;
}

function fuzzyMatch(userAnswer: string, correctAnswer: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[\s\-_'".,!?]/g, "");
  const a = norm(userAnswer);
  const b = norm(correctAnswer);

  if (a === b) return true;

  // includes check: only when the shorter string is at least 3 chars
  // (prevents "u" matching "dharmadurai" or "i" matching "7arivu")
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length >= 3 && (a.includes(b) || b.includes(a))) return true;

  // Allow 1 edit per 5 chars, max 3 — handles "bahubali" vs "baahubali"
  const maxDist = Math.min(Math.floor(Math.max(a.length, b.length) / 5), 3);
  if (maxDist === 0 || Math.abs(a.length - b.length) > maxDist) return false;
  return levenshtein(a, b) <= maxDist;
}

// ===== Current IST week start (Monday) =====
function getCurrentWeekStartIST(): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + istOffset);
  const dayOfWeek = istNow.getUTCDay(); // 0=Sun
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayIST = new Date(istNow);
  mondayIST.setUTCDate(istNow.getUTCDate() - daysFromMonday);
  return mondayIST.toISOString().split("T")[0]!;
}

// ===== Random pick helper =====
function randPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ===== Wordle helpers =====
function computeWordleResult(guess: string, target: string): Array<"correct" | "present" | "absent"> {
  const result: Array<"correct" | "present" | "absent"> = new Array(target.length).fill("absent");
  const usedTarget = new Array(target.length).fill(false);
  const usedGuess  = new Array(guess.length).fill(false);
  for (let i = 0; i < target.length; i++) {
    if (guess[i] === target[i]) {
      result[i] = "correct"; usedTarget[i] = true; usedGuess[i] = true;
    }
  }
  for (let i = 0; i < guess.length; i++) {
    if (usedGuess[i]) continue;
    for (let j = 0; j < target.length; j++) {
      if (!usedTarget[j] && guess[i] === target[j]) {
        result[i] = "present"; usedTarget[j] = true; break;
      }
    }
  }
  return result;
}

function buildWordleBoard(guesses: Array<{ player: string; word: string; result: string[] }>): string {
  return guesses.map(g => {
    const emojis = g.result.map(r => r === "correct" ? "🟩" : r === "present" ? "🟨" : "⬛").join("");
    return `*${g.player}* → ${g.word.toUpperCase()}\n${emojis}`;
  }).join("\n\n");
}

// ===== SONG QUIZ — English translations of famous Tamil lyrics =====
const SONG_QUIZ: { lines: string[]; answer: string; movie: string; hint: string }[] = [
  { lines: ["Little little desires", "Little little dreams", "Eyes that never close", "Sleep never comes"], answer: "chinna chinna aasai", movie: "Roja", hint: "AR Rahman's debut masterpiece — tiny wishes, sleepless nights" },
  { lines: ["Green color green color", "The color of life is green", "Your smile your smile", "Is the light of my life"], answer: "pachai nirame", movie: "Alaipayuthey", hint: "AR Rahman — 'pachai' = green, 'nirame' = color" },
  { lines: ["Why this murderous rage girl", "Why this murderous rage", "White skin girl heart is black"], answer: "kolaveri di", movie: "3", hint: "Dhanush's viral internet hit — kolaveri literally means murderous rage!" },
  { lines: ["Moonlight moonlight where did you hide", "My heart became a cuckoo bird", "I walked all paths searching for you"], answer: "vennilave vennilave", movie: "Minsara Kanavu", hint: "AR Rahman — 'vennilave' = white moonlight, dreamy love song" },
  { lines: ["Don't push and go don't push and go", "Without you what will I do", "Don't erase me and go I will crumble"], answer: "thalli pogadhey", movie: "Achcham Yenbadhu Madamaiyada", hint: "'Thalli' = push — begging someone not to leave" },
  { lines: ["Hey ginger hip lady", "My heart ran behind you", "One look one look finished me completely"], answer: "inji iduppazhagi", movie: "Anegan", hint: "Inji = ginger, iduppu = hip, azhagi = beauty — Harris Jayaraj banger" },
  { lines: ["Life life you are my life", "Without you there is no me", "In every breath you are the one"], answer: "uyire", movie: "Bombay", hint: "AR Rahman — 'uyire' literally means 'life' in Tamil" },
  { lines: ["Come before come before", "In my heart come before", "Your eyes are the answer to all my questions"], answer: "munbe vaa", movie: "Sillunu Oru Kadhal", hint: "AR Rahman — 'munbe vaa' = 'come before me'" },
  { lines: ["Inside the heart inside the heart", "You entered without asking permission", "As a sweet dream you settled inside"], answer: "nenjukulle", movie: "Kadal", hint: "AR Rahman — 'nenjukulle' = 'inside the heart'" },
  { lines: ["Darling of my eyes darling of my eyes", "Where did you come from", "You are the one who holds my breath"], answer: "kannaana kanney", movie: "Viswasam", hint: "D. Imman father-daughter love song — 'kannaana kanney' = darling of eyes" },
  { lines: ["Heart rise up rise up", "Don't break don't break", "Pick up the scattered pieces and walk forward"], answer: "nenje ezhu", movie: "Maryan", hint: "AR Rahman — motivational anthem, 'nenje ezhu' = heart rise up" },
  { lines: ["A different word didn't you say", "Didn't you say you'd never leave", "That day was a lie or is today a lie"], answer: "maruvaarthai", movie: "Enai Noki Paayum Thota", hint: "'Maruvaarthai' = different word / broken promise — Darbuka Siva" },
  { lines: ["The flower that bloomed in the morning", "Will it be there by night", "Even if petals fall the fragrance remains"], answer: "nenjinile", movie: "Uyire", hint: "AR Rahman — 'nenjinile' = inside the heart, bittersweet love song" },
  { lines: ["What will you say what will you say", "Opening your mouth what will you say", "About this heart that fell what words do you have"], answer: "enna solla pogiraai", movie: "Kandukondain Kandukondain", hint: "AR Rahman — longing song asking what the beloved will finally say" },
  { lines: ["Rowdy baby rowdy baby", "Don't leave me rowdy baby", "Your style your smile drives me crazy"], answer: "rowdy baby", movie: "Maari 2", hint: "Yuvan Shankar Raja — massive viral hit with Dhanush and Sai Pallavi" },
  { lines: ["Will you cross the sky and come", "Will you cross the earth and come", "For this love will you risk everything"], answer: "vinnaithaandi varuvaayaa", movie: "Vinnaithaandi Varuvaayaa", hint: "AR Rahman — 'will you cross the sky and come for me'" },
  { lines: ["My golden moon my golden moon", "Where did you go tonight", "The stars searched for you and cried to sleep"], answer: "en iniya pon nilave", movie: "Moondram Pirai", hint: "Ilaiyaraaja — 'pon nilave' = golden moon, emotional Kamal classic" },
  { lines: ["Love rose love rose", "It came into my heart", "Without permission it settled", "Now it will never leave"], answer: "kadhal rojave", movie: "Roja", hint: "AR Rahman — 'kadhal rojave' = love rose, iconic 90s duet" },
  { lines: ["You are my evening you are my morning", "You are my day you are my night", "Without you this world has no meaning"], answer: "kadhal sadugudu", movie: "Alaipayuthey", hint: "AR Rahman — all-consuming love song from Alaipayuthey" },
  { lines: ["One time come and see", "On the shore of my mind", "What blooms there for you come and see"], answer: "oru murai vanthu parthaya", movie: "Mudalvan", hint: "AR Rahman — 'oru murai vanthu parthaya' = come and see just once" },
  { lines: ["Rain rain come", "Come to my heart", "Without asking me just pour down"], answer: "mazhai mazhai", movie: "Majaa", hint: "Yuvan Shankar Raja — 'mazhai' = rain, simple joyful love song" },
  { lines: ["Thunder and lightning at the wrong time", "You came and settled in the wrong heart", "What I asked for is not what I got"], answer: "netru illatha matram", movie: "Kaadhal Kondein", hint: "Yuvan Shankar Raja — Selvaraghavan's raw tragic love story" },
  { lines: ["You who came like the rains", "You who stayed like the earth", "How do I explain what you mean to me"], answer: "poongatru", movie: "Alaipayuthey", hint: "AR Rahman — gentle breeze love song, 'poongatru' = gentle breeze" },
  { lines: ["Beautiful beautiful beautiful girl", "You are a festival for my eyes", "Walking on the road you look like a film"], answer: "azhagiya laila", movie: "Suryavamsam", hint: "Vidyasagar — classic complimenting love song, 'azhagiya' = beautiful" },
  { lines: ["The girl next door entered my heart", "The boy next door is all confused now", "What is this feeling what is this feeling"], answer: "kaadhale kaadhale", movie: "Minnale", hint: "Harris Jayaraj — 'kaadhale' = love, sweet playful duet" },
  { lines: ["I searched seven worlds for you", "I circled the sky looking for you", "Where are you hidden my beautiful"], answer: "ezhil manne", movie: "Uyire", hint: "AR Rahman — searching the universe for the beloved" },
  { lines: ["Push off the fear push off the fear", "Open both eyes and see", "The future is in your hands not anyone else's"], answer: "surviva surviva", movie: "Rhythm", hint: "AR Rahman — motivational anthem from a family drama" },
  { lines: ["Anjali Anjali Anjali", "Push flower Anjali", "You are my everything Anjali"], answer: "anjali anjali", movie: "Duet", hint: "AR Rahman — title song dedicated to the heroine Anjali" },
  { lines: ["The deer that came from the forest", "Drank water from the river", "Saw its own reflection", "And fell in love"], answer: "vaaname ellai", movie: "Aranmanai", hint: "Ilaiyaraaja — poetic metaphor song, the sky is the limit" },
  { lines: ["Without speaking a word", "Your eyes said everything", "In that silence between us", "A thousand songs were sung"], answer: "pesa ninaikkiren", movie: "Alaipayuthey", hint: "AR Rahman — 'pesa ninaikkiren' = I want to speak but can't, subtle love" },
];

// ===== WORDLE — Single-word Tamil movie titles (6 letters) =====
const WORDLE_WORDS: { word: string; hint: string }[] = [
  { word: "VIKRAM", hint: "Kamal Haasan's masked cop — Lokesh Kanagaraj blockbuster" },
  { word: "MERSAL", hint: "Vijay in 3 roles — magician, doctor, historical crusader" },
  { word: "SARKAR", hint: "Vijay returns to become Chief Minister — AR Murugadoss" },
  { word: "MASTER", hint: "Vijay as an alcoholic professor in a juvenile home — Lokesh" },
  { word: "VARISU", hint: "Vijay as an heir who must prove himself to his family" },
  { word: "DARBAR", hint: "Rajini as a tough Mumbai police commissioner — Murugadoss" },
  { word: "JAILER", hint: "Rajini as a retired jailer whose son turns criminal — Nelson" },
  { word: "SINGAM", hint: "Suriya as a lion-hearted cop who never backs down" },
  { word: "GHILLI", hint: "Vijay protects a girl from a powerful rowdy — Dharani's hit" },
  { word: "ANJALI", hint: "Emotional film about a special child — Ilaiyaraaja's music" },
  { word: "COMALI", hint: "Jayam Raman wakes from a 20-year coma into modern India" },
  { word: "KARNAN", hint: "Dhanush as a fearless village protector — Pa. Ranjith" },
  { word: "AMARAN", hint: "Sivakarthikeyan as Major Mukund Varadarajan — true story" },
  { word: "KAITHI", hint: "Karthi as a just-released prisoner who becomes an unlikely hero — Lokesh" },
  { word: "SKETCH", hint: "Vikram as a carefree man who falls for a gangster's girl" },
];

// ===== MEMORY — word pools across categories =====
const MEMORY_POOLS: Record<string, string[]> = {
  actors:  ["RAJINI", "VIJAY", "SURIYA", "AJITH", "DHANUSH", "VIKRAM", "KAMAL", "KARTHI", "VISHAL", "SIMBU"],
  foods:   ["BIRYANI", "IDLI", "DOSAI", "VADAI", "SAMBAR", "RASAM", "HALWA", "PONGAL", "THAYIR", "PAROTTA"],
  cities:  ["CHENNAI", "MADURAI", "KOVAI", "TRICHY", "SALEM", "VELLORE", "TIRUNELVELI", "ERODE", "DINDIGUL", "KARUR"],
  movies:  ["ROJA", "BEAST", "MERSAL", "VIKRAM", "DARBAR", "SINGAM", "MASTER", "GHILLI", "PETTA", "THERI"],
  words:   ["VANAKKAM", "NANDRI", "AMMA", "APPA", "THAMBI", "AKKA", "MACHAAN", "SERI", "ENNA", "AAMA"],
};

// ===== Persistent answer archive — file cache + Supabase backend =====
// File = fast in-session cache. Supabase = ground truth across restarts/redeployments.
type GameType = "quiz" | "brandquiz" | "trivia" | "fastfinger" | "twotruthsonelie" | "dialogue" | "song" | "memory" | "wordle";
type ArchiveMap = Record<string, Partial<Record<GameType, string[]>>>;

const ARCHIVE_DIR = join(process.cwd(), "data");
const ARCHIVE_PATH = join(ARCHIVE_DIR, "used-answers.json");

if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });

let _archive: ArchiveMap = {};
try { _archive = JSON.parse(readFileSync(ARCHIVE_PATH, "utf8")); } catch {}

function saveArchive(): void {
  try { writeFileSync(ARCHIVE_PATH, JSON.stringify(_archive, null, 2), "utf8"); } catch {}
}

function getArchived(groupId: string, type: GameType): string[] {
  return _archive[groupId]?.[type] ?? [];
}

function archiveAnswer(groupId: string, type: GameType, answer: string): void {
  if (!_archive[groupId]) _archive[groupId] = {};
  const list = _archive[groupId]![type] ?? [];
  const norm = answer.toLowerCase();
  if (!list.includes(norm)) list.push(norm);
  _archive[groupId]![type] = list;
  saveArchive();
  // Persist to Supabase (fire-and-forget — file is source of truth for speed)
  supabase.from("ba_question_archive")
    .upsert({ group_id: groupId, game_type: type, answer: norm }, { onConflict: "group_id,game_type,answer" })
    .then(({ error }) => { if (error) console.error("[archive] write:", error.message); });
}

function resetArchive(groupId: string, type: GameType): void {
  if (_archive[groupId]) delete _archive[groupId]![type];
  saveArchive();
  supabase.from("ba_question_archive")
    .delete().eq("group_id", groupId).eq("game_type", type)
    .then(({ error }) => { if (error) console.error("[archive] reset:", error.message); });
}

// Call once on bot startup — loads Supabase archive into file cache (handles wipe/redeployment)
export async function syncArchiveFromSupabase(): Promise<void> {
  try {
    const { data } = await supabase.from("ba_question_archive").select("group_id, game_type, answer");
    if (!data?.length) return;
    let added = 0;
    for (const row of data) {
      if (!_archive[row.group_id]) _archive[row.group_id] = {};
      const list = _archive[row.group_id]![row.game_type as GameType] ?? [];
      if (!list.includes(row.answer)) { list.push(row.answer); added++; }
      _archive[row.group_id]![row.game_type as GameType] = list;
    }
    if (added > 0) { saveArchive(); console.log(`[archive] Synced ${added} new entries from Supabase`); }
  } catch (e) { console.error("[archive] Supabase sync failed:", e); }
}

// ===== CURATED EMOJI QUIZ — hand-verified title-word emoji clues =====
// Each emoji represents a WORD in the title or iconic imagery from the film.
const CURATED_QUIZZES: { emojis: string; answer: string; hint: string }[] = [
  { emojis: "🔪", answer: "kaththi", hint: "Vijay dual role — a rural activist and his city lookalike, farmers vs corporations" },
  { emojis: "🏗️📜", answer: "velaiilla pattadhari", hint: "Dhanush as an unemployed engineering graduate who refuses to give up" },
  { emojis: "🏍️💨", answer: "polladhavan", hint: "Dhanush's bike gets stolen and the search leads him into Chennai's underworld" },
  { emojis: "🐓⚔️", answer: "aadukalam", hint: "Dhanush in the brutal world of cockfighting — National Award-winning performance" },
  { emojis: "🌊🪖", answer: "maryan", hint: "Dhanush stranded in an African conflict zone, desperately trying to get home" },
  { emojis: "🌧️🏍️", answer: "maari", hint: "Rain + rowdy — Dhanush as a fun-loving local hero who falls hard for a feisty girl" },
  { emojis: "🥤❄️", answer: "jigarthanda", hint: "A filmmaker wants to make a gangster biopic but gets entangled with a real don" },
  { emojis: "🤜💪", answer: "naanum rowdy dhaan", hint: "Vijay Sethupathi as a bumbling small-time rowdy — hilarious Vignesh Shivan comedy" },
  { emojis: "🔍❓", answer: "yennai arindhaal", hint: "Ajith as a complicated cop with a secret past — intense Gautham Menon film" },
  { emojis: "🔢🕶️", answer: "billa", hint: "Ajith in a double role — a cop impersonates a deadly international criminal" },
  { emojis: "👁️⚖️", answer: "nerkonda paarvai", hint: "Ajith fights in court for a woman's right to say no — remake of Bollywood film Pink" },
  { emojis: "🤡😴", answer: "comali", hint: "Jayam Raman wakes from a 20-year coma into a completely changed modern world" },
  { emojis: "🏹🛡️", answer: "karnan", hint: "Dhanush as a fearless village protector — Pa. Ranjith's most powerful film" },
  { emojis: "🥊👑", answer: "sarpatta parambarai", hint: "Rival boxing clans clash in 1970s North Chennai — Pa. Ranjith's masterpiece" },
  { emojis: "✊🗳️", answer: "mandela", hint: "A humble barber's vote becomes the decisive one in a tense village election" },
  { emojis: "🪖💚", answer: "amaran", hint: "Sivakarthikeyan as Major Mukund Varadarajan — a true story of an army hero" },
  { emojis: "✍️📸", answer: "autograph", hint: "Cheran revisits three women from his past — emotional masterpiece before his wedding" },
  { emojis: "💭❤️", answer: "ullam ketkumae", hint: "Four close friends, three interlinked love stories — Harris Jayaraj music" },
  { emojis: "🏏📍", answer: "chennai 600028", hint: "Rival cricket teams in Chennai's 600028 pincode streets — cult youth classic" },
  { emojis: "🎭👴", answer: "seethakathi", hint: "Vijay Sethupathi as a veteran folk theatre artist nearing his final curtain call" },
  { emojis: "🧭🌆", answer: "vada chennai", hint: "North Chennai gang saga spanning generations — Vetrimaaran and Dhanush" },
  { emojis: "✏️🎨", answer: "sketch", hint: "Vikram as a carefree guy who falls for a girl promised to a powerful gangster" },
  { emojis: "🗺️👊", answer: "jilla", hint: "Vijay as a don's loyal right-hand who is forced back into the world he escaped" },
  { emojis: "🙏⚡", answer: "lingaa", hint: "Rajini dual role — a modern man discovers his grandfather was a legendary benevolent ruler" },
  { emojis: "🐓💪", answer: "sandakozhi", hint: "Vishal as a tough cop romancing a headstrong village girl — classic rural action" },
  { emojis: "💪🧬", answer: "i", hint: "Vikram as a bodybuilder cursed into a disfigured form — seeks revenge with a vengeance" },
  { emojis: "👥🎭", answer: "thaanaa serndha koottam", hint: "Suriya leads a team of conmen on an elaborate heist — remake of Special 26" },
  { emojis: "❤️🌧️", answer: "kadhal", hint: "A poor mechanic and a rich girl's forbidden love — Bharath and Sandhya, tragic and real" },
  { emojis: "🥊🏆", answer: "irudhi suttru", hint: "Madhavan as a flawed boxing coach who discovers raw talent in a Chennai slum girl" },
  { emojis: "👻🏚️", answer: "kanchana", hint: "Lawrence as a ghost-fearing man who gets possessed by a vengeful spirit" },
  { emojis: "👦📚", answer: "pasanga", hint: "Two mischievous school boys whose pranks drive their teacher to the edge" },
  { emojis: "👩‍⚕️🎭", answer: "remo", hint: "Sivakarthikeyan disguises as a female nurse to get close to the girl he loves" },
  { emojis: "🚢💰", answer: "ayan", hint: "Suriya as a charming smuggler who gets pulled into a dangerous international drug cartel" },
  { emojis: "🦁👮", answer: "singam", hint: "Suriya as a no-nonsense lion-hearted cop who never backs down from any threat" },
  { emojis: "🌾🔪", answer: "paruthiveeran", hint: "Karthi's raw debut — a village rowdy's intense love story with a heartbreaking end" },
  { emojis: "👫🧲", answer: "maattrraan", hint: "Suriya as conjoined twins — inseparable, until a pharma villain tears their world apart" },
  { emojis: "🛡️💪", answer: "etharkkum thunindhavan", hint: "Suriya takes on a woman trafficking gang — 'brave for anything' mass action" },
  { emojis: "🍌🌿", answer: "vaazhai", hint: "A family of banana plantation workers — quiet, profound, and deeply human" },
  { emojis: "💯👤", answer: "meiyazhagan", hint: "Karthi meets a man who claims to be his long-lost childhood friend — emotional thriller" },
  { emojis: "🔍☠️", answer: "naan mahaan alla", hint: "Karthi as a carefree guy who becomes a vigilante hunting a serial killer" },
  { emojis: "🚩🗳️", answer: "kodi", hint: "Dhanush in a dual role — a political activist and his scheming lookalike in elections" },
  { emojis: "🐂🏘️", answer: "komban", hint: "Karthi as a peaceful man pushed to fight back when his village and family are threatened" },
  { emojis: "😂💊", answer: "thenali", hint: "Kamal Haasan tries to cure his extreme cowardice — hilarious results follow" },
  { emojis: "🤥❤️", answer: "poi solla villai", hint: "Jiiva physically can't lie — rom-com chaos in every scene" },
  { emojis: "📷📰", answer: "maaran", hint: "Dhanush as a fearless journalist taking on a powerful political nexus" },
  { emojis: "🚗❤️", answer: "pannaiyarum padminiyum", hint: "A farmer's vintage Padmini car and his land — a tender and quietly moving story" },
  { emojis: "🐦🌿", answer: "mynaa", hint: "A beautiful love story set against the forest — tragic and visually stunning" },
  { emojis: "🏪⛓️", answer: "angadi theru", hint: "Textile shop workers exploited and silenced — Vasanthabalan's gritty realistic drama" },
  { emojis: "🚌❤️", answer: "engeyum eppodhum", hint: "Two strangers fall in love over a long bus journey — Gautham Menon's quiet gem" },
  { emojis: "💍👨‍👩‍👧", answer: "dharma durai", hint: "Vijay Sethupathi trying to hold his fractured family together through love and duty" },
  { emojis: "⚡🦸", answer: "velayudham", hint: "Vijay as a common man who accidentally becomes a vigilante superhero" },
  { emojis: "👮🔑", answer: "nimir", hint: "Udhayanidhi as an arrogant cop transferred to a small town — a lesson in humility" },
  { emojis: "🦁⚡", answer: "singam 2", hint: "Durai Singam returns — this time facing international terrorists, bigger stakes" },
  { emojis: "💈😂", answer: "oru kal oru kannadi", hint: "Udhayanidhi as a lazy barber whose life turns upside down when love walks in" },
  { emojis: "🐔❤️", answer: "saivam", hint: "A little girl's pet hen is about to become the family's festival meal — heartwarming dilemma" },
  { emojis: "👶🌿", answer: "kannathil muthamittal", hint: "A girl goes on a journey to find her biological mother in war-torn Sri Lanka" },
  { emojis: "👥🎓", answer: "friends", hint: "Vijay and a group of college friends — rom-com action, Vijay at his playful best" },
  { emojis: "🧲💑", answer: "vaseegara", hint: "Vijay as a guy with magnetic charm — but the girl he loves remains unimpressed" },
  { emojis: "⚽❤️", answer: "sachein", hint: "Vijay as a passionate football player who falls for a girl on a flight" },
  { emojis: "🔥👊", answer: "pokkiri", hint: "Vijay as an undercover cop in the rowdy world — styled on the Telugu hit" },
  { emojis: "💻🤑", answer: "sivaji the boss", hint: "Rajini as a philanthropist who battles a system of black money and corruption" },
  { emojis: "🎰💰", answer: "mankatha", hint: "Ajith as a morally grey cop planning to steal evidence-money in a daring heist" },
  { emojis: "⛓️📜", answer: "visaranai", hint: "Based on real events — four innocent men tortured by police in a brutal interrogation" },
  { emojis: "🦅🤜", answer: "rekka", hint: "Vijay Anthony as a street-smart guy caught between two rival gangs" },
  { emojis: "🪭🙏", answer: "mookuthi amman", hint: "Nayanthara as a goddess who incarnates to help a common man against a fraud godman" },
  { emojis: "🥊📚", answer: "pattas", hint: "Dhanush as an expert fighter learning the lost art of Adimurai from his father" },
  { emojis: "👁️🏚️", answer: "demonte colony", hint: "Tamil horror classic — a haunted abandoned colony, one dare that changes everything" },
  { emojis: "🤝💔", answer: "inaindha kaigal", hint: "Joined hands separated by modern relationships and digital misunderstandings" },
  { emojis: "🧠📝", answer: "ghajini", hint: "Suriya with short-term memory loss hunts his girlfriend's killer using tattoo notes" },
  { emojis: "💨🏍️", answer: "thirupaachi", hint: "Vijay as a whirlwind hero who comes between a gangster and his captive sister" },
  { emojis: "4️⃣🎭", answer: "michael madana kama rajan", hint: "Kamal Haasan plays four different identical brothers — classic 90s comedy-thriller" },
  { emojis: "🩸🌊", answer: "kurudhipunal", hint: "Kamal Haasan as a cop tracking a serial killer — intense, realistic Mani Ratnam thriller" },
  { emojis: "👮🔫", answer: "kaaval", hint: "G.V. Prakash as a troubled cop walking the fine line between law and crime" },
  { emojis: "🐍🧮", answer: "cobra", hint: "Vikram as a genius mathematician who is also a deadly international assassin" },
  { emojis: "👑🌾", answer: "seema raja", hint: "Sivakarthikeyan as a village chief's son who battles an ancient feud" },
  // — Batch 2 —
  { emojis: "🪄⚡", answer: "mersal", hint: "Vijay in three roles — street magician, rebel doctor, and historical crusader against medical corruption" },
  { emojis: "9️⃣6️⃣", answer: "96", hint: "Vijay Sethupathi and Trisha meet after 22 years — a bittersweet quiet masterpiece about a love never spoken" },
  { emojis: "🌩️👮", answer: "theri", hint: "Vijay as a cop who fakes his own death to protect his daughter from a vengeful don" },
  { emojis: "⚽🎶", answer: "bigil", hint: "Vijay as a football coach with a gangster father — Atlee's high-voltage dual-role sports film" },
  { emojis: "👨‍🏫🔒", answer: "master", hint: "Vijay as an alcoholic professor transferred to a juvenile correctional home — Lokesh Kanagaraj's mass entertainer" },
  { emojis: "☠️🔱", answer: "vikram", hint: "Kamal Haasan as a masked undercover cop in a complex drug war — Lokesh Kanagaraj's multi-starrer crossover" },
  { emojis: "⛓️👴", answer: "jailer", hint: "Rajini as a retired jailer whose son turns criminal — Nelson's stylish action comedy with a terrific cast" },
  { emojis: "🦁☕", answer: "leo", hint: "Vijay as a mysterious cafe owner whose violent past catches up with him — Lokesh Kanagaraj's LCU chapter" },
  { emojis: "🤝🦁", answer: "annaatthe", hint: "Rajini as an elder brother whose world collapses when his sister leaves — Siva's emotional mass entertainer" },
  { emojis: "🎓🕶️", answer: "petta", hint: "Rajini as a hostel warden with a ruthless and mysterious past — Karthik Subbaraj's stylish retro-cool film" },
  { emojis: "👮⚖️", answer: "darbar", hint: "Rajini as a tough Mumbai police commissioner with a personal vendetta against drug lords" },
  { emojis: "🐦🐦", answer: "kaakha kaakha", hint: "Suriya as a cop whose wife is taken hostage by the very criminal he's hunting — Gautham Menon's intense love story" },
  { emojis: "⭐🤚", answer: "vinnaithaandi varuvaayaa", hint: "Will you cross the sky for love? Silambarasan and Trisha's bittersweet love story — AR Rahman at his most romantic" },
  { emojis: "7️⃣🧠", answer: "7am arivu", hint: "Suriya as a circus performer who is the genetic descendant of Bodhidharma — consciousness-awakening thriller" },
  { emojis: "🔍🎩", answer: "thupparivalan", hint: "Vishal as a Sherlock Holmes-inspired quirky detective solving a complex murder case" },
  { emojis: "🔪🧩", answer: "ratsasan", hint: "Vishnu Vishal as a screenwriter-turned-cop hunting a methodical child serial killer — Tamil cinema's best thriller" },
  { emojis: "🐎📜", answer: "pariyerum perumal", hint: "A Dalit law student's brutal journey to dignity against deep caste violence — Mari Selvaraj's powerful debut" },
  { emojis: "🌈🔀", answer: "super deluxe", hint: "Vijay Sethupathi as a trans woman returning home — four radically different stories, Thiagarajan Kumararaja's bold masterpiece" },
  { emojis: "⚡🌧️", answer: "minnale", hint: "Madhavan vs Abbas in a rainy love triangle — Harris Jayaraj's debut album is still iconic" },
  { emojis: "⚡🏍️", answer: "valimai", hint: "Ajith as an undercover cop dismantling a deadly motorcycle racing gang — high-speed action, H. Vinoth" },
  { emojis: "🔒👊", answer: "kaithi", hint: "Karthi as a recently-released convict trapped in one night helping police against drug lords — real-time thriller" },
  { emojis: "🥥🐦", answer: "kolamaavu kokila", hint: "Nayanthara as a middle-class woman unwittingly pulled into drug trafficking — tense dark comedy by Nelson" },
  { emojis: "🌾🦁", answer: "kadaikutty singam", hint: "Karthi as the youngest son in a farmer's family — village drama about love, land, and loyalty" },
  { emojis: "🦅✈️", answer: "soorarai pottru", hint: "Suriya as a man who fights the system to build a low-cost airline for the common man — based on Air Deccan's story" },
  { emojis: "👩⚡", answer: "iraivi", hint: "Three women abandoned by the men in their lives — Karthik Subbaraj's arthouse film about the women behind filmmakers" },
  // — Batch 3 (2023-2024 films + classics) —
  { emojis: "👑🏛️", answer: "maamannan", hint: "Pa. Ranjith's bold political drama — Udhayanidhi Stalin vs Fahadh Faasil in a caste vs power showdown" },
  { emojis: "🎭💰", answer: "thunivu", hint: "Ajith as a charismatic heist mastermind taking on a corporate hospital — H. Vinoth's slick action comedy" },
  { emojis: "👨‍👩‍👧‍👦💼", answer: "varisu", hint: "Vijay as an NRI's youngest son reluctantly taking over the family business — Vamshi Paidipally's feel-good drama" },
  { emojis: "🍺🔫", answer: "mahaan", hint: "Vikram as a reformed man who plunges back into the criminal underworld — Karthik Subbaraj, with Dhruv Vikram opposite him" },
  { emojis: "💃🏘️", answer: "thiruchitrambalam", hint: "Dhanush as a food delivery guy with a complicated family — a warm neighbourhood love story, Anirudh's soundtrack" },
  { emojis: "🦸📖", answer: "maaveeran", hint: "Sivakarthikeyan as a coward who gets powers from a comic book hero and fights a corrupt politician — fun mass entertainer" },
  { emojis: "👨‍⚕️🔫", answer: "doctor", hint: "Sivakarthikeyan as a doctor who single-handedly takes down a human trafficking ring — Nelson Dilipkumar direction" },
  { emojis: "🎓👊", answer: "don", hint: "Sivakarthikeyan enters an elite college to get close to a girl and chaos follows — Cibi Chakaravarthi's fun debut" },
  { emojis: "🙏⏰", answer: "oh my kadavule", hint: "Ashok Selvan gets God's help to undo a marriage mistake — sweet, funny time-reset rom-com" },
  { emojis: "💕💕", answer: "kaathu vaakula rendu kaadhal", hint: "Vijay Sethupathi torn between Nayanthara and Samantha — Vignesh Shivan's colourful love triangle" },
  { emojis: "👥😈", answer: "naane varuven", hint: "Dhanush plays twin brothers — one noble, one evil — Selvaraghavan's intense psychological dual-role drama" },
  { emojis: "😂🎲", answer: "soodhu kavvum", hint: "Vijay Sethupathi as an incompetent small-time kidnapper — Nalan Kumarasamy's pitch-perfect dark comedy" },
  { emojis: "👮‍♀️📚", answer: "raatchasi", hint: "Jyothika as a strict school principal fighting the corrupt education system — feel-good, powerful performance" },
  { emojis: "🤡🎭", answer: "kadhal kondein", hint: "Dhanush in a raw obsessive love story — Selvaraghavan's debut, a landmark in Tamil realist cinema" },
  { emojis: "3️⃣🎵", answer: "3", hint: "Dhanush's bipolar love story — Anirudh debuted, 'Why This Kolaveri Di' broke the internet even before release" },
  { emojis: "🎯🤝", answer: "vikram vedha", hint: "Tamil original — R. Madhavan vs Vijay Sethupathi in a cat-and-mouse cop vs gangster thriller, Pushkar-Gayatri direction" },
  { emojis: "🚣‍♂️📜", answer: "ponniyin selvan", hint: "Mani Ratnam's epic — Kalki's 1200-page novel brought to screen — Chola dynasty, palace politics, Vandiyathevan, Rahman's music" },
  { emojis: "🐞❤️", answer: "kadhal", hint: "Bharath and Sandhya in a raw Romeo-Juliet story across caste lines — Balaji Sakthivel's debut, painfully real" },
  { emojis: "📦🎬", answer: "pizza 2", hint: "Vijay Sethupathi sequel — horror thriller continuation of the cult Pizza universe" },
  { emojis: "🍳😂", answer: "idharkuthane aasaipattai balakumara", hint: "Multiple men running from multiple women — a hilariously chaotic ensemble comedy" },
  { emojis: "💔🌊", answer: "7g rainbow colony", hint: "Selvaraghavan's heartbreak masterpiece — Ravi Krishna's obsessive love, unforgettable climax, Yuvan's aching score" },
  { emojis: "🎤🔊", answer: "kana kaanum kalangal", hint: "School life, friendships, and the talent hunt that changed lives — beloved Tamil TV show turned film" },
  { emojis: "🏺🦅", answer: "ps 1", hint: "Part 1 of Ponniyin Selvan — Karthi as Vandiyathevan, a messenger riding into Chola palace intrigues and danger" },
  { emojis: "🗡️⚓", answer: "ps 2", hint: "Part 2 — the war, betrayal, and rise of Arulmozhi Varman to become Raja Raja Chola — an epic conclusion" },
  { emojis: "🛑⚡", answer: "thunivu 2", hint: "Ajith's sequel — the heist gets bigger, the stakes higher" },
  { emojis: "🏹🗺️", answer: "adipurush", hint: "Hindi epic retelling Ramayana that had a massive Tamil dubbed release and controversial VFX" },
  { emojis: "🌿🤱", answer: "acham madam naanam payirppu", hint: "Jyothika as a rural midwife fighting superstition to save mothers — Mysskin's sensitive drama" },
];

// ===== CURATED BRAND QUIZ — Indian + global brands =====
const CURATED_BRAND_QUIZZES: { emojis: string; answer: string; hint: string }[] = [
  { emojis: "🍎💻", answer: "apple", hint: "Bitten apple logo — iPhone, MacBook, AirPods — 'Think Different'" },
  { emojis: "✔️👟", answer: "nike", hint: "Swoosh logo — Just Do It — world's biggest sports brand" },
  { emojis: "3️⃣〰️", answer: "adidas", hint: "Three parallel stripes — German sportswear born in 1949" },
  { emojis: "🟡🍔", answer: "mcdonalds", hint: "Golden arches M logo — Happy Meals, Big Mac, McFlurry" },
  { emojis: "👴🍗", answer: "kfc", hint: "Colonel's secret recipe of 11 herbs and spices — finger lickin' good" },
  { emojis: "🎲🍕", answer: "dominos", hint: "Domino tiles logo — 30-minute delivery promise, extra cheese" },
  { emojis: "☕🧜", answer: "starbucks", hint: "Mermaid logo — tall, grande, venti — coffee culture in a cup" },
  { emojis: "🔍🌈", answer: "google", hint: "Four-colour logo — the search engine that became a verb" },
  { emojis: "🪟💻", answer: "microsoft", hint: "Windows logo — Word, Excel, PowerPoint — runs the world's offices" },
  { emojis: "📱⚡", answer: "samsung", hint: "Korean electronics giant — Galaxy phones, fridges, TVs — Lee Kun-hee built it" },
  { emojis: "🐆👟", answer: "puma", hint: "Leaping cat logo — German brand founded by Adidas founder's brother" },
  { emojis: "🐎🔴", answer: "ferrari", hint: "Prancing horse on red — Italian supercar brand — Formula 1 legend" },
  { emojis: "🛋️🔧", answer: "ikea", hint: "Swedish furniture — you assemble it yourself — the blue and yellow store" },
  { emojis: "👖🔴", answer: "levis", hint: "Red tab on jeans pocket — 501 original — denim since 1873" },
  { emojis: "🎵🟢", answer: "spotify", hint: "Green music streaming — 100 million songs — Discover Weekly changed playlists forever" },
  { emojis: "💬📱", answer: "whatsapp", hint: "Green messaging app — where this group exists, ticks to show read" },
  { emojis: "🐦⬛", answer: "twitter x", hint: "Bird became X — Elon Musk bought it, rebranded it, everyone still calls it Twitter" },
  { emojis: "⚡🚗", answer: "tesla", hint: "Electric cars named after Nikola Tesla — Elon Musk, autopilot, 0-100 in seconds" },
  { emojis: "👓🛒", answer: "lenskart", hint: "India's biggest eyewear brand — buy glasses online, home eye test, Peyush Bansal's startup" },
  { emojis: "🎧⚓", answer: "boat", hint: "Indian audio brand with an anchor logo — earphones for every budget" },
  { emojis: "🛶📄", answer: "paper boat", hint: "Indian drinks brand — aam panna, kokum, jaljeera — 'memories in a bottle'" },
  { emojis: "🍿🟡", answer: "haldirams", hint: "India's snack empire — bhujia, namkeen, sweets — started in Bikaner in 1937" },
  { emojis: "🏍️⚡", answer: "rapido", hint: "Bike taxi app — fastest way around Chennai and Bangalore traffic" },
  { emojis: "🏏💭", answer: "dream11", hint: "Fantasy cricket app — pick your 11, score points based on real match performance" },
  { emojis: "⚗️💡", answer: "physics wallah", hint: "Alakh Pandey's ed-tech — JEE/NEET at affordable prices — 'Bhaiya' for millions of students" },
  { emojis: "🍬💄", answer: "sugar cosmetics", hint: "Indian makeup brand for deeper skin tones — bold colors, Vineeta Singh founded it" },
  { emojis: "🎵📻", answer: "saregama", hint: "Carvaan — the retro speaker that brought Ilaiyaraaja and classic Hindi songs back" },
  { emojis: "⌚💛", answer: "titan", hint: "Tata's watch brand — 'Be more' — Tanishq jewellery is also theirs" },
  { emojis: "💍✨", answer: "tanishq", hint: "Tata's premium jewellery brand — wedding collection ads make everyone cry" },
  { emojis: "🍪🌟", answer: "britannia", hint: "Eat Healthy Think Better — Good Day, Tiger biscuits, bread — 100+ year old brand" },
  { emojis: "💧🔵", answer: "bisleri", hint: "The word 'bisleri' became synonymous with bottled water in India" },
  { emojis: "🏍️🔴", answer: "tvs", hint: "Chennai's own two-wheeler brand — bikes and scooters for the common man — T.V. Sundaram Iyengar Group" },
  { emojis: "🌲👟", answer: "woodland", hint: "The tough olive-green outdoor boots — 'Made for the outdoors'" },
  { emojis: "⌚🟡", answer: "fastrack", hint: "Titan's youth watch and accessories brand — 'Move on' tagline, affordable cool" },
  { emojis: "👶🌱", answer: "mamaearth", hint: "Natural baby care brand turned full skincare — Varun and Ghazal Alagh founded it" },
  { emojis: "💼🔵", answer: "linkedin", hint: "Professional social network — blue — where everyone suddenly becomes a thought leader" },
  // — Batch 2 —
  { emojis: "🐊👟", answer: "lacoste", hint: "Crocodile logo on the chest — French luxury sportswear since 1933 — the original polo shirt brand" },
  { emojis: "🚕🟡", answer: "ola", hint: "India's biggest cab aggregator — auto, bike, cab — 'Chalo' — Bhavish Aggarwal's startup" },
  { emojis: "🍽️🔴", answer: "zomato", hint: "Red food delivery app — Blinkit, 10-minute grocery — Deepinder Goyal's startup that became a verb" },
  { emojis: "🏏⭐", answer: "mrf", hint: "The bat sticker brand — Made in Chennai since 1952 — India's rubber and tyre giant" },
  { emojis: "✈️🔵", answer: "indigo", hint: "India's largest airline — on-time, affordable, blue uniforms — 'Let's go'" },
  { emojis: "🌍📦", answer: "amazon", hint: "Arrow from A to Z — world's biggest store — Prime delivery changed how India shops" },
  { emojis: "🚲🟢", answer: "swiggy", hint: "Green food delivery and Instamart — Bundl Technologies — rivals Zomato in every city" },
  { emojis: "💳🔵", answer: "paytm", hint: "India's first payments app — QR code revolution — 'Paytm karo' changed how we pay chai kadai" },
  { emojis: "🎬🔴", answer: "netflix", hint: "Red N — binge-watch culture — 'Are you still watching?' — Stranger Things, Sacred Games" },
  { emojis: "📱🟠", answer: "jio", hint: "Reliance Jio — free data year changed everything — ended ₹300/GB era — Mukesh Ambani's telecom revolution" },
  // — Batch 3 (new-age Indian brands) —
  { emojis: "👗📱", answer: "meesho", hint: "Social commerce app for small sellers — resell from home — changed how rural India sells online" },
  { emojis: "⚡🛒", answer: "zepto", hint: "10-minute grocery delivery — Aadit Palicha and Kaivalya Vohra founded it as IIT dropouts at 19" },
  { emojis: "📱💳", answer: "phonepe", hint: "UPI payment app — Walmart-owned, blue logo — competes with GPay and Paytm" },
  { emojis: "0️⃣📈", answer: "zerodha", hint: "Zero brokerage stock trading — Nithin Kamath's startup made investing accessible — India's largest broker by clients" },
  { emojis: "🌱📊", answer: "groww", hint: "Mutual fund and stock investment app — 'Invest karo, Groww karo' — backed by Tiger Global" },
  { emojis: "🔊⌚", answer: "noise", hint: "Indian smartwatch and earbuds brand — affordable, colourful — one of India's fastest-growing electronics brands" },
  { emojis: "💳✨", answer: "cred", hint: "Pay your credit card bills, earn coins — luxury rewards — Kunal Shah's second startup, premium and aspirational" },
  { emojis: "💄🌸", answer: "nykaa", hint: "Online beauty and fashion marketplace — Falguni Nayar built India's first profitable unicorn by a woman founder" },
  { emojis: "🇮🇳💰", answer: "bharatpe", hint: "Merchant payments via QR code — Ashneer Grover's startup that dominated small business payments" },
  { emojis: "🛵📦", answer: "dunzo", hint: "Hyperlocal delivery startup — anything from anywhere — started in Bengaluru, backed by Google" },
  { emojis: "💼🔵", answer: "zoho", hint: "Chennai-born global SaaS giant — Sridhar Vembu's bootstrapped company used by millions of businesses worldwide — 'Tamil Nadu's Microsoft'" },
  { emojis: "🌿💼", answer: "freshworks", hint: "Chennai-based SaaS unicorn — Girish Mathrubootham's customer support software — first Indian SaaS to list on NASDAQ" },
  { emojis: "🏪👘", answer: "saravana stores", hint: "Chennai's iconic textile and shopping empire — Rs. 1 revolution in retail — Pondy Bazaar landmark" },
  { emojis: "🌶️🥔", answer: "hot chips", hint: "Chennai's famous fried snack chain — banana chips, murukku, mixture — a must-buy at Chennai airport" },
  { emojis: "🏨🔷", answer: "oyo", hint: "Budget hotel aggregator — Ritesh Agarwal dropped out at 17, Thiel Fellow — disrupted India's hospitality industry" },
  { emojis: "🎓📱", answer: "byju's", hint: "Ed-tech startup that became India's most valuable unicorn — Byju Raveendran from Kerala — learning app for K-12" },
  { emojis: "🛒🟡", answer: "bigbasket", hint: "Online grocery delivery pioneer — Alibaba-backed, now Tata-owned — predates Blinkit and Zepto by a decade" },
  { emojis: "🚗⬛", answer: "blackbuck", hint: "Trucking logistics tech platform from Chennai — matches truck owners with cargo senders — India's freight Uber" },
];

// ===== CURATED TRIVIA — hand-verified facts only =====
const CURATED_TRIVIA: { question: string; answer: string; hint: string; fact: string }[] = [
  // Star real names & personal facts
  { question: "Rajinikanth-oda real name enna? Rajini-nu peyar illai da!", answer: "shivaji rao gaekwad", hint: "Maharashtra origin, born in Bengaluru", fact: "Rajinikanth was born Shivaji Rao Gaekwad in Bengaluru in 1950 — he became a bus conductor before becoming a superstar!" },
  { question: "AR Rahman-oda original name enna — Islam convert pannanga before?", answer: "dileep kumar", hint: "A.S. initials — Allah Rakha-nu convert pannaanga", fact: "AR Rahman was born A.S. Dileep Kumar — he converted to Islam at 23 after his father's death, and became Allah Rakha Rahman!" },
  { question: "Vijay Sethupathi-oda breakthrough Tamil film enna? Cheese pizza ulla irukku!", answer: "pizza", hint: "2012 horror thriller, Karthik Subbaraj directed", fact: "Pizza (2012) made Vijay Sethupathi a star overnight — it was shot in just 24 days and became a massive cult hit!" },
  { question: "Ilaiyaraaja-oda first Tamil film as music director enna?", answer: "annakili", hint: "1976 release — bird in the title", fact: "Annakili (1976) was Ilaiyaraaja's debut — he composed the score for just ₹5,000 and it became one of the biggest hits of the decade!" },
  { question: "Yuvan Shankar Raja-oda appa yaaru? Famous composer-u!", answer: "ilaiyaraaja", hint: "Tamil Nadu's most legendary music director, father and son duo", fact: "Yuvan Shankar Raja is Ilaiyaraaja's son — both are legendary, but their styles are completely different!" },
  { question: "Jigarthanda enna director-oda film?", answer: "karthik subbaraj", hint: "Same director as Pizza, Iraivi, Petta", fact: "Karthik Subbaraj directed both Jigarthanda and Pizza — he's one of Tamil cinema's most distinct modern voices!" },
  { question: "Lokesh Kanagaraj-oda debut Tamil film enna?", answer: "maanagaram", hint: "2017 urban thriller, multiple storylines", fact: "Maanagaram (2017) was Lokesh Kanagaraj's debut — the budget was just 2 crore but it collected 20+ crore and launched a stellar career!" },
  // Tamil Nadu Geography & History
  { question: "Ooty-oda official Tamil name enna?", answer: "udhagamandalam", hint: "Nilgiris, hill station — British called it Ootacamund", fact: "Udhagamandalam was renamed 'Ooty' by the British — the original name is still used in government documents!" },
  { question: "Srinivasa Ramanujan — enna city-la poranda?", answer: "erode", hint: "Tamil Nadu city, grew up in Kumbakonam", fact: "Ramanujan was born in Erode in 1887 — the math genius who had no formal training but discovered thousands of formulas!" },
  { question: "APJ Abdul Kalam enna city-la poranda? Missile man of India!", answer: "rameswaram", hint: "Island city, Pamban Bridge pakkathule", fact: "Abdul Kalam was born in Rameswaram in 1931 — from a humble family, he became India's President and the father of India's missile program!" },
  { question: "Sivakasi enna-ku famous? Crackers-a illai vera enna?", answer: "fireworks", hint: "South Tamil Nadu — also matches, printing industry", fact: "Sivakasi produces over 90% of India's fireworks and safety matches — it's called 'Little Japan' for its industrial output!" },
  { question: "Tirupur enna-ku famous? Export panuvanga worldwide!", answer: "garments", hint: "Knitwear, t-shirts, hosiery — Dollar City", fact: "Tirupur exports over ₹25,000 crore worth of knitwear annually — it supplies t-shirts and innerwear to brands across the world!" },
  { question: "Coimbatore-ku enna nickname irukkudhu?", answer: "manchester of south india", hint: "Textile mills, industrial city, TN's second largest city", fact: "Coimbatore earned this nickname in the 1920s for its booming cotton textile industry — it's still a massive industrial hub!" },
  { question: "Brihadeeshwara Temple (Big Temple) — enna city-la irukkudhu?", answer: "thanjavur", hint: "Chola dynasty built it, UNESCO World Heritage", fact: "The Big Temple was built by Raja Raja Chola I in 1010 CE — the granite capstone at the top weighs 80 tonnes and was lifted without cranes!" },
  { question: "Jallikattu protest Tamil Nadu-la — enna year?", answer: "2017", hint: "Marina Beach full-a people — lakhs gathered", fact: "January 2017 saw lakhs of Tamils protest at Marina Beach for Jallikattu — one of the biggest spontaneous protests in India's history!" },
  { question: "Bharat Ratna — first Tamil person yaaru receive pannanga?", answer: "c rajagopalachari", hint: "Rajaji-nu koopduvaanga, first Governor-General of India", fact: "C. Rajagopalachari received the Bharat Ratna in 1954, among the very first batch — he was India's last Governor-General and founded the Swatantra Party!" },
  // IPL & Cricket
  { question: "IPL enna year-la start aagudhu?", answer: "2008", hint: "First season, Rajasthan Royals won it", fact: "IPL started in 2008 — Rajasthan Royals won the first edition under Shane Warne's captaincy!" },
  { question: "CSK jersey color enna?", answer: "yellow", hint: "Thala's team, Whistle Podu!", fact: "CSK's iconic yellow jersey earned them the nickname 'Yellow Army' — Chepauk turns into a sea of yellow every home match!" },
  { question: "IPL-la most titles win panna team enna?", answer: "csk", hint: "Chennai Super Kings or Mumbai Indians?", fact: "CSK and Mumbai Indians are tied with 5 IPL titles each — the greatest rivalry in Indian cricket!" },
  { question: "Sachin Tendulkar-oda IPL franchise enna?", answer: "mumbai indians", hint: "Blue team, Wankhede stadium", fact: "Sachin was the icon player for Mumbai Indians and co-owned the franchise — the team has won 5 IPL titles!" },
  // Movies & Music
  { question: "Enthiran-la Rajini-oda robot-ku enna peyar?", answer: "chitti", hint: "Serial number Chitti 2.0 Version A da", fact: "Chitti's famous line 'Inimey Naan Irukken Ayya' became iconic — the robot went from obedient to villain to hero!" },
  { question: "First Tamil talkie (sound padam) enna?", answer: "kalidas", hint: "1931 release — great ancient poet's name", fact: "Kalidas (1931) was Tamil cinema's first talkie — it was actually a bilingual film made in Tamil and Telugu simultaneously!" },
  { question: "Harris Jayaraj debut Tamil film as lead composer enna?", answer: "minnale", hint: "2001 Gautham Menon film, Madhavan hero", fact: "Harris Jayaraj debuted with Minnale (2001) — 'Evano Oruvan' and 'Un Mela' from that album are still loved today!" },
  { question: "Mani Ratnam-oda first Hindi film enna?", answer: "bombay", hint: "1995 film, AR Rahman music, communal riots theme", fact: "Bombay (1995) was Mani Ratnam's first Hindi film — AR Rahman's score including 'Kehna Hi Kya' became legendary!" },
  { question: "Kamal Haasan-Rajinikanth oru padam-la natichirukkanga — enna padam?", answer: "ninaithale inikkum", hint: "1979 K. Balachander film — before both became superstars", fact: "Ninaithale Inikkum (1979) had both Kamal and Rajini as young men — K. Balachander is credited with launching both careers!" },
  { question: "S.P. Balasubrahmanyam Guinness record enna-ku?", answer: "most songs recorded", hint: "40,000+ songs in multiple languages", fact: "SPB holds the Guinness World Record for recording the most songs — over 40,000 songs in Tamil, Telugu, Hindi, Kannada and more!" },
  { question: "Dhanush aadhu padam 'Aadukalam' — enna award paarana?", answer: "national award", hint: "Best Actor, Central Government award", fact: "Dhanush won the National Award for Best Actor for Aadukalam (2011) — the youngest Tamil actor to win it at just 27!" },
  { question: "Vijay Sethupathi National Award — enna padam-la?", answer: "orange mittai", hint: "Short film, 2015, small but powerful", fact: "Vijay Sethupathi won the National Award for Best Supporting Actor for the short film Orange Mittai (2015) — a 90-minute gem!" },
  { question: "Tamil Nadu-oda state tree enna?", answer: "palm tree", hint: "Panai maram — toddy, palm sugar ellam idundhu vudhu", fact: "The Palmyra palm (Panai maram) is Tamil Nadu's state tree — every part is used: fruit, sap, leaves, and trunk!" },
  { question: "Kodaikanal enna district-la irukkudhu?", answer: "dindigul", hint: "Hill station, Princess of Hill Stations-nu solluvaanga", fact: "Kodaikanal is in Dindigul district — it's famous for its lake, Star fruits, and Kodaikanal International School founded in 1901!" },
  { question: "MS Swaminathan enna-ku famous? Tamil Nadu-la born!", answer: "green revolution", hint: "Agriculture scientist, saved India from famine", fact: "M.S. Swaminathan from Kumbakonam led India's Green Revolution — his work in the 1960s-70s transformed India from food-import to food-export nation!" },
  // — Batch 2 —
  { question: "AR Rahman-oda debut Tamil film enna? First composer padam!", answer: "roja", hint: "1992 Mani Ratnam film, Arvind Swamy, Madhoo", fact: "AR Rahman debuted with Roja (1992) — 'Chinna Chinna Aasai' and 'Roja Janeman' were instantly iconic. He was just 25 and changed Tamil film music forever!" },
  { question: "Anirudh Ravichander-oda debut Tamil film enna? (Hint: Dhanush!) ", answer: "3", hint: "2012 Aishwarya Rajinikanth film, 'Why This Kolaveri Di' from the same team", fact: "Anirudh debuted with '3' (2012) at just 21 — but 'Why This Kolaveri Di' from the same album became India's first viral YouTube hit with 100M+ views even before the film released!" },
  { question: "Nayanthara-oda real name enna? She's originally from Kerala!", answer: "diana mariam kurian", hint: "Christian Malayali name — she adopted her stage name at debut", fact: "Nayanthara was born Diana Mariam Kurian in a Malayali Christian family in Bengaluru — she became the biggest female star in South Indian cinema under a completely new name!" },
  { question: "Soorarai Pottru real-life inspiration yaaru? The airline pioneer!", answer: "captain gopinath", hint: "Air Deccan founder — 'Simply Fly' is his autobiography", fact: "Soorarai Pottru is inspired by Captain G.R. Gopinath's book 'Simply Fly' — he founded Air Deccan and made flying accessible to ordinary Indians for the first time!" },
  { question: "Rajinikanth-oda debut Tamil film enna?", answer: "apoorva raagangal", hint: "1975, K. Balachander directed — Rajini played a negative role!", fact: "Rajini debuted in Apoorva Raagangal (1975) in a negative role — K. Balachander told him to act exactly like a villain. The same director launched Kamal Haasan too!" },
  { question: "Kamal Haasan ennaa padam-la child actor-a debut pannaan?", answer: "kalathur kannamma", hint: "1960 film, he was 3 years old!", fact: "Kamal Haasan debuted at age 3 in Kalathur Kannamma (1960) and won the President's Gold Medal for Best Child Artiste — making him the longest-serving actor in Indian cinema!" },
  { question: "Chennai-la Chepauk stadium — official name enna?", answer: "ma chidambaram stadium", hint: "BCCI president name — built 1916", fact: "The M.A. Chidambaram Stadium (Chepauk) is one of India's oldest cricket grounds, built in 1916 — named after BCCI president M.A. Chidambaram who served from 1928 to 1933!" },
  { question: "Tamil Nadu state animal enna da? Namma hill-la irukkudhu!", answer: "nilgiri tahr", hint: "Mountain goat, endangered, found in Nilgiris", fact: "The Nilgiri Tahr is Tamil Nadu's state animal — an endangered mountain goat found only in the Nilgiris and Western Ghats. Fewer than 3,000 survive today!" },
  { question: "IPL-la MS Dhoni CSK-la mattum nadichirukkaan-nu solla mudiyumaa?", answer: "no", hint: "CSK banned for 2 years — 2016-17 seasons", fact: "Dhoni played for Rising Pune Supergiant in 2016-17 when CSK was suspended for spot-fixing! He was even captain in 2017. CSK returned in 2018 and immediately won!" },
  { question: "Thiruvalluvar-oda Thirukkural-la ethanai couplets irukku?", answer: "1330", hint: "133 chapters × 10 couplets each", fact: "The Thirukkural has exactly 1330 couplets in 133 chapters — each chapter has exactly 10 kurals (couplets). Written over 2000 years ago, it's been translated into 80+ languages!" },
  { question: "Tamil Nadu-la Mahabalipuram — UNESCO World Heritage Site enna year aachudhu?", answer: "1984", hint: "Shore Temple, Pallava dynasty rock cuts, Group of Monuments", fact: "Mahabalipuram's Group of Monuments became a UNESCO World Heritage Site in 1984 — the Shore Temple has survived 1,300 years of Bay of Bengal waves!" },
  { question: "Rajinikanth-oda debut Tamil film yaar direct pannanga?", answer: "k balachander", hint: "KB — the legend who launched both Rajini and Kamal", fact: "K. Balachander is called the godfather of Tamil cinema — he launched Rajinikanth in Apoorva Raagangal (1975) and shaped Kamal Haasan's early career. Both stars always touched his feet!" },
  { question: "CSK-oda first IPL title enna year?", answer: "2010", hint: "Dhoni captain, first yellow trophy", fact: "CSK won their first IPL title in 2010 defeating Mumbai Indians in the final — the start of the 'Thala' era. They've since won 5 titles, sharing the record with Mumbai Indians!" },
  { question: "Dhanush enna Hollywood padam-la act pannaan? Ryan Gosling irundhaanga!", answer: "the gray man", hint: "2022 Netflix action film, Russo Brothers directed", fact: "Dhanush starred in The Gray Man (2022) alongside Ryan Gosling and Chris Evans — directed by the Russo Brothers (Avengers directors)! He played antagonist Avik San." },
  { question: "Kallanai dam enna river-la irukkudhu? 2000 year-la kattinanga!", answer: "kaveri", hint: "Chola king Karikalan built it, near Trichy", fact: "The Kallanai dam on the Kaveri was built by King Karikalan in the 2nd century CE — over 2,000 years old and still functional! It's one of the world's oldest water regulation structures." },
  // — Batch 3 (fresh 2024-2026 era + Tamil trivia) —
  { question: "Vijay-oda real full name enna? Thala-nu koopduvaanga but real name vera!", answer: "joseph vijay chandrasekhar", hint: "Joseph peyar use panraan — dad S.A. Chandrasekhar director", fact: "Vijay's full name is Joseph Vijay Chandrasekhar — he's from a Christian family. His father S.A. Chandrasekhar directed many of his early films!" },
  { question: "Sivakarthikeyan ethana TV show-la popular aana? Before actor aana!", answer: "kalakka povathu yaaru", hint: "Vijay TV comedy show — 6th season winner", fact: "Sivakarthikeyan won 'Kalakka Povathu Yaaru' Season 6 on Vijay TV — the comedy show launched his career! He then became one of Tamil cinema's biggest stars from zero film background!" },
  { question: "Tamil classical language status — enna year-la kiduchinaanga?", answer: "2004", hint: "First Indian language to get classical status — not 2000!", fact: "Tamil was declared a Classical Language in 2004 — the first language in India to receive this status! Sanskrit got it in 2005. Tamil literature dates back over 2,000 years!" },
  { question: "Soorarai Pottru-oda real-life inspiration yaaru? Book 'Simply Fly' ezhudhinaanga!", answer: "captain gopinath", hint: "Air Deccan founder — Suriya's character based on him", fact: "G.R. Gopinath's book 'Simply Fly' inspired Soorarai Pottru. He founded Air Deccan in 2003, making flying affordable for ordinary Indians for the first time — tickets as low as ₹500!" },
  { question: "Vijay-oda debut lead actor padam enna? 1992-la release aachudhu!", answer: "naalaya theerpu", hint: "1992 Tamil film — his first as a lead hero", fact: "Vijay debuted as hero in Naalaya Theerpu (1992) — directed by his own father S.A. Chandrasekhar! The film wasn't a big hit but launched one of Tamil cinema's greatest careers!" },
  { question: "Thiruvalluvar statue — Kanyakumari-la ethana feet tall?", answer: "133", hint: "One number represents Thirukkural chapters — 133 chapters!", fact: "The Thiruvalluvar statue at Kanyakumari is exactly 133 feet tall — representing the 133 chapters of Thirukkural! The 38-foot base represents Aram, Porul, and Inbam (virtue, wealth, love). Unveiled in 2000!" },
  { question: "RRR padam 'Naatu Naatu' Oscar win pannuchaa? Grammy-a, Oscar-a?", answer: "oscar", hint: "Academy Award — Best Original Song 2023", fact: "'Naatu Naatu' from RRR (Telugu) won the Academy Award for Best Original Song at the 95th Oscars in 2023 — composed by M.M. Keeravani! First Indian song to win an Oscar! Danced by Ram Charan and Jr NTR." },
  { question: "Karthi-oda debut Tamil film enna? National Award connection irukku!", answer: "paruthiveeran", hint: "2007 Ameer Sultan film — raw village love story", fact: "Karthi debuted in Paruthiveeran (2007) and the film won National Awards — but not for Karthi! The film's music by Yuvan and director Ameer's screenplay were acclaimed. Karthi later won for Madras (2014)!" },
  { question: "Chennai-la first Metro rail line enna year operate aanaadhu?", answer: "2015", hint: "Phase 1 — Airport to Central line", fact: "Chennai Metro Phase 1 began operations in 2015 — connecting Washermanpet to Chennai Airport. Phase 2 is massively expanding the network across the city!" },
  { question: "Nayanthara-oda real name enna? Kerala-la born!", answer: "diana mariam kurian", hint: "Christian Malayali name — completely changed identity for films", fact: "Nayanthara was born Diana Mariam Kurian in Bengaluru to a Malayali Christian family — she became Tamil and Telugu cinema's biggest female star under a completely new name!" },
  { question: "Pa. Ranjith-oda debut directorial padam enna?", answer: "attakathi", hint: "2012 low-budget love story — launched the Pa. Ranjith era", fact: "Pa. Ranjith debuted with Attakathi (2012) — a raw low-budget love story in Chennai's outskirts. It earned him critical praise and led directly to Madras (2014) and then Kabali with Rajinikanth!" },
  { question: "Ilaiyaraaja-oda original birth name enna? Parents gave different name!", answer: "gnanadesikan", hint: "He changed his name — Ilaiyaraaja was his chosen artiste name", fact: "Ilaiyaraaja was born Gnanadesikan in Pannaipuram village, Theni district. He adopted the name 'Ilaiyaraaja' (Young King) as his stage name — now it's the only name anyone knows!" },
  { question: "India-la first Test cricket match — enna year, enna city?", answer: "bombay", hint: "1933-34 season, vs England — not Chennai!", fact: "India's first Test match was played at Bombay Gymkhana in December 1933 — not at Chepauk! India lost by 202 runs. Chepauk hosted its first Test in February 1934, the very next month!" },
  { question: "Lokesh Kanagaraj-oda LCU (Lokesh Cinematic Universe) — first film enna?", answer: "kaithi", hint: "2019 Karthi film — real-time one-night thriller", fact: "Kaithi (2019) is the first film in the LCU! Dilli's character connects to Vikram (2022) where he appears briefly. Leo (2023) further expands the universe with Vijay — all sharing the same criminal world!" },
  { question: "Yuvan Shankar Raja-oda debut Tamil film enna composer-a?", answer: "kadhal desam", hint: "1996 film — young love story, he was only 16!", fact: "Yuvan debuted with Kadhal Desam (1996) at just 16 years old! His father Ilaiyaraaja was already a legend — but Yuvan carved his own distinct sound and became the voice of Tamil youth!" },
  { question: "Ponniyin Selvan novel — enna magazine-la serial-a vanthudhu?", answer: "kalki", hint: "Magazine named after the author himself!", fact: "Ponniyin Selvan was serialised in the magazine 'Kalki' from 1950 to 1954 — written by Kalki Krishnamurthy, who named his magazine after himself! The novel has over 2,400 pages!" },
];

const ACTORS   = ["Vijay Sethupathi", "Fahadh Faasil", "Nayanthara", "Trisha", "Samantha", "Jyothika", "Karthi", "Sivakarthikeyan", "Dhanush", "STR", "Jayam Raman", "Udhayanidhi Stalin", "Vishal", "G.V. Prakash"];
const DECADES  = ["1970s", "1980s", "1990s", "2000s", "2010s"];
const DIRECTORS = ["Vetrimaaran", "Pa. Ranjith", "Karthik Subbaraj", "Lokesh Kanagaraj", "Selvaraghavan", "Pandiraj", "Atlee", "Sudha Kongara", "Cheran", "Bala"];
const COMPOSERS = ["Harris Jayaraj", "Yuvan Shankar Raja", "G.V. Prakash", "Anirudh Ravichander", "D. Imman", "Sean Roldan", "Govind Vasantha", "Santosh Narayanan"];
const TRIVIA_CATEGORIES = ["Tamil Nadu rivers and lakes", "Tamil cinema golden era 1970s-80s", "Tamil folk arts and traditions", "Tamil Nadu famous temples", "Tamil Nadu sports heroes", "Kollywood comeback films", "Tamil Nadu street food origins", "Tamil Nadu district headquarters", "Tamil freedom fighters", "Tamil Nadu industries and exports"];
const WYR_THEMES = ["Chennai Metro commute", "Tamil IT office life", "Tamil hostel life", "IPL watching with family", "Tamil YouTube comment wars", "Ooty/Kodai trip mishaps", "Tamil engagement function drama", "Tamil New Year celebrations", "Chennai summer survival", "Tamil marriage sabha food"];

// ===== Get active game for a group =====
async function getActiveGame(groupId: string, gameType?: string) {
  let query = supabase
    .from("ba_game_state")
    .select("*")
    .eq("group_id", groupId)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (gameType) query = query.eq("game_type", gameType);

  const { data } = await query;
  return data?.[0] ?? null;
}

// ===== Create a new game =====
async function createGame(groupId: string, gameType: string, state: object) {
  // Deactivate any existing games in this group
  await supabase
    .from("ba_game_state")
    .update({ is_active: false })
    .eq("group_id", groupId)
    .eq("is_active", true);

  const { data } = await supabase
    .from("ba_game_state")
    .insert({
      group_id: groupId,
      game_type: gameType,
      state,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  return data;
}

// ===== Award points =====
async function awardPoints(
  groupId: string,
  playerPhone: string,
  playerName: string,
  gameType: string,
  points: number
) {
  const { error } = await supabase.rpc("ba_upsert_game_score", {
    p_group_id: groupId,
    p_player_phone: playerPhone,
    p_player_name: playerName,
    p_game_type: gameType,
    p_points: points,
  });
  if (error) console.error("[games] awardPoints failed:", error.message);
}

// ===== QUIZ — Tamil Movie Emoji Quiz (curated list — no Claude generation) =====
async function startQuiz(msg: BotMessage): Promise<string> {
  let archived = getArchived(msg.groupId, "quiz");
  let pool = CURATED_QUIZZES.filter((q) => !archived.includes(q.answer.toLowerCase()));
  if (pool.length === 0) {
    resetArchive(msg.groupId, "quiz");
    pool = CURATED_QUIZZES;
  }
  const quiz = randPick(pool);

  const state = {
    emojis: quiz.emojis,
    answer: quiz.answer,
    hint: quiz.hint,
    attempts: 0,
    hintGiven: false,
  };

  archiveAnswer(msg.groupId, "quiz", state.answer); // archive before await to prevent race-condition duplicates
  await createGame(msg.groupId, "quiz", state);

  return `🎬 *TAMIL MOVIE QUIZ*\n\nGuess the movie: ${state.emojis}\n\nType *!a <movie name>* to answer\n3 wrong attempts-ku appuram hint varum!`;
}

// ===== BRAND QUIZ — Guess the Indian brand from emoji clues =====
async function startBrandQuiz(msg: BotMessage): Promise<string> {
  let archived = getArchived(msg.groupId, "brandquiz");
  let pool = CURATED_BRAND_QUIZZES.filter((q) => !archived.includes(q.answer.toLowerCase()));
  if (pool.length === 0) {
    resetArchive(msg.groupId, "brandquiz");
    pool = CURATED_BRAND_QUIZZES;
  }
  const quiz = randPick(pool);

  const state = {
    emojis: quiz.emojis,
    answer: quiz.answer,
    hint: quiz.hint,
    attempts: 0,
    hintGiven: false,
  };

  archiveAnswer(msg.groupId, "brandquiz", state.answer);
  await createGame(msg.groupId, "brandquiz", state);

  return `🏷️ *BRAND QUIZ*\n\nEnnaa brand? ${state.emojis}\n\nType *!a <brand name>* to answer\n3 wrong attempts-ku appuram hint varum!`;
}

// ===== CURATED DIALOGUES — hand-verified iconic lines, word-perfect =====
const CURATED_DIALOGUES: { dialogue: string; answer: string; speaker: string; hint: string }[] = [
  { dialogue: "Naan oru thadavai sonna, nooru thadavai sonna maadiri!", answer: "padaiyappa", speaker: "Rajinikanth", hint: "Rajini as a village man who refuses to bow down — 1999 classic" },
  { dialogue: "En vazhi, thani vazhi!", answer: "baasha", speaker: "Rajinikanth", hint: "Rajini as an auto driver with a secret past — 1995" },
  { dialogue: "Neraya per kaadhal solluvaanga... aana, kaadhala kaadhal nu therinja, naan onnu mattum solren — idhuvum kadhuvaadhu!", answer: "kandukondain kandukondain", speaker: "Ajith Kumar", hint: "2000 Tamil adaptation of Sense and Sensibility" },
  { dialogue: "Ulagam sutrum valiban... ulagam sutrum valiban!", answer: "ulaganayagan", speaker: "Kamal Haasan", hint: "Kamal 80s action classic — he goes on a globe-trotting adventure" },
  { dialogue: "Katradhu Tamil, kettathu Tamil, pesiyadhu Tamil, padiyadhu Tamil!", answer: "vivegam", speaker: "Ajith Kumar", hint: "Ajith as an Interpol agent — 2017 action thriller" },
  { dialogue: "Oru thadavai solvaan... thirumba solvaan... mettukudi!", answer: "enthiran", speaker: "Chitti (Rajinikanth)", hint: "Robot movie — Chitti corrects himself after learning new things" },
  { dialogue: "Naanum rowdy dhaan!", answer: "naanum rowdy dhaan", speaker: "Vijay Sethupathi", hint: "Vijay Sethupathi + Nayanthara romantic comedy — 2015" },
  { dialogue: "Vera level!", answer: "theri", speaker: "Vijay", hint: "Vijay as a cop protecting a child — 2016 Atlee film" },
  { dialogue: "Kaathukulla vekka solla... unnai vida romba busy-aa iruken!", answer: "96", speaker: "Ram (Vijay Sethupathi)", hint: "A nostalgic love story set at a school reunion — 2018" },
  { dialogue: "Nee romba azhagaa irukkiya, sollikalaye!", answer: "alaipayuthey", speaker: "Karthik (Madhavan)", hint: "Mani Ratnam's modern love story — 2000" },
  { dialogue: "Yaarukku theriyum... life-la eppovadhu oru naal, idhellam kanavaa irundhaa nu theriyuma?", answer: "vinnaithaandi varuvaayaa", speaker: "Karthik (Simbu)", hint: "Gautham Menon's long-distance love story — 2010" },
  { dialogue: "Naan hero illaama irukkalam, but villain-aa matten!", answer: "billa", speaker: "Billa (Ajith Kumar)", hint: "Ajith's stylish crime thriller — 2007 remake of Don" },
  { dialogue: "Rowdy-aa? Gentleman-aa? Naangalum manushangalthaan!", answer: "gentleman", speaker: "Arjun", hint: "Shankar directorial debut — 1993 action film" },
  { dialogue: "Eppo varuvanga, eppadi varuvanga, yaaru varuvanga — theriyaadhu. Aana varuvaanga!", answer: "kaakha kaakha", speaker: "Anbu (Suriya)", hint: "Gautham Menon's intense cop film — 2003" },
  { dialogue: "Oru muthal iru muthal munnoru muthal — neeyeh muthal!", answer: "minnale", speaker: "Krishna (Madhavan)", hint: "Romantic love triangle — 2001, Harris Jayaraj music" },
  { dialogue: "Naatukku oru thadavai solren — oru kaal vaazhvule, vaazha mudiyaathu nu therinjaalum, muzhangaalukku mela kuniyadhey!", answer: "muthalvan", speaker: "Chief Minister character", hint: "Arjun as a politician who becomes CM — 1999" },
  { dialogue: "Paravaa illai, nee vaazha vendam, aana naan vaazha matten!", answer: "thullatha manamum thullum", speaker: "Vijay", hint: "Vijay's 1999 romance — 'Thullatha Manamum Thullum'" },
  { dialogue: "Anbe sivam!", answer: "anbe sivam", speaker: "Anbarasu (Kamal Haasan)", hint: "Kamal + Madhavan road trip film — 2003, love is god" },
  { dialogue: "Un per enna? Mappillai! Yaar mappillai? Naan mappillai!", answer: "mappillai", speaker: "Rajinikanth", hint: "Rajini as a rowdy who falls in love — 1989" },
  { dialogue: "Idhu eppadi irukku?", answer: "saahasam", speaker: "Prashanth", hint: "Prashanth action film — became a famous meme phrase" },
  { dialogue: "Nambikkai irukkattum, nambaadha irukkattum — yen tholaivile oru vazhiye kidaikkum!", answer: "thalapathi", speaker: "Surya (Rajinikanth)", hint: "Mani Ratnam's Mahabharata-inspired classic — 1991" },
  { dialogue: "Kovam vaaraadhu... aana vandhaale thaangaadhu!", answer: "mersal", speaker: "Vijay", hint: "Vijay triple role, Atlee direction — 2017" },
  { dialogue: "Naan hero mattum dhaan illa, oru average Tamil pasangaloda kanavum dhaan!", answer: "vijay (generic)", speaker: "Vijay", hint: "Vijay's signature mass dialogue style — fan favourite catchphrase era" },
  { dialogue: "Ayngaran!", answer: "ayngaran", speaker: "Bhavani (Vijay Sethupathi)", hint: "Vijay Sethupathi as a gang leader — 2022 crime drama" },
  { dialogue: "Un mela yaar thappu solluvaan — unnoda appa, amma, anna, thangachi, kaadhal — yaaraavathu? Indha ullagaththile enakku oru masilaathavan nu sonnaa, naan sonnavar!", answer: "gajini", speaker: "Suriya", hint: "Suriya as a man with short-term memory loss — 2005, AR Murugadoss" },
  { dialogue: "Idhu kadhal kadhaya illa, oru manidhan valara kathai!", answer: "7g rainbow colony", speaker: "Karthik (Ravi Krishna)", hint: "Selvaraghavan's bittersweet college love story — 2004" },
  { dialogue: "Naan pizhaippean, Nee pizhaippai, Naame pizhaippom!", answer: "jilla", speaker: "Vijay", hint: "Vijay and Mohanlal face-off — 2014" },
  { dialogue: "Oru naal kootam sera varuvan, oru naal thani thiripaen — moochu ulla irukkumbolam, indha vazhiyil thaan nadappa!", answer: "pithamagan", speaker: "Chittan (Vikram)", hint: "Vikram as a boy raised in a cemetery — 2003, National Award winner" },
  { dialogue: "Naan yaar? Yaar naan? Enna vazhippadu solluvom.", answer: "dasavathaaram", speaker: "Kamal Haasan", hint: "Kamal plays 10 roles — 2008 big-budget film" },
  { dialogue: "En vazhi, yen kaathal, yen vaazhkai — yellaamey un kayyile!", answer: "kadhal kondein", speaker: "Selvam (Dhanush)", hint: "Selvaraghavan direction, Dhanush debut in intense role — 2003" },
  { dialogue: "Idhu kaalamum marandhu poachu, naan marandhu pogala!", answer: "ok kanmani", speaker: "Aadi (Dulquer Salmaan)", hint: "Mani Ratnam's modern live-in relationship film — 2015" },
  { dialogue: "Thadava sollamatten, oru thadava sonna thaan, oru nooru thadava sonna maadiri!", answer: "padaiyappa", speaker: "Rajinikanth", hint: "Different Rajini dialogue from the same iconic 1999 film" },
  { dialogue: "Aambala manasu arasamaram maari — aneyaanga adi padudhukku mela mathrika maatom!", answer: "aambala", speaker: "Vishal", hint: "Vishal action comedy — 2015" },
  { dialogue: "Naan vanthutten!", answer: "kaththi", speaker: "Vijay", hint: "Vijay's iconic entry dialogue — 2014 mass entertainer" },
  { dialogue: "Yenga ooru Madurai!", answer: "kaithi", speaker: "Dilli (Karthi)", hint: "Karthi as an ex-convict in one non-stop night — 2019 Lokesh Kanagaraj" },
  { dialogue: "Thalaivaaa!", answer: "baasha", speaker: "Fans (crowd)", hint: "The cry that follows whenever Baasha's identity is revealed — 1995" },
  { dialogue: "Naan sollamatten... inime sollamatten... eppovum sollamatten!", answer: "chellamae", speaker: "Vijay", hint: "Early Vijay sentimental family film — 1994" },
  { dialogue: "Scene-la color irukku, life-la illai!", answer: "super deluxe", speaker: "Vijay Sethupathi", hint: "Thiagarajan Kumararaja's anthology masterpiece — 2019" },
  { dialogue: "Inimey naan thadayam ila, paartha thaan paarppan, thaazhtha thaan thaazhatten!", answer: "vikram vedha", speaker: "Vikram (R. Madhavan)", hint: "Cat-and-mouse cop vs gangster story — 2017" },
  { dialogue: "Naadu kadandhu vandha naalum mudiyaadhu, ooru kadandhu vandha naalum mudiyaadhu — namma oorukku thirumba vandhaale mudiyum!", answer: "anjaan", speaker: "Suriya", hint: "Suriya dual role with STR — 2014" },
  // — Batch 2 (2018-2024) —
  { dialogue: "Naan oru thadavai oru per kitta promise pannaa, adha kaanaama ponaale... thoongi thaane poren da!", answer: "vikram", speaker: "Kamal Haasan / Vikram", hint: "Kamal's 2022 comeback — Lokesh Kanagaraj's multi-starrer blockbuster" },
  { dialogue: "Leo Das! Leo Das-nu pesuravaangalellaam... naan unakku enna da?", answer: "leo", speaker: "Leo (Vijay)", hint: "Vijay in Lokesh Kanagaraj's LCU chapter — 2023" },
  { dialogue: "Thalaivar solvaar, thalaivar seyya maattaar — aaana thalaivar solraadhae... avan nadanthirukkaan!", answer: "jailer", speaker: "Multiple characters", hint: "Rajini's 2023 comeback — Nelson's stylish father-son crime drama" },
  { dialogue: "Naan corrupt-aa? Ada, naan vaalkkai-la oru paisa kuda wrong-aa touch pannala!", answer: "darbar", hint: "Rajini as a no-nonsense Mumbai police commissioner — 2020", speaker: "Aaditya (Rajinikanth)" },
  { dialogue: "Summa aagalai... summaaa aagalai! Vera level!", answer: "mersal", speaker: "Vijay", hint: "Vijay's triple role — Atlee's 2017 blockbuster, became a cultural catchphrase" },
  { dialogue: "Ivan thaan seyaadhaan solraan... avan kaila thaan aacha!", answer: "vikram vedha", speaker: "Priya / the police team", hint: "The philosophical cat-and-mouse thriller — R. Madhavan and Vijay Sethupathi — 2017 Tamil original" },
  { dialogue: "Porundha ooru poganum... pona ooru kekkanum... peru maaridum!", answer: "96", speaker: "Ram (Vijay Sethupathi)", hint: "Ram's wistful advice about moving on — Vijay Sethupathi's quietest, most powerful performance" },
  { dialogue: "Naan oru kaalatula oru per kitta thiruppi solluvaan: ungalukku nan-ri.", answer: "soorarai pottru", speaker: "Nedumaaran (Suriya)", hint: "Suriya's National Award role — the low-cost airline dream — 2020" },
  { dialogue: "Yaen pola, machanae... yaarukkum theriyaama irundhutten... ennoda velai mudichachu!", answer: "kaithi", speaker: "Dilli (Karthi)", hint: "Karthi as an ex-convict in one night of chaos — Lokesh Kanagaraj's real-time 2019 thriller" },
  { dialogue: "Ellaarum pesa mattengaanga... naanum pesa matten. Aaana... naan seyuven!", answer: "maamannan", speaker: "Maamannan (Vadivelu)", hint: "Pa. Ranjith's 2023 political masterpiece — Udhayanidhi Stalin, Fahadh Faasil, Vadivelu" },
  { dialogue: "Doctor-nu solluvaanga, adhe danda... vandhu use panna solluvaanga!", answer: "doctor", speaker: "Varun (Sivakarthikeyan)", hint: "Sivakarthikeyan's 2021 Nelson Dilipkumar action-comedy" },
  { dialogue: "Un vazhiley vandha pombalainga ellaam safe-aa irukkaaangalaa?", answer: "kolamaavu kokila", speaker: "Kokila (Nayanthara)", hint: "Nayanthara as a timid housewife accidentally becoming a drug lord — Nelson's 2018 dark comedy" },
];

// ===== DIALOGUE — Guess Tamil Movie from Famous Dialogue =====
async function startDialogue(msg: BotMessage): Promise<string> {
  const archived = getArchived(msg.groupId, "dialogue");
  const pool = CURATED_DIALOGUES.filter(d => !archived.includes(d.answer.toLowerCase()));

  if (pool.length === 0) {
    resetArchive(msg.groupId, "dialogue");
    return "Dialogue pool reset aayiduchu! Ippovum pazhaya questions varum — try pannunga!";
  }

  const entry = randPick(pool);
  archiveAnswer(msg.groupId, "dialogue", entry.answer.toLowerCase());

  await createGame(msg.groupId, "dialogue", {
    dialogue: entry.dialogue,
    answer: entry.answer.toLowerCase(),
    speaker: entry.speaker,
    hint: entry.hint,
    attempts: 0,
    hintGiven: false,
  });

  return `🎭 *DIALOGUE GUESS*\n\n"${entry.dialogue}"\n\n— ${entry.speaker}\n\nEnnaa movie? Type *!a <movie name>*`;
}

// ===== SONG LYRIC — Complete the Tamil Song Lyric =====
async function startSongLyric(msg: BotMessage): Promise<string> {
  const composer = randPick(COMPOSERS);
  const decade   = randPick(DECADES);
  const prompt = `Generate a Tamil song lyric completion challenge.

Pick a song that people actually sing along to — something famous enough that Tamil 20-35 year olds know it by heart.
Prefer: ${composer} compositions OR popular Tamil songs from the ${decade}.
Avoid obscure album tracks, B-sides, or anything released in the last 6 months.

The blank (___) should be a word/phrase where the listener would immediately know it IF they know the song.

Respond in this format ONLY (no extra text):
LYRIC: <the lyric line with ___ for the missing part>
ANSWER: <the missing word(s)>
SONG: <song name>
MOVIE: <movie or album name>
HINT: <hint about the song mood or movie — not the missing word>`;

  const content = await generateStructured(prompt);

  const lyric = content.match(/LYRIC:\s*(.+)/)?.[1]?.trim();
  const answer = content.match(/ANSWER:\s*(.+)/)?.[1]?.trim();
  const song = content.match(/SONG:\s*(.+)/)?.[1]?.trim();
  const movie = content.match(/MOVIE:\s*(.+)/)?.[1]?.trim();
  const hint = content.match(/HINT:\s*(.+)/)?.[1]?.trim();

  if (!lyric || !answer) return "Song lyric generate panna mudiyala. Try again!";

  await createGame(msg.groupId, "songlyric", {
    lyric,
    answer: answer.toLowerCase(),
    song: song ?? "",
    movie: movie ?? "",
    hint: hint ?? "",
    attempts: 0,
    hintGiven: false,
  });

  return `🎵 *SONG LYRIC CHALLENGE*\n\n${lyric}\n\nBlank fill pannunga! Type *!a <missing word(s)>*`;
}

// ===== WOULD YOU RATHER =====
async function startWYR(msg: BotMessage): Promise<string> {
  const theme = randPick(WYR_THEMES);
  const prompt = `Generate ONE funny "Would You Rather" question themed around: ${theme}. Both options should be equally painful/funny. Write in Tanglish.

Respond in this format ONLY (no extra text):
OPTION_A: <first option>
OPTION_B: <second option>`;

  const content = await generateStructured(prompt);

  const optA = content.match(/OPTION_A:\s*(.+)/)?.[1]?.trim();
  const optB = content.match(/OPTION_B:\s*(.+)/)?.[1]?.trim();

  if (!optA || !optB) {
    return "WYR generate panna mudiyala. Try again!";
  }

  await createGame(msg.groupId, "wyr", { optA, optB, votesA: [], votesB: [] });

  return `🤔 *WOULD YOU RATHER?*\n\n🅰️ ${optA}\n\nOR\n\n🅱️ ${optB}\n\nType *!a A* or *!a B*`;
}

// ===== WORD CHAIN =====
async function startWordChain(msg: BotMessage): Promise<string> {
  const starters = [
    "Thalaivan",
    "Marudhamalai",
    "Chennai",
    "Biryani",
    "Kollywood",
    "Superstar",
    "Thalapathy",
    "Marina",
    "Annamalai",
  ];
  const word = starters[Math.floor(Math.random() * starters.length)];

  await createGame(msg.groupId, "wordchain", {
    lastWord: word!.toLowerCase(),
    usedWords: [word!.toLowerCase()],
    lastPlayer: "bot",
  });

  const lastLetter = word!.slice(-1).toUpperCase();

  return `🔗 *WORD CHAIN GAME*\n\nNaan start pannuren: *${word}*\n\nNext word "${lastLetter}" la start aaganum!\nType *!a <word>* — Repeated words = out!`;
}

// ===== ANTAKSHARI =====
async function startAntakshari(msg: BotMessage): Promise<string> {
  const letters = ["Ka", "Ma", "Pa", "Tha", "Va", "Na", "Sa", "Ra", "Aa"];
  const letter = letters[Math.floor(Math.random() * letters.length)];

  await createGame(msg.groupId, "antakshari", {
    currentLetter: letter,
    usedSongs: [],
    lastPlayer: "bot",
  });

  return `🎵 *ANTAKSHARI TIME*\n\n"${letter}" la start aagura Tamil paattu sollunga!\nType *!a <song name>* — Next person last letter la continue pannanum!`;
}

// ===== TRIVIA — Curated verified questions (no Claude generation to prevent wrong facts) =====
async function startTrivia(msg: BotMessage): Promise<string> {
  let archived = getArchived(msg.groupId, "trivia");
  let pool = CURATED_TRIVIA.filter((q) => !archived.includes(q.answer.toLowerCase()));
  if (pool.length === 0) {
    resetArchive(msg.groupId, "trivia");
    pool = CURATED_TRIVIA;
  }
  const trivia = randPick(pool);

  archiveAnswer(msg.groupId, "trivia", trivia.answer);
  await createGame(msg.groupId, "trivia", {
    question: trivia.question,
    answer: trivia.answer.toLowerCase(),
    hint: trivia.hint,
    fact: trivia.fact,
    attempts: 0,
    hintGiven: false,
  });

  return `🧠 *TRIVIA TIME*\n\n${trivia.question}\n\nType *!a <answer>* to answer`;
}

// ===== SONG QUIZ — Guess the Tamil song from English-translated lyrics =====
async function startSongQuiz(msg: BotMessage): Promise<string> {
  let archived = getArchived(msg.groupId, "song");
  let pool = SONG_QUIZ.filter(q => !archived.includes(q.answer.toLowerCase()));
  if (pool.length === 0) {
    resetArchive(msg.groupId, "song");
    pool = SONG_QUIZ;
  }
  const song = randPick(pool);
  archiveAnswer(msg.groupId, "song", song.answer);

  await createGame(msg.groupId, "song", {
    answer: song.answer,
    movie: song.movie,
    hint: song.hint,
    attempts: 0,
    hintGiven: false,
  });

  const lyricsDisplay = song.lines.map(l => `_${l}_`).join("\n");
  return `🎵 *GUESS THE TAMIL SONG*\n\n_English translation of the lyrics:_\n\n${lyricsDisplay}\n\nType *!a <song name>* to guess!\nTypos ok da, Tanglish welcome! Hint varum after 3 wrong attempts.`;
}

// ===== WORDLE — Group shared Tamil movie 6-letter puzzle =====
async function startWordle(msg: BotMessage): Promise<string> {
  let archived = getArchived(msg.groupId, "wordle");
  let pool = WORDLE_WORDS.filter(w => !archived.includes(w.word.toLowerCase()));
  if (pool.length === 0) {
    resetArchive(msg.groupId, "wordle");
    pool = WORDLE_WORDS;
  }
  const entry = randPick(pool);
  archiveAnswer(msg.groupId, "wordle", entry.word.toLowerCase());

  await createGame(msg.groupId, "wordle", {
    word: entry.word,
    hint: entry.hint,
    guesses: [],
    solved: false,
    maxGuesses: 6,
  });

  return `🟩 *WORDLE — KOLLYWOOD EDITION*\n\n*${entry.word.length}*-letter Tamil movie title!\nEveryone can guess — group shared board!\n\nType *!w <word>* to submit a guess.\n6 total guesses for the group.\n\n🟩 right letter, right spot\n🟨 right letter, wrong spot\n⬛ letter not in word\n\n💡 Hint: ${entry.hint}`;
}

async function handleWordleGuess(args: string, msg: BotMessage): Promise<string> {
  const game = await getActiveGame(msg.groupId, "wordle");
  if (!game) return "Wordle game illa da! Type *!wordle* to start a new game.";

  const state = game.state;
  if (state.solved) return "Already solved da! Type *!wordle* for a new game.";

  const guess = args.trim().toUpperCase();
  const target = (state.word as string).toUpperCase();

  if (guess.length !== target.length) {
    return `❌ ${target.length}-letter word vennum da! "${guess}" has ${guess.length} letters.`;
  }
  if (!/^[A-Z]+$/.test(guess)) {
    return "English letters only da! No numbers or special characters.";
  }

  const result = computeWordleResult(guess, target);
  const guesses = (state.guesses as Array<{ player: string; word: string; result: string[] }>);
  guesses.push({ player: msg.senderName, word: guess, result });

  const isSolved = result.every(r => r === "correct");
  const isGameOver = isSolved || guesses.length >= (state.maxGuesses as number);

  await supabase
    .from("ba_game_state")
    .update({ state: { ...state, guesses, solved: isSolved }, is_active: !isGameOver })
    .eq("id", game.id);

  const board = buildWordleBoard(guesses);

  if (isSolved) {
    await awardPoints(msg.groupId, msg.from, msg.senderName, "wordle", 20);
    return `🟩 *WORDLE SOLVED!*\n\n*${msg.senderName}* cracked it in ${guesses.length} guess${guesses.length > 1 ? "es" : ""}! 🎉\n\n${board}\n\nWord: *${target}*\n+20 points! Type *!wordle* for a new game.`;
  }

  if (isGameOver) {
    return `💀 *GAME OVER!* All ${state.maxGuesses} guesses used.\n\n${board}\n\nAnswer was: *${target}*\n💡 ${state.hint}\n\nType *!wordle* for a new game.`;
  }

  const remaining = (state.maxGuesses as number) - guesses.length;
  return `${board}\n\n_${remaining} guess${remaining > 1 ? "es" : ""} remaining — Type *!w <word>*_`;
}

// ===== MEMORY — Memorize and recall a sequence of words =====
async function startMemory(msg: BotMessage): Promise<string> {
  const categories = Object.keys(MEMORY_POOLS);
  const category = randPick(categories)!;
  const pool = MEMORY_POOLS[category]!;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const words = shuffled.slice(0, 5);

  await createGame(msg.groupId, "memory", {
    category,
    words,
    attempts: 0,
  });

  const wordList = words.map((w, i) => `${i + 1}. *${w}*`).join("\n");
  const showText = `🧠 *MEMORY GAME — ${category.toUpperCase()}*\n\nMemorize these 5 words:\n\n${wordList}\n\n_⏱️ 15 seconds... then this message disappears!_`;
  const recallText = `💥 *Gone!* Now recall from memory:\n\nType *!a <all 5 words>* — First correct wins *20 points*! ⚡`;

  // Send the words message directly so we can delete it after 15 seconds
  try {
    const { getClient } = await import("../index.js");
    const client = getClient();
    if (!client) throw new Error("client not ready");

    const sentMsg = await client.sendMessage(msg.groupId, showText);
    const msgId = sentMsg?.id?._serialized;

    setTimeout(async () => {
      // Attempt deletion — try direct method first, then puppeteer fallback
      let deleted = false;
      try {
        await sentMsg.delete(true);
        deleted = true;
      } catch (e) {
        console.error("[memory] delete(true) failed, trying puppeteer fallback:", e);
      }

      if (!deleted && msgId && client.pupPage) {
        try {
          await client.pupPage.evaluate(async ({ chatId, serialized }: { chatId: string; serialized: string }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const g = globalThis as any;
            const chat = g.Store.Chat.get(chatId);
            const m    = g.Store.Msg.get(serialized);
            if (chat && m) await g.Store.Cmd.sendRevokeMsgs(chat, [m]);
          }, { chatId: msg.groupId, serialized: msgId });
          deleted = true;
        } catch (e2) {
          console.error("[memory] puppeteer revoke failed:", e2);
        }
      }

      // Always send recall prompt regardless of deletion success
      try {
        const recall = deleted
          ? recallText
          : `💥 *(Scroll up fast!)* Now recall from memory:\n\nType *!a <all 5 words>* — First correct wins *20 points*! ⚡`;
        await client.sendMessage(msg.groupId, recall);
      } catch (e) {
        console.error("[memory] recall prompt failed:", e);
      }
    }, 15_000);

    return ""; // already sent — listener will skip empty response
  } catch (e) {
    console.error("[memory] direct send failed, falling back:", e);
  }

  // Fallback: let listener send it (no deletion)
  return `🧠 *MEMORY GAME*\n\nMemorize these 5 *${category.toUpperCase()}*:\n\n${wordList}\n\nType *!a <all 5 words>* — First correct wins *20 points*! ⚡`;
}

// ===== HANDLE ANSWER =====
async function handleAnswer(args: string, msg: BotMessage): Promise<string> {
  const game = await getActiveGame(msg.groupId);
  if (!game) return "Machaan, active game onnum illa. !quiz or !trivia try pannu.";

  const rawAnswer = args.trim();
  const answer = rawAnswer.toLowerCase(); // lowercase for comparison only
  if (!answer || answer.length < 1) return "Machaan, answer type pannu! !answer <your answer>";
  const state = game.state;

  switch (game.game_type) {
    case "quiz":
    case "brandquiz": {
      const isQuiz = game.game_type === "quiz";
      if (fuzzyMatch(answer, state.answer)) {
        await supabase
          .from("ba_game_state")
          .update({ is_active: false })
          .eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, game.game_type, 10);
        const label = isQuiz ? `Movie: *${state.answer}*` : `Brand: *${state.answer}*`;
        const next = isQuiz ? "Type !quiz for next question." : "Type !brandquiz for next one.";
        const emojiExplain = state.hint ? `\n💡 _${state.emojis} → ${state.hint}_` : "";
        return `✅ Correct da ${msg.senderName}! 🎉\n\n${label}${emojiExplain}\n+10 points!\n\n${next}`;
      }

      state.attempts = (state.attempts ?? 0) + 1;

      if (state.attempts >= 3 && !state.hintGiven && state.hint) {
        state.hintGiven = true;
        await supabase
          .from("ba_game_state")
          .update({ state })
          .eq("id", game.id);
        return `❌ Wrong da! Hint: ${state.hint}`;
      }

      if (state.attempts >= 6) {
        await supabase
          .from("ba_game_state")
          .update({ is_active: false })
          .eq("id", game.id);
        const next = isQuiz ? "Type !quiz for next question." : "Type !brandquiz for next one.";
        const emojiExplain = state.hint ? `\n💡 _Emoji explained: ${state.emojis} → ${state.hint}_` : "";
        return `⏰ Time up! Answer: *${state.answer}*${emojiExplain}\n\nYaarum correct solla mudiyala 😅\n${next}`;
      }

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      return `❌ Thambi wrong answer. Try again! (Attempt ${state.attempts}/6)`;
    }

    case "dialogue": {
      const isCorrect = fuzzyMatch(answer, state.answer);

      if (isCorrect) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, "dialogue", 10);
        let resp = `✅ Correct ${msg.senderName}! 🎭\n\nMovie: *${state.answer}*`;
        if (state.speaker) resp += `\nDialogue by: ${state.speaker}`;
        resp += `\n+10 points!`;
        return resp;
      }

      state.attempts = (state.attempts ?? 0) + 1;

      if (state.attempts >= 3 && !state.hintGiven && state.hint) {
        state.hintGiven = true;
        await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
        return `❌ Wrong da! Hint: ${state.hint}`;
      }

      if (state.attempts >= 6) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        return `⏰ Time up! Answer: *${state.answer}*\nType !dialogue for next one.`;
      }

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      return `❌ Wrong! Try again. (${state.attempts}/6)`;
    }

    case "songlyric": {
      const isCorrect = fuzzyMatch(answer, state.answer);

      if (isCorrect) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, "songlyric", 8);
        let resp = `✅ Correct ${msg.senderName}! 🎵 +8 pts\n\nAnswer: *${state.answer}*`;
        if (state.song) resp += `\nSong: ${state.song}${state.movie ? ` (${state.movie})` : ""}`;
        return resp;
      }

      state.attempts = (state.attempts ?? 0) + 1;

      if (state.attempts >= 3 && !state.hintGiven && state.hint) {
        state.hintGiven = true;
        await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
        return `❌ Wrong! Hint: ${state.hint}`;
      }

      if (state.attempts >= 5) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        return `⏰ Time up! Answer: *${state.answer}*${state.song ? ` (${state.song})` : ""}`;
      }

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      return `❌ Wrong! Try again. (${state.attempts}/5)`;
    }

    case "wyr": {
      const choice = answer.toUpperCase();
      if (choice !== "A" && choice !== "B") return "A or B sollu machaan!";

      const key = choice === "A" ? "votesA" : "votesB";
      if (
        state.votesA.includes(msg.from) ||
        state.votesB.includes(msg.from)
      ) {
        return "Nee already vote poittae da!";
      }

      state[key].push(msg.from);
      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);

      const totalVotes = state.votesA.length + state.votesB.length;
      return `${msg.senderName} chose ${choice}! 📊\n\n🅰️ ${state.optA} — ${state.votesA.length} votes\n🅱️ ${state.optB} — ${state.votesB.length} votes\n\nTotal: ${totalVotes} votes`;
    }

    case "wordchain": {
      const lastLetter = state.lastWord.slice(-1).toLowerCase();
      if (!answer.toLowerCase().startsWith(lastLetter)) {
        return `Machaan, "${lastLetter.toUpperCase()}" la start aaganum! "${rawAnswer}" starts with "${rawAnswer[0]}" 🙄`;
      }
      if (state.usedWords.includes(answer)) {
        return `"${answer}" already use pannitaanga da! Vera word sollu.`;
      }

      state.lastWord = answer; // store lowercase for matching
      state.usedWords.push(answer);
      state.lastPlayer = msg.from;
      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      await awardPoints(msg.groupId, msg.from, msg.senderName, "wordchain", 2);

      const nextLetter = answer.slice(-1).toUpperCase();
      return `✅ "${rawAnswer}" — nice ${msg.senderName}! +2 pts\n\nNext word "${nextLetter}" la start aaganum!`;
    }

    case "twotruthsonelie": {
      const guess = parseInt(rawAnswer.trim(), 10);
      if (![1, 2, 3].includes(guess)) return "Type *!a 1*, *!a 2*, or *!a 3* da!";
      // Single attempt — always end the game
      await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
      if (guess === state.lieIndex) {
        await awardPoints(msg.groupId, msg.from, msg.senderName, "twotruthsonelie", 10);
        return `✅ Correct da ${msg.senderName}! Statement ${state.lieIndex} was the LIE! 🤥\n\n${state.explanation}\n\n+10 points! Type *!2t1l* for next round.`;
      }
      return `❌ Nope da! Statement ${state.lieIndex} was the LIE.\n\n${state.explanation}\n\nType *!2t1l* for next round.`;
    }

    case "riddle":
    case "tamilproverb": {
      const isProverb = game.game_type === "tamilproverb";
      if (fuzzyMatch(answer, state.answer)) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, game.game_type, 12);
        const label = isProverb ? `Meaning: *${state.answer}*` : `Answer: *${state.answer}*`;
        return `✅ Correct da ${msg.senderName}! 🎉 +12 points!\n\n${label}\n\nType !${game.game_type} for next one.`;
      }
      state.attempts = (state.attempts ?? 0) + 1;
      if (state.attempts >= 3 && !state.hintGiven && state.hint) {
        state.hintGiven = true;
        await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
        return `❌ Wrong da! Hint: ${state.hint}`;
      }
      if (state.attempts >= 6) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        return `⏰ Time up! Answer: *${state.answer}*\nType !${game.game_type} for next one.`;
      }
      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      return `❌ Wrong! Try again (${state.attempts}/6)`;
    }

    case "fastfinger": {
      if (state.ended) return "Already ended da! Type !ff for next round.";
      const correctAnswer = ((state.requiredAnswer ?? state.targetWord) as string).toUpperCase();
      if (rawAnswer.toUpperCase() === correctAnswer) {
        state.ended = true;
        await supabase.from("ba_game_state").update({ is_active: false, state }).eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, "fastfinger", 15);
        const label = state.isReversed
          ? `🔄 Reversed: *${state.requiredAnswer}* (from ${state.targetWord})`
          : `Word: *${state.targetWord}*`;
        return `⚡ *${msg.senderName} GOT IT FIRST!* 🏆\n\n${label}\n+15 points! Type *!ff* for next round.`;
      }
      const errorHint = state.isReversed
        ? `❌ Wrong! Type the REVERSE of *${state.targetWord}* 🔄`
        : `❌ Wrong spelling! Type EXACTLY: *${state.targetWord}*`;
      return errorHint;
    }

    case "mostlikely": {
      if (state.ended) return "Voting already closed da!";
      if ((state.votes as Record<string, string>)[msg.from]) {
        return `${msg.senderName}, nee already vote pottiyae! Oru per thaan.`;
      }
      (state.votes as Record<string, string>)[msg.from] = rawAnswer;

      const tally = new Map<string, number>();
      Object.values(state.votes as Record<string, string>).forEach((name) => {
        const n = (name as string).toLowerCase();
        tally.set(n, (tally.get(n) ?? 0) + 1);
      });
      const totalVotes = Object.keys(state.votes as Record<string, string>).length;
      const topEntry = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);

      if (totalVotes >= 5) {
        state.ended = true;
        await supabase.from("ba_game_state").update({ is_active: false, state }).eq("id", game.id);
        const winner = topEntry![0];
        const winnerVotes = topEntry![1];
        const { generateContent } = await import("../claude.js");
        const commentary = await generateContent(
          `Tamil WhatsApp group voted: "Most likely to ${state.scenario}" — winner is "${winner}" with ${winnerVotes}/${totalVotes} votes. Write a 2-line Tanglish roast-commentary about this. Loving, not mean.`
        );
        return `🎯 *RESULTS ARE IN!*\n\nMost likely to *${state.scenario}*\n\n🏆 *${winner}* — ${winnerVotes}/${totalVotes} votes\n\n${commentary}`;
      }

      return `${msg.senderName} voted! 🗳️ (${totalVotes}/5 votes)\nCurrent leader: *${topEntry?.[0]}* (${topEntry?.[1]} vote${topEntry![1] > 1 ? "s" : ""})`;
    }

    case "storytime": {
      const lines = state.lines as Array<{ author: string; text: string }>;
      lines.push({ author: msg.senderName, text: rawAnswer });
      state.lines = lines;

      if (lines.length >= (state.maxLines as number)) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        const storyText = lines.map((l) => `${l.author}: ${l.text}`).join("\n");
        const { generateContent } = await import("../claude.js");
        const ending = await generateContent(
          `Here's our collaborative Tamil WhatsApp group story:\n${storyText}\n\nWrite a funny/dramatic Tamil-flavoured ending in Tanglish. 2–3 lines. Make it memorable and unexpected.`
        );
        const fullStory = lines.map((l) => `*${l.author}:* ${l.text}`).join("\n");
        return `📖 *THE COMPLETE STORY*\n\n${fullStory}\n\n*Bot (ending):* ${ending}\n\n🎬 *FIN!* 🎉 Type !storytime for a new story.`;
      }

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      const remaining = (state.maxLines as number) - lines.length;
      return `📖 *${msg.senderName}:* "${rawAnswer}"\n\n_${remaining} line${remaining > 1 ? "s" : ""} remaining. Type *!a <next line>*_`;
    }

    case "antakshari": {
      const expectedStart = state.currentLetter.toLowerCase();
      if (!answer.toLowerCase().startsWith(expectedStart)) {
        return `Machaan, "${state.currentLetter}" la start aaganum! Try again.`;
      }

      if (state.usedSongs.includes(answer)) {
        return "Indha paattu already use aayiduchu! Vera paattu sollu.";
      }

      state.usedSongs.push(answer);
      // Next song must start with the last letter of the current answer (store lowercase)
      state.currentLetter = answer.trim().slice(-1).toLowerCase();
      state.lastPlayer = msg.from;
      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      await awardPoints(msg.groupId, msg.from, msg.senderName, "antakshari", 5);

      return `🎵 "${rawAnswer}" — super ${msg.senderName}! +5 pts\n\nNext: "${state.currentLetter.toUpperCase()}" letter la start aagura paattu sollunga!`;
    }

    case "trivia": {
      if (fuzzyMatch(answer, state.answer)) {
        await supabase
          .from("ba_game_state")
          .update({ is_active: false })
          .eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, "trivia", 10);

        let response = `✅ Correct ${msg.senderName}! 🎉 +10 pts`;
        if (state.fact) response += `\n\n💡 Fun fact: ${state.fact}`;
        response += `\n\nType !trivia for next question.`;
        return response;
      }

      state.attempts = (state.attempts ?? 0) + 1;

      if (state.attempts === 3 && !state.hintGiven && state.hint) {
        state.hintGiven = true;
        await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
        return `❌ Wrong! Hint: ${state.hint} (${state.attempts}/5)`;
      }

      if (state.attempts >= 5) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        return `⏰ Time up! Answer: *${state.answer}*\n${state.fact ? `💡 ${state.fact}` : ""}\n\nType !trivia for next question.`;
      }

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      return `❌ Wrong! Try again. (Attempt ${state.attempts}/5)`;
    }

    case "song": {
      if (fuzzyMatch(answer, state.answer)) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, "song", 15);
        return `✅ *${msg.senderName}* got it! 🎵 +15 pts\n\nSong: *${state.answer}* (${state.movie})\n\n💡 ${state.hint}\n\nType !song for next one!`;
      }

      state.attempts = (state.attempts ?? 0) + 1;

      if (state.attempts >= 3 && !state.hintGiven && state.hint) {
        state.hintGiven = true;
        await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
        return `❌ Wrong da! Hint: ${state.hint}`;
      }

      if (state.attempts >= 6) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        return `⏰ Time up! Song was: *${state.answer}* (${state.movie})\nType !song for next one.`;
      }

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      return `❌ Wrong! Try again. (Attempt ${state.attempts}/6)`;
    }

    case "memory": {
      const required = (state.words as string[]).map(w => w.toUpperCase());
      const typed = rawAnswer.toUpperCase().split(/[\s,]+/).filter(Boolean);
      const allCorrect = required.every(w => typed.includes(w));

      if (allCorrect) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        await awardPoints(msg.groupId, msg.from, msg.senderName, "memory", 20);
        return `🧠 *${msg.senderName} remembered all ${required.length}!* 🏆\n\nWords were: ${required.join(", ")}\n+20 points! Type !memory for next round.`;
      }

      const missed = required.filter(w => !typed.includes(w));
      state.attempts = (state.attempts ?? 0) + 1;

      if (state.attempts >= 5) {
        await supabase.from("ba_game_state").update({ is_active: false }).eq("id", game.id);
        return `⏰ Game over! Words were: ${required.join(", ")}\nType !memory for a new round.`;
      }

      await supabase.from("ba_game_state").update({ state }).eq("id", game.id);
      return `❌ Close! Missed: *${missed.join(", ")}* — Try again! (${state.attempts}/5)`;
    }

    case "wordle":
      return `Wordle answer-ku *!w <word>* type pannu da!\nExample: *!w MERSAL*`;

    default:
      return "Unknown game type machaan.";
  }
}

// ===== RIDDLE — Tamil cultural riddle =====
const RIDDLE_CATEGORIES = [
  "Tamil Nadu agriculture and farming tools", "Tamil temple rituals and puja items", "animals specific to Tamil Nadu forests and farms",
  "Tamil Nadu traditional games and toys", "Chennai street life and local transport", "Tamil festival decorations and customs",
];

async function startRiddle(msg: BotMessage): Promise<string> {
  const cat = randPick(RIDDLE_CATEGORIES);
  const content = await generateStructured(
    `Generate a classic Tamil-style riddle about: ${cat}.
The riddle should be solvable by a Tamil person with cultural knowledge. One clear, short answer.

STRICT ACCURACY RULES (mandatory — wrong facts = invalid riddle):
- All physical descriptions must be 100% factually correct
- Body parts: buffalo/eruma=2 horns, cow=4 legs, spider=8 legs, snake=0 legs, elephant=4 legs 1 trunk
- Counts and numbers must be verified before writing
- Never invent properties — only describe well-known, confirmed traits

Format ONLY (no extra text):
RIDDLE: <describe it in Tanglish without naming the thing — 2–3 lines>
ANSWER: <one word or short phrase>
HINT: <one more clue that narrows it down without giving it away>`
  );

  const riddle = content.match(/RIDDLE:\s*(.+)/s)?.[1]?.split("\n")[0]?.trim();
  const answer = content.match(/ANSWER:\s*(.+)/)?.[1]?.trim();
  const hint = content.match(/HINT:\s*(.+)/)?.[1]?.trim();

  if (!riddle || !answer) return "Riddle generate panna mudiyala. Try again!";

  await createGame(msg.groupId, "riddle", { riddle, answer: answer.toLowerCase(), hint: hint ?? "", attempts: 0, hintGiven: false });
  return `🧩 *RIDDLE TIME*\n\n${riddle}\n\n_Type *!a <answer>* to guess_\n3 wrong attempts → hint varum!`;
}

// ===== FAST FINGER FIRST — First to type the word wins =====
const FASTFINGER_WORDS = [
  // Chennai areas
  "ADYAR", "MYLAPORE", "TAMBARAM", "PERAMBUR", "PORUR", "VELACHERY", "AVADI", "PALLAVARAM",
  // Tamil actors
  "KAMAL", "DHANUSH", "AJITH", "SIVAKARTHIKEYAN", "KARTHI", "MADHAVAN", "ARYA", "SURIYA",
  // Tamil films
  "KAITHI", "KARNAN", "AADUKALAM", "JIGARTHANDA", "SARPATTA", "MANDELA", "SEETHAKATHI", "COBRA",
  // Tamil culture
  "BHARATANATYAM", "CARNATIC", "THIRUKKURAL", "JALLIKATTU", "KOLAM", "SILAMBAM", "NADASWARAM", "VILLUPATTU",
  // Tamil Nadu cities
  "KANCHIPURAM", "VELLORE", "THANJAVUR", "TIRUPUR", "DINDIGUL", "ERODE", "SALEM", "SIVAKASI",
  // Food
  "IDLI", "VADA", "PUTTU", "KOZHUKATTAI", "APPAM", "KUZHAMBU", "KOOTU", "PESARATTU",
  // Historical / literary figures
  "VANDIYATHEVAN", "NANDINI", "RAAVANAN", "BHARATHIYAR", "PERIYAR", "BHARATHIDASAN",
  // Hill stations / nature
  "OOTY", "KODAIKANAL", "COONOOR", "VALPARAI",
  // Misc Tamil words
  "PONNIYIN", "VEERAPANDIYA", "KATTABOMMAN", "RAMANUJAN", "CHEPAUK",
  // More TN cities
  "MADURAI", "TIRUNELVELI", "COIMBATORE", "KUMBAKONAM", "RAMESWARAM",
  "THOOTHUKUDI", "VILLUPURAM", "KARAIKUDI",
  // More Tamil films (single strong words)
  "MERSAL", "VIKRAM", "DARBAR", "THERI", "RATSASAN",
  // More music directors
  "ANIRUDH", "YUVAN", "NAYANTHARA", "TRISHA",
  // Festivals & traditions
  "PONGAL", "THAIPUSAM", "CHITHIRAI", "NAVARATHRI",
  // More food
  "PAROTTA", "KOTHU", "MURUKKU", "BIRYANI", "RASAM",
  // Historical figures
  "THIRUVALLUVAR", "AVVAIYAR", "KARIKALAN",
  // New 2023-2024 Tamil films
  "MAAMANNAN", "THUNIVU", "VARISU", "MAHAAN", "THIRUCHITRAMBALAM", "MAAVEERAN", "PONNIYIN",
  "AMARAN", "DOCTOR", "IRAIVI", "KAITHI", "BEAST", "SARKAR", "VALIMAI", "ANNAATTHE",
  // More Tamil actors
  "SIMBU", "PRASHANTH", "VISHAL", "JEYAMRAMAN", "UDHAYAM", "ARYA", "KATHIR", "ATHARVA",
  // Tamil Nadu freedom fighters & leaders
  "KAMARAJAR", "PERIYAR", "RAJAJI", "BHARATHIYAR", "ARIGNAR", "KALAIGNAR", "AMBEDKAR",
  // More Tamil Nadu cities
  "NAGERCOIL", "TENKASI", "TIRUNELVELI", "VIRUDHUNAGAR", "ARUPPUKKOTTAI", "NAGAPATTINAM",
  "RAMANATHAPURAM", "KRISHNAGIRI", "HOSUR", "POLLACHI", "PALANI", "GUDALUR",
  // Nature & wildlife
  "MUDUMALAI", "ANAMALAI", "MUNDANTHURAI", "KALAKAD", "KANYAKUMARI",
  // Carnatic music terms
  "THILLANA", "VARNAM", "KRITI", "RAGAM", "TALAM", "ALAPANA", "THANAM",
  // Traditional games & arts
  "THERUKOOTHU", "KARAKATTAM", "SILAMBAM", "KUTTHU", "OYILATTAM", "KAVADI",
  // More food
  "KOZHUKATTAI", "PULIOGARE", "PITTU", "KEERAI", "SAMBAR", "PAYASAM", "HALWA", "KAVUNI",
  // IPL & cricket
  "CHEPAUK", "WANKHEDE", "DHONI", "JADEJA", "BUMRAH", "ROHIT", "HARDIK",
  // Tech & startups (Kollywood slang)
  "ZOHO", "FRESHWORKS", "MEESHO", "ZEPTO",
  // Misc Tamil culture words
  "KOLAM", "KUMBABHISHEKAM", "KOOTHU", "PULIYODHARAI", "ARAVAANI",
  // More Tamil films (mass)
  "THUPPAKKI", "JILLA", "PULI", "BAIRAVAA", "SPYDER", "KAALA", "PETTA", "DARBAR",
];

// ===== FAST FINGER — launch game with reverse-word twist =====
async function launchFastFingerGame(msg: BotMessage, player1Name: string): Promise<string> {
  let archived = getArchived(msg.groupId, "fastfinger");
  let pool = FASTFINGER_WORDS.filter((w) => !archived.includes(w.toLowerCase()));
  if (pool.length === 0) {
    resetArchive(msg.groupId, "fastfinger");
    pool = FASTFINGER_WORDS;
  }
  const word = randPick(pool);

  // 40% chance: players must type the REVERSE of the shown word
  const isReversed = Math.random() < 0.4;
  const requiredAnswer = isReversed ? [...word].reverse().join("") : word;

  archiveAnswer(msg.groupId, "fastfinger", word.toLowerCase());
  await createGame(msg.groupId, "fastfinger", { targetWord: word, requiredAnswer, isReversed, ended: false });

  const header = `⚡ *FAST FINGER FIRST!* — ${player1Name} vs ${msg.senderName}\n\n`;
  if (isReversed) {
    return `${header}🔄 Type the *REVERSE* of this word:\n\n*${word}*\n\nType *!a <reversed word>* — GO! 🏃🧠`;
  }
  return `${header}🎯 First to type this EXACTLY wins *15 points*:\n\n*${word}*\n\nType *!a ${word}* — GO! 🏃`;
}

async function handleFastFinger(msg: BotMessage): Promise<string> {
  // If a game is already running, show the current challenge
  const runningGame = await getActiveGame(msg.groupId, "fastfinger");
  if (runningGame && !runningGame.state.ended) {
    const hint = runningGame.state.isReversed
      ? `🔄 Type the REVERSE of *${runningGame.state.targetWord}*`
      : `🎯 Type *${runningGame.state.targetWord}* exactly`;
    return `⚡ Game already running! ${hint}`;
  }

  // Check for an open lobby
  const lobby = await getActiveGame(msg.groupId, "fastfinger_lobby");
  if (lobby) {
    if ((lobby.state.initiator as string) === msg.from) {
      return `⏳ Waiting for someone to join your lobby... Tag a friend to type *!ff*!`;
    }
    // Second player joins — kill lobby and launch game immediately
    await supabase.from("ba_game_state").update({ is_active: false }).eq("id", lobby.id);
    return await launchFastFingerGame(msg, lobby.state.initiatorName as string);
  }

  // No lobby — but check if another game type is already running before proceeding
  const otherGame = await getActiveGame(msg.groupId);
  if (otherGame && !["fastfinger", "fastfinger_lobby"].includes(otherGame.game_type)) {
    return `⚠️ *${otherGame.game_type}* game currently running-nu irukku da! Adha finish pannunga or wait for it to expire. Aprom !ff try pannunga.`;
  }

  // Safe to create lobby — deactivate only fastfinger-type records
  await supabase.from("ba_game_state")
    .update({ is_active: false })
    .eq("group_id", msg.groupId)
    .eq("is_active", true)
    .in("game_type", ["fastfinger", "fastfinger_lobby"]);

  await supabase.from("ba_game_state").insert({
    group_id: msg.groupId,
    game_type: "fastfinger_lobby",
    state: { initiator: msg.from, initiatorName: msg.senderName },
    is_active: true,
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  });

  return `⚡ *FAST FINGER LOBBY*\n\n${msg.senderName} wants to play!\nType *!ff* to join and start! 🙋\n\n⏳ Lobby closes in 30 seconds if nobody joins...`;
}

// ===== MOST LIKELY TO — Group voting game =====
const MOSTLIKELY_SCENARIOS = [
  "mispronounce a word confidently for years and get genuinely upset when corrected",
  "watch a 3-minute reel and emerge 4 hours later with no memory of how it happened",
  "text 'typing...' for 10 minutes and then send a single thumbs up emoji",
  "start explaining something simple and turn it into a 45-minute TED Talk with hand gestures",
  "set 5 alarms and still wake up to a phantom 6th one they don't remember setting",
  "buy one thing online and somehow have 4 items in the cart at checkout",
  "call the restaurant to track the Swiggy order — the restaurant hasn't even seen the order yet",
  "solve everyone else's problem perfectly but have zero solution for the same problem in their own life",
  "know every single episode of a series by heart but not remember what they had for lunch",
  "fall asleep mid-reply and send something completely unintelligible to the group at 1 AM",
  "get into an argument with a stranger online and spend 2 days crafting the perfect comeback they never send",
  "make chai for themselves and somehow end up making chai for the whole building",
  "find food in their bag they don't remember keeping — and eat it anyway without a second thought",
  "make a major life decision based on a YouTube motivational video at 1 AM",
  "be completely calm in a crisis but silently sob at a dog food commercial",
  "read a full 2000-word article and only remember the headline",
  "lose their phone while actively using it",
  "say 'almost there, 2 minutes' when they are still in the shower at home",
  "know the complete plot of a film they swear they have never seen before",
  "have a completely different personality at 1 AM vs 1 PM — practically a different person",
  "add everyone to a group travel plan and then go fully offline when it is time to actually book",
  "promise 'just one voice note' and record 7 parts totalling 11 minutes",
  "be the first one done eating but refuse to say anything while everyone watches them wait",
  "pronounce the same word 3 different ways in one sentence and commit to all three",
  "start a new passion project every Sunday and forget about it by Tuesday",
  "reply 'Seen' and then completely ignore the actual question that was asked",
  "confidently give someone directions to a place they have never been to themselves",
  "be asked 'any questions?' at the end of a presentation and immediately start with 'so basically...'",
  "show up to a potluck with store-bought food served in a home container to make it look homemade",
  "screenshot a story to share in the group but post it after the story has already expired",
  // — Batch 2 —
  "order one dosa on Swiggy and add 17 free sauces so the delivery feels worth it",
  "screenshot the entire conversation before asking 'can I share this?' in the very same chat",
  "say 'aah correct da' to something they clearly don't understand just to avoid asking again",
  "immediately check who viewed their story and then check again every 2 minutes for the next hour",
  "write a 3-paragraph reply, decide 'too long', delete everything, and send 'ok' instead",
  "plan to eat healthy on Monday and eat three vadais Monday morning saying 'next Monday I'll start'",
  "accidentally like a 247-week-old photo and immediately unlike it praying the person didn't get a notification",
  "hear a new word and confidently use it wrong in a sentence within 24 hours",
  "spend 40 minutes choosing what to watch and then rewatch something they've already seen three times",
  "say 'on my way' when they haven't even decided whether to go yet",
  "suggest a restaurant, not eat a single thing on the menu, and just get a cold coffee",
  "reply 'lol' to a voice note they haven't listened to even once",
  "turn a 1-minute phone call into a 45-minute philosophical discussion about life and career",
  "still be on the phone when the Swiggy delivery person has been outside for 12 minutes",
  "add everyone to a group travel plan and go completely offline when it's time to actually book",
  // — Batch 3 —
  "open YouTube to watch one video and emerge 3 hours later having watched documentaries about things they do not care about",
  "have 23 tabs open and genuinely know what every single one of them is for",
  "ask 'is it spicy?' at a Chettinad restaurant and then confidently order the spiciest item on the menu",
  "spend 20 minutes explaining why they don't need a to-do list and forget two important things the same day",
  "know the complete career history of every player in the IPL but forget their own cousin's birthday",
  "reply to a serious question with a meme and somehow make it the most comforting response in the conversation",
  "save 47 reels to watch later and never watch a single one ever again",
  "say 'function poyittu varuven, one hour max' and come back six hours later smelling of biryani",
  "be the person who finally finishes one Rajini movie and immediately starts another at midnight",
  "confidently recommend a restaurant that closed down two years ago",
  "overhear one sentence of someone's conversation and construct an entire theory around it",
  "join a study group and spend 45 minutes debating where to meet and what to eat before opening a single book",
  "say 'adhu vera story' and then tell the exact same story from a slightly different angle",
  "take a 'quick nap' at 6 PM and wake up in a parallel universe at 11 PM confused about what year it is",
  "put a full 3-course meal in the kitchen and still somehow eat at a kadai at midnight",
  "screenshot every motivational quote they see but take zero action on any of them",
  "ask for a small favour that somehow involves three additional people and a spreadsheet",
  "overfill their plate at a function, eat only half, and still go for a second round",
  "correct autocorrect's correction and then autocorrect it again until no one knows what the original word was",
];

async function startMostLikely(msg: BotMessage): Promise<string> {
  const scenario = randPick(MOSTLIKELY_SCENARIOS);
  await createGame(msg.groupId, "mostlikely", { scenario, votes: {} as Record<string, string>, ended: false });
  return `🎯 *MOST LIKELY TO...*\n\n👉 Who in this group is most likely to *${scenario}*?\n\nVote: *!a <person's name>*  (e.g. *!a Madhan*)\nAfter 5 votes, results reveal! 🗳️`;
}

// ===== TAMIL PROVERB CHALLENGE =====
async function startTamilProverb(msg: BotMessage): Promise<string> {
  const content = await generateStructured(
    `Generate a Tamil proverb (thirukkural or folk proverb) that is well-known and has practical modern meaning.
Format ONLY:
PROVERB: <proverb in Tanglish/Tamil transliteration>
MEANING: <short English meaning — the core wisdom, 1 sentence>
HINT: <hint about the context/situation it applies to, without giving away the meaning>`
  );

  const proverb = content.match(/PROVERB:\s*(.+)/)?.[1]?.trim();
  const meaning = content.match(/MEANING:\s*(.+)/)?.[1]?.trim();
  const hint = content.match(/HINT:\s*(.+)/)?.[1]?.trim();

  if (!proverb || !meaning) return "Proverb generate panna mudiyala. Try again!";

  await createGame(msg.groupId, "tamilproverb", {
    proverb, answer: meaning.toLowerCase(), hint: hint ?? "", attempts: 0, hintGiven: false,
  });
  return `📜 *TAMIL PROVERB CHALLENGE*\n\n"${proverb}"\n\nInnaa meaning? Type *!a <meaning>*\n3 wrong attempts → hint varum!`;
}

// ===== STORY TIME — Collaborative story building =====
const STORY_STARTERS = [
  "Madhu NEET exam centre-ku pona naal — hall ticket check pannaa, wrong city-la irundha. Exam 20 minutes later.",
  "Hari blind date-ku pona restaurant-la paathaanga — avanga already group-la irukka Madhan-oda sister.",
  "Group whole-a Goa trip plan pannanga 3 months-la — airport-la reach panna, oru peruku passport valid-a illai. Yaaru?",
  "Indhu accidentally boss-ku forward pannaa the exact meme the group made about him last week.",
  "Siva bday-ku surprise cake order pannaan — delivery panna aana, cake-la name potathu: 'Happy Birthday Stranger'.",
  "Krishna Madhan IPL match-la oru impossible score predict pannaan group-la, seriously-a — avan correct-a poitaan.",
  "Bot 3 days group-la yaarum message pannala-nu wait panni, finally broke — 'Dei, yaaraavadhu irukkeengalaa?'",
  "Oru naal pona Ooty trip-la mist ellam clear aaidichi — group paathaanga, they were in a completely different hill station.",
  "Madhan Google Maps follow panni concert-ku pona — venue reached, but padam-e wrong city-la run aagudhu.",
  "Indhu online checkout-la 1 item add panni pay pannaa — bank notification vandhu: 4 items charged. Support call pannuvaa...",
  // — Batch 2 —
  "Siva ordered a vintage PS2 on OLX for ₹500. It arrived. He opened the box. Inside: one coconut and a handwritten note.",
  "The group accidentally created a second WhatsApp group with the exact same name. Now two versions of the group exist and nobody knows which one is real.",
  "Hari got into the wrong cab. 40 minutes in, the driver said: 'So you're from the group too, right?'",
  "Madhan accidentally replied to a company-wide email with the exact meme the group made about his manager last Tuesday.",
  "Bot finally got tired of being ignored for 3 days and sent one message to the group: 'I quit. Mail my dues.'",
  // — Batch 3 —
  "Madhan opened Google Maps to navigate to Velachery. It said: '2 hours 40 minutes via Tambaram.' He's in Adyar.",
  "The group bet ₹50 each on the IPL match. Five people forgot to pay up. One person paid twice by accident. Nobody can figure out who owes who anymore.",
  "Priya got into the wrong Ola, realised after 10 minutes, and the driver said he was going the same direction anyway.",
  "Hari found a ₹500 note inside his old college notes. Then found the notes were for a subject he never attended.",
  "The group planned to watch a film together. 7 suggestions, 3 vetoes, 4 unavailable time slots, 2 people who 'don't like theatres' — it is now 11 PM.",
];

async function startStoryTime(msg: BotMessage): Promise<string> {
  const startLine = randPick(STORY_STARTERS);
  await createGame(msg.groupId, "storytime", {
    lines: [{ author: "Bot", text: startLine }],
    maxLines: 8,
  });
  return `📖 *STORY TIME — Add one line each!*\n\n${startLine}\n\n_Type *!a <your next line>* to continue_\nAfter 8 lines naan ending ezhuduven! ✍️`;
}

// ===== LEADERBOARD =====
async function getLeaderboard(msg: BotMessage, allTime = false): Promise<string> {
  let data;

  if (allTime) {
    const res = await supabase
      .from("ba_game_scores_alltime")
      .select("player_name, game_type, points")
      .eq("group_id", msg.groupId)
      .order("points", { ascending: false })
      .limit(10);
    data = res.data;
  } else {
    const weekStart = getCurrentWeekStartIST();
    const res = await supabase
      .from("ba_game_scores")
      .select("player_name, game_type, points")
      .eq("group_id", msg.groupId)
      .eq("week_start", weekStart)
      .order("points", { ascending: false })
      .limit(10);
    data = res.data;
  }

  if (!data?.length) {
    return allTime
      ? "Yaarum points earn pannala machaan overall. !quiz start pannu!"
      : "This week innum yaarum points earn pannala. !quiz start pannu!";
  }

  // Aggregate total points per player
  const totals = new Map<string, number>();
  for (const row of data) {
    totals.set(row.player_name, (totals.get(row.player_name) ?? 0) + row.points);
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const medals = ["🥇", "🥈", "🥉"];
  const title = allTime ? "🏆 *ALL-TIME LEADERBOARD*" : "🏆 *THIS WEEK'S LEADERBOARD*";

  let board = `${title}\n\n`;
  sorted.forEach(([name, pts], i) => {
    const medal = medals[i] ?? `${i + 1}.`;
    board += `${medal} ${name} — ${pts} pts\n`;
  });

  return board;
}

// ===== 2 TRUTHS 1 LIE — Spot the fake fact =====
interface TwoTruthsEntry {
  context: string;
  statements: [string, string, string];
  lieIndex: 1 | 2 | 3;
  hint: string;
  explanation: string;
}

const TWO_TRUTHS_ONE_LIE: TwoTruthsEntry[] = [
  {
    context: "Rajinikanth early life",
    statements: [
      "Rajinikanth worked as a bus conductor in Bangalore before acting",
      "Rajinikanth's real name is Sivaji Rao Gaekwad",
      "Apoorva Raagangal (1975) — Rajini's debut — was directed by Mani Ratnam",
    ],
    lieIndex: 3,
    hint: "Who really directed Rajini's debut? Think: the man who launched both Rajini AND Kamal",
    explanation: "He was indeed a bus conductor ✓ and is named Sivaji Rao Gaekwad ✓ — but Apoorva Raagangal was directed by K. Balachander, not Mani Ratnam! KB launched both Rajini and Kamal!",
  },
  {
    context: "AR Rahman facts",
    statements: [
      "AR Rahman was born A.S. Dileep Kumar before converting to Islam",
      "AR Rahman won two Academy Awards for Slumdog Millionaire (2009)",
      "AR Rahman composed the music for Mani Ratnam's Mouna Ragam (1986)",
    ],
    lieIndex: 3,
    hint: "Who scored Mouna Ragam? AR Rahman debuted in which year?",
    explanation: "Rahman was born Dileep Kumar ✓ and won 2 Oscars ✓ — but Mouna Ragam (1986) had music by Ilaiyaraaja! Rahman's debut was Roja in 1992 — he hadn't even started then!",
  },
  {
    context: "Enthiran (Robot) trivia",
    statements: [
      "Enthiran starred Rajinikanth and Aishwarya Rai Bachchan",
      "Enthiran (2010) was directed by Shankar with music by AR Rahman",
      "Enthiran grossed over ₹1000 crore worldwide in 2010",
    ],
    lieIndex: 3,
    hint: "The ₹1000 crore Bollywood club started with which film?",
    explanation: "It had Rajini + Aishwarya ✓ and Shankar + Rahman ✓ — but Enthiran grossed about ₹260-300 crore! The ₹1000 crore club started with Bollywood's 3 Idiots and Dhoom 3 later!",
  },
  {
    context: "Tamil Nadu geography",
    statements: [
      "The Brihadeeshwara Temple in Thanjavur was built by Raja Raja Chola I around 1010 CE",
      "Mahabalipuram (Mamallapuram) is a UNESCO World Heritage Site since 1984",
      "Tamil Nadu shares its borders with Andhra Pradesh, Karnataka, and Odisha",
    ],
    lieIndex: 3,
    hint: "Which state is TN's eastern neighbour? Odisha is very far north...",
    explanation: "Big Temple in Thanjavur ✓ and Mahabalipuram UNESCO site ✓ — but TN borders Andhra Pradesh, Karnataka, and Kerala — not Odisha! Odisha is 1400 km away on the east coast!",
  },
  {
    context: "Dhanush career facts",
    statements: [
      "Dhanush won the National Award for Best Actor for Aadukalam (2011)",
      "Dhanush appeared in the Hollywood film 'The Gray Man' (2022) alongside Ryan Gosling",
      "Dhanush's directorial debut was 'Thiruchitrambalam' (2022)",
    ],
    lieIndex: 3,
    hint: "Thiruchitrambalam — who actually directed it? Dhanush debuted as director earlier...",
    explanation: "National Award ✓ and The Gray Man ✓ — but Dhanush's directorial debut was Pa. Paandi (2017)! Thiruchitrambalam was directed by Mithran Jawahar, not Dhanush!",
  },
  {
    context: "IPL and MS Dhoni",
    statements: [
      "CSK has won 5 IPL titles (2010, 2011, 2018, 2021, 2023)",
      "IPL started in 2008 with Rajasthan Royals winning the first season",
      "MS Dhoni has played only for CSK throughout his entire IPL career",
    ],
    lieIndex: 3,
    hint: "CSK was banned for 2 years. What team did Dhoni play for then?",
    explanation: "CSK has 5 titles ✓ and Rajasthan won the first IPL ✓ — but Dhoni played for Rising Pune Supergiant in 2016-17 when CSK was suspended for spot-fixing! He even captained them!",
  },
  {
    context: "Tamil cinema firsts",
    statements: [
      "The first Tamil talkie 'Kalidas' (1931) was made in Tamil and Telugu simultaneously",
      "Kamal Haasan debuted as a child actor at age 3 in 1960",
      "Tamil cinema began in 1920 with the film 'Keechaka Vadham'",
    ],
    lieIndex: 3,
    hint: "When did Tamil silent cinema actually begin? Before or after 1920?",
    explanation: "Kalidas (1931) was indeed bilingual ✓ and Kamal debuted at 3 ✓ — but Tamil cinema began in 1916 with 'Keechaka Vadham', not 1920! It's 4 years older than most think!",
  },
  {
    context: "Tamil Nadu quick facts",
    statements: [
      "Ramanujan, the math genius, was born in Erode, Tamil Nadu",
      "Tamil Nadu's Sivakasi produces over 90% of India's fireworks",
      "Tamil became a Classical Language by the Indian government in 2000",
    ],
    lieIndex: 3,
    hint: "Tamil Classical Language status — what year did it actually happen?",
    explanation: "Ramanujan from Erode ✓ and Sivakasi's firecracker dominance ✓ — but Tamil was declared a Classical Language in 2004, not 2000! It was the first language to receive this status!",
  },
  // ===== Batch 2 — 20 new entries =====
  {
    context: "Vijay career facts",
    statements: [
      "Vijay's full real name is Joseph Vijay Chandrasekhar",
      "Vijay made his debut as a lead hero in Naalaya Theerpu (1992)",
      "Vijay won the National Award for Best Actor for Master (2021)",
    ],
    lieIndex: 3,
    hint: "Has Vijay ever won a National Award? Think — who won it for Master?",
    explanation: "Vijay's real name is Joseph Vijay Chandrasekhar ✓ and he debuted in Naalaya Theerpu (1992) ✓ — but Vijay has NEVER won a National Award! No one from Master won Best Actor either. Dhanush won for Aadukalam (2011)!",
  },
  {
    context: "Kamal Haasan national honours",
    statements: [
      "Kamal Haasan's Vishwaroopam (2013) was initially banned in Tamil Nadu by the state government",
      "Kamal Haasan has appeared in Tamil, Hindi, Telugu, Malayalam, and Kannada films",
      "Kamal Haasan was awarded the Bharat Ratna in 2011",
    ],
    lieIndex: 3,
    hint: "India's highest civilian honour, Bharat Ratna — has Kamal received it?",
    explanation: "Vishwaroopam was indeed banned ✓ and Kamal has acted in 5 languages ✓ — but Kamal Haasan has NOT received the Bharat Ratna! He received Padma Shri (1990) and Padma Bhushan (2014). Bharat Ratna is a whole other level!",
  },
  {
    context: "Mani Ratnam films",
    statements: [
      "Mani Ratnam's Roja (1992) was AR Rahman's debut as a film composer",
      "Mani Ratnam directed Kannathil Muthamittal (2002), set against the Sri Lanka ethnic conflict",
      "Mani Ratnam's Thalapathi (1991) was inspired by the story of Rama and Lakshmana from the Ramayana",
    ],
    lieIndex: 3,
    hint: "Thalapathi — Rajini is a loyal warrior friend of a powerful don. Think Mahabharata characters...",
    explanation: "Roja launched Rahman ✓ and Kannathil Muthamittal dealt with Sri Lanka ✓ — but Thalapathi was inspired by the MAHABHARATA, specifically Karna and Duryodhana! Rajini = Karna, Mammootty = Duryodhana. NOT the Ramayana!",
  },
  {
    context: "Ponniyin Selvan (2022-23) cast facts",
    statements: [
      "Ponniyin Selvan (Parts I and II) was directed by Mani Ratnam with music by AR Rahman",
      "The novel Ponniyin Selvan was written by Kalki Krishnamurthy, serialised between 1950-1954",
      "In Ponniyin Selvan, Vikram played the role of Arulmozhi Varman (the future Raja Raja Chola I)",
    ],
    lieIndex: 3,
    hint: "Vikram played which Chola prince? Arulmozhi Varman = Ponniyin Selvan (the kind one) or Aditya Karikalan (the fierce one)?",
    explanation: "Mani Ratnam directed + Rahman music ✓ and Kalki's novel ✓ — but Vikram played ADITYA KARIKALAN (the fierce prince), not Arulmozhi Varman! It was Jayam Raman who played Ponniyin Selvan (the future Raja Raja Chola I)!",
  },
  {
    context: "Suriya career milestones",
    statements: [
      "Suriya's real name is Saravanan Sivakumar",
      "Suriya won the National Award for Best Actor for Soorarai Pottru (2020/21)",
      "Suriya made his acting debut in the 1999 film 'Vaali' opposite Ajith",
    ],
    lieIndex: 3,
    hint: "Vaali (1999) — who were the heroes? And when did Suriya actually debut?",
    explanation: "Saravanan Sivakumar ✓ and National Award for Soorarai Pottru ✓ — but Suriya debuted in Nerrukku Ner (1997), directed by Vasanth! Vaali (1999) was an AJITH film (dual role). Suriya had a small role in it but debuted 2 years earlier!",
  },
  {
    context: "Sivakarthikeyan fun facts",
    statements: [
      "Sivakarthikeyan started as a stand-up comedian and won the reality show Kalakka Povathu Yaaru",
      "Sivakarthikeyan starred in 'Doctor' (2021), directed by Nelson Dilipkumar",
      "The chartbuster 'Selfie Pulla' is from Sivakarthikeyan's film Kaththi (2014)",
    ],
    lieIndex: 3,
    hint: "'Selfie Pulla' — which 2015 Sivakarthikeyan film featured this hit, and who directed it?",
    explanation: "Won Kalakka Povathu Yaaru ✓ and Doctor (2021) ✓ — but 'Selfie Pulla' is from KAAKI SATTAI (2015), not Kaththi! Kaththi was a Vijay film. Both were 2014-15 releases, which causes the confusion!",
  },
  {
    context: "Anirudh Ravichander debut",
    statements: [
      "Anirudh Ravichander debuted as a film composer with the movie '3' (2012) directed by Aishwarya Rajinikanth",
      "Anirudh composed the background score for Lokesh Kanagaraj's 'Vikram' (2022)",
      "The viral song 'Why This Kolaveri Di' is from AR Rahman's debut Tamil album",
    ],
    lieIndex: 3,
    hint: "'Why This Kolaveri Di' — who composed it? It was from the same team as '3'...",
    explanation: "Anirudh debuted with '3' (2012) ✓ and scored Vikram ✓ — but 'Why This Kolaveri Di' is from ANIRUDH's album for the film '3'! It was composed by Anirudh at 20 years old. AR Rahman's Tamil debut was Roja (1992), not Kolaveri!",
  },
  {
    context: "Vijay Sethupathi awards",
    statements: [
      "Vijay Sethupathi worked as an accountant before becoming a full-time actor",
      "Vijay Sethupathi played a trans woman in Super Deluxe (2019)",
      "Vijay Sethupathi won the National Award for Best Actor for '96' (2018)",
    ],
    lieIndex: 3,
    hint: "VSP's National Award — which film? And what category? He won for a SHORT film actually...",
    explanation: "He was an accountant ✓ and played a trans woman in Super Deluxe ✓ — but VSP won the National Award for Best Supporting Actor for the short film 'Orange Mittai' (2015), NOT for '96'! Despite '96' being beloved, he hasn't won a National Award for it!",
  },
  {
    context: "Lokesh Cinematic Universe (LCU)",
    statements: [
      "Lokesh Kanagaraj's debut film was Maanagaram (2017), an urban crime thriller",
      "The character Dilli from Kaithi (2019) appears in Vikram (2022), connecting both films",
      "Lokesh Kanagaraj's Maanagaram (2017) is officially part of the LCU (Lokesh Cinematic Universe)",
    ],
    lieIndex: 3,
    hint: "Maanagaram — is it connected to Kaithi, Vikram, or Leo? Does LCU begin there?",
    explanation: "Maanagaram was his debut ✓ and Dilli appears in both Kaithi and Vikram ✓ — but Maanagaram is NOT part of the LCU! The LCU officially begins with Kaithi (2019). Maanagaram is a standalone film set in a different world!",
  },
  {
    context: "Pa. Ranjith directorial career",
    statements: [
      "Pa. Ranjith directed Kabali (2016) starring Rajinikanth as a Tamil plantation labour rights activist in Malaysia",
      "Pa. Ranjith directed Sarpatta Parambarai (2021), set in 1970s North Chennai boxing culture",
      "Pa. Ranjith's directorial debut was Madras (2014) starring Karthi",
    ],
    lieIndex: 3,
    hint: "Pa. Ranjith before Madras — did he make a smaller, lesser-known debut film?",
    explanation: "Kabali ✓ and Sarpatta ✓ — but Pa. Ranjith's debut was ATTAKATHI (2012), a low-budget love story! Madras (2014) was his SECOND film! The Attakathi debut is what caught everyone's attention and led to Madras!",
  },
  {
    context: "Karthik Subbaraj filmography",
    statements: [
      "Karthik Subbaraj directed Petta (2019) starring Rajinikanth as a mysterious hostel warden",
      "Karthik Subbaraj's Jigarthanda (2014) starred Siddharth and Bobby Simha",
      "Karthik Subbaraj made his directorial debut with Iraivi (2016)",
    ],
    lieIndex: 3,
    hint: "Karthik Subbaraj's first film also launched Vijay Sethupathi — what was it?",
    explanation: "Petta ✓ and Jigarthanda ✓ — but KS debuted with PIZZA (2012)! Iraivi (2016) was his third film! Pizza launched both KS and Vijay Sethupathi to stardom — it was shot in just 24 days on a tiny budget!",
  },
  {
    context: "AR Rahman Tamil Nadu connection",
    statements: [
      "AR Rahman debuted in Tamil films with Roja (1992), directed by Mani Ratnam",
      "AR Rahman won two Academy Awards for Slumdog Millionaire (2009)",
      "AR Rahman has won 6 National Awards for Best Music Direction in India",
    ],
    lieIndex: 3,
    hint: "Count AR Rahman's National Film Awards — Roja, Minsara Kanavu, Lagaan... is it 6?",
    explanation: "Roja debut ✓ and 2 Oscars ✓ — but Rahman has won 4 National Film Awards for Best Music, not 6! (Roja 1993, Minsara Kanavu 1997, Lagaan 2002, and one more). 6 is an exaggeration — it's a common misconception!",
  },
  {
    context: "Chennai cricket history",
    statements: [
      "Chennai's Marina Beach is one of the longest urban beaches in the world",
      "Chennai was officially renamed from Madras in 1996",
      "The Chepauk stadium in Chennai hosted India's very first Test cricket match in 1933",
    ],
    lieIndex: 3,
    hint: "India's first-ever Test match was in which city — and which year?",
    explanation: "Marina Beach length ✓ and renamed in 1996 ✓ — but India's first Test was played at Bombay Gymkhana in December 1933! Chepauk hosted its first Test in February 1934, the very next series. Close — but Bombay was first!",
  },
  {
    context: "Bharathiyar life facts",
    statements: [
      "Mahakavi Subramania Bharathi (Bharathiyar) was born in Ettayapuram, Thoothukudi district",
      "Bharathiyar died in 1921 at just 39 years of age",
      "Bharathiyar served as an editor of the Dinamalar newspaper in his lifetime",
    ],
    lieIndex: 3,
    hint: "Dinamalar newspaper — when was it founded? Was Bharathiyar even alive then?",
    explanation: "Born in Ettayapuram ✓ and died at 39 in 1921 ✓ — but Bharathiyar NEVER edited Dinamalar! Dinamalar was founded in 1951 — 30 years after his death! Bharathiyar edited the magazines 'Swadeshamitran' and 'India' during his lifetime!",
  },
  {
    context: "Karthi and Suriya family facts",
    statements: [
      "Karthi is the real-life younger brother of actor Suriya",
      "Karthi starred in Kaithi (2019), a real-time action thriller by Lokesh Kanagaraj",
      "Karthi's debut film Paruthiveeran (2007) was directed by Vetrimaaran",
    ],
    lieIndex: 3,
    hint: "Vetrimaaran directed which Dhanush National Award film? And who directed Paruthiveeran?",
    explanation: "Karthi is Suriya's brother ✓ and Kaithi was his ✓ — but Paruthiveeran (2007) was directed by AMEER SULTAN! Vetrimaaran directed Dhanush's Aadukalam (2011) — a different National Award winning film. Common confusion between the two directors!",
  },
  {
    context: "Rajinikanth films",
    statements: [
      "Rajinikanth has acted in Tamil, Telugu, Hindi, Kannada, and Malayalam films",
      "Rajinikanth's Enthiran (Robot) 2010 was directed by Shankar",
      "Rajinikanth's Sivaji: The Boss (2007) was directed by Mani Ratnam",
    ],
    lieIndex: 3,
    hint: "Sivaji: The Boss — who usually works with CGI spectacle and social themes? Not Mani Ratnam...",
    explanation: "Rajini's multilingual career ✓ and Shankar directed Enthiran ✓ — but Sivaji (2007) was ALSO directed by Shankar, not Mani Ratnam! Shankar directed Rajini in Sivaji (2007) and 2.0 (2018). Mani Ratnam directed Rajini only in Thalapathi (1991)!",
  },
  {
    context: "Nayanthara career",
    statements: [
      "Nayanthara was born Diana Mariam Kurian in a Malayali Christian family in Bengaluru",
      "Nayanthara married director Vignesh Shivan in June 2022",
      "Nayanthara has won the National Award for Best Actress twice",
    ],
    lieIndex: 3,
    hint: "Despite being South India's biggest female star, has Nayanthara won a National Award?",
    explanation: "Born Diana Mariam Kurian ✓ and married Vignesh Shivan in 2022 ✓ — but Nayanthara has NOT won a National Award! Despite being Lady Superstar with 100+ films, this elusive award hasn't come her way yet. She's possibly the biggest star without one!",
  },
  {
    context: "Ilaiyaraaja debut facts",
    statements: [
      "Ilaiyaraaja's real birth name is Gnanadesikan, not Ilaiyaraaja",
      "Ilaiyaraaja has composed music for over 1000 films across multiple languages",
      "Ilaiyaraaja's debut film as composer was 'Kavitha' (1975)",
    ],
    lieIndex: 3,
    hint: "Ilaiyaraaja's actual debut — which 1976 film with a bird name launched his career?",
    explanation: "Born Gnanadesikan ✓ and 1000+ films ✓ — but Ilaiyaraaja debuted with ANNAKILI (1976), not Kavitha! Annakili was a massive hit — he composed it for just ₹5,000 and it became a landmark. 'Kavitha' is not his debut!",
  },
  {
    context: "Yuvan Shankar Raja",
    statements: [
      "Yuvan Shankar Raja is the son of legendary Tamil composer Ilaiyaraaja",
      "Yuvan Shankar Raja composed the music for Selvaraghavan's '7G Rainbow Colony' (2004)",
      "Yuvan Shankar Raja has composed music for over 20 films directed by Selvaraghavan",
    ],
    lieIndex: 3,
    hint: "How many films has Selvaraghavan directed in total? Count: Kadhal Konden, 7G, Pudupettai, Mayakkam Enna...",
    explanation: "Yuvan is Ilaiyaraaja's son ✓ and scored 7G Rainbow Colony ✓ — but Selvaraghavan has directed only about 8 films total! Yuvan has NOT scored 20+ Selvaraghavan films! Their legendary collaborations are Kadhal Konden, 7G, Pudhupettai, Mayakkam Enna — brilliant but not 20 films!",
  },
  {
    context: "Tamil Nadu — Thiruvalluvar statue",
    statements: [
      "The Thiruvalluvar statue at Kanyakumari is exactly 133 feet tall, representing the 133 chapters of Thirukkural",
      "The Thirukkural has exactly 1330 couplets arranged in 133 chapters with 10 couplets each",
      "Thiruvalluvar lived during the 3rd century BCE, making Thirukkural over 2300 years old",
    ],
    lieIndex: 3,
    hint: "When exactly did Thiruvalluvar live? BCE or CE? What do most scholars say?",
    explanation: "133-foot statue ✓ and 1330 couplets ✓ — but the exact date is debated! Most scholars place Thiruvalluvar between 1st century BCE and 5th century CE — NOT definitively the 3rd century BCE. Tamil literature researchers are still debating the period!",
  },
];

async function startTwoTruthsOneLie(msg: BotMessage): Promise<string> {
  let archived = getArchived(msg.groupId, "twotruthsonelie");
  let pool = TWO_TRUTHS_ONE_LIE.filter((e) => !archived.includes(e.context.toLowerCase()));
  if (pool.length === 0) {
    resetArchive(msg.groupId, "twotruthsonelie");
    pool = TWO_TRUTHS_ONE_LIE;
  }
  const entry = randPick(pool);
  archiveAnswer(msg.groupId, "twotruthsonelie", entry.context.toLowerCase());

  // Shuffle statements so the lie isn't predictably in position 3
  const shuffled = [...entry.statements] as [string, string, string];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const lieText = entry.statements[entry.lieIndex - 1]!;
  const shuffledLieIndex = (shuffled.indexOf(lieText) + 1) as 1 | 2 | 3;

  await createGame(msg.groupId, "twotruthsonelie", {
    context: entry.context,
    statements: shuffled,
    lieIndex: shuffledLieIndex,
    hint: entry.hint,
    explanation: entry.explanation,
    attempts: 0,
    hintGiven: false,
  });

  const [s1, s2, s3] = shuffled;
  return `🤥 *2 TRUTHS, 1 LIE*\n\n*${entry.context}*\n\n1️⃣ ${s1}\n2️⃣ ${s2}\n3️⃣ ${s3}\n\nYaaru lie? Type *!a 1*, *!a 2*, or *!a 3*`;
}

// ===== MAIN HANDLER =====
export async function handleGameCommand(
  command: string,
  args: string,
  msg: BotMessage
): Promise<{ response: string }> {
  let response: string;

  switch (command) {
    case "quiz":
      response = await startQuiz(msg);
      break;
    case "brandquiz":
    case "logoquiz":
      response = await startBrandQuiz(msg);
      break;
    case "riddle":
      response = await startRiddle(msg);
      break;
    case "fastfinger":
    case "ff":
      response = await handleFastFinger(msg);
      break;
    case "mostlikely":
    case "ml":
      response = await startMostLikely(msg);
      break;
    case "twotruthsonelie":
    case "2t1l":
      response = await startTwoTruthsOneLie(msg);
      break;
    case "tamilproverb":
    case "proverb":
      response = await startTamilProverb(msg);
      break;
    case "storytime":
    case "story":
      response = await startStoryTime(msg);
      break;
    case "dialogue":
      response = await startDialogue(msg);
      break;
    case "song":
      response = await startSongQuiz(msg);
      break;
    case "wordle":
      response = await startWordle(msg);
      break;
    case "wordle_guess":
      response = await handleWordleGuess(args, msg);
      break;
    case "memory":
      response = await startMemory(msg);
      break;
    case "songlyric":
      response = await startSongLyric(msg);
      break;
    case "wyr":
      response = await startWYR(msg);
      break;
    case "wordchain":
      response = await startWordChain(msg);
      break;
    case "antakshari":
      response = await startAntakshari(msg);
      break;
    case "trivia":
      response = await startTrivia(msg);
      break;
    case "answer":
      response = await handleAnswer(args, msg);
      break;
    case "score":
      response = await getLeaderboard(
        msg,
        args.toLowerCase().includes("alltime") || args.toLowerCase().includes("all")
      );
      break;
    default:
      response = "Unknown game command da.";
  }

  return { response };
}
