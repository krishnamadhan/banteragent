import type { BotMessage } from "../../types.js";
import {
  insertFund, insertPendingAdd, insertPendingContri,
  getPendingItems, getPendingCount, approveItem, approveAll,
  deleteItem, deleteAll, getBalance, getRecentApproved, getAllApproved,
} from "./db.js";
import { parseFundCommand, parseAddCommand, parseContriCommand } from "./claudeParser.js";
import { fmt } from "./parse.js";
import { generateReport } from "./report.js";
import { CONSTRUCTION_CATEGORIES } from "./types.js";

function sender(msg: BotMessage): string {
  return msg.senderName || msg.from.split("@")[0] || "Unknown";
}

function displayDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ── !fund ─────────────────────────────────────────────────────────────────────
// Simple direct pool addition — no pending, no Claude.
// Syntax: !fund <amount> [Madhan|Amma|name] [description]

export async function handleFund(msg: BotMessage, args: string): Promise<string> {
  if (!args.trim()) {
    return [
      "*!fund — Add money to the construction pool*",
      "Usage: `!fund <free text>`",
      "",
      "Examples:",
      "  `!fund 50000` — Madhan added ₹50,000",
      "  `!fund Amma 75000 second instalment`",
      "  `!fund 25000 amma 24-jun first instalment`",
    ].join("\n");
  }

  const result = await parseFundCommand(args);
  if (result.needsClarification) return `🤔 ${result.question}`;
  if (result.error) return `❌ ${result.error}`;
  if (!result.data) return "❌ Parse error.";

  const d = result.data;
  const { error } = await insertFund(
    msg.groupId, d.amount, d.person,
    d.description, d.date, sender(msg),
  );
  if (error) return `❌ DB error: ${error}`;

  const pending = await getPendingItems(msg.groupId);

  const idx = pending.length;
  return [
    `📝 *Pending #${idx} (IN)*`,
    `${fmt(d.amount)} from *${d.person}*${d.description ? ` — ${d.description}` : ""}`,
    `📅 ${displayDate(d.date)}`,
    ``,
    `Send \`!approve ${idx}\` to confirm.`,
  ].join("\n");
}

// ── !add ──────────────────────────────────────────────────────────────────────
// Expense paid FROM the pool. Claude parses free text → pending.

export async function handleAdd(msg: BotMessage, args: string): Promise<string> {
  if (!args.trim()) {
    return [
      "*!add — Log an expense paid from the construction fund*",
      "Usage: `!add <free text description>`",
      "",
      "Examples:",
      "  `!add paid contractor 1000 advance`",
      "  `!add 15000 cement 50 bags yesterday`",
      "  `!add lorry hire 4500 transport 24-Jun`",
    ].join("\n");
  }

  const result = await parseAddCommand(args);

  if (result.needsClarification) {
    return `🤔 ${result.question}\n\n_Reply to this message with the clarification._`;
  }
  if (result.error) return `❌ ${result.error}`;
  if (!result.data) return "❌ Parse error.";

  const d = result.data;
  const { error } = await insertPendingAdd(
    msg.groupId, d.amount, d.category, d.description,
    d.date, d.paidBy, sender(msg), args,
  );
  if (error) return `❌ DB error: ${error}`;

  const pending = await getPendingItems(msg.groupId);

  const idx = pending.length;
  return [
    `📝 *Pending #${idx}*`,
    `${fmt(d.amount)} — *${d.category}* — ${d.description}`,
    `📅 ${displayDate(d.date)}  👤 ${d.paidBy}`,
    ``,
    `Send \`!approve ${idx}\` to confirm.`,
  ].join("\n");
}

// ── !contri ───────────────────────────────────────────────────────────────────
// External person paid from their own pocket → IN+OUT pair → pending.

export async function handleContri(msg: BotMessage, args: string): Promise<string> {
  if (!args.trim()) {
    return [
      "*!contri — Record when someone pays directly (not from the pool)*",
      "Usage: `!contri <free text>`",
      "",
      "This creates a matched IN+OUT — the money comes in from the person and goes out for what they paid.",
      "",
      "Examples:",
      "  `!contri Rajasekar paid for borewell 20000`",
      "  `!contri uncle covered steel 35000 yesterday`",
      "  `!contri contractor advance 10000 Murugan`",
    ].join("\n");
  }

  const result = await parseContriCommand(args);

  if (result.needsClarification) {
    return `🤔 ${result.question}\n\n_Reply to this message with the clarification._`;
  }
  if (result.error) return `❌ ${result.error}`;
  if (!result.data) return "❌ Parse error.";

  const d = result.data;
  const { error } = await insertPendingContri(
    msg.groupId, d.amount, d.category, d.description,
    d.date, d.person, sender(msg), args,
  );
  if (error) return `❌ DB error: ${error}`;

  const pending = await getPendingItems(msg.groupId);

  const idx = pending.length;
  return [
    `📝 *Pending #${idx} (IN+OUT)*`,
    `${fmt(d.amount)} from *${d.person}* → ${d.category} — ${d.description}`,
    `📅 ${displayDate(d.date)}`,
    ``,
    `Send \`!approve ${idx}\` to confirm both sides.`,
  ].join("\n");
}

