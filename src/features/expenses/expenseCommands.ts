import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../../supabase.js";
import type { BotMessage } from "../../types.js";
import {
  appendExpenseLog,
  hasRecentDuplicate,
} from "./expenseLogger.js";
import {
  hasTamilContent,
  detectExpense,
  inferPayer,
  resolvedName,
  istTimestamp,
  isWeekend,
  parsePeriod,
  fmt,
} from "./expenseParser.js";
import { analyseAndSave } from "./expenseAnalyser.js";
import { generateReport, generateSummary } from "./expenseReport.js";
import { handleSplitCommand } from "./expenseSplit.js";
import type { RawLogEntry } from "./types.js";

export { handleSplitCommand };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MONTHLY_BUDGET = Number(process.env.EXPENSE_MONTHLY_BUDGET ?? 30_000);

// ── Natural language expense detection (non-command messages) ─────────────────

export async function handleExpenseMessage(msg: BotMessage): Promise<string> {
  const text = msg.text.trim();

  // Tamil / mixed language → politely reject
  if (hasTamilContent(text)) {
    const parsed = detectExpense(text);
    if (parsed) {
      return "Please send expenses in English for accurate tracking 🙏";
    }
    return "";
  }

  const parsed = detectExpense(text);
  if (!parsed) return "";

  const { amount, description, isSplit, splitDetails } = parsed;
  const sender = resolvedName(msg.from, msg.senderName);
  const payer  = inferPayer(text, msg.from, msg.senderName);
  const ts     = istTimestamp();
  const weekend = isWeekend();

  // Duplicate check
  const isDuplicate = await hasRecentDuplicate(amount, description, msg.groupId);
  if (isDuplicate) {
    return `🤔 This looks similar to a recent entry — is this a new expense or a duplicate? Reply *yes* to log it anyway, or ignore to skip.`;
  }

  const entry: RawLogEntry = {
    timestamp: ts,
    sentBy: sender,
    payer,
    amount,
    description,
    raw: text,
    isSplit,
    splitDetails,
    isWeekend: weekend,
    line: "",
  };
  appendExpenseLog(entry);

  // Insert to DB immediately
  const { error } = await supabase.from("ba_expenses").insert({
    group_id:     msg.groupId,
    raw_text:     text,
    amount,
    description,
    category:     "misc",
    paid_by:      payer,
    added_by:     sender,
    expense_date: new Date().toISOString().slice(0, 10),
    is_split:     isSplit,
    split_details: splitDetails ?? null,
    is_weekend:   weekend,
    source:       "whatsapp",
  });

  if (error) return `⚠️ Could not save expense: ${error.message}`;

  let reply = isSplit && splitDetails
    ? `Logged! 🧾 ₹${splitDetails.perPerson.toLocaleString("en-IN")} × ${splitDetails.memberCount} = ${fmt(amount)} for ${description} — paid by ${payer}`
    : `Logged! 🧾 ${fmt(amount)} for ${description} — paid by ${payer}`;

  const budget = await checkBudgetAlert(msg.groupId);
  if (budget) reply += `\n\n${budget}`;

  return reply;
}

// ── !spent ────────────────────────────────────────────────────────────────────

export async function handleSpentCommand(msg: BotMessage): Promise<string> {
  const raw = msg.text.slice("!spent".length).trim();
  if (!raw) return "Usage: `!spent <amount> <description>`\nExample: `!spent 450 groceries`";

  const amountMatch = raw.match(/^(\d+(?:\.\d+)?)\s*/);
  if (!amountMatch) return "Could not read amount. Try: `!spent 450 groceries`";

  const amount      = parseFloat(amountMatch[1]!);
  const description = raw.slice(amountMatch[0].length).trim() || "expense";
  const payer       = inferPayer(msg.text, msg.from, msg.senderName);
  const sender      = resolvedName(msg.from, msg.senderName);
  const weekend     = isWeekend();

  // Guess category with Haiku
  const category = await guessCategory(description);

  const entry: RawLogEntry = {
    timestamp: istTimestamp(),
    sentBy: sender,
    payer,
    amount,
    description,
    raw: msg.text,
    isSplit: false,
    isWeekend: weekend,
    line: "",
  };
  appendExpenseLog(entry);

  const { error } = await supabase.from("ba_expenses").insert({
    group_id:     msg.groupId,
    raw_text:     msg.text,
    amount,
    description,
    category,
    paid_by:      payer,
    added_by:     sender,
    expense_date: new Date().toISOString().slice(0, 10),
    is_split:     false,
    is_weekend:   weekend,
    source:       "whatsapp",
  });

  if (error) return `DB error: ${error.message}`;

  let reply = `✅ Logged\n*${fmt(amount)}* · ${category} · Paid by ${payer}`;

  const budget = await checkBudgetAlert(msg.groupId);
  if (budget) reply += `\n\n${budget}`;

  return reply;
}

