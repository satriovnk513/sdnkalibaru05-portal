-- =============================================================================
-- Modul Absensi — Laporan (Rekap Bulanan cetak & Rekap Semester) — SDN Kalibaru 05
--
--   1. get_class_report_header(class): kop laporan — kelas, tahun ajaran,
--      wali kelas 1/2 + NIP, kepala sekolah + NIP.
--   2. get_class_semester_recap(class, semester): jumlah H/S/I/A/D per siswa
--      dari absensi HARIAN, hari efektif, hari terisi, % kehadiran.
--
-- Hak akses sama dengan rekap bulanan: can_view_class (admin, pimpinan, wali
-- kelas, guru mapel rombel itu). Hanya menambah fungsi baru. Satu transaksi.
-- =============================================================================

begin;

create or replace function public.get_class_report_header(p_class_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;

    return (
        select jsonb_build_object(
            'kelas', c.name,
            'tahun_ajaran', y.name,
            'ta_mulai', y.start_date,
            'ta_selesai', y.end_date,
            'wali', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'posisi', h.position,
                    'nama', s.name,
                    'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                    order by h.position)
                from public.homeroom_assignments h
                join public.staff s on s.id = h.staff_id
                where h.class_id = c.id), '[]'::jsonb),
            'kepala_sekolah', (
                select jsonb_build_object(
                    'nama', s.name,
                    'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                from public.staff s
                where split_part(s.role, '|', 1) = 'Kepala Sekolah'
                order by s.order_index nulls last, s.name
                limit 1))
        from public.classes c
        join public.academic_years y on y.id = c.academic_year_id
        where c.id = p_class_id);
end;
$$;

create or replace function public.get_class_semester_recap(p_class_id uuid, p_semester int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_start  date;
    v_end    date;
    v_ta_end date;
    v_from   date;
    v_to     date;
    v_upto   date;
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;
    if p_semester not in (1, 2) then
        raise exception 'Semester harus 1 (ganjil) atau 2 (genap).' using errcode = '22023';
    end if;

    select y.start_date, y.end_date into v_start, v_ta_end
    from public.classes c join public.academic_years y on y.id = c.academic_year_id
    where c.id = p_class_id;
    if v_start is null then
        raise exception 'Rombel tidak ditemukan.' using errcode = 'P0002';
    end if;

    if p_semester = 1 then
        v_from := v_start;
        v_to   := make_date(extract(year from v_start)::int, 12, 31);
    else
        v_from := make_date(extract(year from v_start)::int + 1, 1, 1);
        v_to   := v_ta_end;
    end if;
    v_end  := v_to;
    v_upto := least(v_to, public.jakarta_today());

    return jsonb_build_object(
        'semester', p_semester,
        'mulai', v_from,
        'selesai', v_end,
        'sampai_hari_ini', v_upto,
        'hari_efektif', case when v_upto < v_from then 0 else (
            select count(*) from generate_series(v_from, v_upto, interval '1 day') d
            where public.is_school_day(d::date)) end,
        'hari_terisi', (select count(*) from public.attendance_sessions s
                        where s.class_id = p_class_id and s.kind = 'harian' and s.archived_at is null
                          and s.session_date between v_from and v_to),
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object(
                'student_id', st.student_id, 'no', st.no_urut, 'nama', st.nama, 'jk', st.jenis_kelamin,
                'nis', st.nis, 'nisn', st.nisn,
                'H', coalesce(t.h, 0), 'S', coalesce(t.s, 0), 'I', coalesce(t.i, 0),
                'A', coalesce(t.a, 0), 'D', coalesce(t.d, 0))
                order by st.no_urut)
            from public.get_class_roster(p_class_id, greatest(v_from, least(v_upto, v_to))) st
            left join lateral (
                select count(*) filter (where ar.status = 'H') h,
                       count(*) filter (where ar.status = 'S') s,
                       count(*) filter (where ar.status = 'I') i,
                       count(*) filter (where ar.status = 'A') a,
                       count(*) filter (where ar.status = 'D') d
                from public.attendance_records ar
                join public.attendance_sessions s on s.id = ar.session_id
                where ar.student_id = st.student_id and s.class_id = p_class_id
                  and s.kind = 'harian' and s.archived_at is null
                  and s.session_date between v_from and v_to) t on true), '[]'::jsonb)
    );
end;
$$;

do $fn$
declare
    f text;
begin
    foreach f in array array[
        'public.get_class_report_header(uuid)',
        'public.get_class_semester_recap(uuid, int)']
    loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end
$fn$;

commit;
