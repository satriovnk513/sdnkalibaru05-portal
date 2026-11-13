-- =============================================================================
-- Tiruan minimal lingkungan Supabase untuk menguji migration di Postgres LOKAL.
-- Hanya untuk tes. JANGAN dijalankan di Supabase (auth dan role sudah ada).
--
-- Meniru objek produksi yang dipakai migration (dicek 12 Nov 2026):
--   role anon/authenticated/service_role, auth.users, auth.uid(),
--   public.app_role, user_roles, profiles, staff (+ policy), is_admin(),
--   has_role(), handle_new_user() + trigger on_auth_user_created.
-- =============================================================================

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text,
    raw_user_meta_data  jsonb default '{}'::jsonb,
    created_at          timestamptz default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(
        coalesce(
            nullif(current_setting('request.jwt.claim.sub', true), ''),
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
        '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.app_role as enum ('admin', 'guru');

create table public.user_roles (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    role        public.app_role not null default 'guru',
    created_at  timestamptz not null default now(),
    unique (user_id, role)
);
alter table public.user_roles enable row level security;
create policy "Users can view their own roles" on public.user_roles
    for select to authenticated using (auth.uid() = user_id);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

create table public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    full_name   text not null default '',
    nip         text default '',
    kelas       text default '',
    mata_pelajaran text default '',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    insert into public.profiles (id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
    insert into public.user_roles (user_id, role) values (new.id, 'guru');
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create table public.staff (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    role        text not null,
    nip         text,
    image_url   text,
    order_index integer default 0,
    created_at  timestamptz not null default now()
);
alter table public.staff enable row level security;
create policy "Allow public read access for staff" on public.staff for select using (true);
create policy "Allow admin insert for staff" on public.staff for insert to authenticated with check (public.is_admin());
create policy "Allow admin update for staff" on public.staff for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Allow admin delete for staff" on public.staff for delete to authenticated using (public.is_admin());
grant select on public.staff to anon, authenticated;
grant insert, update, delete on public.staff to authenticated;
grant all on public.staff to service_role;
