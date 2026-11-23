-- Strap account security migration (Neon)
-- Apply to the production Neon branch only after reviewing/testing this PR.
create table if not exists public.auth_account_security (
  email text primary key,
  user_id text,
  suspended_at timestamptz,
  suspension_reason text,
  review_status text not null default 'none'
    check (review_status in ('none','pending','approved','rejected')),
  review_message text,
  review_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists auth_account_security_suspended_idx
  on public.auth_account_security(suspended_at) where suspended_at is not null;

create table if not exists public.auth_action_limits (
  bucket_key text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  lock_level integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists auth_action_limits_blocked_until_idx
  on public.auth_action_limits(blocked_until) where blocked_until is not null;

-- Unique normalized email reservation prevents case-variant and concurrent duplicate signups.
create table if not exists public.auth_email_registry (
  email text primary key,
  user_id text,
  created_at timestamptz not null default now()
);
insert into public.auth_email_registry(email,user_id)
select lower(trim(email)), id::text from neon_auth."user"
on conflict(email) do nothing;
