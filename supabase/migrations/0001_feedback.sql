-- Feedback submitted from the in-game FEEDBACK button.
-- Run once in the Supabase dashboard: SQL Editor -> paste -> Run.

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  category    text not null check (category in ('bug', 'idea', 'other')),
  message     text not null check (char_length(message) between 3 and 2000),
  contact     text check (char_length(contact) <= 120),
  room        text,
  user_agent  text
);

-- Row Level Security on, with no policies: browsers holding the public (anon/publishable) key can
-- neither read nor write this table. Only our server writes to it, using the secret key, which
-- bypasses RLS. You read it in the dashboard's Table Editor.
alter table public.feedback enable row level security;

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
