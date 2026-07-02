import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../../supabase.js";
import { getUnprocessedLines, markLinesDone } from "./expenseLogger.js";
import { isWeekend as computeIsWeekend } from "./expenseParser.js";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type AnalysedExpense } from "./types.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface AnalysisResult {
  saved: number;
  categories: Record<string, number>;
  skipped: number;
}

// ── Main analyse entry point ──────────────────────────────────────────────────

export async function analyseAndSave(
  groupId: string,
): Promise<AnalysisResult> {
  const unprocessed = getUnprocessedLines();
  if (unprocessed.length === 0) {
    return { saved: 0, categories: {}, skipped: 0 };
  }

  // Process in batches of 80 to stay within token limits
  const batch = unprocessed.slice(0, 80);
  const parsed = await callClaude(batch);

  const saved = await upsertToDb(parsed, groupId);

  markLinesDone(batch);

  const categories: Record<string, number> = {};
  for (const e of parsed) {
    categories[e.category] = (categories[e.category] ?? 0) + 1;
  }

  return {
    saved,
    categories,
    skipped: batch.length - parsed.length,
  };
}

// ── Claude categorisation ─────────────────────────────────────────────────────

async function callClaude(logLines: string[]): Promise<AnalysedExpense[]> {
  const systemPrompt = `You are an expense categorisation assistant for an Indian couple's WhatsApp expense log.
Each log line has format: [YYYY-MM-DD HH:MM:SS IST] sent_by=Name | payer=Name | amount=N | description=text | raw="original message"

Rules:
- Skip lines that are bot confirmations, commands (!analyse, !report, !help etc), or clearly not expenses
- Default payer is Madhan unless log line says payer=Indhu
- Infer merchant_type from description (Restaurant, Supermarket, Fuel Station, Multiplex, etc.)
- category must be one of: ${EXPENSE_CATEGORIES.join(", ")}
- subcategory is more specific (e.g. Restaurant, Fuel, OTT Subscription, Vegetables)
- confidence: 0.0–1.0 — how sure you are this is a real expense and category is correct
- notes: merchant_type inference + any relevant context

Return ONLY a JSON array (no markdown, no explanation). Each object:
{
  "log_id": "<timestamp from the log line, e.g. 2026-04-29 21:45:30>",
  "amount": 1200,
  "description": "dinner at Adyar Ananda Bhavan",
  "category": "Food",
  "subcategory": "Restaurant",
  "payer": "Madhan",
  "sent_by": "Indhu",
  "timestamp": "2026-04-29T21:45:30+05:30",
  "confidence": 0.95,
  "notes": "merchant_type: Restaurant; South Indian vegetarian restaurant"
}

If no valid expenses found, return: []`;

  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: "user", content: logLines.join("\n") }],
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "[]";
  const cleaned = text.replace(/^```json\s*|^```\s*|```$/gm, "").trim();

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e: any) => e && typeof e.amount === "number" && e.amount > 0);
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertToDb(
  entries: AnalysedExpense[],
  groupId: string,
): Promise<number> {
  if (entries.length === 0) return 0;

  const rows = entries.map(e => {
    const cat: ExpenseCategory = (EXPENSE_CATEGORIES as string[]).includes(e.category)
      ? e.category as ExpenseCategory
      : "Misc";

    const expenseDate = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const dayOfWeek = e.timestamp
      ? new Date(e.timestamp).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" })
      : "";
    const weekend = dayOfWeek === "Sat" || dayOfWeek === "Sun";

    return {
      group_id:     groupId,
      log_id:       e.log_id,
      raw_text:     e.description,
      amount:       Number(e.amount),
      description:  e.description,
      category:     cat.toLowerCase(),
      subcategory:  e.subcategory ?? null,
      paid_by:      e.payer === "Indhu" ? "Indhu" : "Madhan",
      added_by:     e.sent_by ?? "Unknown",
      expense_date: expenseDate,
      processed_at: new Date().toISOString(),
      source:       "whatsapp",
      confidence:   Number(e.confidence) || null,
      notes:        e.notes ?? null,
      is_weekend:   weekend,
    };
  });

  // upsert on log_id to prevent double-processing
  const { error, data } = await supabase
    .from("ba_expenses")
    .upsert(rows, { onConflict: "log_id", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`DB upsert failed: ${error.message}`);
  return data?.length ?? rows.length;
}
