-- =============================================================================
-- PIN pemulihan boleh 6 angka apa saja. Aturan "PIN terlalu mudah ditebak"
-- (123456, 111111, pola berulang) dicabut atas permintaan sekolah: guru bebas
-- memilih PIN yang mudah diingat. Yang tetap dijaga hanya bentuknya (6 angka),
-- plus kunci 30 menit setelah 5 kali salah di verify_recovery_pin.
-- =============================================================================

/** Sekarang hanya memeriksa bentuk: PIN harus tepat 6 angka. */
create or replace function public.recovery_pin_is_weak(p_pin text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select p_pin is null or p_pin !~ '^[0-9]{6}$';
$$;

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
        raise exception 'PIN harus 6 angka.' using errcode = '22023';
    end if;
    insert into public.teacher_recovery_pins (user_id, pin_hash, set_at, failed_count, locked_until)
    values (p_user, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), now(), 0, null)
    on conflict (user_id) do update
        set pin_hash = excluded.pin_hash, set_at = now(), failed_count = 0, locked_until = null;
end;
$$;
