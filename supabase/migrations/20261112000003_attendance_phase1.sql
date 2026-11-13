-- =============================================================================
-- Modul Absensi Siswa — Fase 1 — SDN Kalibaru 05
--
--   1. teacher_account_requests: daftar akun yang AKAN dibuat (email, NIP/NUPTK,
--      peran admin). Diisi admin; akun Auth dibuat oleh /api/admin/teacher-accounts
--      (service role). PRIVAT: hanya admin.
--   2. RPC get_guru_home(): semua yang dibutuhkan beranda guru dalam satu panggilan.
--   3. RPC get_class_month_recap(): rekap bulanan absensi harian satu rombel.
--   4. RPC get_attendance_sheet(): isi lembar absensi (sesi + status + isian awal
--      dari absensi harian untuk absensi mapel).
--
-- Hanya menambah objek baru. Satu transaksi.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Daftar akun yang akan dibuat
-- -----------------------------------------------------------------------------
create table if not exists public.teacher_account_requests (
    staff_id    uuid        primary key references public.staff (id) on delete cascade,
    email       text        not null,
    login_id    text,
    make_admin  boolean     not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint teacher_account_requests_email_key   unique (email),
    constraint teacher_account_requests_login_key   unique (login_id),
    constraint teacher_account_requests_email_lower check (email = lower(btrim(email))),
    constraint teacher_account_requests_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    constraint teacher_account_requests_login_shape check (login_id is null or login_id ~ '^[0-9]{8,20}$')
);

comment on table public.teacher_account_requests is
    'Daftar akun guru/admin yang akan dibuat (PRIVAT: email, NIP/NUPTK). Hanya admin.';

revoke all on table public.teacher_account_requests from anon, authenticated;
grant select, insert, update, delete on table public.teacher_account_requests to authenticated;
grant all on table public.teacher_account_requests to service_role;
alter table public.teacher_account_requests enable row level security;
alter table public.teacher_account_requests force row level security;

drop policy if exists teacher_account_requests_admin on public.teacher_account_requests;
create policy teacher_account_requests_admin on public.teacher_account_requests
    for all to authenticated
    using ((select public.att_is_admin()))
    with check ((select public.att_is_admin()));

-- -----------------------------------------------------------------------------
-- 2. Beranda guru
-- -----------------------------------------------------------------------------
create or replace function public.get_guru_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_uid    uuid := (select auth.uid());
    v_staff  uuid := public.current_staff_id();
    v_today  date := public.jakarta_today();
    v_name   text;
    v_role   text;
