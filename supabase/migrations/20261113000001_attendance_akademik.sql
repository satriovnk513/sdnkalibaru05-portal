-- =============================================================================
-- Modul Absensi — menu Akademik & Kelas (Hari Libur, Tahun Ajaran, Data Kelas,
-- Wali Kelas, Mata Pelajaran) — SDN Kalibaru 05
--
--   1. holiday_catalog: daftar libur resmi (sumber dicatat per baris), dipakai
--      tombol "Sinkron Libur Nasional". Isi awal: Juli 2026 – Desember 2027.
--   2. school_holidays.source: asal data libur.
--   3. RPC admin: sync_holidays, set_active_academic_year, set_homeroom,
--      set_subject_assignments (operasi multi-baris dibuat atomik).
--   4. Tahun ajaran 2026/2027 mulai 13 Juli 2026 (hari pertama sekolah).
--   5. Sinkron awal: katalog → school_holidays.
--
-- Sumber libur:
--   - 2026: SKB 3 Menteri No. 1497/2025, 2/2025, 5/2025 (libur nasional & cuti
--     bersama 2026). Hanya tanggal mulai 1 Juli 2026 yang dimasukkan.
--   - 2027: SKB 3 Menteri No. 1205, 3, dan 2 Tahun 2026 (18 libur nasional,
--     8 cuti bersama).
--   - Libur semester: Keputusan Kepala Dinas Pendidikan Provinsi DKI Jakarta
--     No. 346 Tahun 2026 (Kalender Pendidikan 2026/2027).
-- Libur awal Ramadan dan libur semester tahun ajaran 2027/2028 belum terbit;
-- admin menambahkannya lewat menu Hari Libur.
-- Hanya menambah objek baru. Satu transaksi.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Katalog libur resmi
-- -----------------------------------------------------------------------------
create table if not exists public.holiday_catalog (
    holiday_date  date        primary key,
    name          text        not null,
    kind          text        not null,
    source        text        not null,
    created_at    timestamptz not null default now(),

    constraint holiday_catalog_kind check (kind in ('nasional', 'cuti_bersama', 'sekolah')),
    constraint holiday_catalog_name_not_blank check (btrim(name) <> '')
);

comment on table public.holiday_catalog is
    'Daftar libur resmi (SKB 3 Menteri, kalender pendidikan DKI). Sumber untuk tombol Sinkron Libur Nasional.';

alter table public.school_holidays add column if not exists source text;

