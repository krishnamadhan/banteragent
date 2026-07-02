-- Construction tracker v2 — unified transaction table
-- Replaces separate contributions + expenses tables with a single flow-based table.
-- Old tables are preserved for data migration / rollback.

CREATE TABLE IF NOT EXISTS construction_transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    text        NOT NULL,
  flow        text        NOT NULL CHECK (flow IN ('in', 'out')),
  source      text        NOT NULL CHECK (source IN ('fund', 'add', 'contri')),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  pair_id     uuid,                       -- links the IN+OUT rows of a !contri pair
  amount      numeric(12,2) NOT NULL,
  category    text,
  description text,
  tx_date     date        NOT NULL,
  person      text,                       -- funder (fund), payer (add), external contributor (contri)
  added_by    text        NOT NULL,
  raw_text    text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctx_group        ON construction_transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_ctx_group_status ON construction_transactions(group_id, status);
CREATE INDEX IF NOT EXISTS idx_ctx_group_date   ON construction_transactions(group_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_ctx_pair         ON construction_transactions(pair_id) WHERE pair_id IS NOT NULL;
