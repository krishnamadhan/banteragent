import { supabase } from "../../supabase.js";
import { randomUUID } from "crypto";
import type { ConstructionTx, Balance, PendingItem } from "./types.js";

// ── Writers ───────────────────────────────────────────────────────────────────

export async function insertFund(
  groupId: string, amount: number, person: string,
  description: string | null, date: string, addedBy: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("construction_transactions").insert({
    group_id: groupId, flow: "in", source: "fund", status: "pending",
    amount, person, description, tx_date: date, added_by: addedBy,
  });
  return { error: error?.message ?? null };
}

export async function insertPendingAdd(
  groupId: string, amount: number, category: string, description: string,
  date: string, person: string, addedBy: string, rawText: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("construction_transactions").insert({
    group_id: groupId, flow: "out", source: "add", status: "pending",
    amount, category, description, tx_date: date, person,
    added_by: addedBy, raw_text: rawText,
  });
  return { error: error?.message ?? null };
}

export async function insertPendingContri(
  groupId: string, amount: number, category: string, description: string,
  date: string, person: string, addedBy: string, rawText: string,
): Promise<{ error: string | null }> {
  const pairId = randomUUID();
  const base = { group_id: groupId, source: "contri", status: "pending", pair_id: pairId, amount, category, description, tx_date: date, person, added_by: addedBy, raw_text: rawText };
  const { error } = await supabase.from("construction_transactions").insert([
    { ...base, flow: "in" },
    { ...base, flow: "out" },
  ]);
  return { error: error?.message ?? null };
}

// ── Pending queue ─────────────────────────────────────────────────────────────

export async function getPendingItems(groupId: string): Promise<PendingItem[]> {
  const { data } = await supabase
    .from("construction_transactions")
    .select("*")
    .eq("group_id", groupId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as ConstructionTx[];
  const seen = new Set<string>();
  const items: PendingItem[] = [];

  for (const row of rows) {
    if (row.source === "contri" && row.pair_id) {
      if (seen.has(row.pair_id)) continue;
      seen.add(row.pair_id);
      items.push({ type: "contri_pair", pairId: row.pair_id, row });
    } else {
      items.push({ type: "single", row });
    }
  }
  return items;
}

export async function getPendingCount(groupId: string): Promise<number> {
  const items = await getPendingItems(groupId);
  return items.length;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export async function approveItem(groupId: string, item: PendingItem): Promise<{ error: string | null }> {
  if (item.type === "contri_pair" && item.pairId) {
    const { error } = await supabase.from("construction_transactions")
      .update({ status: "approved" })
      .eq("group_id", groupId).eq("pair_id", item.pairId);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.from("construction_transactions")
    .update({ status: "approved" })
    .eq("id", item.row.id);
  return { error: error?.message ?? null };
}

export async function approveAll(groupId: string): Promise<{ count: number; error: string | null }> {
  const pending = await getPendingItems(groupId);
  if (!pending.length) return { count: 0, error: null };
  const { error } = await supabase.from("construction_transactions")
    .update({ status: "approved" })
    .eq("group_id", groupId).eq("status", "pending");
  return { count: pending.length, error: error?.message ?? null };
}

export async function deleteAll(groupId: string): Promise<{ count: number; error: string | null }> {
  const pending = await getPendingItems(groupId);
  if (!pending.length) return { count: 0, error: null };
  const { error } = await supabase.from("construction_transactions")
    .delete()
    .eq("group_id", groupId)
    .eq("status", "pending");
  return { count: pending.length, error: error?.message ?? null };
}

export async function deleteItem(groupId: string, item: PendingItem): Promise<{ error: string | null }> {
  if (item.type === "contri_pair" && item.pairId) {
    const { error } = await supabase.from("construction_transactions")
      .delete()
      .eq("group_id", groupId).eq("pair_id", item.pairId);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.from("construction_transactions")
    .delete().eq("id", item.row.id);
  return { error: error?.message ?? null };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getBalance(groupId: string): Promise<Balance> {
  const { data } = await supabase
    .from("construction_transactions")
    .select("flow, source, amount, category, person")
    .eq("group_id", groupId)
    .eq("status", "approved");

  let poolFunded = 0, poolSpent = 0, externalPaid = 0;
  const byPerson: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const r of data ?? []) {
    const amt = Number(r.amount);
    if (r.source === "fund"  && r.flow === "in")  {
      poolFunded += amt;
      if (r.person) byPerson[r.person] = (byPerson[r.person] ?? 0) + amt;
    } else if (r.source === "add"   && r.flow === "out") {
      poolSpent += amt;
      if (r.category) byCategory[r.category] = (byCategory[r.category] ?? 0) + amt;
    } else if (r.source === "contri" && r.flow === "out") {
      externalPaid += amt;
      if (r.category) byCategory[r.category] = (byCategory[r.category] ?? 0) + amt;
    }
    // contri IN rows: intentionally excluded from balance math (net-zero with contri OUT)
  }

  return {
    poolFunded, poolSpent,
    poolBalance: poolFunded - poolSpent,
    externalPaid,
    totalProjectCost: poolSpent + externalPaid,
    byPerson, byCategory,
  };
}

export async function getRecentApproved(groupId: string, limit: number): Promise<ConstructionTx[]> {
  const { data } = await supabase
    .from("construction_transactions")
    .select("*")
    .eq("group_id", groupId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ConstructionTx[];
}

export async function getAllApproved(groupId: string): Promise<ConstructionTx[]> {
  const { data } = await supabase
    .from("construction_transactions")
    .select("*")
    .eq("group_id", groupId)
    .eq("status", "approved")
    .order("tx_date", { ascending: true });
  return (data ?? []) as ConstructionTx[];
}
