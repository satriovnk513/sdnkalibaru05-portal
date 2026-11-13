-- =============================================================================
-- Modul Absensi — guru boleh mengisi absensi tanggal berapa pun yang sudah lewat
-- dalam tahun ajaran aktif (sebelumnya dibatasi 3 hari sekolah terakhir).
--
-- Tetap berlaku: tidak bisa tanggal yang akan datang, tidak bisa hari libur /
-- Sabtu / Minggu, dan absensi yang sudah disimpan terkunci keesokan harinya
-- (koreksi lewat admin). Hanya mengganti satu fungsi. Satu transaksi.
-- =============================================================================

begin;

create or replace function public.earliest_backfill_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select min(y.start_date) from public.academic_years y where y.is_active),
        public.jakarta_today() - 365);
$$;

revoke all on function public.earliest_backfill_date() from public, anon;
grant execute on function public.earliest_backfill_date() to authenticated, service_role;

commit;
