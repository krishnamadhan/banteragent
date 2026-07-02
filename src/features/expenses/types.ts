export type ExpenseCategory =
  | "Food" | "Transport" | "Entertainment" | "Groceries"
  | "Shopping" | "Utilities" | "Medical" | "Travel" | "Misc";

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Food", "Transport", "Entertainment", "Groceries",
  "Shopping", "Utilities", "Medical", "Travel", "Misc",
];

export interface RawLogEntry {
  timestamp: string;    // "2026-04-29 21:45:30" — used as log_id in DB
  sentBy: string;
  payer: "Madhan" | "Indhu";
  amount: number;
  description: string;
  raw: string;
  isSplit: boolean;
  splitDetails?: { perPerson: number; memberCount: number; total: number };
  isWeekend: boolean;
  line: string;         // full formatted log line (for [DONE] rewriting)
}

export interface ParsedAmount {
  amount: number;
  description: string;
  isSplit: boolean;
  splitDetails?: { perPerson: number; memberCount: number; total: number };
}

export interface AnalysedExpense {
  log_id: string;
  amount: number;
  description: string;
  category: ExpenseCategory;
  subcategory: string;
  payer: string;
  sent_by: string;
  timestamp: string;   // ISO string
  confidence: number;
  notes: string;
}

export interface SplitRecord {
  expense_ids: string[];
  split_type: string;
  total_amount: number;
  per_person: number;
  member_count: number;
  payer: string;
  created_by: string;
  details: object;
}
