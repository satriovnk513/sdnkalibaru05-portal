-- =============================================================================
-- Modul Absensi Siswa — Fase 0 (fondasi data) — SDN Kalibaru 05
--
-- Acuan: PRD Absensi Siswa (draft 12 Nov 2026).
--
-- Isi:
--   1. Akun guru (teacher_accounts) — TERPISAH dari public.staff, karena staff
--      bisa dibaca publik (halaman Guru & Staf). Email dan NIP login tidak
--      pernah boleh masuk ke tabel staff.
--   2. Data akademik: tahun ajaran, rombel, keanggotaan rombel, wali kelas
--      (maks. 2 per rombel), mata pelajaran, penugasan guru mapel, hari libur.
--   3. Absensi: sesi, status per siswa (H/S/I/A/D), riwayat perubahan.
--   4. Fungsi hak akses, RLS, dan RPC:
--        get_class_roster      — daftar siswa rombel (tanpa data pribadi)
--        get_student_profile   — profil siswa satu versi (tanpa NIK/KK/penghasilan)
--        save_attendance       — simpan absensi (validasi hak, tanggal, roster)
--        archive_attendance_session / restore_attendance_session — admin
--
-- Prinsip:
--   - Hanya MENAMBAH objek baru. Tidak mengubah student_records, staff,
--     user_roles, atau policy lama. Satu transaksi.
--   - Guru tidak pernah mendapat SELECT ke student_records.
--   - Penulisan absensi hanya lewat RPC (SECURITY DEFINER) supaya aturan hak
--     akses, batas waktu, dan riwayat selalu berlaku. Tidak ada grant
--     INSERT/UPDATE/DELETE ke tabel absensi untuk role authenticated.
--   - Zona waktu sekolah: Asia/Jakarta.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Waktu sekolah
-- -----------------------------------------------------------------------------
create or replace function public.jakarta_today()
returns date
language sql
stable
set search_path = ''
as $$
    select (now() at time zone 'Asia/Jakarta')::date;
$$;

-- -----------------------------------------------------------------------------
-- 1. Akun guru
-- -----------------------------------------------------------------------------
create table if not exists public.teacher_accounts (
    user_id     uuid        primary key references auth.users (id) on delete cascade,
    staff_id    uuid        not null references public.staff (id) on delete restrict,
    email       text        not null,
    login_id    text,
    is_active   boolean     not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint teacher_accounts_staff_key   unique (staff_id),
    constraint teacher_accounts_email_key   unique (email),
    constraint teacher_accounts_login_key   unique (login_id),
    constraint teacher_accounts_email_lower check (email = lower(btrim(email))),
    constraint teacher_accounts_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    constraint teacher_accounts_login_shape check (login_id is null or login_id ~ '^[0-9]{8,20}$')
);

comment on table public.teacher_accounts is
    'Akun login guru (PRIVAT: email, NIP/NUPTK). Hanya admin dan pemilik akun yang membaca. Jangan digabung ke staff (staff dibaca publik).';

-- -----------------------------------------------------------------------------
-- 2. Data akademik
-- -----------------------------------------------------------------------------
create table if not exists public.academic_years (
    id          uuid        primary key default gen_random_uuid(),
    name        text        not null,
    start_date  date        not null,
    end_date    date        not null,
    is_active   boolean     not null default false,
    created_at  timestamptz not null default now(),

    constraint academic_years_name_key   unique (name),
    constraint academic_years_name_shape check (
        case when name ~ '^[0-9]{4}/[0-9]{4}$'
             then split_part(name, '/', 2)::int = split_part(name, '/', 1)::int + 1
             else false end),
    constraint academic_years_dates check (end_date > start_date)
);

create unique index if not exists academic_years_one_active
    on public.academic_years (is_active) where is_active;

