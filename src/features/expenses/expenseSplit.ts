import { supabase } from "../../supabase.js";
import { parsePeriod, fmt } from "./expenseParser.js";
import type { BotMessage } from "../../types.js";
import type { SplitRecord } from "./types.js";

const MEMBER_COUNT = Number(process.env.EXPENSE_MEMBER_COUNT ?? 7);

// ── !split category Food [period] ─────────────────────────────────────────────

export async function handleSplitCategory(
  msg: BotMessage,
  category: string,
  periodArg: string,
): Promise<string> {
  const { start, end, label } = parsePeriod(periodArg || "last30days");
  const catLower = category.toLowerCase();

  const { data, error } = await supabase
    .from("ba_expenses")
    .select("id, amount, description, paid_by, expense_date")
    .eq("group_id", msg.groupId)
    .eq("is_settled", false)
    .ilike("category", catLower)
    .gte("expense_date", start.toISOString().slice(0, 10))
    .lte("expense_date", end.toISOString().slice(0, 10));

  if (error) return `DB error: ${error.message}`;
  if (!data?.length) return `No ${category} expenses found for ${label}.`;

  const total = data.reduce((s, e) => s + Number(e.amount), 0);
  const perPerson = total / MEMBER_COUNT;

  // Determine who covered it (majority payer)
  const byPayer: Record<string, number> = {};
  for (const e of data) {
    const p = (e.paid_by as string) || "Madhan";
    byPayer[p] = (byPayer[p] ?? 0) + Number(e.amount);
  }
  const coveredBy = Object.entries(byPayer).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Madhan";

  await saveSplitRecord({
    expense_ids: data.map(e => String(e.id)),
    split_type: `category:${catLower}`,
    total_amount: total,
    per_person: perPerson,
    member_count: MEMBER_COUNT,
    payer: coveredBy,
    created_by: msg.senderName,
    details: { category: catLower, period: label, item_count: data.length },
  }, msg.groupId);

  const catEmoji = getCategoryEmoji(catLower);
  return `${catEmoji} *${category} Split — ${label}*
Total: ${fmt(total)}
Per person (${MEMBER_COUNT} members): ${fmt(perPerson)}
Already covered by: ${coveredBy}
Each person owes ${coveredBy}: ${fmt(perPerson)}`;
}

// ── !split bill <search> ──────────────────────────────────────────────────────

export async function handleSplitBill(
  msg: BotMessage,
  searchTerm: string,
): Promise<string> {
  if (!searchTerm.trim()) return "Usage: `!split bill <description>` e.g. `!split bill dinner`";

  const { data, error } = await supabase
    .from("ba_expenses")
    .select("id, amount, description, paid_by, expense_date")
    .eq("group_id", msg.groupId)
    .eq("is_settled", false)
    .ilike("description", `%${searchTerm.trim()}%`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return `DB error: ${error.message}`;
  if (!data?.length) return `No expense matching "${searchTerm}" found.`;

  const e = data[0]!;
  const total = Number(e.amount);
  const perPerson = total / MEMBER_COUNT;
  const coveredBy = (e.paid_by as string) || "Madhan";

  await saveSplitRecord({
    expense_ids: [String(e.id)],
    split_type: "bill",
    total_amount: total,
    per_person: perPerson,
    member_count: MEMBER_COUNT,
    payer: coveredBy,
    created_by: msg.senderName,
    details: { description: e.description, date: e.expense_date },
  }, msg.groupId);

  return `🧾 *Bill Split — ${e.description}*
Total: ${fmt(total)}
Per person (${MEMBER_COUNT} members): ${fmt(perPerson)}
Already covered by: ${coveredBy}
Each person owes ${coveredBy}: ${fmt(perPerson)}`;
}

// ── Legacy !split <category|last> [madhan|indhu] ─────────────────────────────

const LEGACY_CATEGORIES = [
  "groceries", "food", "fuel", "rent", "utilities", "medical",
  "entertainment", "shopping", "subscriptions", "travel", "savings", "transfer", "others",
];

export async function handleSplitLegacy(
  msg: BotMessage,
  args: string,
): Promise<string> {
  const parts  = args.trim().toLowerCase().split(/\s+/);
  const target = parts[0] ?? "last";
  const who    = parts[1] ?? "equal";

  const splitType = who === "madhan" ? "full_madhan" : who === "indhu" ? "full_indhu" : "equal";

  let query = supabase
    .from("ba_expenses")
    .select("id, amount, description, paid_by, category")
    .eq("group_id", msg.groupId)
    .eq("is_settled", false);

  if (target === "last") {
    query = (query as any).order("created_at", { ascending: false }).limit(1);
  } else if (LEGACY_CATEGORIES.includes(target)) {
    query = (query as any).ilike("category", target);
  } else {
    return "Usage: `!split last` · `!split groceries` · `!split category Food` · `!split bill <desc>`";
  }

  const { data, error } = await query;
  if (error) return `DB error: ${error.message}`;
  if (!data?.length) return "No matching expenses to split.";

  const updates = data.map(e => {
    const amt = Number(e.amount);
    const madhan = splitType === "full_madhan" ? amt : splitType === "full_indhu" ? 0 : amt / 2;
    const indhu  = splitType === "full_indhu"  ? amt : splitType === "full_madhan" ? 0 : amt / 2;
    return supabase.from("ba_expenses")
      .update({ split_type: splitType, madhan_share: madhan, indhu_share: indhu })
      .eq("id", e.id);
  });
  await Promise.all(updates);

  const totalAmt = data.reduce((s, e) => s + Number(e.amount), 0);
  const label =
    splitType === "equal"       ? `split equally (${fmt(totalAmt / 2)} each)` :
    splitType === "full_madhan" ? `assigned fully to Madhan`                  :
                                  `assigned fully to Indhu`;

  return `✅ ${data.length} expense(s) — ${label}\nTotal: ${fmt(totalAmt)}`;
}

// ── Dispatch: parse !split args and route ─────────────────────────────────────

export async function handleSplitCommand(msg: BotMessage, args: string): Promise<string> {
  const trimmed = args.trim();
  const lower   = trimmed.toLowerCase();

  if (lower.startsWith("category ")) {
    // !split category Food [period]
    const rest  = trimmed.slice("category ".length).trim();
    const parts = rest.split(/\s+/);
    const cat   = parts[0] ?? "";
    const period = parts.slice(1).join(" ");
    return handleSplitCategory(msg, cat, period);
  }

  if (lower.startsWith("bill ")) {
    // !split bill <description>
    const search = trimmed.slice("bill ".length).trim();
    return handleSplitBill(msg, search);
  }

  // Legacy: !split last | !split groceries | !split last madhan
  return handleSplitLegacy(msg, trimmed);
}

// ── ba_splits insert ──────────────────────────────────────────────────────────

async function saveSplitRecord(record: SplitRecord, groupId: string): Promise<void> {
  await supabase.from("ba_splits").insert({
    group_id:     groupId,
    expense_ids:  record.expense_ids,
    split_type:   record.split_type,
    total_amount: record.total_amount,
    per_person:   record.per_person,
    member_count: record.member_count,
    payer:        record.payer,
    created_by:   record.created_by,
    details:      record.details,
  });
}

function getCategoryEmoji(cat: string): string {
  const map: Record<string, string> = {
    food: "🍽", transport: "🚗", entertainment: "🎬", groceries: "🛒",
    shopping: "🛍", utilities: "💡", medical: "🏥", travel: "✈️", misc: "📦",
  };
  return map[cat] ?? "💸";
}
