-- =============================================================================
-- Sebagian siswa keluar dengan cerita yang tidak cukup diwakili satu pilihan
-- alasan — misalnya kata guru sudah keluar tapi di Dapodik masih terdaftar.
-- exit_note menyimpan keterangan bebas itu, ikut hidup-mati bersama arsip.
-- =============================================================================

alter table public.student_records add column if not exists exit_note text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'student_records_exit_note_len') then
        alter table public.student_records add constraint student_records_exit_note_len
            check (exit_note is null or length(exit_note) <= 500);
    end if;
end
$$;

comment on column public.student_records.exit_note is 'Keterangan bebas tentang kepergian siswa; hanya terisi saat diarsipkan.';

/** Isi tanggal keluar saat diarsipkan; bersihkan alasan, tanggal & keterangan saat aktif. */
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
        new.exit_note   := null;
        return new;
    end if;
    if new.exit_date is null then
        new.exit_date := (now() at time zone 'Asia/Jakarta')::date;
    end if;
    new.exit_note := nullif(btrim(regexp_replace(coalesce(new.exit_note, ''), '\s+', ' ', 'g')), '');
    return new;
end;
$$;
revoke all on function public.student_exit_fields() from public, anon, authenticated;