create table if not exists public.classes (
    id                uuid        primary key default gen_random_uuid(),
    academic_year_id  uuid        not null references public.academic_years (id) on delete restrict,
    grade             smallint    not null,
    section           text        not null,
    name              text        generated always as (grade::text || ' ' || section) stored,
    created_at        timestamptz not null default now(),

    constraint classes_grade_range   check (grade between 1 and 6),
    constraint classes_section_shape check (section ~ '^[A-Z]$'),
    constraint classes_year_grade_section_key unique (academic_year_id, grade, section)
);

create table if not exists public.student_enrollments (
    id          uuid        primary key default gen_random_uuid(),
    student_id  uuid        not null references public.student_records (id) on delete cascade,
    class_id    uuid        not null references public.classes (id) on delete restrict,
    start_date  date        not null,
    end_date    date,
    created_at  timestamptz not null default now(),
    created_by  uuid        references auth.users (id) on delete set null,

    constraint student_enrollments_dates check (end_date is null or end_date >= start_date)
);

-- Satu siswa hanya boleh punya satu keanggotaan rombel yang masih terbuka.
create unique index if not exists student_enrollments_one_open
    on public.student_enrollments (student_id) where end_date is null;
create index if not exists student_enrollments_class_idx
    on public.student_enrollments (class_id, start_date);

create table if not exists public.homeroom_assignments (
    id          uuid        primary key default gen_random_uuid(),
    class_id    uuid        not null references public.classes (id) on delete cascade,
    staff_id    uuid        not null references public.staff (id) on delete restrict,
    position    smallint    not null,
    created_at  timestamptz not null default now(),

    constraint homeroom_position_range check (position in (1, 2)),
    constraint homeroom_class_position_key unique (class_id, position),
    constraint homeroom_class_staff_key    unique (class_id, staff_id)
);

comment on column public.homeroom_assignments.position is '1 = wali kelas utama, 2 = wali kelas pendamping.';

