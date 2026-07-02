import { appendFileSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { supabase } from "../../supabase.js";
import type { RawLogEntry } from "./types.js";

const PROJECT_ROOT = "/home/pi/banteragent";
export const LOG_FILE = join(PROJECT_ROOT, "expense.md");

// ── Write ─────────────────────────────────────────────────────────────────────

export function appendExpenseLog(entry: RawLogEntry): void {
  let line = `[${entry.timestamp} IST] sent_by=${entry.sentBy} | payer=${entry.payer} | amount=${entry.amount}`;
  if (entry.isSplit && entry.splitDetails) {
    const { perPerson, memberCount } = entry.splitDetails;
    line += ` | description=${entry.description} (split across ${memberCount} members, ₹${perPerson} each)`;
  } else {
    line += ` | description=${entry.description}`;
  }
  line += ` | raw="${entry.raw.replace(/"/g, "'")}"`;

  const block = `---\n${line}\n---\n`;
  appendFileSync(LOG_FILE, block, "utf8");

  // store formatted line for reference by markEntriesDone
  entry.line = line;
}

// ── Read unprocessed ──────────────────────────────────────────────────────────

export function getUnprocessedLines(): string[] {
  if (!existsSync(LOG_FILE)) return [];
  const content = readFileSync(LOG_FILE, "utf8");
  return content
    .split("\n")
    .filter(l => /^\[\d{4}-\d{2}-\d{2}/.test(l));   // timestamp lines without [DONE]
}

export function getAllLogLines(): string[] {
  if (!existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, "utf8")
    .split("\n")
    .filter(l => /^(\[DONE\]\s+)?\[\d{4}-\d{2}-\d{2}/.test(l));
}

// ── Mark done ─────────────────────────────────────────────────────────────────

export function markLinesDone(lines: string[]): void {
  if (!existsSync(LOG_FILE) || lines.length === 0) return;

  const toMark = new Set(lines);
  const content = readFileSync(LOG_FILE, "utf8");
  const updated = content
    .split("\n")
    .map(l => toMark.has(l) ? `[DONE] ${l}` : l)
    .join("\n");

  writeFileSync(LOG_FILE, updated, "utf8");
}

// ── Duplicate detection ───────────────────────────────────────────────────────
// Returns true if a very similar expense exists in the DB within the last 2 hours.

export async function hasRecentDuplicate(
  amount: number,
  description: string,
  groupId: string,
): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("ba_expenses")
      .select("amount, description")
      .eq("group_id", groupId)
      .gte("created_at", cutoff);

    if (!data?.length) return false;

    const descWords = new Set(description.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    return data.some(e => {
      const sameBallpark = Math.abs(Number(e.amount) - amount) / amount <= 0.05;
      if (!sameBallpark) return false;

      const eWords = new Set<string>(
        (e.description as string).toLowerCase().split(/\s+/).filter((w: string) => w.length > 2)
      );
      const overlap = [...descWords].filter(w => eWords.has(w)).length;
      return overlap >= Math.min(2, descWords.size);
    });
  } catch {
    return false;
  }
}
