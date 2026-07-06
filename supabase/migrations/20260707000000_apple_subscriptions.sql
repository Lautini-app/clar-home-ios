-- clar iOS — Apple-Abos via RevenueCat
-- ============================================================================
-- Additive Migration: rührt keine bestehenden Objekte an. Weder subscribers
-- (Stripe/Web) noch groups/group_members werden verändert.
-- ============================================================================

-- ─── Tabelle: apple_subscriptions ────────────────────────────────────────────
-- Ein Row pro (user_id, entitlement). RevenueCat-Webhook upsertet auf
-- INITIAL_PURCHASE / RENEWAL, deaktiviert bei CANCELLATION / EXPIRATION.
create table if not exists public.apple_subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  revenuecat_app_user_id    text not null,                    -- Supabase-UUID als String (= external_id)
  product_id                text not null,                    -- z. B. clar_1app_monthly
  entitlement               text not null,                    -- one | two | all (RevenueCat "Entitlement"-Alias)
  selected_apps             text[] not null default '{}',     -- für 1/2-App-Abos: ['markt','heim'] etc.
  status                    text not null default 'active',   -- active | in_grace_period | expired | cancelled
  environment               text,                             -- sandbox | production
  original_purchase_at      timestamptz,
  purchased_at              timestamptz,
  expires_at                timestamptz,
  cancelled_at              timestamptz,
  is_trial                  boolean not null default false,
  raw_event                 jsonb,
  updated_at                timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  unique (user_id, entitlement)
);

create index if not exists apple_subs_user_idx  on public.apple_subscriptions(user_id);
create index if not exists apple_subs_state_idx on public.apple_subscriptions(user_id, status, expires_at);

-- ─── Kauf-Intent: hält die App-Auswahl bis der Webhook feuert ────────────────
-- Der Client speichert vor dem Bridge-Call in welche Apps das 1/2-App-Abo
-- entsperren soll. Das Webhook liest diesen Row und schreibt ihn in
-- apple_subscriptions.selected_apps. Ein Row pro User (upsert).
create table if not exists public.apple_subscription_intents (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  product_id     text not null,
  selected_apps  text[] not null default '{}',
  created_at     timestamptz not null default now()
);

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.apple_subscriptions        enable row level security;
alter table public.apple_subscription_intents enable row level security;

-- User liest seine eigenen Abos.
drop policy if exists "user reads own apple subs" on public.apple_subscriptions;
create policy "user reads own apple subs" on public.apple_subscriptions
  for select to authenticated
  using (auth.uid() = user_id);

-- User verwaltet seinen eigenen Kauf-Intent (upsert vor Kaufversuch).
drop policy if exists "user manages own intent" on public.apple_subscription_intents;
create policy "user manages own intent" on public.apple_subscription_intents
  for all to authenticated
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Kein INSERT/UPDATE-Recht für authenticated auf apple_subscriptions — die
-- Tabelle wird ausschliesslich vom Webhook (service_role) beschrieben.

-- ─── Grants ─────────────────────────────────────────────────────────────────
grant select on public.apple_subscriptions to authenticated;
grant all    on public.apple_subscriptions to service_role;

grant select, insert, update on public.apple_subscription_intents to authenticated;
grant all    on public.apple_subscription_intents to service_role;