create table if not exists public.subjects (
    id          uuid        primary key default gen_random_uuid(),
    code        text        not null,
    name        text        not null,
    created_at  timestamptz not null default now(),

    constraint subjects_code_key   unique (code),
    constraint subjects_code_shape check (code ~ '^[A-Z0-9_]{2,16}$'),
    constraint subjects_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.subject_assignments (
    id          uuid        primary key default gen_random_uuid(),
    subject_id  uuid        not null references public.subjects (id) on delete restrict,
    class_id    uuid        not null references public.classes (id) on delete cascade,
    staff_id    uuid        not null references public.staff (id) on delete restrict,
    created_at  timestamptz not null default now(),

    constraint subject_assignments_key unique (subject_id, class_id, staff_id)
);

create table if not exists public.school_holidays (
    holiday_date  date        primary key,
    name          text        not null,
    kind          text        not null default 'sekolah',
    created_at    timestamptz not null default now(),

    constraint school_holidays_name_not_blank check (btrim(name) <> ''),
    constraint school_holidays_kind check (kind in ('nasional', 'cuti_bersama', 'sekolah'))
);

comment on table public.school_holidays is 'Hari libur selain Sabtu dan Minggu (keduanya otomatis libur).';

-- -----------------------------------------------------------------------------
-- 3. Absensi
-- -----------------------------------------------------------------------------
create table if not exists public.attendance_sessions (
    id                 uuid        primary key default gen_random_uuid(),
    class_id           uuid        not null references public.classes (id) on delete restrict,
    session_date       date        not null,
    kind               text        not null,
    subject_id         uuid        references public.subjects (id) on delete restrict,
    recorded_by_staff  uuid        references public.staff (id) on delete set null,
    is_late_entry      boolean     not null default false,
    created_by         uuid        references auth.users (id) on delete set null,
    created_at         timestamptz not null default now(),
    updated_by         uuid        references auth.users (id) on delete set null,
    updated_at         timestamptz not null default now(),
    archived_at        timestamptz,
    archived_by        uuid        references auth.users (id) on delete set null,
    archive_reason     text,

    constraint attendance_sessions_kind check (kind in ('harian', 'mapel')),
    constraint attendance_sessions_subject check (
        (kind = 'harian' and subject_id is null) or (kind = 'mapel' and subject_id is not null)),
    constraint attendance_sessions_archive_reason check (
        archived_at is null or nullif(btrim(archive_reason), '') is not null)
);

-- Satu sesi aktif per rombel + tanggal + jenis + mapel.
create unique index if not exists attendance_sessions_one_active
    on public.attendance_sessions (
        class_id, session_date, kind,
        coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where archived_at is null;
create index if not exists attendance_sessions_date_idx
    on public.attendance_sessions (session_date, class_id);

create table if not exists public.attendance_records (
    session_id  uuid        not null references public.attendance_sessions (id) on delete cascade,
    student_id  uuid        not null references public.student_records (id) on delete cascade,
    status      text        not null,
    note        text,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id) on delete set null,

    primary key (session_id, student_id),
    constraint attendance_records_status check (status in ('H', 'S', 'I', 'A', 'D')),
    constraint attendance_records_note_len check (note is null or length(note) <= 200)
);

create index if not exists attendance_records_student_idx
    on public.attendance_records (student_id);

comment on column public.attendance_records.status is
    'H Hadir, S Sakit, I Izin, A Alpa, D Dispensasi (mis. siswa non-Muslim di PAI; tidak mengurangi % kehadiran).';

create table if not exists public.attendance_changes (
    id          bigint      generated always as identity primary key,
    session_id  uuid        not null references public.attendance_sessions (id) on delete cascade,
    student_id  uuid        references public.student_records (id) on delete set null,
    action      text        not null,
    old_status  text,
    new_status  text,
    reason      text,
    changed_by  uuid        references auth.users (id) on delete set null,
    changed_at  timestamptz not null default now(),

    constraint attendance_changes_action check (action in ('buat', 'ubah', 'arsip', 'pulihkan'))
);

create index if not exists attendance_changes_session_idx
    on public.attendance_changes (session_id, changed_at desc);

comment on table public.attendance_changes is
    'Riwayat absensi. Ditulis hanya oleh RPC absensi; admin membaca. Tidak bisa diubah dari browser.';

-- -----------------------------------------------------------------------------
-- 4. Fungsi hak akses (SECURITY DEFINER agar tidak memicu RLS berulang)
-- -----------------------------------------------------------------------------
create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select ta.staff_id
    from public.teacher_accounts ta
    where ta.user_id = (select auth.uid()) and ta.is_active;
$$;

create or replace function public.att_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid()) and ur.role = 'admin');
$$;

create or replace function public.is_pimpinan()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.teacher_accounts ta
        join public.staff s on s.id = ta.staff_id
        where ta.user_id = (select auth.uid())
          and ta.is_active
          and split_part(s.role, '|', 1) in ('Kepala Sekolah', 'Wakil Kepala Sekolah'));
$$;

create or replace function public.is_homeroom_of(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.homeroom_assignments h
        where h.class_id = p_class_id
          and h.staff_id = public.current_staff_id());
$$;

create or replace function public.teaches(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.subject_assignments sa
        where sa.class_id = p_class_id
          and sa.subject_id = p_subject_id
          and sa.staff_id = public.current_staff_id());
$$;

create or replace function public.can_view_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.att_is_admin()
        or public.is_pimpinan()
        or public.is_homeroom_of(p_class_id)
        or exists (
            select 1 from public.subject_assignments sa
            where sa.class_id = p_class_id
              and sa.staff_id = public.current_staff_id());
$$;

