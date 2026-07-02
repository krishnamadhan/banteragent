import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../../supabase.js";
import { getAllApproved } from "./db.js";
import { CONSTRUCTION_CATEGORIES } from "./types.js";
import { fmt } from "./parse.js";

const ai = new Anthropic();

export async function handleAnalyze(groupId: string): Promise<string> {
  const txs = await getAllApproved(groupId);
  const expenses = txs.filter(t => t.flow === "out");
  if (!expenses.length) return "No expense entries yet.";

  const rows = expenses.map(e =>
    `${e.id.slice(0, 8)} | ${e.tx_date} | ${fmt(Number(e.amount))} | ${e.category} | ${e.description}`
  ).join("\n");

  try {
    const res = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Review expense entries for a house construction project in Tamil Nadu.

Categories: ${CONSTRUCTION_CATEGORIES.join(", ")}

Expenses (id | date | amount | category | description):
${rows}

1. Fix misspelled/inconsistent descriptions (e.g. "ciment"→"Cement").
2. Correct miscategorised entries.
3. Only suggest confident changes.
4. Write 2-3 sentences of spending insights.

Reply ONLY in JSON:
{"changes": [{"id": "<first 8 chars>", "description": "<cleaned>", "category": "<correct>"}], "insights": "..."}`,
      }],
    });

    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON");

    const parsed = JSON.parse(m[0]) as { changes: { id: string; description: string; category: string }[]; insights: string };
    const changes = parsed.changes ?? [];

    let updated = 0;
    for (const ch of changes) {
      const match = expenses.find(e => e.id.startsWith(ch.id));
      if (!match) continue;
      const { error } = await supabase
        .from("construction_transactions")
        .update({ description: ch.description, category: ch.category })
        .eq("id", match.id);
      if (!error) updated++;
    }

    const lines = [`*🔍 Analysis Complete*`];
    if (!changes.length) {
      lines.push("All entries look clean.");
    } else {
      lines.push(`Fixed ${updated}/${changes.length} entries:`);
      for (const ch of changes) {
        const orig = expenses.find(e => e.id.startsWith(ch.id));
        if (orig) lines.push(`  • ${orig.description} → ${ch.description} [${ch.category}]`);
      }
    }
    if (parsed.insights) lines.push(`\n💡 ${parsed.insights}`);
    return lines.join("\n");
  } catch (e: unknown) {
    return `⚠️ AI analysis failed: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`;
  }
}

export async function handleInsights(groupId: string): Promise<string> {
  const txs = await getAllApproved(groupId);
  if (!txs.length) return "No data yet.";

  const ins  = txs.filter(t => t.flow === "in"  && t.source === "fund");
  const outs = txs.filter(t => t.flow === "out");

  const totalIn  = ins.reduce((s, r)  => s + Number(r.amount), 0);
  const totalOut = outs.reduce((s, r) => s + Number(r.amount), 0);

  const catTotals: Record<string, number> = {};
  for (const e of outs) {
    const cat = e.category ?? "Misc";
    catTotals[cat] = (catTotals[cat] ?? 0) + Number(e.amount);
  }

  const catSummary = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([c, a]) => `${c}: ${fmt(a)}`).join(", ");

  try {
    const res = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `Construction fund: Tiruvannamalai, Tamil Nadu.
Funded: ${fmt(totalIn)} | Spent: ${fmt(totalOut)} | Balance: ${fmt(totalIn - totalOut)}
Categories: ${catSummary}

Write 3-4 sentences: what's been spent most on, fund health, notable patterns. Be specific with numbers.`,
      }],
    });
    const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
    return `*💡 Project Insights*\n\n${text}`;
  } catch {
    return `*💡 Project Insights*\nFund: ${fmt(totalIn)} in, ${fmt(totalOut)} spent, *${fmt(totalIn - totalOut)} remaining*.\nTop: ${Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"}.`;
  }
}
