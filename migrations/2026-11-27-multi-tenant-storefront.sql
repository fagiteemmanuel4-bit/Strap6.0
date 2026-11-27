-- Strap multi-tenant storefront foundation.
-- Additive only: existing POS, auth, user_data and media records remain intact.

ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

DO $$ BEGIN
  ALTER TABLE public.media
    ADD CONSTRAINT media_visibility_check
    CHECK (visibility IN ('public','private'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused')),
  currency text NOT NULL DEFAULT 'NGN',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$')
);
CREATE UNIQUE INDEX IF NOT EXISTS stores_owner_uidx ON public.stores(owner_id);
CREATE INDEX IF NOT EXISTS stores_status_idx ON public.stores(status);

CREATE TABLE IF NOT EXISTS public.store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  source_product_id text NOT NULL,
  source_branch_id text NOT NULL DEFAULT 'b0',
  slug text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  price numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  sku text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  visible boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, source_product_id, source_branch_id),
  UNIQUE(store_id, slug)
);
CREATE INDEX IF NOT EXISTS store_products_public_idx
  ON public.store_products(store_id, visible, sort_order);

CREATE TABLE IF NOT EXISTS public.store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  order_number bigint GENERATED ALWAYS AS IDENTITY,
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer','pay_on_delivery')),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','verified','rejected','not_required')),
  fulfillment_status text NOT NULL DEFAULT 'pending'
    CHECK (fulfillment_status IN ('pending','confirmed','processing','shipped','delivered','cancelled')),
  buyer_name text NOT NULL,
  buyer_email text NOT NULL DEFAULT '',
  buyer_phone text NOT NULL,
  delivery_address text NOT NULL,
  delivery_city text NOT NULL DEFAULT '',
  delivery_region text NOT NULL DEFAULT '',
  delivery_note text NOT NULL DEFAULT '',
  currency text NOT NULL,
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  proof_media_id uuid NULL REFERENCES public.media(id) ON DELETE SET NULL,
  sender_name text NOT NULL DEFAULT '',
  transfer_reference text NOT NULL DEFAULT '',
  payment_note text NOT NULL DEFAULT '',
  seller_note text NOT NULL DEFAULT '',
  rejection_reason text NOT NULL DEFAULT '',
  items_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, order_number),
  CONSTRAINT bank_transfer_proof_required CHECK (
    payment_method <> 'bank_transfer' OR
    (proof_media_id IS NOT NULL OR length(sender_name) > 0 OR length(transfer_reference) > 0)
  ),
  CONSTRAINT pod_no_payment_proof CHECK (
    payment_method <> 'pay_on_delivery' OR proof_media_id IS NULL
  )
);
CREATE INDEX IF NOT EXISTS store_orders_store_created_idx
  ON public.store_orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_store_status_idx
  ON public.store_orders(store_id, fulfillment_status, payment_status);

CREATE TABLE IF NOT EXISTS public.store_analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('store_view','product_view','add_to_cart','checkout_started','order_placed')),
  product_id uuid NULL REFERENCES public.store_products(id) ON DELETE SET NULL,
  session_key text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_analytics_store_date_idx
  ON public.store_analytics_events(store_id, created_at DESC);