create or replace function public.is_school_day(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select extract(isodow from p_date) not in (6, 7)
       and not exists (select 1 from public.school_holidays h where h.holiday_date = p_date);
$$;

-- Tanggal paling awal yang boleh diisi guru: 3 hari sekolah sebelum hari ini.
create or replace function public.earliest_backfill_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(min(d), public.jakarta_today() - 30)
    from (
        select g::date as d
        from generate_series(public.jakarta_today() - 30, public.jakarta_today() - 1, interval '1 day') g
        where public.is_school_day(g::date)
        order by g desc
        limit 3
    ) last3;
$$;

-- -----------------------------------------------------------------------------
-- 5. Grant + RLS
-- -----------------------------------------------------------------------------
revoke all on table
    public.teacher_accounts, public.academic_years, public.classes, public.student_enrollments,
    public.homeroom_assignments, public.subjects, public.subject_assignments, public.school_holidays,
    public.attendance_sessions, public.attendance_records, public.attendance_changes
    from anon, authenticated;

grant select, insert, update, delete on table
    public.teacher_accounts, public.academic_years, public.classes, public.student_enrollments,
    public.homeroom_assignments, public.subjects, public.subject_assignments, public.school_holidays
    to authenticated;

-- Absensi: browser hanya membaca. Penulisan lewat RPC.
grant select on table public.attendance_sessions, public.attendance_records, public.attendance_changes
    to authenticated;

grant all on table
    public.teacher_accounts, public.academic_years, public.classes, public.student_enrollments,
    public.homeroom_assignments, public.subjects, public.subject_assignments, public.school_holidays,
    public.attendance_sessions, public.attendance_records, public.attendance_changes
    to service_role;

do $rls$
declare
    t text;
begin
    foreach t in array array[
        'teacher_accounts', 'academic_years', 'classes', 'student_enrollments',
        'homeroom_assignments', 'subjects', 'subject_assignments', 'school_holidays',
        'attendance_sessions', 'attendance_records', 'attendance_changes']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('alter table public.%I force row level security', t);
    end loop;
end
$rls$;

-- teacher_accounts: pemilik membaca miliknya; admin semua.
drop policy if exists teacher_accounts_select on public.teacher_accounts;
create policy teacher_accounts_select on public.teacher_accounts
    for select to authenticated
    using (user_id = (select auth.uid()) or (select public.att_is_admin()));

drop policy if exists teacher_accounts_admin_write on public.teacher_accounts;
create policy teacher_accounts_admin_write on public.teacher_accounts
    for all to authenticated
    using ((select public.att_is_admin()))
    with check ((select public.att_is_admin()));

-- Data akademik umum: semua pengguna login membaca, admin menulis.
do $pol$
declare
    t text;
begin
    foreach t in array array[
        'academic_years', 'classes', 'homeroom_assignments', 'subjects',
        'subject_assignments', 'school_holidays']
    loop
        execute format('drop policy if exists %I on public.%I', t || '_select', t);
        execute format(
            'create policy %I on public.%I for select to authenticated using (true)',
            t || '_select', t);
        execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using ((select public.att_is_admin())) with check ((select public.att_is_admin()))',
            t || '_admin_write', t);
    end loop;
end
$pol$;

-- Keanggotaan rombel: admin, atau guru yang berhak atas rombel itu.
drop policy if exists student_enrollments_select on public.student_enrollments;
create policy student_enrollments_select on public.student_enrollments
    for select to authenticated
    using (public.can_view_class(class_id));

drop policy if exists student_enrollments_admin_write on public.student_enrollments;
create policy student_enrollments_admin_write on public.student_enrollments
    for all to authenticated
    using ((select public.att_is_admin()))
    with check ((select public.att_is_admin()));

drop policy if exists attendance_sessions_select on public.attendance_sessions;
create policy attendance_sessions_select on public.attendance_sessions
    for select to authenticated
    using (public.can_view_class(class_id));

drop policy if exists attendance_records_select on public.attendance_records;
create policy attendance_records_select on public.attendance_records
    for select to authenticated
    using (exists (
        select 1 from public.attendance_sessions s
        where s.id = session_id and public.can_view_class(s.class_id)));

drop policy if exists attendance_changes_admin_select on public.attendance_changes;
create policy attendance_changes_admin_select on public.attendance_changes
    for select to authenticated
    using ((select public.att_is_admin()));

