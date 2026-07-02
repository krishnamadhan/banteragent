export type Flow     = "in" | "out";
export type TxSource = "fund" | "add" | "contri";
export type TxStatus = "pending" | "approved";

export const CONSTRUCTION_CATEGORIES = [
  "Foundation", "Brickwork", "Roofing", "Flooring",
  "Electrical", "Plumbing", "Painting", "Doors/Windows",
  "Labor", "Materials", "Transport", "Permit", "Misc",
] as const;

export type ConstructionCategory = typeof CONSTRUCTION_CATEGORIES[number];

export const KNOWN_CONTRIBUTORS = ["Madhan", "Amma"] as const;

export interface ConstructionTx {
  id: string;
  group_id: string;
  flow: Flow;
  source: TxSource;
  status: TxStatus;
  pair_id: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  tx_date: string;
  person: string | null;
  added_by: string;
  raw_text: string | null;
  created_at: string;
}

export interface ParsedFund {
  amount: number;
  person: string;
  description: string | null;
  date: string;
}

export interface ParsedAdd {
  amount: number;
  category: string;
  description: string;
  date: string;
  paidBy: string;
}

export interface ParsedContri {
  amount: number;
  person: string;
  category: string;
  description: string;
  date: string;
}

export interface ParseResult<T> {
  data?: T;
  needsClarification?: boolean;
  question?: string;
  error?: string;
}

export interface Balance {
  poolFunded: number;
  poolSpent: number;
  poolBalance: number;
  externalPaid: number;
  totalProjectCost: number;
  byPerson: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface PendingItem {
  type: "single" | "contri_pair";
  pairId?: string;
  row: ConstructionTx;
}
