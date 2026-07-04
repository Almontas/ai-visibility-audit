-- ==========================================================================
-- AI Visibility Audit — Supabase Schema
--
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This creates all 3 tables + indexes + RLS policies needed for the app.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. SCANS — stores scan results, cached for 24h, expire after 30 days
-- --------------------------------------------------------------------------

create table if not exists public.scans (
  id              uuid primary key default gen_random_uuid(),
  url             text not null,
  url_hash        text not null,                          -- 16-char SHA256 prefix for cache lookups
  brand_name      text,
  blog_page       jsonb,                                  -- { found, url, method }
  score           jsonb not null,                         -- full scoring object
  llm_visibility  jsonb,                                  -- LLM brand visibility check results
  scan_version    text,                                   -- scoring version for cache invalidation
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '30 days')
);

-- Index for cache lookups (getCachedScan: filter by url_hash + created_at)
create index if not exists idx_scans_url_hash_created
  on public.scans (url_hash, created_at desc);

-- --------------------------------------------------------------------------
-- 2. LEADS — email captures tied to scans
-- --------------------------------------------------------------------------

create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid not null references public.scans(id) on delete cascade,
  name            text not null,
  email           text not null,
  company         text,
  created_at      timestamptz not null default now(),
  email_1_sent_at timestamptz    -- Report link email (immediate)
);

-- Index for cross-lead dedupe (filter by email)
create index if not exists idx_leads_email
  on public.leads (email);

create index if not exists idx_leads_created
  on public.leads (created_at);

create index if not exists idx_leads_scan_id
  on public.leads (scan_id);

-- --------------------------------------------------------------------------
-- 3. RATE_LIMITS — tracks scan requests per IP (5/hour limit)
-- --------------------------------------------------------------------------

create table if not exists public.rate_limits (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null,
  created_at timestamptz not null default now()
);

-- Index for rate limit checks (filter by ip + created_at)
create index if not exists idx_rate_limits_ip_created
  on public.rate_limits (ip, created_at);

-- --------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
--
-- The app uses the anon key from server-side API routes (not exposed to
-- browser clients). These policies allow full CRUD for the anon role.
-- If you switch to the service_role key, RLS is bypassed automatically.
-- --------------------------------------------------------------------------

-- Scans
alter table public.scans enable row level security;

create policy "Allow insert for anon" on public.scans
  for insert to anon with check (true);

create policy "Allow select for anon" on public.scans
  for select to anon using (true);

-- Leads
alter table public.leads enable row level security;

create policy "Allow insert for anon" on public.leads
  for insert to anon with check (true);

create policy "Allow select for anon" on public.leads
  for select to anon using (true);

create policy "Allow update for anon" on public.leads
  for update to anon using (true) with check (true);

-- Rate Limits
alter table public.rate_limits enable row level security;

create policy "Allow insert for anon" on public.rate_limits
  for insert to anon with check (true);

create policy "Allow select for anon" on public.rate_limits
  for select to anon using (true);

create policy "Allow delete for anon" on public.rate_limits
  for delete to anon using (true);
