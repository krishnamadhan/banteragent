-- Expense tracker for couples group
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ba_expenses (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id     TEXT        NOT NULL,
  raw_text     TEXT        NOT NULL,                          -- original message as typed
  amount       NUMERIC(10,2) NOT NULL,
  description  TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT 'others',         -- see categories below
  paid_by      TEXT        NOT NULL DEFAULT 'Madhan',         -- 'Madhan' | 'Indhu'
  added_by     TEXT        NOT NULL,                          -- sender name from WhatsApp
  expense_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  split_type   TEXT        NOT NULL DEFAULT 'equal',          -- 'equal' | 'full_madhan' | 'full_indhu' | 'custom'
  madhan_share NUMERIC(10,2),                                 -- populated on split
  indhu_share  NUMERIC(10,2),
  is_settled   BOOLEAN     NOT NULL DEFAULT FALSE,
  settled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- categories: groceries | food | fuel | rent | utilities | medical |
--             entertainment | shopping | subscriptions | travel | savings | transfer | others

CREATE INDEX IF NOT EXISTS idx_ba_expenses_group      ON ba_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_ba_expenses_date       ON ba_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_ba_expenses_settled    ON ba_expenses(is_settled);
CREATE INDEX IF NOT EXISTS idx_ba_expenses_paid_by    ON ba_expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_ba_expenses_category   ON ba_expenses(category);

-- Settlement log — one row per settle action
CREATE TABLE IF NOT EXISTS ba_expense_settlements (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id     TEXT        NOT NULL,
  settled_by   TEXT        NOT NULL,
  period_start DATE,
  period_end   DATE,
  madhan_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  indhu_total  NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_owed_by  TEXT,                                          -- who owed money
  net_amount   NUMERIC(10,2),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ba_settlements_group ON ba_expense_settlements(group_id);