-- Libur nasional dan cuti bersama lebih dulu, supaya tanggal yang bertumpuk
-- dengan libur semester tetap memakai nama libur nasional.
insert into public.holiday_catalog (holiday_date, name, kind, source) values
    -- 2026 (SKB 3 Menteri No. 1497/2025, 2/2025, 5/2025)
    ('2026-08-17', 'Proklamasi Kemerdekaan RI',                       'nasional',     'SKB 3 Menteri 2026'),
    ('2026-08-25', 'Maulid Nabi Muhammad SAW',                        'nasional',     'SKB 3 Menteri 2026'),
    ('2026-12-24', 'Cuti Bersama Kelahiran Yesus Kristus',            'cuti_bersama', 'SKB 3 Menteri 2026'),
    ('2026-12-25', 'Kelahiran Yesus Kristus',                         'nasional',     'SKB 3 Menteri 2026'),
    -- 2027 (SKB 3 Menteri No. 1205, 3, dan 2 Tahun 2026)
    ('2027-01-01', 'Tahun Baru 2027 Masehi',                          'nasional',     'SKB 3 Menteri 2027'),
    ('2027-01-05', 'Isra Mikraj Nabi Muhammad SAW 1448 H',            'nasional',     'SKB 3 Menteri 2027'),
    ('2027-02-05', 'Cuti Bersama Tahun Baru Imlek',                   'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-02-06', 'Tahun Baru Imlek 2578 Kongzili',                  'nasional',     'SKB 3 Menteri 2027'),
    ('2027-03-08', 'Hari Suci Nyepi Tahun Baru Saka 1949',            'nasional',     'SKB 3 Menteri 2027'),
    ('2027-03-09', 'Cuti Bersama Idulfitri 1448 H',                   'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-03-10', 'Idulfitri 1448 H',                                'nasional',     'SKB 3 Menteri 2027'),
    ('2027-03-11', 'Idulfitri 1448 H',                                'nasional',     'SKB 3 Menteri 2027'),
    ('2027-03-12', 'Cuti Bersama Idulfitri 1448 H',                   'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-03-15', 'Cuti Bersama Idulfitri 1448 H',                   'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-03-25', 'Cuti Bersama Wafat Yesus Kristus',                'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-03-26', 'Wafat Yesus Kristus',                             'nasional',     'SKB 3 Menteri 2027'),
    ('2027-03-28', 'Kebangkitan Yesus Kristus (Paskah)',              'nasional',     'SKB 3 Menteri 2027'),
    ('2027-05-01', 'Hari Buruh Internasional',                        'nasional',     'SKB 3 Menteri 2027'),
    ('2027-05-06', 'Kenaikan Yesus Kristus',                          'nasional',     'SKB 3 Menteri 2027'),
    ('2027-05-17', 'Iduladha 1448 H',                                 'nasional',     'SKB 3 Menteri 2027'),
    ('2027-05-18', 'Cuti Bersama Iduladha 1448 H',                    'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-05-19', 'Cuti Bersama Hari Raya Waisak',                   'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-05-20', 'Hari Raya Waisak 2571 BE',                        'nasional',     'SKB 3 Menteri 2027'),
    ('2027-06-01', 'Hari Lahir Pancasila',                            'nasional',     'SKB 3 Menteri 2027'),
    ('2027-06-06', 'Tahun Baru Islam 1449 H',                         'nasional',     'SKB 3 Menteri 2027'),
    ('2027-08-15', 'Maulid Nabi Muhammad SAW',                        'nasional',     'SKB 3 Menteri 2027'),
    ('2027-08-17', 'Proklamasi Kemerdekaan RI',                       'nasional',     'SKB 3 Menteri 2027'),
    ('2027-12-24', 'Cuti Bersama Kelahiran Yesus Kristus',            'cuti_bersama', 'SKB 3 Menteri 2027'),
    ('2027-12-25', 'Kelahiran Yesus Kristus',                         'nasional',     'SKB 3 Menteri 2027'),
    ('2027-12-26', 'Isra Mikraj Nabi Muhammad SAW 1449 H',            'nasional',     'SKB 3 Menteri 2027')
on conflict (holiday_date) do nothing;

-- Libur semester (Kepdis DKI No. 346/2026). Tanggal yang sudah terisi libur
-- nasional/cuti bersama dilewati.
insert into public.holiday_catalog (holiday_date, name, kind, source)
select d::date, x.name, 'sekolah', 'Kalender Pendidikan DKI 2026/2027'
from (values
    (date '2026-12-19', date '2027-01-02', 'Libur Semester Ganjil'),
    (date '2027-06-26', date '2027-07-10', 'Libur Semester Genap')
) as x(dari, sampai, name)
cross join lateral generate_series(x.dari, x.sampai, interval '1 day') d
on conflict (holiday_date) do nothing;

revoke all on table public.holiday_catalog from anon, authenticated;
grant select on table public.holiday_catalog to authenticated;
grant all on table public.holiday_catalog to service_role;
alter table public.holiday_catalog enable row level security;
alter table public.holiday_catalog force row level security;
drop policy if exists holiday_catalog_select on public.holiday_catalog;
create policy holiday_catalog_select on public.holiday_catalog
    for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- 2. RPC admin
-- -----------------------------------------------------------------------------
create or replace function public.sync_holidays()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_added int;
begin
    if not public.att_is_admin() then
        raise exception 'Hanya admin.' using errcode = '42501';
    end if;
    insert into public.school_holidays (holiday_date, name, kind, source)
    select c.holiday_date, c.name, c.kind, c.source
    from public.holiday_catalog c
    on conflict (holiday_date) do nothing;
    get diagnostics v_added = row_count;
    return jsonb_build_object(
        'ditambahkan', v_added,
        'katalog', (select count(*) from public.holiday_catalog),
        'sampai', (select max(holiday_date) from public.holiday_catalog));