// ── !approve ──────────────────────────────────────────────────────────────────

export async function handleApprove(msg: BotMessage, args: string): Promise<string> {
  const a = args.trim().toLowerCase();
  const pending = await getPendingItems(msg.groupId);

  if (!pending.length) return "✅ No pending items.";

  // List pending
  if (!a) {
    const lines = [`📋 *${pending.length} pending approval${pending.length > 1 ? "s" : ""}*`, ""];
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!;
      const r = item.row;
      if (item.type === "contri_pair") {
        lines.push(`${i + 1}. [IN+OUT] ${fmt(Number(r.amount))} — *${r.person}* → ${r.category ?? "?"} — ${r.description ?? ""}  📅 ${displayDate(r.tx_date)}`);
      } else if (r.source === "fund") {
        lines.push(`${i + 1}. [IN] ${fmt(Number(r.amount))} — *${r.person}*${r.description ? ` — ${r.description}` : ""}  📅 ${displayDate(r.tx_date)}`);
      } else {
        lines.push(`${i + 1}. [OUT] ${fmt(Number(r.amount))} — ${r.category ?? "?"} — ${r.description ?? ""}  📅 ${displayDate(r.tx_date)}`);
      }
    }
    lines.push("", `\`!approve <n>\` or \`!approve all\``);
    return lines.join("\n");
  }

  // Approve all
  if (a === "all") {
    const { count, error } = await approveAll(msg.groupId);
    if (error) return `❌ ${error}`;
    const bal = await getBalance(msg.groupId);
    return `✅ Approved all ${count} item${count !== 1 ? "s" : ""}.\n💰 Pool balance: *${fmt(bal.poolBalance)}*`;
  }

  // Approve specific item
  const n = parseInt(a);
  if (isNaN(n) || n < 1 || n > pending.length) {
    return `❌ No item #${a}. Send \`!approve\` to see the list.`;
  }
  const item = pending[n - 1]!;
  const { error } = await approveItem(msg.groupId, item);
  if (error) return `❌ ${error}`;

  const r = item.row;
  const [bal, stillPending] = await Promise.all([getBalance(msg.groupId), getPendingItems(msg.groupId)]);
  const label = item.type === "contri_pair"
    ? `${fmt(Number(r.amount))} from ${r.person} → ${r.category}`
    : r.source === "fund"
      ? `${fmt(Number(r.amount))} IN from ${r.person}`
      : `${fmt(Number(r.amount))} — ${r.category} — ${r.description}`;

  const pendingFund = stillPending.filter(p => p.row.source === "fund").reduce((s, p) => s + Number(p.row.amount), 0);
  const balLine = pendingFund > 0
    ? `💰 Pool balance: *${fmt(bal.poolBalance)}* _(+ ${fmt(pendingFund)} pending approval)_`
    : `💰 Pool balance: *${fmt(bal.poolBalance)}*`;

  return [`✅ Approved #${n}: ${label}`, balLine].join("\n");
}

// ── !delete ───────────────────────────────────────────────────────────────────

export async function handleDelete(msg: BotMessage, args: string): Promise<string> {
  const a = args.trim().toLowerCase();
  const pending = await getPendingItems(msg.groupId);

  if (!pending.length) return "Nothing pending to delete.";

  // List pending (deletable items only)
  if (!a) {
    const lines = [`🗑️ *${pending.length} pending item${pending.length > 1 ? "s" : ""} (can delete)*`, ""];
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!;
      const r = item.row;
      const tag = item.type === "contri_pair" ? "[IN+OUT]"
        : r.source === "fund" ? "[IN]" : "[OUT]";
      const label = r.source === "fund"
        ? `${r.person ?? "?"} — ${r.description ?? "fund"}`
        : (r.description ?? r.category ?? "?");
      lines.push(`${i + 1}. ${tag} ${fmt(Number(r.amount))} — ${label} — ${displayDate(r.tx_date)}`);
    }
    lines.push("", `\`!delete <n>\` or \`!delete all\``);
    return lines.join("\n");
  }

  // Delete all pending
  if (a === "all") {
    const { count, error } = await deleteAll(msg.groupId);
    if (error) return `❌ ${error}`;
    return `🗑️ Deleted all ${count} pending item${count !== 1 ? "s" : ""}.`;
  }

  const n = parseInt(a);
  if (isNaN(n) || n < 1 || n > pending.length) {
    return `❌ No item #${a}. Send \`!delete\` to see the list.`;
  }
  const item = pending[n - 1]!;
  const { error } = await deleteItem(msg.groupId, item);
  if (error) return `❌ ${error}`;

  const r = item.row;
  const label = r.source === "fund"
    ? `${fmt(Number(r.amount))} IN from ${r.person}`
    : `${fmt(Number(r.amount))} — ${r.description ?? r.category ?? "?"}`;
  return `🗑️ Deleted #${n}: ${label}`;
}

