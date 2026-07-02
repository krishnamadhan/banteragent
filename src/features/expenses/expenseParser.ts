import type { ParsedAmount } from "./types.js";

const MADHAN_PHONE = (process.env.BOT_OWNER_PHONE ?? "").replace("@c.us", "").replace(/\D/g, "").slice(-6);
const INDHU_PHONE  = (process.env.INDHU_PHONE ?? "").replace("@c.us", "").replace(/\D/g, "").slice(-6);

// ── Tamil detection ───────────────────────────────────────────────────────────

// Tamil Unicode block (U+0B80–U+0BFF) is definitive.
// For romanized Tamil, check for 2+ distinctive Tamil words.
const TAMIL_WORDS = /\b(enna|yenna|sollu|paaru|vaanga|vangi|pochu|irukku|iruku|appo|ippo|romba|konjam|seri|sari|illai|illa|ille|aama|naan|unna|ungaluku|avanga|ivanga|ivaru|yaar|avan|aval|inga|anga|adhu|ithu|ethu|avlo|ivlo|evlo|mokkai|ponga|vanga|thambi|akka|anna|enaku|unaku)\b/gi;

export function hasTamilContent(text: string): boolean {
  if (/[\u0B80-\u0BFF]/.test(text)) return true;
  const matches = text.match(TAMIL_WORDS);
  return (matches?.length ?? 0) >= 2;
}

// ── Payer inference ───────────────────────────────────────────────────────────

export function inferPayer(
  text: string,
  senderPhone: string,
  senderName: string,
): "Madhan" | "Indhu" {
  const numSuffix = senderPhone.replace(/\D/g, "").slice(-6);
  const isIndhu = INDHU_PHONE && numSuffix === INDHU_PHONE;

  if (/\bindhu\s+paid\b|\bindhu['']?s\b/i.test(text)) return "Indhu";
  if (/\bmadhan\s+paid\b|\bmadhan['']?s\b/i.test(text)) return "Madhan";
  if (isIndhu && /\b(i paid|i spent|my\s|i bought|i got)\b/i.test(text)) return "Indhu";

  return "Madhan";
}

export function resolvedName(senderPhone: string, senderName: string): string {
  const numSuffix = senderPhone.replace(/\D/g, "").slice(-6);
  if (MADHAN_PHONE && numSuffix === MADHAN_PHONE) return "Madhan";
  if (INDHU_PHONE  && numSuffix === INDHU_PHONE)  return "Indhu";
  return senderName;
}

// ── IST helpers ───────────────────────────────────────────────────────────────

export function istTimestamp(): string {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).replace(/\//g, "-").replace(",", "");
}

export function isWeekend(): boolean {
  const day = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata", weekday: "short",
  });
  return day === "Sat" || day === "Sun";
}

// ── Amount extraction ─────────────────────────────────────────────────────────

const MONEY_TRIGGER = /\b(spent|paid|bought|cost|bill|fee|charge|₹|rs\.?|rupee|expense)\b/i;
const AMOUNT_RE     = /(?:₹|rs\.?\s*)?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)/i;

const MEMBER_COUNT = Number(process.env.EXPENSE_MEMBER_COUNT ?? 7);

export function detectExpense(text: string): ParsedAmount | null {
  const hasMoney = MONEY_TRIGGER.test(text) || /₹/.test(text);
  const hasNumber = /\b\d+\b/.test(text);
  if (!hasMoney || !hasNumber) return null;

  // "600 each" / "500 per head" / "300 per person"
  const eachRe = /(?:₹|rs\.?\s*)?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:each|per\s+(?:head|person))\b/i;
  const eachMatch = text.match(eachRe);
  if (eachMatch) {
    const perPerson = parseFloat(eachMatch[1]!.replace(/,/g, ""));
    const total = perPerson * MEMBER_COUNT;
    return {
      amount: total,
      description: extractDescription(text),
      isSplit: true,
      splitDetails: { perPerson, memberCount: MEMBER_COUNT, total },
    };
  }

  const amountMatch = text.match(AMOUNT_RE);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1]!.replace(/,/g, ""));
  if (amount <= 0 || amount > 10_000_000) return null;

  return {
    amount,
    description: extractDescription(text),
    isSplit: false,
  };
}

function extractDescription(text: string): string {
  // Strip leading amount / command words, take rest as description
  return text
    .replace(/^!spent\s*/i, "")
    .replace(/(?:₹|rs\.?\s*)?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:each|per\s+(?:head|person))?\s*/gi, "")
    .replace(/\b(spent|paid|bought|for|on|at|the|a|an)\b\s*/gi, "")
    .trim()
    .slice(0, 120) || "expense";
}

// ── Period parser ─────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

export function parsePeriod(raw: string): { start: Date; end: Date; label: string } {
  const now   = new Date();
  const lower = raw.toLowerCase().replace(/\s+/g, "");
  const endDay = new Date(now);
  endDay.setHours(23, 59, 59, 999);

  if (lower.includes("last7") || lower.includes("7day")) {
    const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0);
    return { start: s, end: endDay, label: "Last 7 days" };
  }
  if (lower.includes("last14") || lower.includes("14day")) {
    const s = new Date(now); s.setDate(s.getDate() - 13); s.setHours(0, 0, 0, 0);
    return { start: s, end: endDay, label: "Last 14 days" };
  }
  if (lower.includes("thismonth")) {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: s, end: endDay, label: "This month" };
  }
  if (lower.includes("lastmonth")) {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: "Last month" };
  }
  if (lower.includes("last3month")) {
    const s = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { start: s, end: endDay, label: "Last 3 months" };
  }
  // named month: "april", "mar" etc.
  for (const [name, num] of Object.entries(MONTHS)) {
    if (lower === name || lower.startsWith(name)) {
      const year = num > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
      const s = new Date(year, num - 1, 1);
      const e = new Date(year, num, 0); e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: `${raw.charAt(0).toUpperCase()}${raw.slice(1)}` };
    }
  }
  // default: last 30 days
  const s = new Date(now); s.setDate(s.getDate() - 29); s.setHours(0, 0, 0, 0);
  return { start: s, end: endDay, label: "Last 30 days" };
}

export function fmt(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