// ── !analyse ──────────────────────────────────────────────────────────────────

export async function handleAnalyseCommand(msg: BotMessage): Promise<string> {
  try {
    const result = await analyseAndSave(msg.groupId);

    if (result.saved === 0 && result.skipped === 0) {
      return "No unprocessed entries found in expense.md. Start logging first!";
    }
    if (result.saved === 0) {
      return `Processed ${result.skipped} log line(s) — no valid expenses found.`;
    }

    const catLines = Object.entries(result.categories)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `${cat} (${count})`)
      .join(", ");

    return `✅ Analysed ${result.saved + result.skipped} entries
📂 Categories: ${catLines || "N/A"}
💾 All saved to database. Run \`!report\` for the full breakdown.`;
  } catch (e) {
    return `⚠️ Analyse failed: ${String(e).slice(0, 200)}`;
  }
}

// ── !report ───────────────────────────────────────────────────────────────────

export async function handleReportCommand(msg: BotMessage, periodArg: string): Promise<string> {
  try {
    return await generateReport(msg.groupId, periodArg);
  } catch (e) {
    return `⚠️ Could not generate report: ${String(e).slice(0, 200)}`;
  }
}

// ── !summary ──────────────────────────────────────────────────────────────────

export async function handleSummaryCommand(msg: BotMessage): Promise<string> {
  try {
    return await generateSummary(msg.groupId);
  } catch (e) {
    return `⚠️ Could not fetch summary: ${String(e).slice(0, 200)}`;
  }
}

// ── !settle ───────────────────────────────────────────────────────────────────

export async function handleSettleCommand(msg: BotMessage, args: string): Promise<string> {
  const { start, end, label } = parsePeriod(args || "last30days");

  const { data, error } = await supabase
    .from("ba_expenses")
    .select("amount, paid_by")
    .eq("group_id", msg.groupId)
    .eq("is_settled", false)
    .gte("expense_date", start.toISOString().slice(0, 10))
    .lte("expense_date", end.toISOString().slice(0, 10));

  if (error) return `DB error: ${error.message}`;
  if (!data?.length) return `No unsettled expenses for ${label}.`;

  let madhanTotal = 0, indhuTotal = 0;
  for (const e of data) {
    if (e.paid_by === "Indhu") indhuTotal += Number(e.amount);
    else madhanTotal += Number(e.amount);
  }
  const grand  = madhanTotal + indhuTotal;
  const half   = grand / 2;
  const netBy  = madhanTotal > half ? "Indhu" : "Madhan";
  const netAmt = Math.abs(madhanTotal - half);

  const { error: upErr } = await supabase
    .from("ba_expenses")
    .update({ is_settled: true, settled_at: new Date().toISOString() })
    .eq("group_id", msg.groupId)
    .eq("is_settled", false)
    .gte("expense_date", start.toISOString().slice(0, 10))
    .lte("expense_date", end.toISOString().slice(0, 10));

  if (upErr) return `Failed to mark settled: ${upErr.message}`;

  await supabase.from("ba_expense_settlements").insert({
    group_id:     msg.groupId,
    settled_by:   resolvedName(msg.from, msg.senderName),
    period_start: start.toISOString().slice(0, 10),
    period_end:   end.toISOString().slice(0, 10),
    madhan_total: madhanTotal,
    indhu_total:  indhuTotal,
    net_owed_by:  netBy,
    net_amount:   netAmt,
  });

  return `✅ *Settled — ${label}*
Total: ${fmt(grand)}  (Madhan: ${fmt(madhanTotal)} · Indhu: ${fmt(indhuTotal)})
${netBy} owes ${fmt(netAmt)} → transfer and you're even.`;
}

// ── !history ──────────────────────────────────────────────────────────────────

