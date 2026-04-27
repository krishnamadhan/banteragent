import type { BotMessage } from "../types.js";
import { supabase } from "../supabase.js";
import { getGroupConfig } from "../group-config.js";

// ===== Zodiac helpers =====
const ZODIAC_SIGNS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo",
  "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
];

const TAMIL_TO_ENGLISH: Record<string, string> = {
  mesham: "aries", rishabam: "taurus", mithunam: "gemini", kadagam: "cancer",
  simmam: "leo", kanni: "virgo", thulam: "libra", viruchigam: "scorpio",
  dhanusu: "sagittarius", makaram: "capricorn", kumbam: "aquarius", meenam: "pisces",
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function normalizeZodiac(s: string): string {
  return TAMIL_TO_ENGLISH[s.toLowerCase()] ?? s.toLowerCase();
}

// NOTE: zodiacFromDate is intentionally removed.
// Tamil rasi (Vedic astrology) is based on moon position at birth — it cannot be
// calculated from date alone. We only save zodiac when the user explicitly states it.

export interface MemberProfile {
  group_id: string;
  member_phone: string;
  member_name: string;
  nickname?: string | null;
  gender?: string | null; // "male" | "female" | "other" — requires: ALTER TABLE ba_member_profiles ADD COLUMN IF NOT EXISTS gender text;
  zodiac_sign?: string | null;
  birthday?: string | null;
  occupation?: string | null;
  partner_name?: string | null;
  partner_phone?: string | null;
  facts?: string[];
  asked_zodiac_at?: string | null;
  last_wished_at?: string | null;
  last_updated?: string;
}

export async function getProfile(groupId: string, phone: string): Promise<MemberProfile | null> {
  const { data } = await supabase
    .from("ba_member_profiles")
    .select("*")
    .eq("group_id", groupId)
    .eq("member_phone", phone)
    .maybeSingle();
  return data;
}

export async function getAllProfiles(groupId: string): Promise<MemberProfile[]> {
  const { data } = await supabase
    .from("ba_member_profiles")
    .select("*")
    .eq("group_id", groupId);
  return data ?? [];
}

// Track which users we've already checked for ghost seed records (per session)
const ghostMergeChecked = new Set<string>();

// ===== Extract profile info from message (regex-based, free) =====
export async function extractProfileInfo(msg: BotMessage): Promise<void> {
  const text = msg.text;
  const lower = text.toLowerCase();
  const updates: Partial<MemberProfile> = {};

  // Detect zodiac sign — only from explicit self-declarations, not any mention
  // e.g. "naan leo da", "my rasi is simmam", "im a scorpio" — NOT "hari is leo"
  const selfZodiacPattern = /(?:naan|nan|i['']?m|i am|my (?:sign|rasi|zodiac|star)\s+(?:is|=)?|my sign is)\s+(?:a\s+)?(\w+)/i;
  const szMatch = lower.match(selfZodiacPattern);
  if (szMatch?.[1]) {
    const candidate = szMatch[1].toLowerCase();
    const sign = ZODIAC_SIGNS.includes(candidate) ? candidate : (TAMIL_TO_ENGLISH[candidate] ?? null);
    if (sign) updates.zodiac_sign = sign;
  }
  // Also catch Tamil rasi corrections like "nan leo da", "naan simmam da"
  for (const [tamil, eng] of Object.entries(TAMIL_TO_ENGLISH)) {
    const tamilPattern = new RegExp(`(?:naan|nan)\\s+${tamil}`, "i");
    if (tamilPattern.test(lower)) { updates.zodiac_sign = eng; break; }
  }

  // Detect birthday: "born july 15", "birthday July 15", "15th July", "July 15th"
  const bdPatterns: RegExp[] = [
    /(?:born|birthday|bday|dob)[^a-z].*?(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(\d{1,2})/i,
    /(\d{1,2})(?:st|nd|rd|th)?\s+(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)/i,
    /(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
  ];
  for (const pat of bdPatterns) {
    const m = text.match(pat);
    if (m) {
      let month = 0, day = 0;
      if (pat === bdPatterns[1]) {
        day = parseInt(m[1]); month = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? 0;
      } else {
        month = MONTHS[m[1].toLowerCase().slice(0, 3)] ?? 0; day = parseInt(m[2]);
      }
      if (month && day && day <= 31) {
        updates.birthday = `${new Date(2000, month - 1, 1).toLocaleString("en", { month: "long" })} ${day}`;
        // Do NOT auto-infer zodiac from birthday — Tamil rasi requires explicit statement
        break;
      }
    }
  }

  // Detect occupation — "at" and "in" patterns removed: too broad ("working at 9pm", "I work in chennai")
  const jobPatterns: RegExp[] = [
    /i['']?m\s+(?:a\s+|an\s+)?(software\s*engineer|developer|doctor|manager|teacher|designer|student|analyst|architect|consultant|lawyer|ca|accountant|nurse|officer|entrepreneur)/i,
    /(?:i work|working)\s+as\s+(?:a\s+|an\s+)([a-z][a-z\s]{2,30})/i,
    /my\s+(?:job|profession|occupation)\s+is\s+([a-z][a-z\s]{2,30})/i,
  ];
  for (const p of jobPatterns) {
    const m = text.match(p);
    if (m?.[1] && m[1].trim().length > 2) { updates.occupation = m[1].trim(); break; }
  }

  // Detect partner
  const partnerPatterns: RegExp[] = [
    /(?:my\s+)?(?:wife|husband|partner|spouse)\s+(?:is\s+|= )?(\w{3,})/i,
    /married\s+to\s+(\w{3,})/i,
    /(\w{3,})\s+is\s+my\s+(?:wife|husband|partner|spouse)/i,
  ];
  for (const p of partnerPatterns) {
    const m = text.match(p);
    if (m?.[1]) { updates.partner_name = m[1]; break; }
  }

  // Detect self-declared nickname: "call me X", "my nickname is X", "everyone calls me X"
  const nickPatterns = [
    /(?:call me|you can call me|everyone calls me|friends call me|just call me)\s+(\w{2,20})/i,
    /my\s+nickname\s+(?:is|=)\s*(\w{2,20})/i,
    /my\s+nick\s+(?:is|=)\s*(\w{2,20})/i,
  ];
  for (const p of nickPatterns) {
    const m = text.match(p);
    if (m?.[1]) { updates.nickname = m[1].trim(); break; }
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from("ba_member_profiles").upsert({
      group_id: msg.groupId,
      member_phone: msg.from,
      member_name: msg.senderName,
      ...updates,
      last_updated: new Date().toISOString(),
    }, { onConflict: "group_id,member_phone" });
    invalidateProfileCache(msg.groupId);
  }

  // Auto-link: merge ghost seed record (unknown_ phone) into the real profile — once per session
  const ghostKey = `${msg.groupId}:${msg.from}`;
  if (!ghostMergeChecked.has(ghostKey)) {
    ghostMergeChecked.add(ghostKey);
    const { data: ghost } = await supabase
      .from("ba_member_profiles")
      .select("partner_name, occupation, zodiac_sign")
      .eq("group_id", msg.groupId)
      .eq("member_name", msg.senderName)
      .like("member_phone", "unknown_%")
      .maybeSingle();

    if (ghost) {
      const mergeUpdates: Partial<MemberProfile> = {};
      if (ghost.partner_name && !updates.partner_name) mergeUpdates.partner_name = ghost.partner_name;
      if (ghost.occupation && !updates.occupation) mergeUpdates.occupation = ghost.occupation;
      if (ghost.zodiac_sign && !updates.zodiac_sign) mergeUpdates.zodiac_sign = ghost.zodiac_sign;

      if (Object.keys(mergeUpdates).length > 0) {
        await supabase.from("ba_member_profiles").upsert({
          group_id: msg.groupId, member_phone: msg.from, member_name: msg.senderName,
          ...mergeUpdates, last_updated: new Date().toISOString(),
        }, { onConflict: "group_id,member_phone" });
      }
      // Delete the ghost record
      await supabase.from("ba_member_profiles")
        .delete()
        .eq("group_id", msg.groupId)
        .eq("member_name", msg.senderName)
        .like("member_phone", "unknown_%");
      invalidateProfileCache(msg.groupId);
      console.log(`[profiles] Merged ghost record for ${msg.senderName}`);
    }
  }
}

// ===== Context string for Claude (passed in system prompt) =====
// Cached per group to avoid a DB hit on every single chat message
const profileContextCache = new Map<string, { text: string; ts: number }>();
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getGroupProfileContext(groupId: string, mode = "roast"): Promise<string> {
  const cacheKey = `${groupId}:${mode}`;
  const cached = profileContextCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL) return cached.text;

  const profiles = await getAllProfiles(groupId);
  const useful = profiles.filter(
    (p) => p.gender || p.zodiac_sign || p.occupation || p.partner_name || p.nickname
  );

  if (!useful.length) {
    profileContextCache.set(cacheKey, { text: "", ts: Date.now() });
    return "";
  }

  const lines = useful.map((p) => {
    // Show the nickname prominently so Claude uses it as the primary reference
    const displayName = p.nickname
      ? `${p.nickname} (full name: ${p.member_name})`
      : p.member_name;
    const parts: string[] = [displayName];
    if (p.gender) parts.push(p.gender);
    if (p.zodiac_sign) parts.push(p.zodiac_sign);
    if (p.occupation) parts.push(p.occupation);
    if (p.partner_name) parts.push(`married to ${p.partner_name}`);
    return parts.join(" | ");
  });

  const aliasNote = "CRITICAL: When chat refers to someone by a short name, nickname, or first name, always match it to the member listed above — NEVER treat it as an unknown extra person. E.g. if 'Hari' is listed, any mention of 'Hari' in chat IS that person.";

  const modeInstructions: Record<string, string> = {
    nanban: "Use their nickname when you know it. Reference their details warmly — praise their job, mention their partner affectionately. NEVER use this for roasting, mockery, or punchlines. Zodiac is stored for !astro only — do NOT bring it up in general chat.",
    peter:  "Use their nickname when you know it. Use this knowledge for over-explained academic observations — their career field's history, their relationship dynamics as a sociological case study. Zodiac is stored for !astro only — do NOT bring it up in general chat.",
    roast:  "Use their nickname when you know it. Personalize naturally — prefer job or partner when it fits the moment. Zodiac is stored for !astro only — do NOT bring it up in general chat unless the user mentions it first.",
  };

  const instruction = modeInstructions[mode] ?? modeInstructions["roast"]!;
  const pronounNote = "Pronouns: male → he/him, female → she/her, unknown → neutral (machaan/da/they).";
  const text = `\nGROUP MEMBERS YOU KNOW:\n${lines.join("\n")}\n${aliasNote} ${instruction} ${pronounNote}`;
  profileContextCache.set(cacheKey, { text, ts: Date.now() });
  return text;
}

// Invalidate cache when a profile is updated (clear all mode variants)
function invalidateProfileCache(groupId: string) {
  for (const key of profileContextCache.keys()) {
    if (key.startsWith(`${groupId}:`)) profileContextCache.delete(key);
  }
}

// ===== Check whether to ask for zodiac (max once per 7 days) =====
export async function getZodiacQuestion(
  groupId: string,
  phone: string,
  name: string
): Promise<string | null> {
  const cfg = getGroupConfig(groupId);
  if (cfg.disabledTasks.has("horoscope")) return null;

  const profile = await getProfile(groupId, phone);
  if (profile?.zodiac_sign) return null; // already know

  if (profile?.asked_zodiac_at) {
    const days = (Date.now() - new Date(profile.asked_zodiac_at).getTime()) / 86400000;
    if (days < 7) return null;
  }

  const qs = [
    `Dei ${name}, nee enna raasi da? Personalized horoscope sollanum — !myinfo zodiac scorpio maadiri type pannu 🔮`,
    `${name}, birthday eppo da? !myinfo birthday July 15 — sollu, daily palan customize pannen 🌟`,
    `Oii ${name}, unoda zodiac sign sollu! Naan super fake horoscope ready panni vaichen 😂`,
  ];
  const question = qs[Math.floor(Math.random() * qs.length)]!;

  // Mark as asked only now — so the 7-day cooldown starts when we actually asked, not before
  await supabase.from("ba_member_profiles").upsert({
    group_id: groupId, member_phone: phone, member_name: name,
    asked_zodiac_at: new Date().toISOString(),
  }, { onConflict: "group_id,member_phone" });

  return question;
}

// ===== !myinfo command =====
export async function handleProfileCommand(args: string, msg: BotMessage): Promise<string> {
  const lower = args.trim().toLowerCase();

  if (!args.trim() || lower === "show" || lower === "me") {
    const p = await getProfile(msg.groupId, msg.from);
    if (!p || (!p.zodiac_sign && !p.occupation && !p.partner_name && !p.birthday && !p.nickname && !p.gender)) {
      return `En kita ungaluoda info onnum illa! Type:\n!myinfo nick Machan\n!myinfo gender male\n!myinfo zodiac scorpio\n!myinfo birthday July 15\n!myinfo job software engineer\n!myinfo partner Priya`;
    }
    const displayName = p.nickname ? `${msg.senderName} aka *${p.nickname}*` : msg.senderName;
    let r = `📋 *${displayName}'s Profile:*\n`;
    if (p.nickname) r += `🏷️ Nickname: ${p.nickname}\n`;
    if (p.gender) r += `👤 Gender: ${p.gender}\n`;
    if (p.birthday) r += `🎂 Birthday: ${p.birthday}\n`;
    if (p.zodiac_sign) r += `♈ Zodiac: ${p.zodiac_sign}\n`;
    if (p.occupation) r += `💼 Job: ${p.occupation}\n`;
    if (p.partner_name) r += `💑 Partner: ${p.partner_name}\n`;
    return r;
  }

  // !myinfo nick <nickname>
  const nickM = args.match(/^nick(?:name)?\s+(.+)/i);
  if (nickM) {
    const nick = nickM[1].trim().slice(0, 20); // cap at 20 chars
    await supabase.from("ba_member_profiles").upsert({
      group_id: msg.groupId, member_phone: msg.from, member_name: msg.senderName,
      nickname: nick, last_updated: new Date().toISOString(),
    }, { onConflict: "group_id,member_phone" });
    invalidateProfileCache(msg.groupId);
    return `✅ Nickname set! Inimael naan unnai *${nick}* nu koopuduven 😎`;
  }

  // !myinfo gender <male/female/other>
  const genderM = lower.match(/^gender\s+(\w+)/);
  if (genderM) {
    const raw = genderM[1].toLowerCase();
    const normalized = raw === "man" || raw === "boy" ? "male"
      : raw === "woman" || raw === "girl" ? "female"
      : ["male", "female", "other"].includes(raw) ? raw : null;
    if (!normalized) return `Valid options: !myinfo gender male / female / other`;
    await supabase.from("ba_member_profiles").upsert({
      group_id: msg.groupId, member_phone: msg.from, member_name: msg.senderName,
      gender: normalized, last_updated: new Date().toISOString(),
    }, { onConflict: "group_id,member_phone" });
    invalidateProfileCache(msg.groupId);
    const pronoun = normalized === "male" ? "he/him" : normalized === "female" ? "she/her" : "they/them";
    return `✅ Got it! Will use *${pronoun}* when referring to you 👍`;
  }

  // !myinfo zodiac <sign>
  const zodiacM = lower.match(/^zodiac\s+(\w+)/);
  if (zodiacM) {
    const raw = zodiacM[1];
    const sign = normalizeZodiac(raw);
    if (!ZODIAC_SIGNS.includes(sign)) {
      return `Valid signs: ${ZODIAC_SIGNS.join(", ")}`;
    }
    await supabase.from("ba_member_profiles").upsert({
      group_id: msg.groupId, member_phone: msg.from, member_name: msg.senderName,
      zodiac_sign: sign, last_updated: new Date().toISOString(),
    }, { onConflict: "group_id,member_phone" });
    invalidateProfileCache(msg.groupId);
    return `✅ ${msg.senderName} is a *${sign}*. Daily horoscope ready! ♈`;
  }

  // !myinfo birthday <date>
  const bdM = args.match(/^birthday\s+(.*)/i);
  if (bdM) {
    const raw = bdM[1].trim();
    let month = 0, day = 0;
    const m1 = raw.match(/(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(\d{1,2})/i);
    const m2 = raw.match(/(\d{1,2})\s+(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)/i);
    if (m1) { month = MONTHS[m1[1].toLowerCase().slice(0, 3)] ?? 0; day = parseInt(m1[2]); }
    else if (m2) { day = parseInt(m2[1]); month = MONTHS[m2[2].toLowerCase().slice(0, 3)] ?? 0; }
    if (month && day) {
      const bday = `${new Date(2000, month - 1, 1).toLocaleString("en", { month: "long" })} ${day}`;
      await supabase.from("ba_member_profiles").upsert({
        group_id: msg.groupId, member_phone: msg.from, member_name: msg.senderName,
        birthday: bday, last_updated: new Date().toISOString(),
      }, { onConflict: "group_id,member_phone" });
      invalidateProfileCache(msg.groupId);
      return `✅ Birthday saved: *${bday}* 🎂\n\nRasi therinja sollu: *!myinfo zodiac simmam* (or leo/scorpio etc)\nTamil rasi Western sign-a vida different — nee dhan solanum!`;
    }
    return `Format: !myinfo birthday July 15`;
  }

  // !myinfo job <occupation>
  const jobM = args.match(/^job\s+(.*)/i);
  if (jobM) {
    const occ = jobM[1].trim();
    await supabase.from("ba_member_profiles").upsert({
      group_id: msg.groupId, member_phone: msg.from, member_name: msg.senderName,
      occupation: occ, last_updated: new Date().toISOString(),
    }, { onConflict: "group_id,member_phone" });
    invalidateProfileCache(msg.groupId);
    return `✅ Noted! ${msg.senderName} is a *${occ}*. Will roast appropriately 😈`;
  }

  // !myinfo partner <name>
  const partnerM = args.match(/^(?:partner|wife|husband|married)\s+(.*)/i);
  if (partnerM) {
    const pName = partnerM[1].trim();
    await supabase.from("ba_member_profiles").upsert({
      group_id: msg.groupId, member_phone: msg.from, member_name: msg.senderName,
      partner_name: pName, last_updated: new Date().toISOString(),
    }, { onConflict: "group_id,member_phone" });
    invalidateProfileCache(msg.groupId);
    return `✅ ${msg.senderName} + *${pName}* = noted 💑 Future couple roasting sessions ready 😈`;
  }

  return `Usage:\n!myinfo nick Machan\n!myinfo gender male\n!myinfo zodiac scorpio\n!myinfo birthday July 15\n!myinfo job software engineer\n!myinfo partner Priya\n!myinfo show`;
}

// ===== Seed known couples (call once on startup) =====
// Only updates real phone records — never creates ghost "unknown_" placeholders
// (ghost records never merge with real ones when the user actually messages)
export async function seedKnownCouples(groupId: string): Promise<void> {
  const couples = [
    { name: "Hari", partner: "Madhu" },
    { name: "Madhu", partner: "Hari" },
    { name: "Siva", partner: "Preethinga" },
    { name: "Preethinga", partner: "Siva" },
    { name: "Madhan", partner: "Indhu" },
    { name: "Indhu", partner: "Madhan" },
  ];

  for (const c of couples) {
    // Use ILIKE prefix match so "Hari" finds "Harikrishnan D", "Madhu" finds "Madhu S" etc.
    const { data: realRecord } = await supabase
      .from("ba_member_profiles")
      .select("member_phone, member_name, partner_name, nickname")
      .eq("group_id", groupId)
      .ilike("member_name", `${c.name}%`)
      .not("member_phone", "like", "unknown_%")
      .maybeSingle();

    if (realRecord) {
      const updates: Record<string, string> = { last_updated: new Date().toISOString() };
      if (!realRecord.partner_name) updates.partner_name = c.partner;
      // Auto-set short name as nickname if not already set and WhatsApp name is longer
      if (!realRecord.nickname && realRecord.member_name.toLowerCase() !== c.name.toLowerCase()) {
        updates.nickname = c.name;
      }
      if (Object.keys(updates).length > 1) {
        await supabase.from("ba_member_profiles")
          .update(updates)
          .eq("group_id", groupId)
          .eq("member_phone", realRecord.member_phone);
        invalidateProfileCache(groupId);
      }
    }
  }
}
