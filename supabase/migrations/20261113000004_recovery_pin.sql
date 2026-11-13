-- =============================================================================
-- Modul Absensi — PIN pemulihan (lupa password tanpa email) — SDN Kalibaru 05
--
-- Guru membuat PIN 6 angka sekali (di menu Akun, wajib memasukkan password saat
-- ini). Saat lupa password: email/NIP + PIN + password baru di /guru.
--
--   * PIN disimpan sebagai hash bcrypt (pgcrypto), tidak pernah bisa dibaca.
--   * Tabel tertutup untuk anon/authenticated (RLS FORCE, tanpa policy).
--   * Salah PIN 5 kali → terkunci 30 menit.
--   * Fungsi tulis/verifikasi hanya untuk service_role (dipanggil API server).
--   * Guru hanya bisa melihat status PIN-nya sendiri (ada/belum, kapan dibuat).
-- Satu transaksi.
-- =============================================================================

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.teacher_recovery_pins (
    user_id       uuid primary key references auth.users (id) on delete cascade,
    pin_hash      text not null,
    set_at        timestamptz not null default now(),
    failed_count  int not null default 0 check (failed_count >= 0),
    locked_until  timestamptz,
    last_used_at  timestamptz
);

alter table public.teacher_recovery_pins enable row level security;
alter table public.teacher_recovery_pins force row level security;
revoke all on table public.teacher_recovery_pins from public, anon, authenticated;
grant all on table public.teacher_recovery_pins to service_role;

-- PIN lemah: angka sama semua, urut naik/turun, atau pola umum.
create or replace function public.recovery_pin_is_weak(p_pin text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select p_pin is null
        or p_pin !~ '^[0-9]{6}$'
        or p_pin ~ '^(.)\1{5}$'
        or strpos('0123456789012', p_pin) > 0
        or strpos('9876543210987', p_pin) > 0
        or p_pin in ('112233', '121212', '123123', '111222', '101010', '696969', '131313', '202020', '212121', '232323')
        or p_pin ~ '^(..)\1\1$'
        or p_pin ~ '^(...)\1$';
$$;

-- Simpan / ganti PIN (dipanggil API setelah password saat ini terbukti benar).
create or replace function public.set_recovery_pin(p_user uuid, p_pin text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if p_user is null or not exists (select 1 from public.teacher_accounts a where a.user_id = p_user) then
        raise exception 'Akun guru tidak ditemukan.' using errcode = 'P0002';
    end if;
    if public.recovery_pin_is_weak(p_pin) then
        raise exception 'PIN terlalu mudah ditebak. Pakai 6 angka acak.' using errcode = '22023';
    end if;
    insert into public.teacher_recovery_pins (user_id, pin_hash, set_at, failed_count, locked_until)
    values (p_user, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), now(), 0, null)
    on conflict (user_id) do update
        set pin_hash = excluded.pin_hash, set_at = now(), failed_count = 0, locked_until = null;
end;
$$;

-- Cek PIN: 'ok' | 'salah' | 'terkunci' | 'tidak_ada'. Salah 5x → kunci 30 menit.
create or replace function public.verify_recovery_pin(p_user uuid, p_pin text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    r public.teacher_recovery_pins%rowtype;
begin
    select * into r from public.teacher_recovery_pins where user_id = p_user for update;
    if not found then
        return 'tidak_ada';
    end if;
    if r.locked_until is not null and r.locked_until > now() then
        return 'terkunci';
    end if;
    if p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash then
        update public.teacher_recovery_pins
           set failed_count = 0, locked_until = null, last_used_at = now()
         where user_id = p_user;
        return 'ok';
    end if;
    update public.teacher_recovery_pins
       set failed_count = case when r.failed_count + 1 >= 5 then 0 else r.failed_count + 1 end,
           locked_until = case when r.failed_count + 1 >= 5 then now() + interval '30 minutes' else null end
     where user_id = p_user;
    return case when r.failed_count + 1 >= 5 then 'terkunci' else 'salah' end;
end;
$$;

-- Admin menghapus PIN guru (mis. guru lupa PIN).
create or replace function public.clear_recovery_pin(p_user uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
    with d as (delete from public.teacher_recovery_pins where user_id = p_user returning 1)
    select exists (select 1 from d);
$$;

-- Status PIN milik sendiri (untuk menu Akun & pengingat di dashboard).
create or replace function public.get_my_recovery_pin()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'ada', p.user_id is not null,
        'dibuat', to_char(p.set_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY HH24.MI'),
        'terkunci', p.locked_until is not null and p.locked_until > now())
    from (select (select auth.uid()) as uid) me
    left join public.teacher_recovery_pins p on p.user_id = me.uid
    where me.uid is not null;
$$;

revoke all on function public.recovery_pin_is_weak(text) from public, anon;
grant execute on function public.recovery_pin_is_weak(text) to authenticated, service_role;

do $fn$
declare
    f text;
begin
    foreach f in array array[
        'public.set_recovery_pin(uuid, text)',
        'public.verify_recovery_pin(uuid, text)',
        'public.clear_recovery_pin(uuid)']
    loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end
$fn$;

revoke all on function public.get_my_recovery_pin() from public, anon;
grant execute on function public.get_my_recovery_pin() to authenticated, service_role;

commit;
