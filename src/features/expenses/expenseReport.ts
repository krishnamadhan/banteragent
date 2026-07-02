import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../../supabase.js";
import { parsePeriod } from "./expenseParser.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── !report ───────────────────────────────────────────────────────────────────

export async function generateReport(groupId: string, periodArg: string): Promise<string> {
  const { start, end, label } = parsePeriod(periodArg || "last30days");

  const { data, error } = await supabase
    .from("ba_expenses")
    .select("amount, description, category, paid_by, expense_date, is_weekend, notes")
    .eq("group_id", groupId)
    .eq("is_settled", false)
    .gte("expense_date", start.toISOString().slice(0, 10))
    .lte("expense_date", end.toISOString().slice(0, 10))
    .order("expense_date", { ascending: false });

  if (error) return `DB error: ${error.message}`;
  if (!data?.length) return `No expenses found for ${label}.`;

  const prompt = `Given these expense records for an Indian couple (Madhan and Indhu), generate a concise WhatsApp report.

Use this structure exactly:

📊 *Expense Report — ${label}*

💰 *Total Spent: ₹XX,XXX*
👤 Paid by Madhan: ₹XX,XXX
👤 Paid by Indhu: ₹XXX

📂 *By Category*
🍽 Food: ₹X,XXX (N items) — top spend: [description]
🚗 Transport: ₹X,XXX (N items)
[... other categories with relevant emoji]

📅 *Biggest Expenses*
1. ₹X,XXX — [description] ([date DD MMM])
2. ₹X,XXX — [description] ([date])
3. ₹X,XXX — [description] ([date])

📈 *Insights*
- [1 observation about spending patterns, e.g. 'Food is 60% of total — mostly weekends']
- [1 observation about payer balance or category trend]

Use ₹ symbol, bold with WhatsApp markdown (*text*). Under 40 lines. Numbers in Indian format (1,200 not 1200).

Category emojis: Food 🍽 Transport 🚗 Entertainment 🎬 Groceries 🛒 Shopping 🛍 Utilities 💡 Medical 🏥 Travel ✈️ Misc 📦

Expense data (JSON):
${JSON.stringify(data, null, 2)}`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0]?.type === "text" ? res.content[0].text.trim() : "Could not generate report.";
  } catch (e) {
    return `Failed to generate report: ${String(e).slice(0, 100)}`;
  }
}

// ── !summary — one-liner ──────────────────────────────────────────────────────

export async function generateSummary(groupId: string): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = now.toLocaleString("en-IN", { month: "long", timeZone: "Asia/Kolkata" });

  const { data, error } = await supabase
    .from("ba_expenses")
    .select("amount, category")
    .eq("group_id", groupId)
    .gte("expense_date", monthStart.toISOString().slice(0, 10));

  if (error || !data?.length) return `📍 No expenses logged in ${month} yet.`;

  const total = data.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory: Record<string, number> = {};
  for (const e of data) {
    const cat = (e.category as string) || "misc";
    byCategory[cat] = (byCategory[cat] ?? 0) + Number(e.amount);
  }
  const [topCat, topAmt] = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0] ?? ["N/A", 0];
  const topLabel = String(topCat).charAt(0).toUpperCase() + String(topCat).slice(1);

  return `📍 *${month} so far:* ₹${total.toLocaleString("en-IN")} across ${data.length} expense${data.length !== 1 ? "s" : ""}. Biggest category: ${topLabel} (₹${Number(topAmt).toLocaleString("en-IN")})`;
}
