-- =============================================================================
-- Siswa yang diarsipkan sekarang bisa dicatat alasan keluarnya (mengikuti
-- istilah Dapodik), supaya setahun kemudian masih jelas kenapa dia hilang dari
-- daftar: mutasi, mengundurkan diri, lulus, hilang, dan seterusnya.
--
-- - exit_reason/exit_date hanya berlaku saat diarsipkan; begitu dipulihkan
--   keduanya dikosongkan otomatis.
-- - Mengarsipkan juga menutup baris rombel yang masih terbuka, dan memulihkan
--   membukanya kembali, supaya constraint student_enrollments_one_open tidak
--   tertinggal baris menggantung.
-- =============================================================================

alter table public.student_records
    add column if not exists exit_reason text,
    add column if not exists exit_date   date;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'student_records_exit_reason') then
        alter table public.student_records add constraint student_records_exit_reason
            check (exit_reason is null or exit_reason in
                ('Mutasi', 'Mengundurkan diri', 'Lulus', 'Hilang', 'Putus sekolah', 'Meninggal', 'Lainnya'));
    end if;
end
$$;

comment on column public.student_records.exit_reason is 'Alasan siswa keluar; hanya terisi saat diarsipkan.';
comment on column public.student_records.exit_date is 'Tanggal siswa keluar; bawaan tanggal pengarsipan.';

create index if not exists student_records_exit_idx on public.student_records (exit_reason) where archived_at is not null;

-- -----------------------------------------------------------------------------
-- Alasan keluar hanya hidup bersama arsip
-- -----------------------------------------------------------------------------
/** Isi tanggal keluar saat diarsipkan; bersihkan alasan & tanggal saat aktif. */
create or replace function public.student_exit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.archived_at is null then
        new.exit_reason := null;
        new.exit_date   := null;
    elsif new.exit_date is null then
        new.exit_date := (now() at time zone 'Asia/Jakarta')::date;
    end if;
    return new;
end;
$$;
revoke all on function public.student_exit_fields() from public, anon, authenticated;

drop trigger if exists student_records_auto_exit on public.student_records;
create trigger student_records_auto_exit
    before insert or update on public.student_records
    for each row
    execute function public.student_exit_fields();

-- -----------------------------------------------------------------------------
-- Arsip menutup rombel, pulihkan membukanya lagi
-- -----------------------------------------------------------------------------
/** Tutup/buka kembali baris student_enrollments mengikuti status arsip. */
create or replace function public.student_archive_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class uuid;
begin
    if new.archived_at is not null then
        update public.student_enrollments
        set end_date = coalesce(new.exit_date, (now() at time zone 'Asia/Jakarta')::date)
        where student_id = new.id and end_date is null;
        return null;
    end if;

    select c.id into v_class
    from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active
    where upper(btrim(c.name)) = upper(btrim(coalesce(new.payload ->> 'kelas', '')));
    if v_class is not null and not exists (
        select 1 from public.student_enrollments where student_id = new.id and end_date is null) then
        insert into public.student_enrollments (student_id, class_id, start_date)
        values (new.id, v_class, (now() at time zone 'Asia/Jakarta')::date);
    end if;
    return null;
end;
$$;
revoke all on function public.student_archive_enrollment() from public, anon, authenticated;

drop trigger if exists student_records_archive_enrollment on public.student_records;
create trigger student_records_archive_enrollment
    after update of archived_at on public.student_records
    for each row
    when ((old.archived_at is null) <> (new.archived_at is null))
    execute function public.student_archive_enrollment();

-- -----------------------------------------------------------------------------
-- Tutup rombel siswa yang sudah terlanjur diarsipkan
-- -----------------------------------------------------------------------------
update public.student_enrollments e
set end_date = coalesce(s.exit_date, (s.archived_at at time zone 'Asia/Jakarta')::date)
from public.student_records s
where s.id = e.student_id and s.archived_at is not null and e.end_date is null;