begin
    if v_uid is null then
        raise exception 'Harus login.' using errcode = '42501';
    end if;
    if v_staff is null then
        raise exception 'Akun belum terhubung ke data guru.' using errcode = '42501';
    end if;

    select s.name, s.role into v_name, v_role from public.staff s where s.id = v_staff;

    return jsonb_build_object(
        'staff_id', v_staff,
        'nama', v_name,
        'jabatan', split_part(v_role, '|', 2),
        'is_admin', public.att_is_admin(),
        'is_pimpinan', public.is_pimpinan(),
        'today', v_today,
        'is_school_day', public.is_school_day(v_today),
        'holiday_name', (select h.name from public.school_holidays h where h.holiday_date = v_today),
        'earliest_date', public.earliest_backfill_date(),
        'wali_kelas', coalesce((
            select jsonb_agg(jsonb_build_object(
                'class_id', c.id,
                'kelas', c.name,
                'posisi', h.position,
                'jumlah_siswa', (select count(*) from public.student_enrollments e
                                 join public.student_records sr on sr.id = e.student_id
                                 where e.class_id = c.id and e.start_date <= v_today
                                   and (e.end_date is null or e.end_date >= v_today)
                                   and sr.archived_at is null),
                'hari_ini', (
                    select jsonb_build_object(
                        'session_id', s.id,
                        'disimpan', to_char(s.updated_at at time zone 'Asia/Jakarta', 'HH24.MI'),
                        'terkunci', (s.created_at at time zone 'Asia/Jakarta')::date <> v_today,
                        'rekap', (select jsonb_object_agg(x.status, x.n) from (
                                    select r.status, count(*) n from public.attendance_records r
                                    where r.session_id = s.id group by r.status) x))
                    from public.attendance_sessions s
                    where s.class_id = c.id and s.session_date = v_today
                      and s.kind = 'harian' and s.archived_at is null))
                order by c.grade, c.section)
            from public.homeroom_assignments h
            join public.classes c on c.id = h.class_id
            join public.academic_years y on y.id = c.academic_year_id and y.is_active
            where h.staff_id = v_staff), '[]'::jsonb),
        'mapel', coalesce((
            select jsonb_agg(jsonb_build_object(
                'class_id', c.id,
                'kelas', c.name,
                'subject_id', sub.id,
                'kode', sub.code,
                'mapel', sub.name,
                'hari_ini', exists (
                    select 1 from public.attendance_sessions s
                    where s.class_id = c.id and s.session_date = v_today and s.kind = 'mapel'
                      and s.subject_id = sub.id and s.archived_at is null))
                order by sub.code, c.grade, c.section)
            from public.subject_assignments sa
            join public.classes c on c.id = sa.class_id
            join public.academic_years y on y.id = c.academic_year_id and y.is_active
            join public.subjects sub on sub.id = sa.subject_id
            where sa.staff_id = v_staff), '[]'::jsonb),
        'semua_kelas', case when public.is_pimpinan() or public.att_is_admin() then coalesce((
            select jsonb_agg(jsonb_build_object('class_id', c.id, 'kelas', c.name) order by c.grade, c.section)
            from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active), '[]'::jsonb)
            else '[]'::jsonb end
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Lembar absensi: sesi yang ada + status + isian awal
-- -----------------------------------------------------------------------------
create or replace function public.get_attendance_sheet(
    p_class_id uuid, p_date date, p_kind text, p_subject_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_session  public.attendance_sessions%rowtype;
    v_prefill  uuid;
    v_today    date := public.jakarta_today();
    v_can_edit boolean;
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;

    select * into v_session from public.attendance_sessions s
    where s.class_id = p_class_id and s.session_date = p_date and s.kind = p_kind
      and s.subject_id is not distinct from p_subject_id and s.archived_at is null;

    -- Absensi mapel diisi awal dari absensi harian hari itu.
    if v_session.id is null and p_kind = 'mapel' then
        select s.id into v_prefill from public.attendance_sessions s
        where s.class_id = p_class_id and s.session_date = p_date and s.kind = 'harian' and s.archived_at is null;
    end if;

    v_can_edit := public.att_is_admin()
        or ((p_kind = 'harian' and public.is_homeroom_of(p_class_id))
            or (p_kind = 'mapel' and p_subject_id is not null and public.teaches(p_class_id, p_subject_id)))
           and p_date <= v_today and p_date >= public.earliest_backfill_date()
           and (v_session.id is null or (v_session.created_at at time zone 'Asia/Jakarta')::date = v_today);

    return jsonb_build_object(
        'kelas', (select c.name from public.classes c where c.id = p_class_id),
        'tanggal', p_date,
        'hari_sekolah', public.is_school_day(p_date),
        'libur', (select h.name from public.school_holidays h where h.holiday_date = p_date),
        'bisa_ubah', v_can_edit and public.is_school_day(p_date),
        'is_admin', public.att_is_admin(),
        'session', case when v_session.id is null then null else jsonb_build_object(
            'id', v_session.id,
            'disimpan', to_char(v_session.updated_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY HH24.MI'),
            'terlambat', v_session.is_late_entry) end,
        'isian_awal_dari_harian', v_prefill is not null,
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object(
                'student_id', r.student_id, 'no', r.no_urut, 'nama', r.nama, 'jk', r.jenis_kelamin,
                'status', coalesce(ar.status, pr.status), 'catatan', coalesce(ar.note, pr.note))
                order by r.no_urut)
            from public.get_class_roster(p_class_id, p_date) r
            left join public.attendance_records ar on ar.session_id = v_session.id and ar.student_id = r.student_id
            left join public.attendance_records pr on pr.session_id = v_prefill and pr.student_id = r.student_id), '[]'::jsonb)
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Rekap bulanan absensi harian satu rombel
-- -----------------------------------------------------------------------------
create or replace function public.get_class_month_recap(p_class_id uuid, p_year int, p_month int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_first date;
    v_last  date;
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;
    if p_month not between 1 and 12 or p_year not between 2020 and 2100 then
        raise exception 'Bulan tidak valid.' using errcode = '22023';
    end if;
    v_first := make_date(p_year, p_month, 1);
    v_last  := (v_first + interval '1 month' - interval '1 day')::date;

    return jsonb_build_object(
        'kelas', (select c.name from public.classes c where c.id = p_class_id),
        'tahun', p_year,
        'bulan', p_month,
        'hari', (select jsonb_agg(jsonb_build_object(
                    'tanggal', d::date,
                    'libur', not public.is_school_day(d::date),
                    'diisi', exists (select 1 from public.attendance_sessions s
                                     where s.class_id = p_class_id and s.session_date = d::date
                                       and s.kind = 'harian' and s.archived_at is null)) order by d)
                 from generate_series(v_first, v_last, interval '1 day') d),
        'hari_efektif', (select count(*) from generate_series(v_first, least(v_last, public.jakarta_today()), interval '1 day') d
                         where public.is_school_day(d::date)),
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object(
                'student_id', st.student_id, 'no', st.no_urut, 'nama', st.nama, 'jk', st.jenis_kelamin,
                'nis', st.nis, 'nisn', st.nisn,
                'status', coalesce((select jsonb_object_agg(s.session_date, ar.status)
                                    from public.attendance_records ar
                                    join public.attendance_sessions s on s.id = ar.session_id
                                    where ar.student_id = st.student_id and s.class_id = p_class_id
                                      and s.kind = 'harian' and s.archived_at is null
                                      and s.session_date between v_first and v_last), '{}'::jsonb))
                order by st.no_urut)
            from public.get_class_roster(p_class_id, least(v_last, public.jakarta_today())) st), '[]'::jsonb)
    );
end;
$$;

do $fn$
declare
    f text;
begin
    foreach f in array array[
        'public.get_guru_home()',
        'public.get_attendance_sheet(uuid, date, text, uuid)',
        'public.get_class_month_recap(uuid, int, int)']
    loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end
$fn$;

commit;
