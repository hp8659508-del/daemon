-- Minimal Supabase environment + reconstructed base schema (as used by the app)
create extension if not exists pgcrypto;
do $$ begin
  create role anon; create role authenticated; create role service_role bypassrls;
exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create publication supabase_realtime;
grant usage on schema public, auth to anon, authenticated, service_role;

create table public.teams (id uuid primary key default gen_random_uuid(), team_name text not null unique, username text not null unique, created_at timestamptz default now());
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role text not null check (role in ('admin','team')), team_id uuid references public.teams(id), must_change_password boolean default false, created_at timestamptz default now());
create table public.transactions (id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id), description text not null, points integer not null,
  transaction_type text not null check (transaction_type in ('bonus','adjustment','purchase','spin')), created_by uuid references auth.users(id), created_at timestamptz default now());
create table public.auction_items (id uuid primary key default gen_random_uuid(), item_name text not null, base_points integer not null default 0, is_active boolean default true, created_at timestamptz default now());
create table public.purchases (id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id), item_id uuid not null references public.auction_items(id), transaction_id uuid references public.transactions(id), purchase_price integer not null, created_at timestamptz default now());
create table public.event_settings (id boolean primary key default true check (id), starting_points integer default 0, starting_points_published boolean default false);
insert into public.event_settings default values;

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
create or replace function public.current_team_id() returns uuid language sql stable security definer set search_path='' as $$ select team_id from public.profiles where id = auth.uid() $$;
alter table public.teams enable row level security; alter table public.profiles enable row level security;
alter table public.transactions enable row level security; alter table public.purchases enable row level security;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