// ── !summary ──────────────────────────────────────────────────────────────────

export async function handleSummary(msg: BotMessage): Promise<string> {
  const [bal, recent, pendingCount] = await Promise.all([
    getBalance(msg.groupId),
    getRecentApproved(msg.groupId, 5),
    getPendingCount(msg.groupId),
  ]);

  const pct = bal.poolFunded > 0 ? Math.round((bal.poolSpent / bal.poolFunded) * 100) : 0;

  const pendingFund = (await getPendingItems(msg.groupId))
    .filter(p => p.row.source === "fund")
    .reduce((s, p) => s + Number(p.row.amount), 0);
  const pendingHint = pendingFund > 0 ? ` _(+ ${fmt(pendingFund)} pending)_` : "";

  const lines: string[] = [
    `*🏗️ Construction Summary*`,
    ``,
    `💰 *Pool balance: ${fmt(bal.poolBalance)}*${pendingHint}`,
    `  Funded: ${fmt(bal.poolFunded)} | Pool expenses: ${fmt(bal.poolSpent)} (${pct}%)`,
  ];

  if (bal.externalPaid > 0) {
    lines.push(`🤝 External (paid by others): ${fmt(bal.externalPaid)}`);
  }
  lines.push(`📊 Total project cost: ${fmt(bal.totalProjectCost)}`);

  if (pendingCount > 0) {
    lines.push(``, `⏳ *${pendingCount} pending approval${pendingCount > 1 ? "s" : ""}* — send \`!approve\` to review`);
  }

  if (recent.length) {
    // Deduplicate contri pairs — only show the OUT row
    const seen = new Set<string>();
    const deduped = recent.filter(tx => {
      if (tx.source === "contri" && tx.flow === "in") return false;
      if (tx.source === "contri" && tx.pair_id) {
        if (seen.has(tx.pair_id)) return false;
        seen.add(tx.pair_id);
      }
      return true;
    });
    lines.push(``, `*Last ${deduped.length} entries:*`);
    for (const tx of deduped) {
      const icon = tx.source === "fund" ? "💚" : tx.source === "contri" ? "🤝" : "🔴";
      const who  = tx.source === "fund" ? tx.person : tx.source === "contri" ? `${tx.person}→${tx.category}` : tx.category;
      lines.push(`${icon} ${displayDate(tx.tx_date)}  ${fmt(Number(tx.amount)).padStart(10)}  ${who ?? "?"}`);
    }
  }

  return lines.join("\n");
}

// ── !balance ──────────────────────────────────────────────────────────────────

export async function handleBalance(msg: BotMessage): Promise<string> {
  const bal = await getBalance(msg.groupId);
  const pct = bal.poolFunded > 0 ? Math.round((bal.poolSpent / bal.poolFunded) * 100) : 0;
  const filled = Math.min(Math.round(pct / 5), 20);
  const bar = `[${"█".repeat(filled)}${"░".repeat(20 - filled)}] ${pct}%`;

  const personLines = Object.entries(bal.byPerson)
    .sort((a, b) => b[1] - a[1])
    .map(([n, a]) => `  ${n}: ${fmt(a)}`).join("\n");

  const catLines = Object.entries(bal.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c, a]) => `  ${c}: ${fmt(a)}`).join("\n");

  const pendingCount = await getPendingCount(msg.groupId);

  return [
    `*🏗️ Construction Fund*`,
    ``,
    `💚 *Pool funded: ${fmt(bal.poolFunded)}*`,
    personLines || "  —",
    ``,
    `🔴 Pool spent: ${fmt(bal.poolSpent)} (${pct}%)`,
    catLines || "  —",
    ``,
    bal.externalPaid > 0 ? `🤝 External: ${fmt(bal.externalPaid)}` : "",
    bal.externalPaid > 0 ? `📊 Total project: ${fmt(bal.totalProjectCost)}` : "",
    ``,
    bar,
    ``,
    `💰 *Balance: ${fmt(bal.poolBalance)}*`,
    bal.poolBalance < 0 ? `⚠️ *Fund is overdrawn!*` : bal.poolBalance < 10000 ? `⚠️ Running low — top up soon` : "",
    pendingCount > 0 ? `⏳ ${pendingCount} pending approval${pendingCount > 1 ? "s" : ""}` : "",
  ].filter(l => l !== "").join("\n").trimEnd();
}