end;
$$;

create or replace function public.set_active_academic_year(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if not public.att_is_admin() then
        raise exception 'Hanya admin.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.academic_years where id = p_id) then
        raise exception 'Tahun ajaran tidak ditemukan.' using errcode = 'P0002';
    end if;
    update public.academic_years set is_active = false where is_active and id <> p_id;
    update public.academic_years set is_active = true where id = p_id;
end;
$$;

create or replace function public.set_homeroom(p_class_id uuid, p_wali1 uuid, p_wali2 uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if not public.att_is_admin() then
        raise exception 'Hanya admin.' using errcode = '42501';
    end if;
    if p_wali1 is null then
        raise exception 'Wali Kelas 1 wajib dipilih.' using errcode = '22023';
    end if;
    if p_wali2 is not null and p_wali2 = p_wali1 then
        raise exception 'Wali Kelas 2 tidak boleh sama dengan Wali Kelas 1.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.classes where id = p_class_id) then
        raise exception 'Kelas tidak ditemukan.' using errcode = 'P0002';
    end if;
    if (select count(*) from public.staff where id in (p_wali1, p_wali2)) <> (case when p_wali2 is null then 1 else 2 end) then
        raise exception 'Guru tidak ditemukan.' using errcode = 'P0002';
    end if;
    delete from public.homeroom_assignments where class_id = p_class_id;
    insert into public.homeroom_assignments (class_id, staff_id, position) values (p_class_id, p_wali1, 1);
    if p_wali2 is not null then
        insert into public.homeroom_assignments (class_id, staff_id, position) values (p_class_id, p_wali2, 2);
    end if;
end;
$$;

-- Ganti seluruh kelas yang diajar satu guru untuk satu mapel (array kosong = hapus semua).
create or replace function public.set_subject_assignments(p_subject_id uuid, p_staff_id uuid, p_class_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_n integer;
begin
    if not public.att_is_admin() then
        raise exception 'Hanya admin.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.subjects where id = p_subject_id) then
        raise exception 'Mata pelajaran tidak ditemukan.' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.staff where id = p_staff_id) then
        raise exception 'Guru tidak ditemukan.' using errcode = 'P0002';
    end if;
    if exists (select 1 from unnest(coalesce(p_class_ids, '{}')) c(id)
               where not exists (select 1 from public.classes k where k.id = c.id)) then
        raise exception 'Ada kelas yang tidak ditemukan.' using errcode = 'P0002';
    end if;
    delete from public.subject_assignments where subject_id = p_subject_id and staff_id = p_staff_id;
    insert into public.subject_assignments (subject_id, class_id, staff_id)
    select p_subject_id, c.id, p_staff_id from (select distinct unnest(coalesce(p_class_ids, '{}')) as id) c;
    get diagnostics v_n = row_count;
    return v_n;
end;
$$;

do $fn$
declare
    f text;
begin
    foreach f in array array[
        'public.sync_holidays()',
        'public.set_active_academic_year(uuid)',
        'public.set_homeroom(uuid, uuid, uuid)',
        'public.set_subject_assignments(uuid, uuid, uuid[])']
    loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end
$fn$;

-- -----------------------------------------------------------------------------
-- 3. Data
-- -----------------------------------------------------------------------------
-- Hari pertama sekolah TA 2026/2027 menurut Kepdis DKI No. 346/2026.
update public.academic_years
   set start_date = date '2026-07-13'
 where name = '2026/2027' and start_date = date '2026-07-01';

-- Sinkron awal.
insert into public.school_holidays (holiday_date, name, kind, source)
select c.holiday_date, c.name, c.kind, c.source
from public.holiday_catalog c
on conflict (holiday_date) do nothing;

commit;
