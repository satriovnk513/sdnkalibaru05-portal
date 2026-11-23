-- =============================================================================
-- Label "Kelas" di data siswa dan keanggotaan rombel (student_enrollments) adalah
-- dua hal terpisah, dan absensi/nilai/jadwal/piket mengikuti keanggotaan. Sebelum
-- ini penyelarasan hanya dilakukan oleh kode di browser, sehingga tab lama, impor,
-- atau penulisan server-side bisa mengubah label tanpa memindahkan rombel — diam-diam.
-- Trigger ini memindahkan keanggotaan setiap kali label kelas berubah, dari jalur
-- mana pun. Riwayat absensi tetap di kelas lama (keanggotaan lama ditutup kemarin).
-- =============================================================================

create or replace function public.student_enrollment_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_tgl    date := public.jakarta_today();
    v_nama   text := nullif(btrim(regexp_replace(coalesce(new.payload ->> 'kelas', ''), '\s+', ' ', 'g')), '');
    v_target uuid;
    v_old    public.student_enrollments;
begin
    if new.archived_at is not null then return null; end if;

    if v_nama is not null then
        select c.id into v_target
        from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active
        where upper(btrim(c.name)) = upper(v_nama);
        -- Nama kelas tidak dikenal (mis. impor tahun ajaran yang belum dibuat):
        -- keanggotaan dibiarkan apa adanya, selisihnya terlihat di get_class_mismatch().
        if v_target is null then return null; end if;
    end if;

    select * into v_old from public.student_enrollments where student_id = new.id and end_date is null for update;
    if v_old.class_id is not distinct from v_target then return null; end if;

    if v_old.id is not null then
        if v_old.start_date >= v_tgl then
            delete from public.student_enrollments where id = v_old.id;
        else
            update public.student_enrollments set end_date = v_tgl - 1 where id = v_old.id;
        end if;
    end if;

    if v_target is not null then
        insert into public.student_enrollments (student_id, class_id, start_date, created_by)
        values (new.id, v_target, v_tgl, (select auth.uid()));
    end if;
    return null;
end;
$$;

revoke all on function public.student_enrollment_sync() from public, anon, authenticated;

drop trigger if exists student_records_enrollment_sync on public.student_records;
drop trigger if exists student_records_enrollment_sync_ins on public.student_records;
drop trigger if exists student_records_enrollment_sync_upd on public.student_records;
create trigger student_records_enrollment_sync_ins
    after insert on public.student_records
    for each row
    when (new.archived_at is null and nullif(btrim(coalesce(new.payload ->> 'kelas', '')), '') is not null)
    execute function public.student_enrollment_sync();
create trigger student_records_enrollment_sync_upd
    after update of payload on public.student_records
    for each row
    when (new.archived_at is null and (old.payload ->> 'kelas') is distinct from (new.payload ->> 'kelas'))
    execute function public.student_enrollment_sync();

-- Perbaiki siswa yang labelnya sudah diisi tapi rombelnya belum terbentuk.
do $$
declare
    v_row record;
    v_n   int := 0;
begin
    for v_row in
        select s.id, c.id class_id
        from public.student_records s
        join public.classes c on upper(btrim(c.name)) = upper(btrim(s.payload ->> 'kelas'))
        join public.academic_years y on y.id = c.academic_year_id and y.is_active
        where s.archived_at is null
          and nullif(btrim(coalesce(s.payload ->> 'kelas', '')), '') is not null
          and not exists (select 1 from public.student_enrollments e where e.student_id = s.id and e.end_date is null)
    loop
        insert into public.student_enrollments (student_id, class_id, start_date)
        values (v_row.id, v_row.class_id, public.jakarta_today());
        v_n := v_n + 1;
    end loop;
    raise notice 'Keanggotaan rombel dibuat untuk % siswa.', v_n;
end;
$$;
