-- 真心話大冒險 — Supabase / PostgreSQL 建議 schema
-- 在 Supabase SQL Editor 執行此檔

create table if not exists public.truth_cards (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  sort_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.dare_cards (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  sort_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- 示範資料
insert into public.truth_cards (text, sort_order) values
  ('說出一個你從沒告訴過在場任何人的秘密。', 1),
  ('你最後一次說謊是什麼時候？為什麼？', 2),
  ('在場誰最可能讓你心動？為什麼？', 3);

insert into public.dare_cards (text, sort_order) values
  ('對著窗外大喊：「我是最帥／美的！」', 1),
  ('模仿在場一位朋友的招牌動作或語氣。', 2),
  ('用單腳跳繞房間一圈。', 3);

-- 允許匿名讀取（僅 SELECT；管理請用 Supabase Dashboard 或 service role）
alter table public.truth_cards enable row level security;
alter table public.dare_cards enable row level security;

create policy "anon read truth"
  on public.truth_cards for select
  to anon using (enabled = true);

create policy "anon read dare"
  on public.dare_cards for select
  to anon using (enabled = true);