-- -----------------------------------------------------------------------------
-- 6. RPC: daftar siswa rombel (tanpa data pribadi)
-- -----------------------------------------------------------------------------
create or replace function public.get_class_roster(p_class_id uuid, p_date date default null)
returns table (
    student_id     uuid,
    no_urut        integer,
    nama           text,
    jenis_kelamin  text,
    nis            text,
    nisn           text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_date date := coalesce(p_date, public.jakarta_today());
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;

    return query
    select s.id,
           (row_number() over (order by upper(btrim(s.nama_siswa)), s.id))::integer,
           s.nama_siswa,
           case s.payload ->> 'siswa_jenis_kelamin_nama'
               when 'Laki-laki' then 'L'
               when 'Perempuan' then 'P'
               else null end,
           s.nipd,
           s.nisn
    from public.student_enrollments e
    join public.student_records s on s.id = e.student_id
    where e.class_id = p_class_id
      and e.start_date <= v_date
      and (e.end_date is null or e.end_date >= v_date)
      and s.archived_at is null
    order by 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. RPC: profil siswa satu versi
-- -----------------------------------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when d is null or d = '' then null
        when d ~ '^62' and length(d) between 10 and 15 then '0' || substr(d, 3)
        when d ~ '^8'  and length(d) between 9 and 13  then '0' || d
        when d ~ '^0'  and length(d) between 9 and 14  then d
        else null end
    from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

create or replace function public.get_student_profile(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_rec        public.student_records%rowtype;
    x            jsonb;
    v_class_id   uuid;
    v_class_name text;
    v_full       boolean;
    v_phones     text[] := array[]::text[];
    v_phone      text;
    v_ayah       text;
    v_ibu        text;
    v_wali       text;
begin
    if (select auth.uid()) is null then
        raise exception 'Harus login.' using errcode = '42501';
    end if;

    select * into v_rec from public.student_records where id = p_student_id;
    if not found then
        raise exception 'Siswa tidak ditemukan.' using errcode = 'P0002';
    end if;

    select c.id, c.name into v_class_id, v_class_name
    from public.student_enrollments e
    join public.classes c on c.id = e.class_id
    where e.student_id = p_student_id
    order by (e.end_date is null) desc, e.start_date desc
    limit 1;

    if not (public.att_is_admin() or public.is_pimpinan()
            or (v_class_id is not null and public.can_view_class(v_class_id))) then
        raise exception 'Tidak punya akses ke siswa ini.' using errcode = '42501';
    end if;

    -- Catatan (kebutuhan khusus, KIP/PIP) hanya untuk wali kelas, pimpinan, admin.
    v_full := public.att_is_admin() or public.is_pimpinan()
              or (v_class_id is not null and public.is_homeroom_of(v_class_id));

    x := v_rec.payload;
    v_ayah := nullif(btrim(x ->> 'ayah_nama'), '');
    v_ibu  := coalesce(nullif(btrim(x ->> 'ibu_nama'), ''), nullif(btrim(x ->> 'siswa_nama_ibu_kandung'), ''));
    v_wali := nullif(btrim(x ->> 'wali_nama'), '');

    foreach v_phone in array array[
        x ->> 'kontak_no_hp', x ->> 'ibu_no_hp', x ->> 'ayah_no_hp', x ->> 'wali_no_hp',
        x ->> 'wali_no_telp', x ->> 'lain_hp_orang_tua_ppdb', x ->> 'siswa_no_hp', x ->> 'siswa_no_telepon']
    loop
        v_phone := public.normalize_phone(v_phone);
        if v_phone is not null and not (v_phone = any (v_phones)) and cardinality(v_phones) < 2 then
            v_phones := v_phones || v_phone;
        end if;
    end loop;

    return jsonb_strip_nulls(jsonb_build_object(
        'id', v_rec.id,
        'identitas', jsonb_build_object(
            'nama', v_rec.nama_siswa,
            'nis', v_rec.nipd,
            'nisn', v_rec.nisn,
            'kelas', v_class_name,
            'jenis_kelamin', case x ->> 'siswa_jenis_kelamin_nama'
                                when 'Laki-laki' then 'L' when 'Perempuan' then 'P' end,
            'tempat_lahir', nullif(btrim(x ->> 'siswa_tempat_lahir'), ''),
            'tanggal_lahir', nullif(btrim(x ->> 'siswa_tanggal_lahir'), ''),
            'agama', nullif(btrim(x ->> 'siswa_agama'), ''),
            'anak_ke', nullif(btrim(x ->> 'lain_anak_ke'), '')),
        'orang_tua', jsonb_build_object(
            'ayah_nama', v_ayah,
            'ayah_pekerjaan', nullif(btrim(x ->> 'ayah_pekerjaan_nama'), ''),
            'ibu_nama', v_ibu,
            'ibu_pekerjaan', nullif(btrim(x ->> 'ibu_pekerjaan_nama'), '')),
        'wali', case
            when v_wali is not null
             and upper(v_wali) is distinct from upper(coalesce(v_ayah, ''))
             and upper(v_wali) is distinct from upper(coalesce(v_ibu, ''))
            then jsonb_build_object(
                'nama', v_wali,
                'pekerjaan', nullif(btrim(x ->> 'wali_pekerjaan_nama'), ''))
            end,
        'kontak', to_jsonb(v_phones),
        'alamat', jsonb_build_object(
            'jalan', nullif(btrim(x ->> 'siswa_alamat'), ''),
            'rt', nullif(btrim(x ->> 'siswa_rt'), ''),
            'rw', nullif(btrim(x ->> 'siswa_rw'), ''),
            'kelurahan', nullif(btrim(x ->> 'siswa_kelurahan_nama'), ''),
            'kecamatan', nullif(btrim(x ->> 'siswa_kecamatan_nama'), '')),
        'catatan', case when v_full then jsonb_build_object(
            'kebutuhan_khusus', nullif(btrim(x ->> 'lain_kebutuhan_khusus'), ''),
            'penerima_kip', nullif(btrim(x ->> 'lain_penerima_kip'), ''),
            'usulan_pip', nullif(btrim(x ->> 'lain_usulan_pip'), '')) end
    ));
end;
$$;

comment on function public.get_student_profile(uuid) is
    'Profil siswa satu versi untuk guru. Tidak pernah mengembalikan NIK, KK, penghasilan, anggota keluarga, akta, koordinat, PPDB/Dukcapil.';

-- -----------------------------------------------------------------------------
-- 8. RPC: simpan absensi
--
-- p_entries: [{"student_id": "<uuid>", "status": "H|S|I|A|D", "note": "..."}]
-- Harus memuat SELURUH siswa rombel pada tanggal itu, tidak lebih, tidak kurang.
-- -----------------------------------------------------------------------------
create or replace function public.save_attendance(
    p_class_id    uuid,
    p_date        date,
    p_kind        text,
    p_subject_id  uuid,
    p_entries     jsonb,
    p_reason      text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_uid       uuid := (select auth.uid());
    v_admin     boolean := public.att_is_admin();
    v_staff     uuid := public.current_staff_id();
    v_today     date := public.jakarta_today();
    v_year      record;
    v_session   public.attendance_sessions%rowtype;
    v_is_new    boolean := false;
    v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
    v_roster    uuid[];
    v_given     uuid[];
    v_entry     jsonb;
    v_sid       uuid;
    v_status    text;
    v_note      text;
    v_old       text;
begin
    if v_uid is null then
        raise exception 'Harus login.' using errcode = '42501';
    end if;
    if not v_admin and v_staff is null then
        raise exception 'Akun belum terhubung ke data guru.' using errcode = '42501';
    end if;

    -- Jenis dan mapel
    if p_kind not in ('harian', 'mapel') then
        raise exception 'Jenis absensi tidak dikenal.' using errcode = '22023';
    end if;
    if (p_kind = 'harian') <> (p_subject_id is null) then
        raise exception 'Absensi harian tanpa mapel; absensi mapel wajib memilih mapel.' using errcode = '22023';
    end if;

    -- Hak akses
    if not v_admin then
        if p_kind = 'harian' and not public.is_homeroom_of(p_class_id) then
            raise exception 'Hanya wali kelas rombel ini yang bisa mengisi absensi harian.' using errcode = '42501';
        end if;
        if p_kind = 'mapel' and not public.teaches(p_class_id, p_subject_id) then
            raise exception 'Mapel ini tidak ditugaskan kepada Anda di rombel ini.' using errcode = '42501';
        end if;
    end if;

    -- Tanggal
    select y.start_date, y.end_date into v_year
    from public.classes c join public.academic_years y on y.id = c.academic_year_id
    where c.id = p_class_id;
    if not found then
        raise exception 'Rombel tidak ditemukan.' using errcode = 'P0002';
    end if;
    if p_date is null or p_date < v_year.start_date or p_date > v_year.end_date then
        raise exception 'Tanggal di luar tahun ajaran rombel ini.' using errcode = '22023';
    end if;
    if p_date > v_today then
        raise exception 'Tidak bisa mengisi absensi untuk tanggal yang akan datang.' using errcode = '22023';
    end if;
    if not public.is_school_day(p_date) then
        raise exception 'Tanggal ini hari libur.' using errcode = '22023';
    end if;
    if not v_admin and p_date < public.earliest_backfill_date() then
        raise exception 'Absensi lebih dari 3 hari sekolah lalu hanya bisa diisi admin.' using errcode = '42501';
    end if;

    -- Roster harus lengkap dan persis
    select coalesce(array_agg(r.student_id order by r.student_id), array[]::uuid[]) into v_roster
    from (
        select e.student_id
        from public.student_enrollments e
        join public.student_records s on s.id = e.student_id
        where e.class_id = p_class_id
          and e.start_date <= p_date
          and (e.end_date is null or e.end_date >= p_date)
          and s.archived_at is null
    ) r;

    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'Data absensi tidak valid.' using errcode = '22023';
    end if;

    begin
        select coalesce(array_agg((v ->> 'student_id')::uuid order by (v ->> 'student_id')::uuid), array[]::uuid[])
        into v_given
        from jsonb_array_elements(p_entries) v;
    exception when invalid_text_representation then
        raise exception 'ID siswa tidak valid.' using errcode = '22023';
    end;

    if cardinality(v_roster) = 0 then
        raise exception 'Rombel ini belum punya siswa.' using errcode = '22023';
    end if;
    if v_given is distinct from v_roster then
        raise exception 'Daftar siswa berubah. Muat ulang halaman lalu isi lagi.' using errcode = '22023';
    end if;

    -- Sesi yang sudah ada?
    select * into v_session
    from public.attendance_sessions s
    where s.class_id = p_class_id
      and s.session_date = p_date
      and s.kind = p_kind
      and s.subject_id is not distinct from p_subject_id
      and s.archived_at is null
    for update;

    if found then
        if v_admin then
            if v_reason is null then
                raise exception 'Koreksi oleh admin wajib menyertakan alasan.' using errcode = '22023';
            end if;
        elsif (v_session.created_at at time zone 'Asia/Jakarta')::date <> v_today then
            raise exception 'Absensi ini sudah terkunci. Hubungi admin untuk koreksi.' using errcode = '42501';
        end if;
        update public.attendance_sessions
           set updated_by = v_uid, updated_at = now()
         where id = v_session.id;
    else
        v_is_new := true;
        insert into public.attendance_sessions (
            class_id, session_date, kind, subject_id, recorded_by_staff,
            is_late_entry, created_by, updated_by)
        values (
            p_class_id, p_date, p_kind, p_subject_id, v_staff,
            p_date < v_today, v_uid, v_uid)
        returning * into v_session;

        insert into public.attendance_changes (session_id, action, reason, changed_by)
        values (v_session.id, 'buat', v_reason, v_uid);
    end if;

    -- Tulis status per siswa
    for v_entry in select value from jsonb_array_elements(p_entries) loop
        v_sid    := (v_entry ->> 'student_id')::uuid;
        v_status := upper(btrim(coalesce(v_entry ->> 'status', '')));
        v_note   := nullif(btrim(coalesce(v_entry ->> 'note', '')), '');

        if v_status not in ('H', 'S', 'I', 'A', 'D') then
            raise exception 'Status tidak dikenal. Gunakan H, S, I, A, atau D.' using errcode = '22023';
        end if;
        if v_note is not null and length(v_note) > 200 then
            raise exception 'Catatan maksimal 200 karakter.' using errcode = '22023';
        end if;

        select r.status into v_old
        from public.attendance_records r
        where r.session_id = v_session.id and r.student_id = v_sid;

        if not found then
            insert into public.attendance_records (session_id, student_id, status, note, updated_by)
            values (v_session.id, v_sid, v_status, v_note, v_uid);
            if not v_is_new then
                insert into public.attendance_changes (session_id, student_id, action, old_status, new_status, reason, changed_by)
                values (v_session.id, v_sid, 'ubah', null, v_status, v_reason, v_uid);
            end if;
        else
            update public.attendance_records
               set status = v_status, note = v_note, updated_at = now(), updated_by = v_uid
             where session_id = v_session.id and student_id = v_sid
               and (status is distinct from v_status or note is distinct from v_note);
            if v_old is distinct from v_status then
                insert into public.attendance_changes (session_id, student_id, action, old_status, new_status, reason, changed_by)
                values (v_session.id, v_sid, 'ubah', v_old, v_status, v_reason, v_uid);
            end if;
        end if;
    end loop;

    return v_session.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. RPC admin: arsip / pulihkan sesi
-- -----------------------------------------------------------------------------
create or replace function public.archive_attendance_session(p_session_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
    if not public.att_is_admin() then
        raise exception 'Hanya admin.' using errcode = '42501';
    end if;
    if v_reason is null then
        raise exception 'Alasan wajib diisi.' using errcode = '22023';
    end if;
    update public.attendance_sessions
       set archived_at = now(), archived_by = (select auth.uid()), archive_reason = v_reason
     where id = p_session_id and archived_at is null;
    if not found then
        raise exception 'Sesi tidak ditemukan atau sudah diarsipkan.' using errcode = 'P0002';
    end if;
    insert into public.attendance_changes (session_id, action, reason, changed_by)
    values (p_session_id, 'arsip', v_reason, (select auth.uid()));
end;
$$;

create or replace function public.restore_attendance_session(p_session_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
    if not public.att_is_admin() then
        raise exception 'Hanya admin.' using errcode = '42501';
    end if;
    if v_reason is null then
        raise exception 'Alasan wajib diisi.' using errcode = '22023';
    end if;
    begin
        update public.attendance_sessions
           set archived_at = null, archived_by = null, archive_reason = null,
               updated_by = (select auth.uid()), updated_at = now()
         where id = p_session_id and archived_at is not null;
    exception when unique_violation then
        raise exception 'Sudah ada absensi aktif untuk rombel dan tanggal ini.' using errcode = '23505';
    end;
    if not found then
        raise exception 'Sesi tidak ditemukan atau tidak diarsipkan.' using errcode = 'P0002';
    end if;
    insert into public.attendance_changes (session_id, action, reason, changed_by)
    values (p_session_id, 'pulihkan', v_reason, (select auth.uid()));
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Hak eksekusi fungsi
-- -----------------------------------------------------------------------------
do $fn$
declare
    f text;
begin
    foreach f in array array[
        'public.jakarta_today()',
        'public.current_staff_id()',
        'public.att_is_admin()',
        'public.is_pimpinan()',
        'public.is_homeroom_of(uuid)',
        'public.teaches(uuid, uuid)',
        'public.can_view_class(uuid)',
        'public.is_school_day(date)',
        'public.earliest_backfill_date()',
        'public.normalize_phone(text)',
        'public.get_class_roster(uuid, date)',
        'public.get_student_profile(uuid)',
        'public.save_attendance(uuid, date, text, uuid, jsonb, text)',
        'public.archive_attendance_session(uuid, text)',
        'public.restore_attendance_session(uuid, text)']
    loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end
$fn$;

commit;
