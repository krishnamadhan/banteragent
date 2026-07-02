import { CONSTRUCTION_CATEGORIES, KNOWN_CONTRIBUTORS } from "./types.js";
import type { ConstructionCategory } from "./types.js";

// ── Date parsing ──────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parseDate(token: string): string | null {
  const t = token.toLowerCase().trim();
  const now = new Date();

  if (t === "today")     return toISO(now);
  if (t === "yesterday") { now.setDate(now.getDate() - 1); return toISO(now); }

  // DD-Mon or DD/Mon e.g. "24-Jun", "3-jan"
  const dMon = t.match(/^(\d{1,2})[-/]([a-z]{3})$/);
  if (dMon) {
    const mo = MONTHS[dMon[2]!];
    if (mo !== undefined) {
      const d = new Date(now.getFullYear(), mo, parseInt(dMon[1]!));
      return toISO(d);
    }
  }

  // DD/MM or DD-MM
  const ddmm = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (ddmm) {
    const d = new Date(now.getFullYear(), parseInt(ddmm[2]!) - 1, parseInt(ddmm[1]!));
    return toISO(d);
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const full = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (full) {
    return `${full[3]}-${full[2]!.padStart(2,"0")}-${full[1]!.padStart(2,"0")}`;
  }

  return null;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return toISO(new Date());
}

// ── Category matching ─────────────────────────────────────────────────────────

export function matchCategory(token: string): ConstructionCategory | null {
  const t = token.toLowerCase();
  for (const cat of CONSTRUCTION_CATEGORIES) {
    if (cat.toLowerCase().startsWith(t) || t.startsWith(cat.toLowerCase().slice(0, 4))) {
      return cat;
    }
  }
  // aliases
  const aliases: Record<string, ConstructionCategory> = {
    cement: "Materials", steel: "Materials", sand: "Materials", brick: "Brickwork",
    wire: "Electrical", pipe: "Plumbing", paint: "Painting", door: "Doors/Windows",
    window: "Doors/Windows", tile: "Flooring", wage: "Labor", worker: "Labor",
    lorry: "Transport", auto: "Transport", fee: "Permit", tax: "Permit",
    other: "Misc", misc: "Misc",
  };
  return aliases[t] ?? null;
}

// ── Contributor matching ──────────────────────────────────────────────────────

export function matchContributor(token: string): string {
  const t = token.toLowerCase();
  for (const name of KNOWN_CONTRIBUTORS) {
    if (name.toLowerCase() === t || name.toLowerCase().startsWith(t)) return name;
  }
  // capitalise unknown contributor
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

// ── !contrib parser ───────────────────────────────────────────────────────────
// Syntax: !contrib <amount> [contributor] [description]
// Amount is always first token. Contributor is second token if it looks like a name
// (not a date or category). Rest is description.

export function parseContribArgs(raw: string): {
  amount: number | null;
  contributor: string;
  description: string | null;
  date: string;
  error: string | null;
} {
  const tokens = raw.trim().split(/\s+/);
  if (!tokens.length || !tokens[0]) return { amount: null, contributor: "Madhan", description: null, date: todayISO(), error: "No amount provided." };

  const amount = parseFloat(tokens[0]!);
  if (isNaN(amount) || amount <= 0) return { amount: null, contributor: "Madhan", description: null, date: todayISO(), error: `Invalid amount: "${tokens[0]}"` };

  let contributor = "Madhan";
  let descStart = 1;
  let date = todayISO();

  // Second token: contributor name?
  if (tokens[1] && /^[a-zA-Z]/.test(tokens[1]) && !parseDate(tokens[1])) {
    contributor = matchContributor(tokens[1]);
    descStart = 2;
  }

  // Scan remaining tokens for a date
  const descTokens: string[] = [];
  for (let i = descStart; i < tokens.length; i++) {
    const d = parseDate(tokens[i]!);
    if (d && descTokens.length === 0) { date = d; continue; }
    descTokens.push(tokens[i]!);
  }

  return {
    amount,
    contributor,
    description: descTokens.length ? descTokens.join(" ") : null,
    date,
    error: null,
  };
}

// ── !expense parser ───────────────────────────────────────────────────────────
// Syntax: !expense <amount> <category> [date] <description> [paid by <name>]

export function parseExpenseArgs(raw: string): {
  amount: number | null;
  category: ConstructionCategory;
  date: string;
  description: string | null;
  paidBy: string;
  error: string | null;
} {
  const tokens = raw.trim().split(/\s+/);

  const amount = parseFloat(tokens[0] ?? "");
  if (isNaN(amount) || amount <= 0) {
    return { amount: null, category: "Misc", date: todayISO(), description: null, paidBy: "Madhan", error: `Invalid amount. Usage: !expense <amount> <category> [date] <description>` };
  }

  // Resolve "paid by <name>" anywhere in the tail
  let paidBy = "Madhan";
  const paidByMatch = raw.match(/\bpaid\s+by\s+(\w+)/i);
  if (paidByMatch) {
    paidBy = matchContributor(paidByMatch[1]!);
    raw = raw.replace(paidByMatch[0], "").trim();
  }

  const rest = raw.trim().split(/\s+/).slice(1); // drop amount token

  // Category: first matching token
  let category: ConstructionCategory = "Misc";
  let catIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    const c = matchCategory(rest[i]!);
    if (c) { category = c; catIdx = i; break; }
  }

  // Date: first token that parses as a date (after category)
  let date = todayISO();
  let dateIdx = -1;
  const searchFrom = catIdx + 1;
  for (let i = searchFrom; i < rest.length; i++) {
    const d = parseDate(rest[i]!);
    if (d) { date = d; dateIdx = i; break; }
  }

  // Description: remaining tokens
  const descTokens = rest.filter((_, i) => i !== catIdx && i !== dateIdx);
  const description = descTokens.join(" ").trim() || null;

  return { amount, category, date, description, paidBy, error: null };
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function fmt(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
