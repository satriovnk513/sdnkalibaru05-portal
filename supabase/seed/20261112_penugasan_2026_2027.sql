-- =============================================================================
-- Seed Absensi Fase 0 — Penugasan Tahun Ajaran 2026/2027 — SDN Kalibaru 05
--
-- Jalankan SETELAH migration 20261112000001_attendance_foundation.sql.
-- Aman dijalankan ulang (idempotent). Satu transaksi: jika satu nama guru
-- tidak ditemukan di public.staff, semuanya dibatalkan.
--
-- TIDAK berisi data pribadi. Nama guru di sini sama dengan yang tampil publik
-- di halaman Guru & Staf. Email dan NIP login TIDAK ada di repo; akun dibuat
-- dengan scripts/create-teacher-accounts.mjs dari file lokal yang di-ignore.
--
-- Sumber: dokumen "Pembagian Tugas Mengajar dan Tendik" + keputusan PRD:
--   - PAI kelas 1–3 Susy Nurhayati, kelas 4–6 Nurul Mawaddah
--   - PJOK kelas 1–3 Nasori, kelas 4–6 Josua Prasetyo
-- =============================================================================

begin;

-- 1. Tahun ajaran aktif
insert into public.academic_years (name, start_date, end_date, is_active)
values ('2026/2027', date '2026-07-01', date '2027-06-30', true)
on conflict (name) do nothing;

-- 2. Rombel: kelas 1–5 A/B/C, kelas 6 A/B (17 rombel)
insert into public.classes (academic_year_id, grade, section)
select y.id, g.grade, g.section
from public.academic_years y
cross join (values
    (1,'A'),(1,'B'),(1,'C'),(2,'A'),(2,'B'),(2,'C'),(3,'A'),(3,'B'),(3,'C'),
    (4,'A'),(4,'B'),(4,'C'),(5,'A'),(5,'B'),(5,'C'),(6,'A'),(6,'B')
) as g(grade, section)
where y.name = '2026/2027'
on conflict (academic_year_id, grade, section) do nothing;

-- 3. Mata pelajaran
insert into public.subjects (code, name) values
    ('PAI',  'Pendidikan Agama Islam'),
    ('PJOK', 'Pendidikan Jasmani, Olahraga, dan Kesehatan')
on conflict (code) do nothing;

-- 4. Keanggotaan rombel dari data siswa (status "Tercantum di daftar kelas")
insert into public.student_enrollments (student_id, class_id, start_date)
select s.id, c.id, date '2026-07-01'
from public.student_records s
join public.classes c on c.name = s.kelas
join public.academic_years y on y.id = c.academic_year_id and y.name = '2026/2027'
where s.archived_at is null
  and s.status_daftar = 'Tercantum di daftar kelas'
  and not exists (
      select 1 from public.student_enrollments e
      where e.student_id = s.id and e.end_date is null)
on conflict do nothing;

-- 5 + 6. Wali kelas dan guru mapel, dicocokkan dengan nama di public.staff
do $seed$
declare
    v_year    uuid;
    v_missing text;
    v_rows    integer;
begin
    select id into v_year from public.academic_years where name = '2026/2027';

    create temp table seed_homeroom (kelas text, staff_name text) on commit drop;
    insert into seed_homeroom values
        ('1 A', 'Sunarsih, S.Pd.'),
        ('1 B', 'Ika Fitri Herti Winarsih, S.Pd.'),
        ('1 C', 'Purnawati, S.Pd.'),
        ('2 A', 'Dara Chaerunnisa, S.Pd.'),
        ('2 B', 'Choirunnisa, S.Pd.'),
        ('2 C', 'Suharni, S.Pd.'),
        ('3 A', 'Taripah, S.Pd.'),
        ('3 B', 'Siti Maysyaroh, S.Pd.'),
        ('3 C', 'Ahmad Soleh, S.Pd.'),
        ('4 A', 'Akna Dewi, S.Pd.'),
        ('4 B', 'Yayuk Pujayanti, S.Pd.'),
        ('4 C', 'Annisa Khoirotunnisa, S.Pd.'),
        ('5 A', 'Samsuri, S.Pd.'),
        ('5 B', 'Nuryamah, S.Pd.'),
        ('5 C', 'Fauziah Ambar Parawansa, S.Pd.'),
        ('6 A', 'Desy Iswahyuni, S.Pd.'),
        ('6 B', 'Abdul Azis, S.Pd.');

    create temp table seed_subject (code text, staff_name text, grade_from int, grade_to int) on commit drop;
    insert into seed_subject values
        ('PAI',  'Susy Nurhayati',        1, 3),
        ('PAI',  'Nurul Mawaddah, S.Pd.', 4, 6),
        ('PJOK', 'Nasori, S.Pd.',         1, 3),
        ('PJOK', 'Josua Prasetyo, S.Pd.', 4, 6);

    -- Setiap nama harus cocok dengan TEPAT satu baris staff.
    select string_agg(n, ', ') into v_missing
    from (
        select staff_name n from seed_homeroom
        union select staff_name from seed_subject
    ) names
    where (select count(*) from public.staff s where s.name = names.n) <> 1;
    if v_missing is not null then
        raise exception 'Nama guru tidak ditemukan (atau ganda) di staff: %', v_missing;
    end if;

    insert into public.homeroom_assignments (class_id, staff_id, position)
    select c.id, s.id, 1
    from seed_homeroom h
    join public.classes c on c.name = h.kelas and c.academic_year_id = v_year
    join public.staff s on s.name = h.staff_name
    on conflict do nothing;

    get diagnostics v_rows = row_count;
    raise notice 'Wali kelas baru: %', v_rows;

    insert into public.subject_assignments (subject_id, class_id, staff_id)
    select sub.id, c.id, s.id
    from seed_subject x
    join public.subjects sub on sub.code = x.code
    join public.classes c on c.academic_year_id = v_year and c.grade between x.grade_from and x.grade_to
    join public.staff s on s.name = x.staff_name
    on conflict do nothing;

    get diagnostics v_rows = row_count;
    raise notice 'Penugasan mapel baru: %', v_rows;
end
$seed$;

commit;

-- Cek hasil (angka saja). Diharapkan: 17 rombel, 17 wali kelas, 34 penugasan
-- mapel (17 PAI + 17 PJOK), dan siswa_terdaftar = jumlah siswa tercantum.
select
    (select count(*) from public.classes c join public.academic_years y on y.id = c.academic_year_id
      where y.name = '2026/2027')                                                  as rombel,
    (select count(*) from public.homeroom_assignments)                              as wali_kelas,
    (select count(*) from public.subject_assignments)                               as penugasan_mapel,
    (select count(*) from public.student_enrollments where end_date is null)        as siswa_terdaftar,
    (select count(*) from public.student_records
      where archived_at is null and status_daftar = 'Tercantum di daftar kelas')    as siswa_tercantum;
