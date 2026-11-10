-- Supabase Dashboard -> SQL Editor -> New query -> ye poora paste karke Run karein

-- 1) Admin ka set kiya link (sirf ek row)
create table if not exists public.config (
  id int primary key default 1 check (id = 1),
  link text not null default '',
  title text not null default ''
);
insert into public.config (id) values (1) on conflict (id) do nothing;

-- 2) Users ki submissions
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  link text not null default '',
  like_path text not null,
  comment_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- 3) Tables ko public access se band rakho (server service_role key se access karta hai)
alter table public.config enable row level security;
alter table public.submissions enable row level security;

-- 4) Private storage bucket (screenshots sirf admin signed link se dekh sakta hai)
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;