// ── !history ──────────────────────────────────────────────────────────────────

export async function handleHistory(msg: BotMessage, args: string): Promise<string> {
  const n = Math.min(parseInt(args) || 10, 50);
  const txs = await getRecentApproved(msg.groupId, n);

  if (!txs.length) return "No approved entries yet.";

  const lines = [`*📋 Last ${txs.length} approved entries*`];
  for (const tx of txs) {
    if (tx.source === "contri" && tx.flow === "in") continue; // skip contri IN — show OUT only
    const icon = tx.source === "fund" ? "💚" : tx.source === "contri" ? "🤝" : "🔴";
    const who  = tx.source === "fund" ? (tx.person ?? "?") : tx.source === "contri" ? `${tx.person}→${tx.category}` : `[${tx.category}] ${tx.description ?? ""}`;
    lines.push(`${icon} ${tx.tx_date}  ${fmt(Number(tx.amount)).padStart(10)}  ${who}`);
  }

  return `\`\`\`\n${lines.join("\n")}\n\`\`\``;
}

// ── !report ───────────────────────────────────────────────────────────────────

export async function handleReport(msg: BotMessage): Promise<{ text: string; file?: string }> {
  const [txs, bal] = await Promise.all([
    getAllApproved(msg.groupId),
    getBalance(msg.groupId),
  ]);

  if (!txs.length) return { text: "No approved transactions yet — nothing to report." };

  try {
    const filePath = await generateReport(txs, bal);
    // Count display rows: fund + add rows + all contri rows (both IN and OUT)
    const displayCount = txs.length;
    const lines = [
      `📊 *Construction Report*`,
      ``,
      `💰 Fund collected: ${fmt(bal.poolFunded)}`,
      `🔴 Spent from fund: ${fmt(bal.poolSpent)}`,
      `💵 Fund available: *${fmt(bal.poolBalance)}*`,
    ];
    if (bal.externalPaid > 0) lines.push(`🤝 External payments: ${fmt(bal.externalPaid)}`);
    lines.push(`📊 Total project cost: *${fmt(bal.totalProjectCost)}*`);
    lines.push(``, `${displayCount} entries exported.`);
    return { text: lines.join("\n"), file: filePath };
  } catch (e: any) {
    return { text: `❌ Report generation failed: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

// ── !help ─────────────────────────────────────────────────────────────────────

export function constructionHelp(): string {
  return [
    `*🏗️ Construction Fund Tracker*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `*Add money to pool*`,
    `  \`!fund <amount> [person] [desc]\``,
    `  \`!fund 50000 Amma second instalment\``,
    ``,
    `*Log expense from pool* (goes pending)`,
    `  \`!add <free text>\``,
    `  \`!add paid contractor 1000 advance\``,
    `  \`!add 15000 cement 50 bags yesterday\``,
    ``,
    `*Log external payment* (IN+OUT, goes pending)`,
    `  \`!contri\` / \`!contribute\` / \`!contrib\` <free text>`,
    `  \`!contri Rajasekar paid borewell 20000\``,
    `  \`!contri uncle covered steel 35000\``,
    ``,
    `*Categories:* ${CONSTRUCTION_CATEGORIES.join(", ")}`,
    ``,
    `*Approve pending*`,
    `  \`!approve\` — list pending`,
    `  \`!approve 2\` — approve item 2`,
    `  \`!approve all\` — approve everything`,
    ``,
    `*Delete pending*`,
    `  \`!delete\` — list pending`,
    `  \`!delete 3\` — remove item 3`,
    ``,
    `*Reports & history*`,
    `  \`!summary\` — balance + pending + last 5`,
    `  \`!balance\` / \`!bal\` — detailed fund breakdown`,
    `  \`!history [n]\` — last n approved entries`,
    `  \`!report\` — full Excel file (.xlsx)`,
    ``,
    `_!add = from pool  |  !contri = person's own pocket (IN+OUT)_`,
  ].join("\n");
}
