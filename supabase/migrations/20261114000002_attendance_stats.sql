-- =============================================================================
-- Modul Absensi — Statistik & peringatan alpa — SDN Kalibaru 05
--
--   1. get_class_attendance_stats(class, dari, sampai): ringkasan absensi HARIAN
--      satu rombel untuk rentang tanggal — total H/S/I/A/D, per hari, per siswa.
--      Dipakai kartu "Absensi per tanggal" di dashboard dan halaman Statistik.
--   2. get_alpha_alerts(min): siswa yang alpanya >= min hari pada semester
--      berjalan. Wali kelas melihat kelasnya; pimpinan & admin semua kelas.
--
-- Hak akses lewat can_view_class / is_homeroom_of. Hanya menambah fungsi.
-- =============================================================================

begin;

create or replace function public.get_class_attendance_stats(p_class_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_to date;
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;
    if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
        raise exception 'Rentang tanggal tidak valid (maksimal 400 hari).' using errcode = '22023';
    end if;
    v_to := least(p_to, public.jakarta_today());

    return (
        with ses as (
            select s.id, s.session_date
            from public.attendance_sessions s
            where s.class_id = p_class_id and s.kind = 'harian' and s.archived_at is null
              and s.session_date between p_from and p_to),
        rec as (
            select ses.session_date, ar.student_id, ar.status
            from ses join public.attendance_records ar on ar.session_id = ses.id),
        per_day as (
            select session_date,
                   count(*) filter (where status = 'H') h, count(*) filter (where status = 'S') s,
                   count(*) filter (where status = 'I') i, count(*) filter (where status = 'A') a,
                   count(*) filter (where status = 'D') d
            from rec group by session_date),
        roster as (
            select * from public.get_class_roster(p_class_id, greatest(p_from, v_to))),
        per_student as (
            select r.student_id, r.no_urut, r.nama, r.jenis_kelamin,
                   count(*) filter (where rec.status = 'H') h, count(*) filter (where rec.status = 'S') s,
                   count(*) filter (where rec.status = 'I') i, count(*) filter (where rec.status = 'A') a,
                   count(*) filter (where rec.status = 'D') d
            from roster r left join rec on rec.student_id = r.student_id
            group by r.student_id, r.no_urut, r.nama, r.jenis_kelamin)
        select jsonb_build_object(
            'kelas', (select c.name from public.classes c where c.id = p_class_id),
            'dari', p_from,
            'sampai', p_to,
            'jumlah_siswa', (select count(*) from roster),
            'hari_efektif', case when v_to < p_from then 0 else (
                select count(*) from generate_series(p_from, v_to, interval '1 day') g where public.is_school_day(g::date)) end,
            'hari_terisi', (select count(*) from ses),
            'libur', case when p_from = p_to and not public.is_school_day(p_from) then
                coalesce((select h.name from public.school_holidays h where h.holiday_date = p_from), 'Sabtu/Minggu') end,
            'total', (select jsonb_build_object(
                'H', coalesce(sum(h), 0), 'S', coalesce(sum(s), 0), 'I', coalesce(sum(i), 0),
                'A', coalesce(sum(a), 0), 'D', coalesce(sum(d), 0)) from per_day),
            'harian', coalesce((select jsonb_agg(jsonb_build_object(
                'tanggal', session_date, 'H', h, 'S', s, 'I', i, 'A', a, 'D', d) order by session_date) from per_day), '[]'::jsonb),
            'siswa', coalesce((select jsonb_agg(jsonb_build_object(
                'student_id', student_id, 'no', no_urut, 'nama', nama, 'jk', jenis_kelamin,
                'H', h, 'S', s, 'I', i, 'A', a, 'D', d) order by no_urut) from per_student), '[]'::jsonb))
    );
end;
$$;

create or replace function public.get_alpha_alerts(p_min int default 4)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_today date := public.jakarta_today();
    v_start date;
    v_end   date;
    v_from  date;
    v_all   boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Belum login.' using errcode = '42501';
    end if;
    if p_min is null or p_min < 1 then
        raise exception 'Batas minimal tidak valid.' using errcode = '22023';
    end if;
    v_all := public.att_is_admin() or public.is_pimpinan();

    select y.start_date, y.end_date into v_start, v_end
    from public.academic_years y where y.is_active;
    if v_start is null then
        return jsonb_build_object('batas', p_min, 'dari', null, 'siswa', '[]'::jsonb);
    end if;
    -- Semester berjalan: ganjil = awal TA s.d. 31 Des; genap = 1 Jan s.d. akhir TA.
    v_from := case when v_today >= make_date(extract(year from v_start)::int + 1, 1, 1)
                   then make_date(extract(year from v_start)::int + 1, 1, 1) else v_start end;

    return jsonb_build_object(
        'batas', p_min,
        'dari', v_from,
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object(
                'class_id', x.class_id, 'kelas', x.kelas, 'student_id', x.student_id,
                'nama', x.nama, 'alpa', x.alpa, 'terakhir', x.terakhir)
                order by x.alpa desc, x.kelas, x.nama)
            from (
                select c.id as class_id, c.name as kelas, st.id as student_id, st.nama_siswa as nama,
                       count(*) as alpa, max(s.session_date) as terakhir
                from public.classes c
                join public.academic_years y on y.id = c.academic_year_id and y.is_active
                join public.attendance_sessions s on s.class_id = c.id and s.kind = 'harian' and s.archived_at is null
                     and s.session_date between v_from and v_today
                join public.attendance_records ar on ar.session_id = s.id and ar.status = 'A'
                join public.student_records st on st.id = ar.student_id and st.archived_at is null
                join public.student_enrollments e on e.student_id = st.id and e.class_id = c.id
                     and e.start_date <= v_today and (e.end_date is null or e.end_date >= v_today)
                where v_all or public.is_homeroom_of(c.id)
                group by c.id, c.name, st.id, st.nama_siswa
                having count(*) >= p_min) x), '[]'::jsonb));
end;
$$;

do $fn$
declare
    f text;
begin
    foreach f in array array[
        'public.get_class_attendance_stats(uuid, date, date)',
        'public.get_alpha_alerts(int)']
    loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end
$fn$;

commit;