export async function handleHistoryCommand(msg: BotMessage, args: string): Promise<string> {
  const n = Math.min(parseInt(args) || 10, 30);

  const { data, error } = await supabase
    .from("ba_expenses")
    .select("expense_date, amount, description, category, paid_by, is_settled")
    .eq("group_id", msg.groupId)
    .order("created_at", { ascending: false })
    .limit(n);

  if (error) return `DB error: ${error.message}`;
  if (!data?.length) return "No expenses logged yet.";

  const lines = data.map(e => {
    const settled = e.is_settled ? " ✓" : "";
    return `${e.expense_date}  ${fmt(Number(e.amount)).padStart(9)}  ${e.description} [${e.paid_by}]${settled}`;
  });
  return `*Last ${data.length} expenses:*\n\`\`\`\n${lines.join("\n")}\n\`\`\``;
}

// ── !delete last ──────────────────────────────────────────────────────────────

export async function handleDeleteCommand(msg: BotMessage, args: string): Promise<string> {
  if (args.trim().toLowerCase() !== "last")
    return "Only `!delete last` is supported.";

  const { data, error } = await supabase
    .from("ba_expenses")
    .select("id, amount, description")
    .eq("group_id", msg.groupId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data?.length) return "Nothing to delete.";

  const e = data[0]!;
  const { error: delErr } = await supabase.from("ba_expenses").delete().eq("id", e.id);
  if (delErr) return `Delete failed: ${delErr.message}`;

  return `🗑️ Removed: ${fmt(Number(e.amount))} — ${e.description}`;
}

// ── Help ──────────────────────────────────────────────────────────────────────

export function expensesHelp(): string {
  return `*💰 Expense Tracker*
━━━━━━━━━━━━━━━━━━━━━━━━
*Logging*
• Type naturally: "spent 500 on petrol", "paid 1200 for dinner"
• "600 each" or "500 per head" → auto-multiplies by ${Number(process.env.EXPENSE_MEMBER_COUNT ?? 7)} members
• \`!spent <amount> <description>\`

*Reviewing*
• \`!report\` — last 30 days (Claude-generated)
• \`!report last7days\` / \`thismonth\` / \`lastmonth\` / \`april\`
• \`!summary\` — one-liner for current month
• \`!history [n]\` — last N entries

*Analysis*
• \`!analyse\` — process expense.md → save to DB with categories

*Splitting*
• \`!split category Food\` — split all Food (last 30 days)
• \`!split category Food last7days\`
• \`!split bill dinner\` — split specific bill by description
• \`!split last\` — split last entry 50/50
• \`!split groceries\` — split all groceries

*Settling*
• \`!settle\` — mark all as settled, show net owed

*Other*
• \`!delete last\` — remove last entry
• \`!help\` — this menu

*Default: Madhan pays* unless you say "Indhu paid"
*English only* — Tamil/mixed messages won't be logged`;
}

// ── Budget alert ──────────────────────────────────────────────────────────────

async function checkBudgetAlert(groupId: string): Promise<string | null> {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const { data } = await supabase
      .from("ba_expenses")
      .select("amount")
      .eq("group_id", groupId)
      .gte("expense_date", monthStart.toISOString().slice(0, 10));

    if (!data?.length) return null;

    const total = data.reduce((s, e) => s + Number(e.amount), 0);
    const pct   = (total / MONTHLY_BUDGET) * 100;

    if (pct >= 100) {
      return `🚨 *Budget exceeded!* Spent ${fmt(total)} of ${fmt(MONTHLY_BUDGET)} budget this month.`;
    }
    if (pct >= 80) {
      return `⚠️ Heads up — you've spent ${fmt(total)} this month (${Math.round(pct)}% of ${fmt(MONTHLY_BUDGET)} budget)`;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Category guesser (Haiku, for !spent) ─────────────────────────────────────

const OLD_CATS = [
  "groceries", "food", "fuel", "rent", "utilities", "medical",
  "entertainment", "shopping", "subscriptions", "travel", "savings", "transfer", "others",
];

async function guessCategory(description: string): Promise<string> {
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{
        role: "user",
        content: `Classify this expense into exactly one category. Reply with only the category word.
Categories: ${OLD_CATS.join(", ")}
Expense: "${description}"`,
      }],
    });
    const cat = res.content[0]?.type === "text" ? res.content[0].text.trim().toLowerCase() : "others";
    return OLD_CATS.includes(cat) ? cat : "others";
  } catch {
    return "others";
  }
}
