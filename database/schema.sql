-- Idempotent, re-runnable. Run in Supabase SQL editor.
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  origin text not null check (origin ~ '^[A-Z]{3}$'),
  destination text not null check (destination ~ '^[A-Z]{3}$'),
  depart_date date not null,
  return_date date,
  currency text not null default 'myr',
  target_price numeric not null check (target_price > 0),
  condition text not null default '<=' check (condition in ('<=','<','>=','>')),
  sources text[] not null default array['travelpayouts'],
  notify_email boolean not null default true,
  notify_browser boolean not null default true,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','TRIGGERED','DISABLED')),
  last_notified_price numeric,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.alerts add column if not exists extra_emails text[] not null default '{}';

create table if not exists public.prices (
  id bigserial primary key,
  source text not null,
  origin text not null,
  destination text not null,
  depart_date date not null,
  return_date date,
  currency text not null,
  price numeric,
  airline text,
  retrieved_at timestamptz not null,
  source_timestamp timestamptz,
  status text not null,
  validation_status text not null,
  data_kind text not null check (data_kind in ('CACHED','LIVE')),
  error_message text
);
create index if not exists prices_route_idx on public.prices (origin, destination, depart_date, retrieved_at desc);

create table if not exists public.notifications (
  id bigserial primary key,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  type text not null,
  price numeric,
  delivery_status text
);

alter table public.alerts enable row level security;
alter table public.prices enable row level security;
alter table public.notifications enable row level security;

-- Per-user isolation enforced here, not in JS.
drop policy if exists alerts_select_own on public.alerts;
drop policy if exists alerts_insert_own on public.alerts;
drop policy if exists alerts_update_own on public.alerts;
drop policy if exists alerts_delete_own on public.alerts;
create policy alerts_select_own on public.alerts for select to authenticated using (auth.uid() = user_id);
create policy alerts_insert_own on public.alerts for insert to authenticated with check (auth.uid() = user_id);
create policy alerts_update_own on public.alerts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy alerts_delete_own on public.alerts for delete to authenticated using (auth.uid() = user_id);

-- Prices are public market data: readable by signed-in users, writable only by the service role (bypasses RLS).
drop policy if exists prices_read on public.prices;
create policy prices_read on public.prices for select to authenticated using (true);

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated using (auth.uid() = user_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists alerts_touch on public.alerts;
create trigger alerts_touch before update on public.alerts for each row execute function public.touch_updated_at();

-- Editing target/condition/dates re-arms a TRIGGERED alert.
create or replace function public.rearm_on_edit() returns trigger language plpgsql as $$
begin
  if new.status = 'TRIGGERED' and old.status = 'TRIGGERED'
     and (new.target_price is distinct from old.target_price or new.condition is distinct from old.condition
          or new.depart_date is distinct from old.depart_date or new.return_date is distinct from old.return_date) then
    new.status = 'ACTIVE';
  end if;
  return new;
end $$;
drop trigger if exists alerts_rearm on public.alerts;
create trigger alerts_rearm before update on public.alerts for each row execute function public.rearm_on_edit();
