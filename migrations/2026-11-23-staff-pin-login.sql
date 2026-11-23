-- Strap staff authentication and role-scoped access (Neon Postgres)
-- Additive migration. Staff PINs are scrypt-hashed server-side; only hashed session tokens are stored.
CREATE TABLE IF NOT EXISTS public.staff_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('Cashier','Stock keeper','Customer care','Manager')),
  branch_id text,
  email text NOT NULL,
  pin_salt text NOT NULL,
  pin_hash text NOT NULL,
  pin_algo text NOT NULL DEFAULT 'scrypt-v1' CHECK (pin_algo IN ('scrypt-v1','legacy-sha256-v1')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_accounts_email_lower_uidx
  ON public.staff_accounts (lower(email));
CREATE INDEX IF NOT EXISTS staff_accounts_owner_idx
  ON public.staff_accounts (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.staff_sessions (
  token_hash text PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES public.staff_accounts(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_sessions_expiry_idx
  ON public.staff_sessions (expires_at);

ALTER TABLE public.staff_accounts
  ADD COLUMN IF NOT EXISTS pin_algo text NOT NULL DEFAULT 'scrypt-v1';
