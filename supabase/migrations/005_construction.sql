-- Construction project fund tracker
-- Run this in Supabase SQL editor before using !contrib / !expense commands

create table if not exists construction_contributions (
  id               uuid primary key default gen_random_uuid(),
  group_id         text        not null,
  amount           numeric(12,2) not null check (amount > 0),
  contributor      text        not null default 'Madhan',
  description      text,
  contribution_date date        not null default current_date,
  added_by         text        not null,
  created_at       timestamptz not null default now()
);

create table if not exists construction_expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     text          not null,
  amount       numeric(12,2) not null check (amount > 0),
  category     text          not null default 'Misc',
  description  text          not null,
  expense_date date          not null default current_date,
  paid_by      text          not null default 'Madhan',
  added_by     text          not null,
  notes        text,
  raw_text     text,
  created_at   timestamptz   not null default now()
);

create index if not exists idx_cc_group   on construction_contributions(group_id);
create index if not exists idx_cc_date    on construction_contributions(contribution_date);
create index if not exists idx_ce_group   on construction_expenses(group_id);
create index if not exists idx_ce_cat     on construction_expenses(category);
create index if not exists idx_ce_date    on construction_expenses(expense_date);
