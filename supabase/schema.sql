-- Agora — conversation storage (v2 memory, tier 1).
-- Paste this into Supabase → SQL Editor → Run.

create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_session_created_idx
  on messages (session_id, created_at);

-- Access happens only through the server (service_role key), so RLS stays on
-- with no public policies: the anon key can't read or write these tables.
alter table sessions enable row level security;
alter table messages enable row level security;
