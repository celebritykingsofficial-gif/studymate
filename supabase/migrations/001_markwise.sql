-- Markwise: private student analyses and plans. Run in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) <= 100),
  course_code text,
  university text,
  regulation text,
  syllabus_text text not null default '',
  paper_files jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  analysis_id uuid references public.analyses(id) on delete set null,
  subject text not null,
  exam_date date not null,
  minutes_per_day integer not null check (minutes_per_day between 15 and 600),
  weak_topics text[] not null default '{}',
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.analyses enable row level security;
alter table public.study_plans enable row level security;

drop policy if exists "Students read own analyses" on public.analyses;
create policy "Students read own analyses" on public.analyses for select to authenticated using (user_id = auth.uid());
drop policy if exists "Students create own analyses" on public.analyses;
create policy "Students create own analyses" on public.analyses for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Students delete own analyses" on public.analyses;
create policy "Students delete own analyses" on public.analyses for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Students read own plans" on public.study_plans;
create policy "Students read own plans" on public.study_plans for select to authenticated using (user_id = auth.uid());
drop policy if exists "Students create own plans" on public.study_plans;
create policy "Students create own plans" on public.study_plans for insert to authenticated with check (
  user_id = auth.uid() and (analysis_id is null or exists (
    select 1 from public.analyses a where a.id = analysis_id and a.user_id = auth.uid()
  ))
);
drop policy if exists "Students update own plans" on public.study_plans;
create policy "Students update own plans" on public.study_plans for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Students delete own plans" on public.study_plans;
create policy "Students delete own plans" on public.study_plans for delete to authenticated using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-files', 'student-files', false, 15728640, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/markdown'
])
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists "Students upload own files" on storage.objects;
create policy "Students upload own files" on storage.objects for insert to authenticated
with check (bucket_id = 'student-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Students read own files" on storage.objects;
create policy "Students read own files" on storage.objects for select to authenticated
using (bucket_id = 'student-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Students delete own files" on storage.objects;
create policy "Students delete own files" on storage.objects for delete to authenticated
using (bucket_id = 'student-files' and (storage.foldername(name))[1] = auth.uid()::text);
