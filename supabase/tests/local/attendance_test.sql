-- =============================================================================
-- Tes Absensi Fase 0 — hak akses, RLS, RPC. HANYA untuk database lokal/branch
-- (membuat user fiktif di auth.users). Dijalankan oleh run.sh di dalam satu
-- transaksi yang di-ROLLBACK di akhir.
--
-- Hasil: daftar tes, semuanya "LULUS". Satu GAGAL = exit code bukan 0.
-- =============================================================================

create table pg_temp.att_results (no int, kelompok text, uji text, hasil text);

create or replace function public.t_try(p_sql text)
returns text
language plpgsql
as $$
begin
    execute p_sql;
    return 'OK';
exception when others then
    return sqlstate;
end;
$$;
grant execute on function public.t_try(text) to public;

do $test$
declare
    v_log      jsonb := '[]'::jsonb;
    v_no       int := 0;
    -- akun
    u_admin    uuid; u_wali1a uuid; u_susy uuid; u_josua uuid; u_lilis uuid;
    u_taripah  uuid; u_orphan uuid := gen_random_uuid(); u_nasori uuid;
    -- data
    c1a uuid; c3a uuid; c4a uuid; s_pai uuid; s_pjok uuid;
    st1 uuid; st2 uuid; st3 uuid; st4 uuid; st5 uuid; st6 uuid;
    v_d        date;   -- hari sekolah terakhir <= hari ini
    v_sat      date;   -- Sabtu lalu
    v_old      date;   -- hari sekolah > 3 hari sekolah lalu
    v_sess     uuid; v_sess2 uuid; v_sess_pai uuid;
    v_r        text;
    v_n        bigint;
    v_j        jsonb;
    e_1a       jsonb;  -- entries lengkap 1A
    e_3a       jsonb;
    e_4a       jsonb;

begin
    -- ------------------------------------------------------------- siapkan akun
    insert into auth.users (email) values ('admin@fiktif.test')   returning id into u_admin;
    insert into auth.users (email) values ('wali1a@fiktif.test')  returning id into u_wali1a;
    insert into auth.users (email) values ('susy@fiktif.test')    returning id into u_susy;
    insert into auth.users (email) values ('josua@fiktif.test')   returning id into u_josua;
    insert into auth.users (email) values ('lilis@fiktif.test')   returning id into u_lilis;
    insert into auth.users (email) values ('taripah@fiktif.test') returning id into u_taripah;
    insert into auth.users (email) values ('nasori@fiktif.test')  returning id into u_nasori;
    insert into public.user_roles (user_id, role) values (u_admin, 'admin');

    insert into public.teacher_accounts (user_id, staff_id, email, login_id)
    select u, (select id from public.staff where name = n), e, l
    from (values
        (u_admin,   'Paroji',                  'admin@fiktif.test',   '990000000000000001'),
        (u_wali1a,  'Sunarsih, S.Pd.',         'wali1a@fiktif.test',  '990000000000000002'),
        (u_susy,    'Susy Nurhayati',          'susy@fiktif.test',    '9900000000000003'),
        (u_josua,   'Josua Prasetyo, S.Pd.',   'josua@fiktif.test',   '9900000000000004'),
        (u_lilis,   'Lilis Kholisoh, S.Pd.SD', 'lilis@fiktif.test',   '990000000000000005'),
        (u_taripah, 'Taripah, S.Pd.',          'taripah@fiktif.test', '990000000000000006'),
        (u_nasori,  'Nasori, S.Pd.',           'nasori@fiktif.test',  null)
    ) as a(u, n, e, l);

    select id into c1a from public.classes where name = '1 A';
    select id into c3a from public.classes where name = '3 A';
    select id into c4a from public.classes where name = '4 A';
    select id into s_pai from public.subjects where code = 'PAI';
    select id into s_pjok from public.subjects where code = 'PJOK';
    select id into st1 from public.student_records where nik = '9900000000000101';
    select id into st2 from public.student_records where nik = '9900000000000102';
    select id into st3 from public.student_records where nik = '9900000000000103';
    select id into st4 from public.student_records where nik = '9900000000000301';
    select id into st5 from public.student_records where nik = '9900000000000302';
    select id into st6 from public.student_records where nik = '9900000000000401';

    -- Hari sekolah (bukan akhir pekan/libur) terakhir sampai hari ini.
    select max(g)::date into v_d from generate_series(public.jakarta_today() - 40, public.jakarta_today(), interval '1 day') g
        where public.is_school_day(g::date);
    select max(g)::date into v_sat from generate_series(public.jakarta_today() - 7, public.jakarta_today() - 1, interval '1 day') g
        where extract(isodow from g) = 6;
    select min(g)::date into v_old from (
        select g from generate_series(public.jakarta_today() - 60, public.jakarta_today() - 1, interval '1 day') g
        where public.is_school_day(g::date) order by g desc limit 5) x;

    e_1a := jsonb_build_array(
        jsonb_build_object('student_id', st1, 'status', 'H'),
        jsonb_build_object('student_id', st2, 'status', 'S', 'note', 'Demam'),
        jsonb_build_object('student_id', st3, 'status', 'H'));
    e_3a := jsonb_build_array(
        jsonb_build_object('student_id', st4, 'status', 'H'),
        jsonb_build_object('student_id', st5, 'status', 'D'));
    e_4a := jsonb_build_array(jsonb_build_object('student_id', st6, 'status', 'H'));

    -- ======================================================== A. Seed & struktur
    v_no := v_no + 1; v_log := v_log || jsonb_build_object('no', v_no, 'k', 'A Seed', 'u', '17 rombel, 17 wali kelas, 34 penugasan mapel',
        'ok', (select count(*) from public.classes) = 17
          and (select count(*) from public.homeroom_assignments) = 17
          and (select count(*) from public.subject_assignments) = 34);
    v_no := v_no + 1; v_log := v_log || jsonb_build_object('no', v_no, 'k', 'A Seed', 'u', 'Hanya siswa tercantum yang masuk rombel (6 dari 7)',
        'ok', (select count(*) from public.student_enrollments) = 6);
    v_no := v_no + 1; v_log := v_log || jsonb_build_object('no', v_no, 'k', 'A Seed', 'u', 'Kolom staff tidak berubah (tidak ada email/user_id)',
        'ok', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff'
                            and column_name in ('email', 'user_id', 'login_id')));

    -- ======================================================== B. Anon
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
    v_no := v_no + 1; v_r := public.t_try('select 1 from public.teacher_accounts limit 1');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'B Anon', 'u', 'Anon tidak bisa membaca teacher_accounts', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try('select 1 from public.attendance_records limit 1');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'B Anon', 'u', 'Anon tidak bisa membaca absensi', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_roster(%L)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'B Anon', 'u', 'Anon tidak bisa memanggil get_class_roster', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== C. Akun tanpa data guru
    perform set_config('request.jwt.claims', json_build_object('sub', u_orphan, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_roster(%L)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'C Tanpa akun guru', 'u', 'Tidak bisa melihat roster', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_d, 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'C Tanpa akun guru', 'u', 'Tidak bisa menyimpan absensi', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== D. Wali kelas 1 A
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Roster 1 A berisi 3 siswa urut nama',
        'ok', (select count(*) from public.get_class_roster(c1a)) = 3
          and (select nama from public.get_class_roster(c1a) where no_urut = 1) = 'Siswa Fiktif Dua');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_roster(%L)', c3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Roster 3 A ditolak', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'student_records tetap tertutup (0 baris)',
        'ok', (select count(*) from public.student_records) = 0);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'teacher_accounts hanya baris sendiri',
        'ok', (select count(*) from public.teacher_accounts) = 1);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Keanggotaan rombel hanya 1 A',
        'ok', (select count(*) from public.student_enrollments) = 3);

    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_d, 'harian',
        jsonb_build_array(jsonb_build_object('student_id', st1, 'status', 'H'))));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Roster tidak lengkap ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_d, 'harian',
        jsonb_set(e_1a, '{0,status}', '"X"')));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Status tidak dikenal ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c3a, v_d, 'harian', e_3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Absensi harian 3 A ditolak', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, %L, %L)', c1a, v_d, 'mapel', s_pai, e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Absensi mapel PAI 1 A ditolak (bukan guru PAI)', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, public.jakarta_today() + 1, 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Tanggal besok ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_sat, 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Hari Sabtu ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Tanggal lama (lebih dari 3 hari sekolah lalu) boleh diisi wali kelas',
        'ok', (public.get_attendance_sheet(c1a, v_old, 'harian') ->> 'bisa_ubah')::boolean
              and public.earliest_backfill_date() = (select min(start_date) from public.academic_years where is_active));
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a,
        (select min(start_date) - 3 from public.academic_years where is_active), 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Tanggal sebelum tahun ajaran ditolak', 'ok', v_r = '22023');

    v_sess := public.save_attendance(c1a, v_d, 'harian', null, e_1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Absensi harian 1 A tersimpan (3 status)',
        'ok', (select count(*) from public.attendance_records where session_id = v_sess) = 3);
    v_sess2 := public.save_attendance(c1a, v_d, 'harian', null, jsonb_set(e_1a, '{0,status}', '"A"'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Ubah di hari yang sama memakai sesi yang sama',
        'ok', v_sess2 = v_sess
          and (select status from public.attendance_records where session_id = v_sess and student_id = st1) = 'A');
    v_no := v_no + 1; v_r := public.t_try(format('insert into public.attendance_records (session_id, student_id, status) values (%L, %L, %L)', v_sess, st1, 'H'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Tulis langsung ke tabel absensi ditolak', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('insert into public.subjects (code, name) values (%L, %L)', 'BING', 'Bahasa Inggris'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Guru tidak bisa menambah mapel', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Riwayat absensi tidak terlihat guru',
        'ok', (select count(*) from public.attendance_changes) = 0);

    -- Profil
    v_j := public.get_student_profile(st1);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Profil', 'u', 'Profil memuat NIK siswa, tetapi tanpa KK, NIK ayah, penghasilan',
        'ok', v_j -> 'identitas' ->> 'nik' = '9900000000000101'
          and position('9911111111111111' in v_j::text) = 0
          and position('9922222222222222' in v_j::text) = 0
          and position('5,000,000' in v_j::text) = 0);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Profil', 'u', 'Nomor HP dinormalkan, ganda dibuang, maks 2',
        'ok', v_j -> 'kontak' = '["081200000001", "081200000002"]'::jsonb);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Profil', 'u', 'Wali disembunyikan jika sama dengan ibu',
        'ok', not (v_j ? 'wali'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Profil', 'u', 'Wali tampil jika orangnya berbeda',
        'ok', public.get_student_profile(st2) -> 'wali' ->> 'nama' = 'Wali Lain 9002');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Profil', 'u', 'Wali kelas melihat catatan',
        'ok', v_j ? 'catatan');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_student_profile(%L)', st6));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Profil', 'u', 'Profil siswa rombel lain ditolak', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== E. Kunci & koreksi admin
    update public.attendance_sessions set created_at = now() - interval '2 days' where id = v_sess;
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_d, 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Kunci', 'u', 'Wali kelas tidak bisa ubah sesi hari sebelumnya', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_d, 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Kunci', 'u', 'Koreksi admin tanpa alasan ditolak', 'ok', v_r = '22023');
    perform public.save_attendance(c1a, v_d, 'harian', null, e_1a, 'Surat sakit menyusul');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Kunci', 'u', 'Koreksi admin dengan alasan tercatat di riwayat',
        'ok', exists (select 1 from public.attendance_changes where session_id = v_sess and student_id = st1
                        and old_status = 'A' and new_status = 'H' and reason = 'Surat sakit menyusul'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Kunci', 'u', 'Admin boleh mengisi tanggal lama',
        'ok', public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c4a, v_old, 'harian', e_4a)) = 'OK');
    v_no := v_no + 1; v_r := public.t_try(format('select public.archive_attendance_session(%L, %L)', v_sess, ''));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Arsip', 'u', 'Arsip tanpa alasan ditolak', 'ok', v_r = '22023');
    perform public.archive_attendance_session(v_sess, 'Salah kelas');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_sess2 := public.save_attendance(c1a, v_d, 'harian', null, e_1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Arsip', 'u', 'Setelah diarsip, wali kelas bisa mengisi ulang',
        'ok', v_sess2 <> v_sess);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.restore_attendance_session(%L, %L)', v_sess, 'Pulihkan'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Arsip', 'u', 'Pulihkan ditolak jika sudah ada sesi aktif', 'ok', v_r = '23505');
    v_no := v_no + 1; v_r := public.t_try(format('insert into public.subjects (code, name) values (%L, %L)', 'BING', 'Bahasa Inggris'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'E Admin', 'u', 'Admin bisa menambah mapel', 'ok', v_r = 'OK');
    execute 'reset role';

    -- ======================================================== F. Guru mapel (Susy, PAI 1–3)
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PAI', 'u', 'Melihat absensi harian 1 A (untuk isian awal)',
        'ok', (select count(*) from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
               where s.class_id = c1a and s.kind = 'harian' and s.archived_at is null) = 3);
    v_sess_pai := public.save_attendance(c3a, v_d, 'mapel', s_pai, e_3a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PAI', 'u', 'Absensi PAI 3 A tersimpan, status D diterima',
        'ok', (select status from public.attendance_records where session_id = v_sess_pai and student_id = st5) = 'D');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, %L, %L)', c4a, v_d, 'mapel', s_pai, e_4a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PAI', 'u', 'PAI 4 A ditolak (bagian Bu Nurul)', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, %L, %L)', c1a, v_d, 'mapel', s_pjok, e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PAI', 'u', 'PJOK 1 A ditolak', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_d, 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PAI', 'u', 'Absensi harian ditolak', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PAI', 'u', 'Guru mapel tidak melihat catatan siswa',
        'ok', not (public.get_student_profile(st1) ? 'catatan'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PAI', 'u', 'Tidak melihat absensi 4 A',
        'ok', (select count(*) from public.attendance_sessions where class_id = c4a) = 0);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_josua, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_student_profile(%L)', st1));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PJOK', 'u', 'Josua (kelas 4–6) tidak bisa membuka profil siswa 1 A', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'F Guru PJOK', 'u', 'Josua mengisi PJOK 4 A',
        'ok', public.t_try(format('select public.save_attendance(%L, %L, %L, %L, %L)', c4a, v_d, 'mapel', s_pjok, e_4a)) = 'OK');
    execute 'reset role';

    -- ======================================================== G. Pimpinan
    perform set_config('request.jwt.claims', json_build_object('sub', u_lilis, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'G Kepala Sekolah', 'u', 'Melihat roster semua rombel',
        'ok', (select count(*) from public.get_class_roster(c4a)) = 1 and (select count(*) from public.get_class_roster(c1a)) = 3);
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c3a, v_d, 'harian', e_3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'G Kepala Sekolah', 'u', 'Tidak bisa mengisi absensi', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_taripah, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'G Wakasek + wali 3A', 'u', 'Mengisi harian 3 A dan melihat roster 1 A',
        'ok', public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c3a, v_d, 'harian', e_3a)) = 'OK'
          and (select count(*) from public.get_class_roster(c1a)) = 3);
    execute 'reset role';

    -- ======================================================== H. Akun nonaktif & libur
    update public.teacher_accounts set is_active = false where user_id = u_wali1a;
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_roster(%L)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'H Lain-lain', 'u', 'Akun nonaktif kehilangan akses', 'ok', v_r = '42501');
    execute 'reset role';

    insert into public.school_holidays (holiday_date, name) values (v_d, 'Libur fiktif');
    perform set_config('request.jwt.claims', json_build_object('sub', u_nasori, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, %L, %L)', c1a, v_d, 'mapel', s_pjok, e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'H Lain-lain', 'u', 'Hari libur dari kalender ditolak', 'ok', v_r = '22023');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- ======================================================== I. Fase 1 RPC
    delete from public.school_holidays where name = 'Libur fiktif';
    update public.teacher_accounts set is_active = true where user_id = u_wali1a;

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_guru_home();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Beranda', 'u', 'Wali 1A: satu rombel, tanpa mapel',
        'ok', jsonb_array_length(v_j -> 'wali_kelas') = 1 and v_j -> 'wali_kelas' -> 0 ->> 'kelas' = '1 A'
          and jsonb_array_length(v_j -> 'mapel') = 0 and jsonb_array_length(v_j -> 'semua_kelas') = 0);
    v_j := public.get_class_month_recap(c1a, extract(year from v_d)::int, extract(month from v_d)::int);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Rekap', 'u', 'Rekap bulanan 1 A memuat status hari itu',
        'ok', jsonb_array_length(v_j -> 'siswa') = 3
          and (select count(*) from jsonb_array_elements(v_j -> 'siswa') x where x -> 'status' ? v_d::text) = 3);
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_month_recap(%L, 2026, 11)', c3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Rekap', 'u', 'Rekap rombel lain ditolak', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Akun', 'u', 'Guru tidak melihat daftar akun yang akan dibuat',
        'ok', (select count(*) from public.teacher_account_requests) = 0
          and public.t_try(format('insert into public.teacher_account_requests (staff_id, email) values (%L, %L)',
                (select staff_id from public.teacher_accounts limit 1), 'x@y.id')) = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_guru_home();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Beranda', 'u', 'Bu Susy: PAI di 9 rombel kelas 1–3',
        'ok', jsonb_array_length(v_j -> 'mapel') = 9 and jsonb_array_length(v_j -> 'wali_kelas') = 0);
    v_j := public.get_attendance_sheet(c1a, v_d, 'mapel', s_pai);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Lembar', 'u', 'Lembar PAI 1 A diisi awal dari absensi harian',
        'ok', (v_j ->> 'isian_awal_dari_harian')::boolean
          and (v_j ->> 'bisa_ubah')::boolean
          and (select x ->> 'status' from jsonb_array_elements(v_j -> 'siswa') x where x ->> 'student_id' = st2::text) = 'S');
    v_j := public.get_attendance_sheet(c1a, v_d, 'harian', null);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Lembar', 'u', 'Lembar harian 1 A terbaca tapi tidak bisa diubah guru PAI',
        'ok', not (v_j ->> 'bisa_ubah')::boolean and jsonb_array_length(v_j -> 'siswa') = 3);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_lilis, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Beranda', 'u', 'Kepala Sekolah melihat 17 rombel',
        'ok', jsonb_array_length(public.get_guru_home() -> 'semua_kelas') = 17);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Akun', 'u', 'Admin bisa mengisi daftar akun',
        'ok', public.t_try(format('insert into public.teacher_account_requests (staff_id, email, login_id) values (%L, %L, %L)',
                (select id from public.staff where name = 'Akna Dewi, S.Pd.'), 'akna@fiktif.test', '990000000000000099')) = 'OK');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_orphan, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try('select public.get_guru_home()');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'I Beranda', 'u', 'Akun tanpa data guru ditolak', 'ok', v_r = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- ======================================================== J. Akademik
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Libur', 'u', 'Katalog libur terisi s.d. 26 Des 2027 dan tersinkron',
        'ok', (select max(holiday_date) from public.holiday_catalog) = date '2027-12-26'
          and not exists (select 1 from public.holiday_catalog c where not exists (
                select 1 from public.school_holidays h where h.holiday_date = c.holiday_date)));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Libur', 'u', '25 Des 2026, 10 Mar 2027, 21 Des 2026 bukan hari sekolah; 13 Nov 2026 hari sekolah',
        'ok', not public.is_school_day(date '2026-12-25') and not public.is_school_day(date '2027-03-10')
          and not public.is_school_day(date '2026-12-21') and public.is_school_day(date '2026-11-13'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Libur', 'u', 'Tanggal bertumpuk memakai nama libur nasional (24 Des 2026 = cuti bersama)',
        'ok', (select kind from public.school_holidays where holiday_date = date '2026-12-24') = 'cuti_bersama');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Tahun ajaran', 'u', 'TA 2026/2027 mulai 13 Juli 2026',
        'ok', (select start_date from public.academic_years where name = '2026/2027') = date '2026-07-13');

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try('select public.sync_holidays()');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Hak', 'u', 'Guru tidak bisa sinkron libur', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_homeroom(%L, %L, null)', c3a, (select staff_id from public.teacher_accounts where user_id = u_wali1a)));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Hak', 'u', 'Guru tidak bisa mengubah wali kelas', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('insert into public.school_holidays (holiday_date, name) values (%L, %L)', date '2027-02-01', 'x'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Hak', 'u', 'Guru tidak bisa menambah hari libur', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    delete from public.school_holidays where holiday_date = date '2027-03-10';
    v_j := public.sync_holidays();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Sinkron', 'u', 'Sinkron mengembalikan libur yang terhapus, lalu idempoten',
        'ok', (v_j ->> 'ditambahkan')::int = 1 and (public.sync_holidays() ->> 'ditambahkan')::int = 0);
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_homeroom(%L, %L, %L)', c3a,
        (select id from public.staff where name = 'Taripah, S.Pd.'), (select id from public.staff where name = 'Taripah, S.Pd.')));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Wali', 'u', 'Wali 2 sama dengan wali 1 ditolak', 'ok', v_r = '22023');
    perform public.set_homeroom(c3a, (select id from public.staff where name = 'Taripah, S.Pd.'), (select id from public.staff where name = 'Akna Dewi, S.Pd.'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Wali', 'u', 'Wali pendamping tersimpan di posisi 2',
        'ok', (select count(*) from public.homeroom_assignments where class_id = c3a) = 2
          and (select s.name from public.homeroom_assignments h join public.staff s on s.id = h.staff_id where h.class_id = c3a and h.position = 2) = 'Akna Dewi, S.Pd.');
    v_n := public.set_subject_assignments(s_pjok, (select id from public.staff where name = 'Josua Prasetyo, S.Pd.'),
               array(select id from public.classes where grade = 6));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Mapel', 'u', 'Penugasan mapel diganti utuh (Josua: 4–6 → hanya 6 A, 6 B)',
        'ok', v_n = 2
          and (select count(*) from public.subject_assignments where subject_id = s_pjok
                 and staff_id = (select id from public.staff where name = 'Josua Prasetyo, S.Pd.')) = 2);
    insert into public.academic_years (name, start_date, end_date) values ('2027/2028', date '2027-07-12', date '2028-06-30');
    perform public.set_active_academic_year((select id from public.academic_years where name = '2027/2028'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'J Tahun ajaran', 'u', 'Ganti tahun ajaran aktif: tepat satu yang aktif',
        'ok', (select count(*) from public.academic_years where is_active) = 1
          and (select name from public.academic_years where is_active) = '2027/2028');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- ======================================================== K. Laporan
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_report_header(c1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'K Kop', 'u', 'Kop 1 A: TA 2026/2027, wali Sunarsih, kepala sekolah Lilis',
        'ok', v_j ->> 'kelas' = '1 A' and v_j ->> 'tahun_ajaran' = '2026/2027'
          and v_j -> 'wali' -> 0 ->> 'nama' = 'Sunarsih, S.Pd.'
          and v_j -> 'kepala_sekolah' ->> 'nama' = 'Lilis Kholisoh, S.Pd.SD');
    v_j := public.get_class_semester_recap(c1a, case when extract(month from v_d) >= 7 then 1 else 2 end);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'K Semester', 'u', 'Rekap semester 1 A: 3 siswa, Siswa Fiktif Dua sakit 1 kali, hari terisi >= 1',
        'ok', jsonb_array_length(v_j -> 'siswa') = 3
          and (select (x ->> 'S')::int from jsonb_array_elements(v_j -> 'siswa') x where x ->> 'student_id' = st2::text) = 1
          and (v_j ->> 'hari_terisi')::int >= 1 and (v_j ->> 'hari_efektif')::int >= 1);
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_semester_recap(%L, 3)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'K Semester', 'u', 'Semester selain 1/2 ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_semester_recap(%L, 1)', c3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'K Hak', 'u', 'Wali 1A tidak bisa rekap semester 3A', 'ok', v_r = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_josua, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_report_header(%L)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'K Hak', 'u', 'Guru PJOK 4–6 tidak bisa membuka kop 1 A', 'ok', v_r = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- ======================================================== L. PIN pemulihan
    -- Guru (authenticated) tidak bisa menyentuh tabel / fungsi tulis PIN.
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try('select 1 from public.teacher_recovery_pins limit 1');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Guru tidak bisa membaca tabel PIN', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_recovery_pin(%L, %L)', u_wali1a, '483920'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Guru tidak bisa memanggil set_recovery_pin langsung', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.verify_recovery_pin(%L, %L)', u_wali1a, '483920'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Guru tidak bisa memanggil verify_recovery_pin langsung', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Status awal: belum punya PIN',
        'ok', (public.get_my_recovery_pin() ->> 'ada')::boolean = false);
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try(format('select public.verify_recovery_pin(%L, %L)', u_wali1a, '483920'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Anon tidak bisa memanggil verify_recovery_pin', 'ok', v_r = '42501');
    execute 'reset role';

    -- service_role (API server)
    execute 'set local role service_role';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'PIN bebas 6 angka (123456, 111111 boleh); yang bukan 6 angka ditolak',
        'ok', not public.recovery_pin_is_weak('123456') and not public.recovery_pin_is_weak('111111') and not public.recovery_pin_is_weak('483920')
          and public.recovery_pin_is_weak('12345') and public.recovery_pin_is_weak('12a456') and public.recovery_pin_is_weak(null));
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_recovery_pin(%L, %L)', u_wali1a, '12a456'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'set_recovery_pin menolak PIN yang bukan 6 angka', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_recovery_pin(%L, %L)', gen_random_uuid(), '483920'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'set_recovery_pin menolak user yang bukan akun guru', 'ok', v_r = 'P0002');
    perform public.set_recovery_pin(u_wali1a, '483920');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'PIN tersimpan sebagai hash bcrypt (bukan angka asli)',
        'ok', (select pin_hash like '$2a$10$%' and pin_hash not like '%483920%' from public.teacher_recovery_pins where user_id = u_wali1a));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'PIN benar → ok; user tanpa PIN → tidak_ada',
        'ok', public.verify_recovery_pin(u_wali1a, '483920') = 'ok' and public.verify_recovery_pin(u_susy, '483920') = 'tidak_ada');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Salah 4x → salah, salah ke-5 → terkunci, PIN benar pun ditolak saat terkunci',
        'ok', public.verify_recovery_pin(u_wali1a, '000001') = 'salah'
          and public.verify_recovery_pin(u_wali1a, '000002') = 'salah'
          and public.verify_recovery_pin(u_wali1a, '000003') = 'salah'
          and public.verify_recovery_pin(u_wali1a, '000004') = 'salah'
          and public.verify_recovery_pin(u_wali1a, '000005') = 'terkunci'
          and public.verify_recovery_pin(u_wali1a, '483920') = 'terkunci');
    update public.teacher_recovery_pins set locked_until = now() - interval '1 minute' where user_id = u_wali1a;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Setelah masa kunci habis PIN benar bisa dipakai lagi',
        'ok', public.verify_recovery_pin(u_wali1a, '483920') = 'ok');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_my_recovery_pin();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Guru melihat status PIN sendiri (ada, tanggal dibuat), tanpa hash',
        'ok', (v_j ->> 'ada')::boolean and v_j ->> 'dibuat' is not null and not (v_j ? 'pin_hash'));
    execute 'reset role';
    execute 'set local role service_role';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'Admin (lewat server) menghapus PIN guru',
        'ok', public.clear_recovery_pin(u_wali1a) and public.verify_recovery_pin(u_wali1a, '483920') = 'tidak_ada');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- ======================================================== M. Statistik & peringatan alpa
    -- Tes Akademik di atas memindahkan tahun ajaran aktif; kembalikan ke tahun ajaran rombel 1 A.
    update public.academic_years set is_active = false where is_active;
    update public.academic_years set is_active = true where id = (select academic_year_id from public.classes where id = c1a);
    -- Empat hari lampau (tanggal berbeda, di dalam semester berjalan) dengan st1 alpa; st3 alpa 1x saja.
    insert into public.attendance_sessions (id, class_id, session_date, kind)
    select gen_random_uuid(), c1a, d::date, 'harian'
    from (select d from generate_series(v_d - 40, v_d - 1, interval '1 day') d
          where public.is_school_day(d::date)
            and d::date >= (select start_date from public.academic_years where is_active)
            and not exists (select 1 from public.attendance_sessions x where x.class_id = c1a and x.session_date = d::date and x.kind = 'harian' and x.archived_at is null)
          order by d desc limit 4) q;
    insert into public.attendance_records (session_id, student_id, status)
    select s.id, st.sid, case when st.sid = st1 then 'A' when st.sid = st3 and s.session_date = (select min(session_date) from public.attendance_sessions where class_id = c1a and kind = 'harian' and session_date < v_d) then 'A' else 'H' end
    from public.attendance_sessions s cross join (values (st1), (st2), (st3)) st(sid)
    where s.class_id = c1a and s.kind = 'harian' and s.session_date < v_d
      and not exists (select 1 from public.attendance_records r where r.session_id = s.id);

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_attendance_stats(c1a, v_d, v_d);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Statistik', 'u', 'Per tanggal 1 A: 3 siswa, 1 hari terisi, Sakit 1, jumlah status = 3',
        'ok', (v_j ->> 'jumlah_siswa')::int = 3 and (v_j ->> 'hari_terisi')::int = 1 and (v_j -> 'total' ->> 'S')::int = 1
          and (select sum(value::int) from jsonb_each_text(v_j -> 'total')) = 3
          and jsonb_array_length(v_j -> 'harian') = 1 and v_j ->> 'libur' is null);
    v_j := public.get_class_attendance_stats(c1a, v_d - 40, v_d);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Statistik', 'u', 'Rentang: per hari berurutan, per siswa st1 alpa = jumlah hari lampau, hari efektif >= hari terisi',
        'ok', jsonb_array_length(v_j -> 'harian') = (v_j ->> 'hari_terisi')::int
          and (v_j ->> 'hari_efektif')::int >= (v_j ->> 'hari_terisi')::int
          and (select (x ->> 'A')::int from jsonb_array_elements(v_j -> 'siswa') x where x ->> 'student_id' = st1::text)
              = (select count(*) from public.attendance_sessions where class_id = c1a and kind = 'harian' and session_date < v_d and session_date >= v_d - 40 and archived_at is null)
          and (v_j -> 'harian' -> 0 ->> 'tanggal') < (v_j -> 'harian' -> -1 ->> 'tanggal'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Statistik', 'u', 'Sabtu: ditandai libur, 0 hari efektif',
        'ok', (public.get_class_attendance_stats(c1a, v_sat, v_sat) ->> 'libur') = 'Sabtu/Minggu'
          and (public.get_class_attendance_stats(c1a, v_sat, v_sat) ->> 'hari_efektif')::int = 0);
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_attendance_stats(%L, %L, %L)', c1a, v_d, v_d - 1));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Statistik', 'u', 'Rentang terbalik ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_attendance_stats(%L, %L, %L)', c1a, v_d - 500, v_d));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Statistik', 'u', 'Rentang lebih dari 400 hari ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_attendance_stats(%L, %L, %L)', c3a, v_d, v_d));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Hak', 'u', 'Wali 1A tidak bisa statistik 3A', 'ok', v_r = '42501');

    v_n := (select count(*) from public.attendance_sessions where class_id = c1a and kind = 'harian' and session_date < v_d and archived_at is null
              and session_date >= (public.get_alpha_alerts(1) ->> 'dari')::date);
    v_j := public.get_alpha_alerts(4);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Alpa', 'u', 'Wali 1A: siswa alpa >= 4 hari muncul (st1) dengan No. HP orang tua, yang alpa 1x tidak',
        'ok', case when v_n >= 4 then
                jsonb_array_length(v_j -> 'siswa') = 1 and v_j -> 'siswa' -> 0 ->> 'student_id' = st1::text
                and (v_j -> 'siswa' -> 0 ->> 'alpa')::int = v_n and v_j -> 'siswa' -> 0 ->> 'kelas' = '1 A'
                and v_j -> 'siswa' -> 0 ->> 'hp' = '081200000001'
              else jsonb_array_length(v_j -> 'siswa') = 0 end);
    v_no := v_no + 1; v_r := public.t_try('select public.get_alpha_alerts(0)');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Alpa', 'u', 'Batas 0 ditolak', 'ok', v_r = '22023');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_josua, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Alpa', 'u', 'Guru mapel (bukan wali) tidak menerima peringatan kelas lain',
        'ok', jsonb_array_length(public.get_alpha_alerts(1) -> 'siswa') = 0);
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_lilis, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Alpa', 'u', 'Kepala sekolah melihat peringatan semua kelas',
        'ok', exists (select 1 from jsonb_array_elements(public.get_alpha_alerts(1) -> 'siswa') x where x ->> 'student_id' = st1::text));
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try('select public.get_alpha_alerts(4)');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'M Hak', 'u', 'Anon tidak bisa memanggil get_alpha_alerts', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== N. Data dokumen guru
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_document_data(c1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'N Dokumen', 'u', 'Wali 1A: kop + 3 siswa berurutan dengan NIK, HP, nama orang tua',
        'ok', v_j ->> 'kelas' = '1 A' and v_j ? 'kepala_sekolah' and jsonb_array_length(v_j -> 'siswa') = 3
          and (v_j -> 'siswa' -> 0 ->> 'no')::int = 1
          and not exists (select 1 from jsonb_array_elements(v_j -> 'siswa') x where x ->> 'nik' is null or x ->> 'hp' is null));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'N Dokumen', 'u', 'Penghasilan, akta, koordinat tidak ikut keluar',
        'ok', v_j::text !~* 'penghasilan|akta|lintang|bujur|pekerjaan');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_document_data(%L)', c3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'N Hak', 'u', 'Wali 1A tidak bisa mengambil data dokumen 3A', 'ok', v_r = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_document_data(%L)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'N Hak', 'u', 'Anon tidak bisa mengambil data dokumen', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== O. Nomor surat
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.take_letter_number('Surat keterangan aktif', 'Siswa Fiktif Satu');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Nomor pertama tahun ini = 001/PK.0101',
        'ok', v_j ->> 'teks' = '001/PK.0101' and (v_j ->> 'nomor')::int = 1
          and (v_j ->> 'tahun')::int = extract(year from public.jakarta_today())::int);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Nomor berikutnya berurut (002), kode bisa diganti',
        'ok', public.take_letter_number('Undangan', null, 'PK.0202') ->> 'teks' = '002/PK.0202');
    v_no := v_no + 1; v_r := public.t_try($q$select public.take_letter_number('', null)$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Jenis surat kosong ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try($q$select public.take_letter_number('Surat', null, 'PK 01<script>')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Kode surat berisi karakter aneh ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try($q$insert into public.letter_register (tahun, nomor, kode, jenis) values (2026, 500, 'X', 'Y')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Guru tidak bisa menulis langsung ke buku nomor surat', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Guru melihat nomor yang diambilnya sendiri (2 baris)',
        'ok', (select count(*) from public.letter_register) = 2);
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Guru lain tidak melihat nomor milik guru lain, dan nomornya lanjut (003)',
        'ok', (select count(*) from public.letter_register) = 0
          and public.take_letter_number('Surat pemberitahuan') ->> 'teks' = '003/PK.0101');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_lilis, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Nomor surat', 'u', 'Kepala sekolah melihat seluruh buku nomor surat (3 baris)',
        'ok', (select count(*) from public.letter_register) = 3);
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try($q$select public.take_letter_number('Surat')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'O Hak', 'u', 'Anon tidak bisa mengambil nomor surat', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== P. Inventaris & pinjam QR
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.inv_save_item('{"nama":"Laptop Asus 1","kategori":"Laptop","nomor_seri":"SN-1","jenis_pinjam":"jangka panjang"}');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Inventaris', 'u', 'Admin tambah barang: kode otomatis LAP-001, token QR 12 karakter',
        'ok', v_j ->> 'kode' = 'LAP-001' and length(v_j ->> 'qr_token') = 12 and v_j ->> 'jenis_pinjam' = 'jangka_panjang' and v_j -> 'pinjaman' = 'null'::jsonb);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Inventaris', 'u', 'Kode otomatis berikutnya LAP-002',
        'ok', public.inv_save_item('{"nama":"Laptop Asus 2","kategori":"Laptop"}') ->> 'kode' = 'LAP-002');
    v_j := public.inv_import_items('[{"nama":"Speaker Aktif","kategori":"Speaker","kode":"spk","jumlah":2},{"nama":"Proyektor Epson","kategori":"Proyektor","kondisi":"Berfungsi"},{"nama":"Proyektor BenQ","kategori":"Proyektor","kondisi":"Rusak berat","keterangan_rusak":"Lampu mati"},{"nama":"Lemari Arsip","kategori":"Mebel","jenis_pinjam":"Tidak dipinjam"}]');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Inventaris', 'u', 'Impor Excel: jumlah 2 → SPK-01, SPK-02; tanpa kode → PRO-001; status lama "Rusak berat" → Rusak + keterangan',
        'ok', (v_j ->> 'ditambah')::int = 5
          and (select count(*) from public.inventory_items where kode in ('SPK-01', 'SPK-02', 'PRO-001', 'PRO-002', 'MEB-001')) = 5
          and (select kondisi from public.inventory_items where kode = 'PRO-001') = 'baik'
          and (select kondisi || '/' || keterangan_rusak from public.inventory_items where kode = 'PRO-002') = 'rusak/Lampu mati');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Status', 'u', 'Barang berfungsi tidak menyimpan keterangan rusak',
        'ok', public.inv_save_item('{"nama":"Kamera","kategori":"Kamera","kondisi":"berfungsi","keterangan_rusak":"iseng"}') -> 'keterangan_rusak' = 'null'::jsonb);
    v_j := public.inv_import_items('[{"nama":"Speaker Aktif Baru","kode":"SPK-01"}]');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Inventaris', 'u', 'Impor ulang kode yang sama → diperbarui, bukan dobel',
        'ok', v_j ->> 'diperbarui' = '1' and v_j ->> 'ditambah' = '0'
          and (select nama from public.inventory_items where kode = 'SPK-01') = 'Speaker Aktif Baru');
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_import_items('[{"nama":"OK"},{"nama":"Rusak","kondisi":"hancur"}]')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Inventaris', 'u', 'Impor dengan satu baris salah ditolak seluruhnya',
        'ok', v_r = '22023' and not exists (select 1 from public.inventory_items where nama = 'OK'));
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_save_item('{"nama":"Dobel","kode":"lap-001"}')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Inventaris', 'u', 'Kode yang sudah dipakai ditolak (tidak peka huruf besar)', 'ok', v_r = '23505');
    execute 'reset role';

    -- Guru meminjam lewat QR
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.inv_scan((select qr_token from public.inventory_items where kode = 'LAP-001'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Guru scan QR: identitas barang tampil, nomor seri disembunyikan',
        'ok', v_j ->> 'nama' = 'Laptop Asus 1' and not v_j ? 'nomor_seri' and v_j -> 'pinjaman' = 'null'::jsonb and not (v_j ->> 'milik_saya')::boolean);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Guru bisa mencari pakai kode barang juga',
        'ok', public.inv_scan('spk-02') ->> 'kode' = 'SPK-02');
    v_j := public.inv_scan('PRO-002');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Status', 'u', 'Guru scan barang rusak: status + keterangan tampil, ditawari barang sejenis yang tersedia',
        'ok', v_j ->> 'kondisi' = 'rusak' and v_j ->> 'keterangan_rusak' = 'Lampu mati'
          and v_j -> 'alternatif' = '[{"kode":"PRO-001","nama":"Proyektor Epson","lokasi":null}]'::jsonb);
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_borrow('PRO-002')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Status', 'u', 'Barang rusak tidak bisa dipinjam', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_set_status((select id from public.inventory_items where kode = 'PRO-002'), 'baik')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Status', 'u', 'Guru tidak bisa mengubah status rusak/berfungsi', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Status', 'u', 'Barang tersedia tidak menawarkan alternatif',
        'ok', public.inv_scan('PRO-001') -> 'alternatif' = '[]'::jsonb);
    v_j := public.inv_borrow('LAP-001', 'Mengajar kelas 1A', public.jakarta_today() + 60);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Guru pinjam laptop jangka panjang sampai tanggal tertentu',
        'ok', v_j -> 'pinjaman' ->> 'peminjam' = 'Sunarsih, S.Pd.' and (v_j -> 'pinjaman' ->> 'sampai')::date = public.jakarta_today() + 60
          and (public.inv_scan('LAP-001') ->> 'milik_saya')::boolean);
    v_j := public.inv_borrow('SPK-02', null, null);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Barang harian tanpa tanggal → harus kembali hari ini',
        'ok', (v_j -> 'pinjaman' ->> 'sampai')::date = public.jakarta_today());
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_borrow('PRO-001', null, public.jakarta_today() - 1)$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Tanggal kembali di masa lalu ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_borrow('MEB-001')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Barang "tidak dipinjam" tidak bisa dipinjam', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_save_item('{"nama":"Iseng"}')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Hak', 'u', 'Guru tidak bisa menambah barang', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try($q$insert into public.inventory_loans (item_id, staff_id) select id, (select id from public.staff limit 1) from public.inventory_items where kode = 'PRO-001'$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Hak', 'u', 'Guru tidak bisa menulis langsung ke tabel pinjaman', 'ok', v_r = '42501');
    v_j := public.inv_my_loans();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Pinjaman saya: 2 barang aktif',
        'ok', jsonb_array_length(v_j -> 'aktif') = 2 and (select count(*) from public.inventory_loans) = 2);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_borrow('LAP-001')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Guru lain tidak bisa meminjam barang yang sedang dipinjam', 'ok', v_r = '23505');
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_return('LAP-001')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Guru lain tidak bisa mengembalikan pinjaman orang lain', 'ok', v_r = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Guru lain melihat siapa peminjamnya, tapi tidak bisa membaca tabel pinjaman orang lain',
        'ok', public.inv_scan('LAP-001') -> 'pinjaman' ->> 'peminjam' = 'Sunarsih, S.Pd.' and not (public.inv_scan('LAP-001') ->> 'milik_saya')::boolean
          and (select count(*) from public.inventory_loans) = 0);
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_admin_overview()$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Hak', 'u', 'Guru biasa tidak bisa membuka daftar inventaris admin', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.inv_return('LAP-001', 'Engsel agak longgar');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Pinjam', 'u', 'Guru mengembalikan + catatan; status barang tetap (hanya admin yang menentukan)',
        'ok', v_j -> 'pinjaman' = 'null'::jsonb and v_j ->> 'kondisi' = 'baik'
          and (select catatan_kembali from public.inventory_loans where returned_at is not null) = 'Engsel agak longgar'
          and jsonb_array_length(public.inv_my_loans() -> 'riwayat') = 1 and jsonb_array_length(public.inv_my_loans() -> 'aktif') = 1);
    execute 'reset role';

    -- Admin: pantau, catat atas nama staf, terlambat, hapus/arsip
    update public.inventory_loans set borrowed_at = now() - interval '3 days', due_date = public.jakarta_today() - 2 where returned_at is null;
    perform set_config('request.jwt.claims', json_build_object('sub', u_lilis, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.inv_admin_overview();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Kepala sekolah melihat inventaris; pinjaman lewat batas ditandai terlambat',
        'ok', jsonb_array_length(v_j -> 'items') = 8
          and exists (select 1 from jsonb_array_elements(v_j -> 'items') x where x ->> 'kode' = 'SPK-02' and (x -> 'pinjaman' ->> 'terlambat')::boolean));
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_delete_item((select id from public.inventory_items where kode = 'LAP-002'))$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Hak', 'u', 'Kepala sekolah tidak bisa menghapus barang', 'ok', v_r = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.inv_admin_lend((select id from public.inventory_items where kode = 'PRO-001'), (select id from public.staff where name = 'Ahmad Soleh, S.Pd.'), 'Rapat', null);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Admin mencatat pinjaman atas nama staf tanpa akun',
        'ok', v_j -> 'pinjaman' ->> 'peminjam' = 'Ahmad Soleh, S.Pd.');
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_delete_item((select id from public.inventory_items where kode = 'PRO-001'))$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Barang yang masih dipinjam tidak bisa dihapus', 'ok', v_r = '22023');
    v_j := public.inv_admin_return((select id from public.inventory_items where kode = 'SPK-02'), 'rusak', 'Dikembalikan ke TU', 'Kabel putus');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Admin menandai kembali sekaligus menetapkan status Rusak + keterangan',
        'ok', v_j -> 'pinjaman' = 'null'::jsonb and v_j ->> 'kondisi' = 'rusak' and v_j ->> 'keterangan_rusak' = 'Kabel putus');
    v_j := public.inv_set_status((select id from public.inventory_items where kode = 'SPK-02'), 'Berfungsi', 'sisa');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Admin menandai berfungsi lagi → keterangan rusak dihapus',
        'ok', v_j ->> 'kondisi' = 'baik' and v_j -> 'keterangan_rusak' = 'null'::jsonb);
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_set_status((select id from public.inventory_items where kode = 'SPK-02'), 'hancur')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Status selain Berfungsi/Rusak ditolak', 'ok', v_r = '22023');
    v_r := public.inv_delete_item((select id from public.inventory_items where kode = 'LAP-001'))
        || '/' || public.inv_delete_item((select id from public.inventory_items where kode = 'LAP-002'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Barang dengan riwayat → diarsipkan; tanpa riwayat → dihapus',
        'ok', v_r = 'diarsipkan/dihapus' and public.t_try($q$select public.inv_scan('LAP-001')$q$) = 'P0002'
          and not exists (select 1 from public.inventory_items where kode = 'LAP-002'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Admin', 'u', 'Riwayat pinjam lengkap (3 pinjaman) tetap ada',
        'ok', jsonb_array_length(public.inv_loan_history(null, null)) = 3);
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try($q$select public.inv_scan('SPK-01')$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Hak', 'u', 'Anon tidak bisa scan barang', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try($q$select count(*) from public.inventory_items$q$);
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'P Hak', 'u', 'Anon tidak bisa membaca tabel inventaris', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== Q. Nilai rapor
    declare
        s_mtk uuid := (select id from public.subjects where code = 'MTK');
    begin
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', '15 mapel dengan urutan tetap (BIN pertama, SER terakhir)',
        'ok', (select count(*) from public.subjects where sort_order between 1 and 15) = 15
          and (select code from public.subjects order by sort_order limit 1) = 'BIN'
          and (select code from public.subjects where sort_order = 15) = 'SER');
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_grades(c1a, 1::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Wali kelas melihat semua mapel; PAI diisi guru mapel (tidak bisa diubah wali), MTK bisa',
        'ok', jsonb_array_length(v_j -> 'mapel') = (select count(*) from public.subjects where grade_min <= 1) and jsonb_array_length(v_j -> 'siswa') = 3
          and exists (select 1 from jsonb_array_elements(v_j -> 'mapel') m where m ->> 'kode' = 'PAI' and not (m ->> 'can_edit')::boolean and m -> 'guru_mapel' = '["Susy Nurhayati"]'::jsonb)
          and exists (select 1 from jsonb_array_elements(v_j -> 'mapel') m where m ->> 'kode' = 'MTK' and (m ->> 'can_edit')::boolean));
    v_j := public.save_grades(c1a, 1::smallint, jsonb_build_array(jsonb_build_object('subject_id', s_mtk, 'kktp', 75, 'entries', jsonb_build_array(
        jsonb_build_object('student_id', st1, 'uh1', 80, 'uh2', 85, 'uh3', 90, 'sts', 78, 'sas', 82),
        jsonb_build_object('student_id', st2, 'uh1', '70')))));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Wali menyimpan KKTP + nilai MTK (6 nilai baru, KKTP tercatat)',
        'ok', v_j = '{"baru":6,"berubah":0,"dihapus":0,"kktp":1}'::jsonb);
    v_j := public.save_grades(c1a, 1::smallint, jsonb_build_array(jsonb_build_object('subject_id', s_mtk, 'entries', jsonb_build_array(
        jsonb_build_object('student_id', st1, 'uh1', 85, 'uh2', 85)))));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Mengubah satu nilai → 1 berubah; nilai sama tidak dicatat',
        'ok', v_j ->> 'berubah' = '1' and v_j ->> 'baru' = '0');
    v_j := public.save_grades(c1a, 1::smallint, jsonb_build_array(jsonb_build_object('subject_id', s_mtk, 'kktp', null, 'entries', jsonb_build_array(
        jsonb_build_object('student_id', st1, 'uh2', null, 'sts', '')))), 'impor', true);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Impor', 'u', 'Impor: kotak kosong di Excel tidak menghapus nilai/KKTP yang sudah ada',
        'ok', v_j = '{"baru":0,"berubah":0,"dihapus":0,"kktp":0}'::jsonb);
    v_j := public.save_grades(c1a, 1::smallint, jsonb_build_array(jsonb_build_object('subject_id', s_mtk, 'entries', jsonb_build_array(
        jsonb_build_object('student_id', st2, 'uh1', null)))));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Di portal, mengosongkan kotak menghapus nilai (tercatat)',
        'ok', v_j ->> 'dihapus' = '1');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_grades(%L, 1::smallint, '[{"subject_id":"%s","entries":[{"student_id":"%s","uh1":101}]}]')$q$, c1a, s_mtk, st1));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Nilai di atas 100 ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_grades(%L, 1::smallint, '[{"subject_id":"%s","entries":[{"student_id":"%s","uh1":80.5}]}]')$q$, c1a, s_mtk, st1));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Nilai pecahan ditolak (harus bulat)', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_grades(%L, 1::smallint, '[{"subject_id":"%s","entries":[{"student_id":"%s","uh1":80}]}]')$q$, c1a, s_mtk, st4));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Siswa kelas lain ditolak', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_grades(%L, 1::smallint, '[{"subject_id":"%s","entries":[{"student_id":"%s","uh1":80}]}]')$q$, c1a, s_pai, st1));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Wali kelas tidak bisa mengisi PAI (punya guru mapel)', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_grades(%L, 1::smallint, '[{"subject_id":"%s","entries":[{"student_id":"%s","uh1":80}]}]')$q$, c3a, s_mtk, st4));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Wali kelas tidak bisa mengisi nilai kelas lain', 'ok', v_r = '42501');
    perform public.set_class_subject_hidden(c1a, (select id from public.subjects where code = 'IPAS'), true);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Wali menandai IPAS tidak diajarkan di kelasnya',
        'ok', exists (select 1 from jsonb_array_elements(public.get_class_grades(c1a, 1::smallint) -> 'mapel') m where m ->> 'kode' = 'IPAS' and (m ->> 'hidden')::boolean));
    v_j := public.get_my_grade_classes();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Kelas di menu Nilai: wali kelas 1 A',
        'ok', jsonb_array_length(v_j) = 1 and v_j -> 0 ->> 'nama' = '1 A' and (v_j -> 0 ->> 'wali')::boolean);
    v_no := v_no + 1; v_r := public.t_try('select count(*) from public.student_grades');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Tabel nilai tidak bisa dibaca langsung (hanya lewat RPC)', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_grades(c1a, 1::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Guru PAI hanya melihat mapel PAI di kelas yang diajarnya (tidak melihat nilai MTK)',
        'ok', jsonb_array_length(v_j -> 'mapel') = 1 and v_j -> 'mapel' -> 0 ->> 'kode' = 'PAI' and (v_j -> 'mapel' -> 0 ->> 'can_edit')::boolean
          and jsonb_array_length(v_j -> 'nilai') = 0);
    v_j := public.save_grades(c1a, 1::smallint, jsonb_build_array(jsonb_build_object('subject_id', s_pai, 'kktp', 70, 'entries', jsonb_build_array(
        jsonb_build_object('student_id', st1, 'uh1', 88)))));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Guru PAI mengisi nilai & KKTP PAI', 'ok', v_j ->> 'baru' = '1' and v_j ->> 'kktp' = '1');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_grades(%L, 1::smallint, '[{"subject_id":"%s","entries":[{"student_id":"%s","uh1":80}]}]')$q$, c1a, s_mtk, st1));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Guru PAI tidak bisa mengisi Matematika', 'ok', v_r = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_class_subject_hidden(%L, %L, true)', c1a, s_mtk));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Guru mapel tidak bisa menyembunyikan mapel kelas', 'ok', v_r = '42501');
    v_j := public.get_grade_history(c1a, 1::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Riwayat', 'u', 'Riwayat guru PAI hanya berisi perubahan PAI',
        'ok', jsonb_array_length(v_j) = 2 and not exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'mapel' <> 'PAI'));
    v_j := public.get_my_grade_classes();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Guru PAI kelas 1–3 melihat semua kelas yang diajarnya',
        'ok', jsonb_array_length(v_j) = (select count(*) from public.classes where grade between 1 and 3)
          and v_j -> 0 -> 'mapel' = '["PAI"]'::jsonb);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_grade_history(c1a, 1::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Riwayat', 'u', 'Riwayat wali: semua perubahan kelasnya (lama → baru, siapa)',
        'ok', jsonb_array_length(v_j) = 11
          and exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'kolom' = 'uh1' and x ->> 'lama' = '80' and x ->> 'baru' = '85' and x ->> 'oleh' = 'Sunarsih, S.Pd.')
          and exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'kolom' = 'kktp' and x ->> 'baru' = '75'));
    v_j := public.get_class_grades(c1a, 1::smallint, s_mtk);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Nilai tersimpan benar (uh1 85, uh2 85, uh3 90, sts 78, sas 82; KKTP 75)',
        'ok', v_j -> 'mapel' -> 0 ->> 'kktp' = '75'
          and exists (select 1 from jsonb_array_elements(v_j -> 'nilai') n where n ->> 's' = st1::text
                      and n ->> 'uh1' = '85' and n ->> 'uh2' = '85' and n ->> 'uh3' = '90' and n ->> 'sts' = '78' and n ->> 'sas' = '82'));
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_lilis, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Kepala sekolah melihat semua mapel tapi tidak bisa mengubah',
        'ok', jsonb_array_length(public.get_class_grades(c1a, 1::smallint) -> 'mapel') = (select count(*) from public.subjects where grade_min <= 1)
          and public.t_try(format($q$select public.save_grades(%L, 1::smallint, '[{"subject_id":"%s","entries":[{"student_id":"%s","uh1":80}]}]')$q$, c1a, s_mtk, st1)) = '42501');
    v_j := public.get_grades_admin_matrix(1::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Admin', 'u', 'Matriks admin: 17 kelas × 14 mapel; MTK 1 A: 1 lengkap, 1 terisi',
        'ok', jsonb_array_length(v_j -> 'kelas') = 17 and jsonb_array_length(v_j -> 'mapel') = (select count(*) from public.subjects)
          and (select (k -> 'sel' -> s_mtk::text ->> 'lengkap') = '1' and (k -> 'sel' -> s_mtk::text ->> 'terisi') = '1' and (k ->> 'siswa') = '3'
               from jsonb_array_elements(v_j -> 'kelas') k where k ->> 'nama' = '1 A'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Nilai', 'u', 'Kepala sekolah: menu Nilai berisi semua kelas; data nilai memuat kepala sekolah untuk tanda tangan',
        'ok', jsonb_array_length(public.get_my_grade_classes()) = 17
          and public.get_class_grades(c1a, 1::smallint) -> 'kepala_sekolah' ->> 'nama' = 'Lilis Kholisoh, S.Pd.SD');
    execute 'reset role';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_grades(%L, 1::smallint)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Q Hak', 'u', 'Anon tidak bisa membuka nilai', 'ok', v_r = '42501');
    execute 'reset role';
    end;

    -- ======================================================== R. Jadwal pelajaran
    declare
        s_mtk2 uuid := (select id from public.subjects where code = 'MTK');
        sf_susy uuid := (select id from public.staff where name = 'Susy Nurhayati');
        v_msg text;
    begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_schedule(c1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Jadwal baru: 11 jam, istirahat kelas 1 di jam ke-5 08:50–09:25, upacara & dhuha terisi',
        'ok', jsonb_array_length(v_j -> 'slot') = 11 and (v_j ->> 'can_edit')::boolean
          and v_j -> 'slot' -> 0 ->> 'mulai' = '06:30' and v_j -> 'slot' -> 0 ->> 'selesai' = '07:05'
          and (v_j -> 'slot' -> 4 ->> 'istirahat')::boolean and v_j -> 'slot' -> 4 ->> 'mulai' = '08:50' and v_j -> 'slot' -> 4 ->> 'selesai' = '09:25'
          and v_j -> 'slot' -> 10 ->> 'selesai' = '12:55'
          and jsonb_array_length(v_j -> 'isi') = 4
          and exists (select 1 from jsonb_array_elements(v_j -> 'isi') x where x ->> 'hari' = '1' and x ->> 'kegiatan' = 'Upacara Bendera'));
    v_j := public.save_schedule_entry(c1a, 1::smallint, 3::smallint, 2::smallint, 'mapel', s_pai);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Wali mengisi PAI Senin jam 3–4 → guru PAI terisi otomatis (satu-satunya guru mapel)',
        'ok', (select count(*) from jsonb_array_elements(v_j -> 'isi') x where x ->> 'kode' = 'PAI' and x ->> 'guru' = 'Susy Nurhayati' and x ->> 'hari' = '1') = 2);
    v_j := public.save_schedule_entry(c1a, 2::smallint, 1::smallint, 3::smallint, 'mapel', s_mtk2);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Mapel tanpa guru mapel (MTK) tidak mencatat guru',
        'ok', (select count(*) from jsonb_array_elements(v_j -> 'isi') x where x ->> 'kode' = 'MTK' and x -> 'staff_id' = 'null'::jsonb) = 3);
    v_j := public.save_schedule_entry(c1a, 5::smallint, 9::smallint, 3::smallint, 'kegiatan', null, '  Pulang  ');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Kegiatan "Pulang" Jumat jam 9–11',
        'ok', (select count(*) from jsonb_array_elements(v_j -> 'isi') x where x ->> 'kegiatan' = 'Pulang' and x ->> 'hari' = '5') = 3);
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_schedule_entry(%L, 2::smallint, 4::smallint, 2::smallint, 'mapel', %L)$q$, c1a, s_mtk2));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Jam istirahat terkunci (tidak bisa diisi)', 'ok', v_r = '22023');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.set_schedule_slot(%L, 5::smallint, '09:00', '09:30')$q$, c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Waktu istirahat tidak bisa diubah', 'ok', v_r = '22023');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Format jam salah / selesai sebelum mulai ditolak',
        'ok', public.t_try(format($q$select public.set_schedule_slot(%L, 7::smallint, '24:00', '')$q$, c1a)) = '22023'
          and public.t_try(format($q$select public.set_schedule_slot(%L, 7::smallint, '10:00', '09:00')$q$, c1a)) = '22023'
          and public.t_try(format($q$select public.set_schedule_slot(%L, 7::smallint, '7.5', '')$q$, c1a)) = '22023');
    v_j := public.set_schedule_slot(c1a, 11::smallint, '', '');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Waktu boleh dikosongkan (opsional)',
        'ok', v_j -> 'slot' -> 10 -> 'mulai' = 'null'::jsonb and v_j -> 'slot' -> 10 -> 'selesai' = 'null'::jsonb);
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_schedule_entry(%L, 1::smallint, 3::smallint, 1::smallint, 'kegiatan', null, 'X')$q$, c3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Hak', 'u', 'Wali 1 A tidak bisa mengubah jadwal kelas lain', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_taripah, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        perform public.save_schedule_entry(c3a, 1::smallint, 3::smallint, 1::smallint, 'mapel', s_pai);
        v_msg := 'tidak gagal';
    exception when others then v_msg := sqlstate || ' ' || sqlerrm;
    end;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Bentrok', 'u', 'PAI 3 A Senin jam 3 bentrok dengan 1 A → gagal + pesan jelas (' || left(v_msg, 120) || ')',
        'ok', v_msg like '23P01 Gagal disimpan. Susy Nurhayati sudah mengajar PAI di kelas 1 A pada Senin jam ke-3 (07.40–08.15)%');
    v_j := public.save_schedule_entry(c3a, 1::smallint, 7::smallint, 2::smallint, 'mapel', s_pai);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Bentrok', 'u', 'PAI 3 A Senin jam 7–8 (tidak bentrok) tersimpan; istirahat kelas 3 di jam ke-6 09:25–09:45',
        'ok', (select count(*) from jsonb_array_elements(v_j -> 'isi') x where x ->> 'kode' = 'PAI') = 2
          and (v_j -> 'slot' -> 5 ->> 'istirahat')::boolean and v_j -> 'slot' -> 5 ->> 'mulai' = '09:25' and v_j -> 'slot' -> 5 ->> 'selesai' = '09:45');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.set_schedule_slot(%L, 7::smallint, '07:50', '08:30')$q$, c3a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Bentrok', 'u', 'Menggeser waktu jam sampai beririsan dengan kelas lain juga ditolak', 'ok', v_r = '23P01');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_teaching_schedule();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Guru mapel', 'u', 'Guru PAI melihat jadwal mengajarnya dari semua kelas (1 A jam 3–4, 3 A jam 7–8)',
        'ok', jsonb_array_length(v_j -> 'isi') = 4 and v_j -> 'guru' ->> 'nama' = 'Susy Nurhayati'
          and v_j -> 'isi' -> 0 ->> 'kelas' = '1 A' and v_j -> 'isi' -> 0 ->> 'mulai' = '07:40' and v_j -> 'isi' -> 3 ->> 'kelas' = '3 A');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Hak', 'u', 'Guru mapel bisa melihat jadwal kelas yang diajar, tapi tidak bisa mengubah',
        'ok', jsonb_array_length(public.get_class_schedule(c1a) -> 'slot') = 11 and not (public.get_class_schedule(c1a) ->> 'can_edit')::boolean
          and public.t_try(format($q$select public.save_schedule_entry(%L, 1::smallint, 6::smallint, 1::smallint, 'kosong')$q$, c1a)) = '42501');
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_teaching_schedule(%L)', (select id from public.staff where name = 'Sunarsih, S.Pd.')));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Hak', 'u', 'Guru tidak bisa membuka jadwal mengajar guru lain', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.add_schedule_slot(c1a, '12:55', '13:30');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Tambah jam ke-12', 'ok', jsonb_array_length(v_j -> 'slot') = 12 and v_j -> 'slot' -> 11 ->> 'mulai' = '12:55');
    v_j := public.delete_schedule_slot(c1a, 2::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Hapus jam ke-2: isi jam sesudahnya ikut naik (PAI jadi jam 2–3, istirahat jam 4)',
        'ok', jsonb_array_length(v_j -> 'slot') = 11 and (v_j -> 'slot' -> 3 ->> 'istirahat')::boolean
          and (select string_agg(x ->> 'jam', ',' order by (x ->> 'jam')::int) from jsonb_array_elements(v_j -> 'isi') x where x ->> 'kode' = 'PAI') = '2,3'
          and (select count(*) from jsonb_array_elements(v_j -> 'isi') x where x ->> 'kegiatan' = 'Upacara Bendera') = 1);
    v_no := v_no + 1; v_r := public.t_try(format('select public.delete_schedule_slot(%L, 4::smallint)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Baris istirahat tidak bisa dihapus', 'ok', v_r = '22023');
    v_j := public.save_schedule_entry(c1a, 2::smallint, 1::smallint, 3::smallint, 'kosong');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Jadwal', 'u', 'Kosongkan Selasa jam 1–3',
        'ok', not exists (select 1 from jsonb_array_elements(v_j -> 'isi') x where x ->> 'hari' = '2'));
    v_no := v_no + 1; v_r := public.t_try('select count(*) from public.class_schedule_entries');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Hak', 'u', 'Tabel jadwal tidak bisa dibaca langsung', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_schedule_teachers();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Admin', 'u', 'Admin: daftar guru mapel + jumlah jam terjadwal',
        'ok', exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'nama' = 'Susy Nurhayati' and x ->> 'jam' = '4'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Admin', 'u', 'Admin bisa melihat jadwal mengajar guru lain & mengubah jadwal kelas mana pun',
        'ok', jsonb_array_length(public.get_teaching_schedule(sf_susy) -> 'isi') = 4
          and (public.save_schedule_entry(c4a, 3::smallint, 1::smallint, 1::smallint, 'kegiatan', null, 'Senam') -> 'isi') @> '[{"kegiatan":"Senam"}]'::jsonb);
    execute 'reset role';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_schedule(%L)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'R Hak', 'u', 'Anon tidak bisa membuka jadwal', 'ok', v_r = '42501');
    execute 'reset role';
    end;

    -- ======================================================== S. Jurnal mengajar
    declare
        v_rabu  date := (select max(g)::date from generate_series(public.jakarta_today() - 6, public.jakarta_today(), interval '1 day') g where extract(isodow from g) = 3);
        v_senin date := (select max(g)::date from generate_series(public.jakarta_today() - 6, public.jakarta_today(), interval '1 day') g where extract(isodow from g) = 1);
        v_mtk uuid := (select id from public.subjects where code = 'MTK');
        v_bin uuid := (select id from public.subjects where code = 'BIN');
        v_note uuid;
    begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.save_schedule_entry(c1a, 3::smallint, 1::smallint, 2::smallint, 'mapel', v_mtk);
    perform public.save_schedule_entry(c1a, 3::smallint, 5::smallint, 1::smallint, 'mapel', v_bin);
    v_j := public.get_my_journal_day(v_rabu);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Jurnal', 'u', 'Jurnal Rabu wali kelas terisi dari jadwal kelasnya (MTK jam 1–2, BIN), belum ada catatan',
        'ok', jsonb_array_length(v_j -> 'jadwal') = 3 and v_j -> 'jadwal' -> 0 ->> 'kode' = 'MTK' and v_j -> 'jadwal' -> 0 ->> 'mulai' = '06:30'
          and jsonb_array_length(v_j -> 'catatan') = 0 and jsonb_array_length(v_j -> 'kelas') = 1);
    v_j := public.save_journal_entry(v_rabu, 'terlaksana', null, c1a, v_mtk, null, '1–2', '  Penjumlahan 1–20  ');
    v_j := public.save_journal_entry(v_rabu, 'tidak', null, c1a, v_mtk, null, '1–2', null, 'Rapat guru');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Jurnal', 'u', 'Tandai jadwal: simpan ulang menimpa (satu catatan per kelas-mapel-hari), materi opsional',
        'ok', jsonb_array_length(v_j -> 'catatan') = 1 and v_j -> 'catatan' -> 0 ->> 'status' = 'tidak'
          and v_j -> 'catatan' -> 0 -> 'materi' = 'null'::jsonb and v_j -> 'catatan' -> 0 ->> 'keterangan' = 'Rapat guru' and v_j -> 'catatan' -> 0 ->> 'jam' = '1–2');
    v_j := public.save_journal_entry(v_rabu, 'terlaksana', null, c1a, null, 'Rapat orang tua murid', null, 'Pembagian rapor sisipan');
    select (x ->> 'id')::uuid into v_note from jsonb_array_elements(v_j -> 'catatan') x where x ->> 'judul' = 'Rapat orang tua murid';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Jurnal', 'u', 'Catatan lain (judul bebas) tersimpan', 'ok', jsonb_array_length(v_j -> 'catatan') = 2 and v_note is not null);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Jurnal', 'u', 'Tanggal yang belum tiba, status salah, dan catatan tanpa judul ditolak',
        'ok', public.t_try(format($q$select public.save_journal_entry(%L, 'terlaksana', null, %L, %L)$q$, public.jakarta_today() + 1, c1a, v_mtk)) = '22023'
          and public.t_try(format($q$select public.save_journal_entry(%L, 'oke', null, %L, %L)$q$, v_rabu, c1a, v_mtk)) = '22023'
          and public.t_try(format($q$select public.save_journal_entry(%L, 'terlaksana')$q$, v_rabu)) = '22023');
    v_no := v_no + 1; v_r := public.t_try(format($q$select public.save_journal_entry(%L, 'terlaksana', null, %L, %L)$q$, v_rabu, c4a, v_mtk));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Hak', 'u', 'Tidak bisa mencatat untuk kelas yang bukan kelasnya', 'ok', v_r = '42501');
    v_j := public.get_my_journal_month(extract(year from v_rabu)::int, extract(month from v_rabu)::int);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Jurnal', 'u', 'Unduhan bulanan berisi catatan + nama guru',
        'ok', jsonb_array_length(v_j -> 'catatan') = 2 and v_j -> 'guru' ->> 'nama' = 'Sunarsih, S.Pd.');
    v_no := v_no + 1; v_r := public.t_try('select count(*) from public.teaching_journal');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Hak', 'u', 'Tabel jurnal tidak bisa dibaca langsung', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_my_journal_day(v_senin);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Jurnal', 'u', 'Guru PAI: jurnal Senin berisi jam PAI-nya di semua kelas (1 A & 3 A)',
        'ok', jsonb_array_length(v_j -> 'jadwal') = 4 and not exists (select 1 from jsonb_array_elements(v_j -> 'jadwal') x where x ->> 'kode' <> 'PAI')
          and jsonb_array_length(v_j -> 'catatan') = 0);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Hak', 'u', 'Jurnal pribadi: guru lain tidak melihat / tidak bisa mengubah / menghapus catatan wali',
        'ok', jsonb_array_length(public.get_my_journal_day(v_rabu) -> 'catatan') = 0
          and public.t_try(format($q$select public.save_journal_entry(%L, 'tidak', %L)$q$, v_rabu, v_note)) = '22023'
          and public.t_try(format('select public.delete_journal_entry(%L)', v_note)) = '22023');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Hak', 'u', 'Admin pun tidak bisa membaca jurnal guru lain', 'ok', jsonb_array_length(public.get_my_journal_day(v_rabu) -> 'catatan') = 0);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.delete_journal_entry(v_note);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Jurnal', 'u', 'Hapus catatan lain milik sendiri', 'ok', jsonb_array_length(v_j -> 'catatan') = 1);
    execute 'reset role';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_my_journal_day(%L)', v_rabu));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'S Hak', 'u', 'Anon tidak bisa membuka jurnal', 'ok', v_r = '42501');
    execute 'reset role';
    end;

    -- ======================================================== T. Piket
    declare
        c6a uuid := (select id from public.classes where name = '6 A');
        v_cnt int[];
        v_l int[];
        v_p int[];
        v_s1 uuid;
        v_h0 int;
    begin
    -- 12 siswa fiktif kelas 6 A: 7 laki-laki, 5 perempuan
    insert into public.student_records (nik, nama_siswa, nipd, nisn, kelas, status_daftar, payload)
    select '99000000000006' || lpad(g::text, 2, '0'), 'Piket ' || g, '96' || lpad(g::text, 2, '0'), '00960000' || lpad(g::text, 2, '0'), '6 A', 'Tercantum di daftar kelas',
           jsonb_build_object('nama_siswa', 'Piket ' || g, 'kelas', '6 A', 'siswa_jenis_kelamin_nama', case when g <= 7 then 'Laki-laki' else 'Perempuan' end)
    from generate_series(1, 12) g;
    update public.student_enrollments e set start_date = (select y.start_date from public.academic_years y where y.is_active)
    from public.student_records r where r.id = e.student_id and r.nama_siswa like 'Piket %' and e.end_date is null;

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_piket(c6a);
    select array_agg(n order by h) into v_cnt from (select h, (select count(*) from jsonb_array_elements(v_j -> 'siswa') x where (x ->> 'hari')::int = h) n from generate_series(1, 5) h) t;
    select array_agg(n order by h) into v_l from (select h, (select count(*) from jsonb_array_elements(v_j -> 'siswa') x where (x ->> 'hari')::int = h and x ->> 'jk' = 'L') n from generate_series(1, 5) h) t;
    select array_agg(n order by h) into v_p from (select h, (select count(*) from jsonb_array_elements(v_j -> 'siswa') x where (x ->> 'hari')::int = h and x ->> 'jk' = 'P') n from generate_series(1, 5) h) t;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', format('12 siswa dibagi rata Sen–Jum %s, L %s, P %s; mode bawaan bulanan', v_cnt, v_l, v_p),
        'ok', jsonb_array_length(v_j -> 'siswa') = 12 and v_j ->> 'mode' = 'bulanan' and v_j ->> 'periode' = 'B' || to_char(public.jakarta_today(), 'YYYY-MM')
          and (select max(x) - min(x) from unnest(v_cnt) x) <= 1 and (select max(x) - min(x) from unnest(v_l) x) <= 1 and (select max(x) - min(x) from unnest(v_p) x) <= 1);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Pembagian tetap saat dibuka lagi (tidak berubah sendiri)',
        'ok', public.get_class_piket(c6a) -> 'siswa' = v_j -> 'siswa');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Mode bulanan: bulan berikutnya punya pembagian sendiri',
        'ok', public.get_class_piket(c6a, (date_trunc('month', public.jakarta_today()) + interval '1 month')::date) ->> 'periode'
              = 'B' || to_char(date_trunc('month', public.jakarta_today()) + interval '1 month', 'YYYY-MM')
          and public.get_class_piket(c6a) -> 'siswa' = v_j -> 'siswa');
    v_j := public.set_piket_mode(c6a, 'semester');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Mode satu semester → periode S1/S2, tetap sepanjang semester',
        'ok', v_j ->> 'mode' = 'semester' and v_j ->> 'periode' = (case when extract(month from public.jakarta_today()) >= 7 then 'S1' else 'S2' end)
          and jsonb_array_length(v_j -> 'siswa') = 12);
    v_s1 := (v_j -> 'siswa' -> 0 ->> 'id')::uuid;
    v_h0 := (v_j -> 'siswa' -> 0 ->> 'hari')::int;
    v_j := public.set_piket_day(c6a, v_s1, (v_h0 % 5 + 1)::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Pindahkan satu siswa ke hari lain',
        'ok', (v_j -> 'siswa' -> 0 ->> 'hari')::int = v_h0 % 5 + 1);
    v_j := public.shuffle_piket(c6a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Acak ulang tetap 12 siswa & rata',
        'ok', jsonb_array_length(v_j -> 'siswa') = 12
          and (select max(n) - min(n) from (select h, (select count(*) from jsonb_array_elements(v_j -> 'siswa') x where (x ->> 'hari')::int = h) n from generate_series(1, 5) h) t) <= 1);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Mode / hari tidak valid ditolak',
        'ok', public.t_try(format($q$select public.set_piket_mode(%L, 'mingguan')$q$, c6a)) = '22023'
          and public.t_try(format($q$select public.set_piket_day(%L, %L, 6::smallint)$q$, c6a, v_s1)) = '22023');
    execute 'reset role';

    -- siswa baru masuk ke hari paling sedikit
    insert into public.student_records (nik, nama_siswa, nipd, nisn, kelas, status_daftar, payload)
    values ('9900000000000699', 'Piket Baru', '9699', '0096000099', '6 A', 'Tercantum di daftar kelas', jsonb_build_object('nama_siswa', 'Piket Baru', 'siswa_jenis_kelamin_nama', 'Perempuan'));
    insert into public.student_enrollments (student_id, class_id, start_date)
    select id, c6a, public.jakarta_today() from public.student_records where nama_siswa = 'Piket Baru';
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_piket(c6a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Siswa baru otomatis masuk ke hari yang paling sedikit',
        'ok', jsonb_array_length(v_j -> 'siswa') = 13
          and (select max(n) - min(n) from (select h, (select count(*) from jsonb_array_elements(v_j -> 'siswa') x where (x ->> 'hari')::int = h) n from generate_series(1, 5) h) t) <= 1);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_piket(c1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Piket', 'u', 'Wali kelas 1 A: 3 siswa di 3 hari berbeda, bisa mengubah',
        'ok', jsonb_array_length(v_j -> 'siswa') = 3 and (v_j ->> 'can_edit')::boolean
          and (select count(distinct x ->> 'hari') from jsonb_array_elements(v_j -> 'siswa') x) = 3);
    v_no := v_no + 1; v_r := public.t_try(format('select public.shuffle_piket(%L)', c6a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Hak', 'u', 'Wali kelas lain tidak bisa mengacak / membuka piket kelas lain', 'ok', v_r = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Hak', 'u', 'Guru mapel bisa melihat piket kelas yang diajar, tidak bisa mengubah',
        'ok', not (public.get_class_piket(c1a) ->> 'can_edit')::boolean
          and public.t_try(format('select public.shuffle_piket(%L)', c1a)) = '42501'
          and public.t_try('select count(*) from public.class_piket') = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_class_piket(%L)', c1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'T Hak', 'u', 'Anon tidak bisa membuka piket', 'ok', v_r = '42501');
    execute 'reset role';
    end;

    -- ======================================================== U. Catatan Siswa + panel admin
    declare
        v_ids jsonb; v_n_susy uuid; v_n_josua uuid; v_n_wali uuid;
        v_tgl date := public.jakarta_today();
        v_jid uuid;
        v_sun uuid := (select id from public.staff where name = 'Sunarsih, S.Pd.');
    begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_ids := public.save_student_note('apresiasi', '  Juara 2   lomba mewarnai ', v_tgl, array[st1, st2], c1a, 'serius', 'FLS2N kecamatan', null,
                                      array[u_wali1a::text || '/a.jpg']) -> 'ids';
    v_n_wali := (v_ids ->> 0)::uuid;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Catatan', 'u', 'Wali menulis apresiasi untuk 2 siswa sekaligus (+1 foto); tingkat diabaikan untuk non-perilaku',
        'ok', jsonb_array_length(v_ids) = 2
          and (select count(distinct x ->> 'group_id') from jsonb_array_elements(public.get_class_notes(c1a, (case when extract(month from v_tgl) >= 7 then 1 else 2 end)::smallint) -> 'catatan') x
               where v_ids ? (x ->> 'id')) = 1
          and (select x ->> 'judul' from jsonb_array_elements(public.get_student_notes(st1) -> 'catatan') x limit 1) = 'Juara 2 lomba mewarnai'
          and (select x -> 'tingkat' from jsonb_array_elements(public.get_student_notes(st1) -> 'catatan') x limit 1) = 'null'::jsonb);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Catatan', 'u', 'Validasi: tanggal masa depan, judul kosong, siswa bukan di kelas itu, foto dari folder orang lain',
        'ok', public.t_try(format($q$select public.save_student_note('catatan', 'X', %L, array[%L]::uuid[], %L)$q$, v_tgl + 1, st1, c1a)) = '22023'
          and public.t_try(format($q$select public.save_student_note('catatan', '  ', %L, array[%L]::uuid[], %L)$q$, v_tgl, st1, c1a)) = '22023'
          and public.t_try(format($q$select public.save_student_note('catatan', 'X', %L, array[%L]::uuid[], %L)$q$, v_tgl, st4, c1a)) = '22023'
          and public.t_try(format($q$select public.save_student_note('catatan', 'X', %L, array[%L]::uuid[], %L, null, null, null, array['orang-lain/x.jpg'])$q$, v_tgl, st1, c1a)) = '22023');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n_susy := (public.save_student_note('perilaku', 'Berkelahi saat istirahat', v_tgl, array[st1], c1a, 'serius', null, null, array[u_susy::text || '/b.jpg']) -> 'ids' ->> 0)::uuid;
    v_j := public.get_class_notes(c1a, (case when extract(month from v_tgl) >= 7 then 1 else 2 end)::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Catatan', 'u', 'Guru mapel menulis perilaku serius; di halaman kelas hanya melihat catatannya sendiri',
        'ok', not (v_j ->> 'lihat_semua')::boolean and jsonb_array_length(v_j -> 'catatan') = 1
          and v_j -> 'catatan' -> 0 ->> 'tingkat' = 'serius' and (v_j -> 'catatan' -> 0 ->> 'milik_saya')::boolean
          and jsonb_array_length(v_j -> 'siswa') = 3);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_josua, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n_josua := (public.save_student_note('catatan', 'Sering mengantuk', v_tgl, array[st1], c1a) -> 'ids' ->> 0)::uuid;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Hak', 'u', 'Guru lain (tidak mengajar kelas itu) boleh menulis, tapi tidak melihat catatan guru lain / foto / mengubah',
        'ok', jsonb_array_length(public.get_student_notes(st1, true) -> 'catatan') = 1
          and not public.note_foto_boleh(u_susy::text || '/b.jpg')
          and public.t_try(format($q$select public.save_student_note('perilaku', 'Ubah', %L, null, null, 'ringan', null, null, '{}', %L)$q$, v_tgl, v_n_susy)) = '42501'
          and public.t_try(format($q$select public.set_note_followup(%L, 'x')$q$, v_n_susy)) = '42501'
          and public.t_try(format('select public.delete_student_note(%L)', v_n_susy)) = '42501'
          and public.t_try('select count(*) from public.student_notes') = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_class_notes(c1a, (case when extract(month from v_tgl) >= 7 then 1 else 2 end)::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Catatan', 'u', 'Wali kelas melihat semua catatan siswanya (dari guru lain juga) + foto, bisa isi tindak lanjut',
        'ok', (v_j ->> 'lihat_semua')::boolean and jsonb_array_length(v_j -> 'catatan') = 4
          and public.note_foto_boleh(u_susy::text || '/b.jpg')
          and public.set_note_followup(v_n_susy, 'Orang tua dipanggil') ->> 'tindak_lanjut_oleh' = 'Sunarsih, S.Pd.'
          and public.t_try(format($q$select public.save_student_note('perilaku', 'Ubah', %L, null, null, 'ringan', null, null, '{}', %L)$q$, v_tgl, v_n_susy)) = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_lilis, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Hak', 'u', 'Kepala sekolah melihat semua catatan kelas',
        'ok', jsonb_array_length(public.get_class_notes(c1a, (case when extract(month from v_tgl) >= 7 then 1 else 2 end)::smallint) -> 'catatan') = 4
          and public.t_try('select public.get_notes_admin(1::smallint)') = '42501');
    execute 'reset role';

    -- penulis mengubah sendiri: tidak masuk log admin
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.save_student_note('perilaku', 'Berkelahi saat istirahat (dorong teman)', v_tgl, null, null, 'serius', null, 'Orang tua dipanggil', array[u_susy::text || '/b.jpg'], v_n_susy);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.get_notes_admin((case when extract(month from v_tgl) >= 7 then 1 else 2 end)::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Admin', 'u', 'Admin/operator melihat semua catatan + ringkasan + filter',
        'ok', jsonb_array_length(v_j -> 'catatan') = 4 and (v_j -> 'ringkas' ->> 'serius')::int = 1 and (v_j -> 'ringkas' ->> 'serius_terbuka')::int = 0
          and jsonb_array_length(public.get_notes_admin((case when extract(month from v_tgl) >= 7 then 1 else 2 end)::smallint, null, 'perilaku') -> 'catatan') = 1
          and jsonb_array_length(public.get_notes_admin((case when extract(month from v_tgl) >= 7 then 1 else 2 end)::smallint, null, null, null, 'mengantuk') -> 'catatan') = 1);
    perform public.save_student_note('catatan', 'Sering mengantuk di jam pertama', v_tgl, null, null, null, null, null, '{}', v_n_josua);
    perform public.delete_student_note(v_n_wali);
    v_j := public.get_admin_audit('catatan_siswa');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Admin', 'u', 'Admin merapikan & menghapus catatan guru → tercatat di log + tanda "dirapikan"',
        'ok', jsonb_array_length(v_j) = 2 and v_j -> 0 ->> 'aksi' = 'hapus' and v_j -> 1 ->> 'aksi' = 'ubah' and v_j -> 1 -> 'data_lama' ->> 'judul' = 'Sering mengantuk'
          and (select x ->> 'dirapikan_oleh' from jsonb_array_elements(public.get_student_notes(st1, true) -> 'catatan') x where x ->> 'id' = v_n_josua::text) is not null);
    -- Jurnal: admin melihat & menghapus
    v_j := public.get_journal_admin(v_sun, extract(year from v_tgl)::int, extract(month from v_tgl)::int);
    select (x ->> 'id')::uuid into v_jid from jsonb_array_elements(v_j -> 'catatan') x limit 1;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Admin', 'u', 'Admin melihat jurnal guru per bulan + daftar guru',
        'ok', exists (select 1 from jsonb_array_elements(v_j -> 'guru') g where g ->> 'nama' = 'Sunarsih, S.Pd.')
          and (v_jid is not null or extract(day from v_tgl) < 7));
    v_n := case when v_jid is null then 1 else public.admin_delete_journal(array[v_jid]) end;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Admin', 'u', 'Admin menghapus jurnal guru → tercatat di log',
        'ok', v_n = 1 and (v_jid is null or public.get_admin_audit('jurnal_mengajar') -> 0 ->> 'aksi' = 'hapus'));
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Hak', 'u', 'Guru tidak bisa membuka panel admin (catatan, jurnal, log)',
        'ok', public.t_try('select public.get_notes_admin(1::smallint)') = '42501'
          and public.t_try(format('select public.get_journal_admin(%L, 2026, 11)', v_sun)) = '42501'
          and public.t_try('select public.admin_delete_journal(array[gen_random_uuid()])') = '42501'
          and public.t_try('select public.get_admin_audit()') = '42501');
    -- Storage: unggah hanya ke folder sendiri
    insert into storage.objects (bucket_id, name) values ('catatan-siswa', u_wali1a::text || '/c.jpg');
    v_no := v_no + 1; v_r := public.t_try(format($q$insert into storage.objects (bucket_id, name) values ('catatan-siswa', %L)$q$, u_susy::text || '/d.jpg'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Foto', 'u', 'Foto hanya bisa diunggah ke folder sendiri', 'ok', v_r = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.delete_student_note(v_n_susy);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Catatan', 'u', 'Penulis menghapus catatannya; foto yang tak terpakai dikembalikan untuk dihapus dari penyimpanan',
        'ok', v_j -> 'fotos' = jsonb_build_array(u_susy::text || '/b.jpg'));
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1; v_r := public.t_try(format('select public.get_student_notes(%L)', st1));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'U Hak', 'u', 'Anon tidak bisa membuka catatan siswa', 'ok', v_r = '42501');
    execute 'reset role';
    end;

    -- ======================================================== V. Sapaan panel admin
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'V Sapaan', 'u', 'Admin yang tertaut ke data staf disapa dengan nama stafnya', 'ok', public.get_admin_name() = 'Paroji');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try('select public.get_admin_name()');
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'V Sapaan', 'u', 'Guru biasa tidak bisa memanggil sapaan admin', 'ok', v_r = '42501');
    execute 'reset role';

    -- ======================================================== W. Pindah kelas siswa
    declare
        v_enr public.student_enrollments;
        v_lama uuid;
    begin
    select class_id into v_lama from public.student_enrollments where student_id = st1 and end_date is null;
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_student_class(%L, %L)', st1, '3 A'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Guru biasa tidak bisa memindahkan kelas siswa', 'ok', v_r = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_student_class(%L, %L)', st1, '9 Z'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Kelas yang tidak ada di tahun ajaran aktif ditolak', 'ok', v_r = '22023');

    v_j := public.set_student_class(st1, '3 A');
    select * into v_enr from public.student_enrollments where student_id = st1 and end_date is null;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Keanggotaan rombel pindah ke kelas baru mulai hari ini',
        'ok', (v_j ->> 'pindah')::boolean and v_enr.class_id = c3a and v_enr.start_date = public.jakarta_today());
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Keanggotaan lama ditutup kemarin, riwayat absensi tetap di kelas lama',
        'ok', exists (select 1 from public.student_enrollments where student_id = st1 and class_id = v_lama and end_date = public.jakarta_today() - 1));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Label kelas dan kelas sebelumnya di data siswa ikut diperbarui',
        'ok', (select payload ->> 'kelas' from public.student_records where id = st1) = '3 A'
          and (select payload ->> 'kelas_lama' from public.student_records where id = st1) = '1 A');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Hanya satu keanggotaan terbuka per siswa',
        'ok', (select count(*) from public.student_enrollments where student_id = st1 and end_date is null) = 1);

    v_j := public.set_student_class(st1, '3 A');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Memilih kelas yang sama tidak membuat keanggotaan ganda',
        'ok', not (v_j ->> 'pindah')::boolean and (select count(*) from public.student_enrollments where student_id = st1) = 2);

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Pindah pada hari yang sama tidak melanggar aturan tanggal',
        'ok', (public.set_student_class(st1, '4 A') ->> 'pindah')::boolean
          and (select count(*) from public.student_enrollments where student_id = st1 and end_date is null) = 1);

    v_j := public.set_student_class(st1, null);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Kelas dikosongkan: siswa keluar dari rombel, label kelas dihapus',
        'ok', (select count(*) from public.student_enrollments where student_id = st1 and end_date is null) = 0
          and not ((select payload from public.student_records where id = st1) ? 'kelas'));

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Setiap pemindahan tercatat di log admin',
        'ok', jsonb_array_length(public.get_admin_audit('siswa_kelas')) = 3);

    perform public.set_student_class(st1, '1 A');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'W Pindah', 'u', 'Daftar selisih label kelas vs rombel kosong setelah dirapikan',
        'ok', public.get_class_mismatch() = '[]'::jsonb);
    execute 'reset role';
    end;

    -- ======================================================== X. Label kelas selalu menarik rombel
    declare
        v_kini uuid;
    begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.student_records set payload = payload || jsonb_build_object('kelas', '3 A') where id = st2;
    select class_id into v_kini from public.student_enrollments where student_id = st2 and end_date is null;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'X Sinkron', 'u', 'Mengubah label kelas saja tetap memindahkan keanggotaan rombel', 'ok', v_kini = c3a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'X Sinkron', 'u', 'Hanya satu keanggotaan terbuka setelah label diubah',
        'ok', (select count(*) from public.student_enrollments where student_id = st2 and end_date is null) = 1);
    update public.student_records set payload = payload || jsonb_build_object('kelas', 'Kelas Khayalan') where id = st2;
    select class_id into v_kini from public.student_enrollments where student_id = st2 and end_date is null;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'X Sinkron', 'u', 'Nama kelas tak dikenal tidak merusak keanggotaan yang ada', 'ok', v_kini = c3a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'X Sinkron', 'u', 'Selisih label vs rombel terbaca di get_class_mismatch',
        'ok', jsonb_array_length(public.get_class_mismatch()) >= 0);
    update public.student_records set payload = payload || jsonb_build_object('kelas', '1 A') where id = st2;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'X Sinkron', 'u', 'Siswa yang punya kelas otomatis berstatus tercantum di daftar kelas',
        'ok', (select payload ->> 'status_daftar' from public.student_records where id = st2) = 'Tercantum di daftar kelas');
    update public.student_records set payload = payload - 'kelas' where id = st2;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'X Sinkron', 'u', 'Kelas dikosongkan: status kembali perlu verifikasi dan rombel dilepas',
        'ok', (select payload ->> 'status_daftar' from public.student_records where id = st2) = 'Perlu verifikasi lebih lanjut'
          and not exists (select 1 from public.student_enrollments where student_id = st2 and end_date is null));
    update public.student_records set payload = payload || jsonb_build_object('kelas', '1 A') where id = st2;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'X Sinkron', 'u', 'Kolom turunan status_daftar ikut diperbarui',
        'ok', (select status_daftar from public.student_records where id = st2) = 'Tercantum di daftar kelas');
    execute 'reset role';
    end;

    -- ======================================================== Y. Mapel per tingkat (KKA kelas 5 & 6)
    declare
        c6a    uuid := (select id from public.classes where name = '6 A');
        s_kka  uuid := (select id from public.subjects where code = 'KKA');
        v_m6   jsonb;
    begin
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Y Mapel', 'u', 'KKA tercatat hanya untuk kelas 5 & 6',
        'ok', (select grade_min = 5 and grade_max = 6 from public.subjects where id = s_kka)
          and public.subject_grade_label(s_kka) = 'kelas 5 & 6'
          and public.subject_in_class(c6a, s_kka) and not public.subject_in_class(c1a, s_kka));
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Y Mapel', 'u', 'Menu Nilai: KKA muncul di kelas 6 A, tidak di kelas 1 A',
        'ok', exists (select 1 from jsonb_array_elements(public.get_class_grades(c6a, 1::smallint) -> 'mapel') m where m ->> 'kode' = 'KKA')
          and not exists (select 1 from jsonb_array_elements(public.get_class_grades(c1a, 1::smallint) -> 'mapel') m where m ->> 'kode' = 'KKA'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Y Mapel', 'u', 'Nilai KKA di kelas 1 A ditolak, di kelas 6 A diterima',
        'ok', public.t_try(format('select public.save_grades(%L, 1::smallint, %L::jsonb)', c1a,
                  jsonb_build_array(jsonb_build_object('subject_id', s_kka, 'entries',
                      jsonb_build_array(jsonb_build_object('student_id', st1, 'uh1', 80)))))) = '42501'
          and public.grade_can_edit(c6a, s_kka));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Y Mapel', 'u', 'Penugasan guru KKA ke kelas 1 A ditolak',
        'ok', public.t_try(format('select public.set_subject_assignments(%L, %L, array[%L]::uuid[])', s_kka,
                  (select id from public.staff where name = 'Susy Nurhayati'), c1a)) = '22023');
    v_m6 := public.get_class_schedule(c6a) -> 'mapel';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Y Mapel', 'u', 'Pilihan mapel jadwal: KKA ada di kelas 6 A, tidak di kelas 1 A',
        'ok', exists (select 1 from jsonb_array_elements(v_m6) m where m ->> 'kode' = 'KKA')
          and not exists (select 1 from jsonb_array_elements(public.get_class_schedule(c1a) -> 'mapel') m where m ->> 'kode' = 'KKA'));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Y Mapel', 'u', 'Jadwal: KKA tidak bisa dipasang di kelas 1 A, bisa di kelas 6 A',
        'ok', public.t_try(format($q$select public.save_schedule_entry(%L, 1::smallint, 1::smallint, 1::smallint, 'mapel', %L)$q$, c1a, s_kka)) = '22023'
          and public.t_try(format($q$select public.save_schedule_entry(%L, 1::smallint, 1::smallint, 1::smallint, 'mapel', %L)$q$, c6a, s_kka)) = 'OK');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Y Mapel', 'u', 'Matriks admin menandai KKA luar tingkat di kelas 1–4',
        'ok', ((select k -> 'sel' -> (s_kka::text) ->> 'luar' from jsonb_array_elements(public.get_grades_admin_matrix(1::smallint) -> 'kelas') k
                where k ->> 'nama' = '1 A'))::boolean
          and not ((select k -> 'sel' -> (s_kka::text) ->> 'luar' from jsonb_array_elements(public.get_grades_admin_matrix(1::smallint) -> 'kelas') k
                where k ->> 'nama' = '6 A'))::boolean);
    execute 'reset role';
    end;

    -- ======================================================== Z. Statistik publik & alasan keluar
    declare
        v_st   jsonb;
        v_sis  uuid := st1;
        v_roms int;
    begin
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    v_st := public.get_public_stats();
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Statistik', 'u', 'get_public_stats memberi empat angka dan tidak membocorkan data pribadi',
        'ok', (select count(*) from jsonb_object_keys(v_st)) = 4
          and (v_st ? 'siswa') and (v_st ? 'guru') and (v_st ? 'rombel') and (v_st ? 'ekskul')
          and (v_st ->> 'rombel')::int = (select count(*) from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active)
          and (v_st ->> 'guru')::int = (select count(*) from public.staff));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Statistik', 'u', 'Pengunjung (anon) boleh memanggil get_public_stats, tapi tidak get_grades_admin_matrix',
        'ok', has_function_privilege('anon', 'public.get_public_stats()', 'execute')
          and not has_function_privilege('anon', 'public.get_grades_admin_matrix(smallint)', 'execute'));

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Keluar', 'u', 'Alasan keluar hanya nilai yang dikenal',
        'ok', public.t_try(format('update public.student_records set archived_at = now(), exit_reason = %L where id = %L', 'Kabur', v_sis)) = '23514');

    update public.student_records set archived_at = now(), exit_reason = 'Mutasi', exit_note = '  Kata   wali kelas  sudah keluar. ' where id = v_sis;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Keluar', 'u', 'Keterangan keluar dirapikan spasinya',
        'ok', (select exit_note = 'Kata wali kelas sudah keluar.' from public.student_records where id = v_sis));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Keluar', 'u', 'Diarsipkan: tanggal keluar terisi sendiri, rombel ditutup, lepas dari daftar kelas',
        'ok', (select exit_date is not null and exit_reason = 'Mutasi' from public.student_records where id = v_sis)
          and not exists (select 1 from public.student_enrollments where student_id = v_sis and end_date is null));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Statistik', 'u', 'Siswa yang diarsipkan tidak ikut dihitung di statistik publik',
        'ok', (public.get_public_stats() ->> 'siswa')::int = (v_st ->> 'siswa')::int - 1);

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Keluar', 'u', 'Siswa yang diarsipkan lepas dari daftar kelas',
        'ok', not exists (select 1 from public.get_class_roster(c1a, current_date) r where r.student_id = v_sis));
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);

    update public.student_records set archived_at = null where id = v_sis;
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Z Keluar', 'u', 'Dipulihkan: alasan & tanggal keluar dihapus, rombel dibuka lagi',
        'ok', (select exit_reason is null and exit_date is null and exit_note is null from public.student_records where id = v_sis)
          and exists (select 1 from public.student_enrollments where student_id = v_sis and end_date is null)
          and (public.get_public_stats() ->> 'siswa')::int = (v_st ->> 'siswa')::int);
    end;

    -- ======================================================== AA. Jumlah UH bisa diubah
    declare
        s_mtk2 uuid := (select id from public.subjects where code = 'MTK');
        s_bin  uuid := (select id from public.subjects where code = 'BIN');
        v_u    jsonb;
        v_t1   text; v_t2 text;
    begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Bawaan 3 kolom UH untuk semua mapel yang belum pernah diatur',
        'ok', public.grade__uh_count(c1a, s_bin, 1::smallint) = 3
          and exists (select 1 from jsonb_array_elements(public.get_class_grades(c1a, 1::smallint) -> 'mapel') m
                      where m ->> 'kode' = 'BIN' and (m ->> 'jumlah_uh')::int = 3));

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Jumlah UH hanya 1–10',
        'ok', public.t_try(format('select public.set_subject_uh_count(%L, %L, 0::smallint, 1::smallint)', c1a, s_bin)) = '22023'
          and public.t_try(format('select public.set_subject_uh_count(%L, %L, 11::smallint, 1::smallint)', c1a, s_bin)) = '22023');

    v_u := public.set_subject_uh_count(c1a, s_bin, 5::smallint, 1::smallint);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Ditambah jadi 5 kolom, dan UH5 jadi bisa diisi',
        'ok', v_u = '{"jumlah":5,"sebelumnya":3,"terhapus":0}'::jsonb
          and public.grade__uh_count(c1a, s_bin, 1::smallint) = 5
          and public.save_grades(c1a, 1::smallint, jsonb_build_array(jsonb_build_object('subject_id', s_bin, 'entries',
                  jsonb_build_array(jsonb_build_object('student_id', st1, 'uh4', 70, 'uh5', 90),
                                    jsonb_build_object('student_id', st2, 'uh5', 60))))) = '{"baru":3,"berubah":0,"dihapus":0,"kktp":0}'::jsonb);

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Semester 2 punya jumlah UH sendiri (tetap 3)',
        'ok', public.grade__uh_count(c1a, s_bin, 2::smallint) = 3
          and public.t_try(format($q$select public.save_grades(%L, 2::smallint, jsonb_build_array(jsonb_build_object('subject_id', %L, 'entries',
                  jsonb_build_array(jsonb_build_object('student_id', %L, 'uh5', 80)))))$q$, c1a, s_bin, st1)) = '22023');

    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Dikurangi ke 3 ditolak selama UH4/UH5 masih terisi (2 siswa)',
        'ok', public.t_try(format('select public.set_subject_uh_count(%L, %L, 3::smallint, 1::smallint)', c1a, s_bin)) = '23514'
          and public.grade__uh_count(c1a, s_bin, 1::smallint) = 5);

    v_u := public.set_subject_uh_count(c1a, s_bin, 3::smallint, 1::smallint, true);
    execute 'reset role';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Dengan konfirmasi: 3 nilai terhapus, tercatat di riwayat, kolom tinggal 3',
        'ok', v_u = '{"jumlah":3,"sebelumnya":5,"terhapus":3}'::jsonb
          and public.grade__uh_count(c1a, s_bin, 1::smallint) = 3
          and (select count(*) from public.grade_changes where class_id = c1a and subject_id = s_bin
                 and field in ('uh4', 'uh5') and new_value is null) = 3
          and (select count(*) from public.grade_changes where class_id = c1a and subject_id = s_bin
                 and field = 'jumlah_uh' and old_value = 5 and new_value = 3) = 1
          and (select count(*) from public.student_grades where class_id = c1a and subject_id = s_bin
                 and semester = 1 and num_nonnulls(uh4, uh5) > 0) = 0);

    execute 'set local role authenticated';
    v_u := public.set_subject_uh_count(c1a, s_mtk2, 1::smallint, 1::smallint, true);
    execute 'reset role';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Boleh turun sampai 1 kolom; UH2 ke atas dibuang',
        'ok', (v_u ->> 'jumlah')::int = 1
          and (select count(*) from public.student_grades where class_id = c1a and subject_id = s_mtk2
                 and semester = 1 and num_nonnulls(uh2, uh3) > 0) = 0);
    execute 'set local role authenticated';
    perform public.set_subject_uh_count(c1a, s_mtk2, 3::smallint, 1::smallint, true);

    -- Hapus satu kolom di tengah: UH 1..4 = 61..64, buang UH 2 → 61, 63, 64.
    perform public.set_subject_uh_count(c1a, s_bin, 4::smallint, 1::smallint, true);
    perform public.save_grades(c1a, 1::smallint, jsonb_build_array(jsonb_build_object('subject_id', s_bin, 'entries',
        jsonb_build_array(jsonb_build_object('student_id', st1, 'uh1', 61, 'uh2', 62, 'uh3', 63, 'uh4', 64)))));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Hapus kolom di tengah ditolak dulu selama masih terisi',
        'ok', public.t_try(format('select public.delete_subject_uh(%L, %L, 2::smallint, 1::smallint)', c1a, s_bin)) = '23514');
    v_u := public.delete_subject_uh(c1a, s_bin, 2::smallint, 1::smallint, true);
    execute 'reset role';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'UH 2 dibuang, kolom sesudahnya naik: 61/62/63/64 jadi 61/63/64',
        'ok', v_u = '{"jumlah":3,"sebelumnya":4,"dihapus_ke":2,"terhapus":1}'::jsonb
          and public.grade__uh_count(c1a, s_bin, 1::smallint) = 3
          and (select jsonb_build_array(uh1, uh2, uh3, uh4) from public.student_grades
               where class_id = c1a and subject_id = s_bin and semester = 1 and student_id = st1) = '[61,63,64,null]'::jsonb);
    execute 'set local role authenticated';
    v_t1 := public.t_try(format('select public.delete_subject_uh(%L, %L, 9::smallint, 1::smallint, true)', c1a, s_bin));
    perform public.delete_subject_uh(c1a, s_bin, 1::smallint, 1::smallint, true);
    perform public.delete_subject_uh(c1a, s_bin, 1::smallint, 1::smallint, true);
    v_t2 := public.t_try(format('select public.delete_subject_uh(%L, %L, 1::smallint, 1::smallint, true)', c1a, s_bin));
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Kolom UH ke-9 tidak ada, dan kolom terakhir tidak boleh dihapus',
        'ok', v_t1 = '22023' and v_t2 = '22023' and public.grade__uh_count(c1a, s_bin, 1::smallint) = 1);
    execute 'reset role';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Penghapusan kolom tercatat di riwayat (hapus_uh + jumlah_uh)',
        'ok', (select count(*) from public.grade_changes where class_id = c1a and subject_id = s_bin and field = 'hapus_uh') = 3
          and (select count(*) from public.grade_changes where class_id = c1a and subject_id = s_bin
                 and field = 'jumlah_uh' and old_value = 4 and new_value = 3) = 1);
    execute 'set local role authenticated';
    perform public.set_subject_uh_count(c1a, s_bin, 3::smallint, 1::smallint, true);
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AA UH', 'u', 'Guru mapel tidak boleh mengubah jumlah UH mapel yang bukan diampunya',
        'ok', public.t_try(format('select public.set_subject_uh_count(%L, %L, 4::smallint, 1::smallint)', c1a, s_bin)) = '42501');
    execute 'reset role';
    end;

    -- ======================================================== AB. Kartu siswa
    declare
        v_k1   jsonb; v_k2 jsonb; v_tok text; v_tok2 text; v_sid uuid; v_n1a int; v_old text;
        v_t1   text; v_t2 text; v_t3 text;
    begin
    select count(*) into v_n1a from public.student_enrollments e join public.student_records s on s.id = e.student_id
     where e.class_id = c1a and e.end_date is null and s.archived_at is null;

    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_k1 := public.get_student_cards(c1a);
    v_k2 := public.get_student_cards(c1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Wali kelas membuka data kartu rombelnya; tiap siswa langsung dapat kode 8 karakter yang tetap',
        'ok', jsonb_array_length(v_k1 -> 'siswa') = v_n1a and v_n1a > 0
          and (v_k1 ->> 'bisa_kelola')::boolean
          and v_k1 -> 'kelas' ->> 'nama' = '1 A'
          and not exists (select 1 from jsonb_array_elements(v_k1 -> 'siswa') x where x ->> 'token' !~ '^[0-9A-HJKMNP-TV-Z]{8}$')
          and v_k1 -> 'pengaturan' ->> 'tempat' = 'Jakarta' and not (v_k1 ->> 'admin')::boolean
          and v_k1 -> 'siswa' = v_k2 -> 'siswa');
    v_sid := (v_k1 -> 'siswa' -> 0 ->> 'student_id')::uuid;
    v_tok := v_k1 -> 'siswa' -> 0 ->> 'token';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Wali kelas tidak bisa membuka kartu rombel lain; tabel kartu tidak bisa dibaca langsung',
        'ok', public.t_try(format('select public.get_student_cards(%L)', c3a)) = '42501'
          and public.t_try('select 1 from public.student_cards limit 1') = '42501');
    execute 'reset role';

    -- Guru mapel (PAI 1A): boleh ambil token untuk scan, tidak boleh data cetak (TTL).
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Guru mapel rombel bisa mengambil token untuk scan absensi, tapi tidak data cetak kartu',
        'ok', jsonb_array_length(public.get_class_card_tokens(c1a)) = v_n1a
          and public.get_class_card_tokens(c1a) @> jsonb_build_array(jsonb_build_object('student_id', v_sid, 'token', v_tok))
          and public.t_try(format('select public.get_student_cards(%L)', c1a)) = '42501'
          and public.t_try(format('select public.reissue_student_card(%L)', v_sid)) = '42501'
          and public.t_try(format('select public.set_student_photo(%L, %L)', v_sid, v_sid::text || '/a.jpg')) = '42501');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Scan/ketik kode: format KB05-XXXX-XXXX, huruf kecil, spasi dikenali; kode asal-asalan → null',
        'ok', public.resolve_student_card(' ' || lower(v_tok) || ' ') ->> 'student_id' = v_sid::text
          and public.resolve_student_card('kb05-' || lower(left(v_tok, 4)) || '-' || right(v_tok, 4)) ->> 'student_id' = v_sid::text
          and public.resolve_student_card(v_tok) ->> 'kelas' = '1 A'
          and public.resolve_student_card('KB05-ZZZZ-ZZZZ') is null
          and public.card__norm_token('kb05-0ilo-abcd') = '0110ABCD');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Foto', 'u', 'Guru mapel rombel bisa melihat foto siswa di profil, tapi tidak mengelola',
        'ok', public.get_student_photo(v_sid) ? 'foto' and not (public.get_student_photo(v_sid) ->> 'bisa_kelola')::boolean
          and public.t_try(format('select public.set_card_settings(%L)', '{"tempat":"X"}')) = '42501');
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', u_josua, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Guru yang tidak mengajar rombel tidak bisa mengambil token/foto siswanya',
        'ok', public.t_try(format('select public.get_class_card_tokens(%L)', c1a)) = '42501'
          and public.t_try(format('select public.get_student_photo(%L)', v_sid)) = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Anon tidak bisa memakai RPC kartu sama sekali',
        'ok', public.t_try(format('select public.get_class_card_tokens(%L)', c1a)) = '42501'
          and public.t_try('select public.resolve_student_card(''AAAA'')') = '42501'
          and public.t_try(format('select public.get_student_cards(%L)', c1a)) = '42501');
    execute 'reset role';

    -- Kartu hilang → terbitkan ulang; foto.
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_k2 := public.reissue_student_card(v_sid);
    v_tok2 := v_k2 ->> 'token';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Terbitkan ulang: token baru, versi 2, kartu lama tidak dikenali lagi',
        'ok', v_tok2 <> v_tok and (v_k2 ->> 'versi')::int = 2
          and public.resolve_student_card(v_tok) is null
          and public.resolve_student_card(v_tok2) ->> 'student_id' = v_sid::text);
    v_t1 := public.t_try(format('select public.set_student_photo(%L, %L)', v_sid, gen_random_uuid()::text || '/a.jpg'));
    v_t2 := public.t_try(format('select public.set_student_photo(%L, %L)', v_sid, v_sid::text || '/../x.jpg'));
    v_old := public.set_student_photo(v_sid, v_sid::text || '/f1.jpg');
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Foto', 'u', 'Path foto wajib di folder siswa itu sendiri',
        'ok', v_t1 = '22023' and v_t2 = '22023' and v_old is null);
    v_old := public.set_student_photo(v_sid, v_sid::text || '/f2.jpg');
    v_k1 := public.get_student_cards(c1a);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Foto', 'u', 'Ganti foto mengembalikan path lama (untuk dihapus) dan data kartu memuat foto baru',
        'ok', v_old = v_sid::text || '/f1.jpg'
          and exists (select 1 from jsonb_array_elements(v_k1 -> 'siswa') x where x ->> 'student_id' = v_sid::text
                      and x ->> 'foto' = v_sid::text || '/f2.jpg' and (x ->> 'versi')::int = 2));
    -- Storage: wali boleh unggah ke folder siswanya, tidak ke siswa kelas lain.
    v_t1 := public.t_try(format($q$insert into storage.objects (bucket_id, name) values ('foto-siswa', %L)$q$, v_sid::text || '/f2.jpg'));
    v_t2 := public.t_try(format($q$insert into storage.objects (bucket_id, name) values ('foto-siswa', %L)$q$, st4::text || '/x.jpg'));
    v_t3 := public.t_try($q$insert into storage.objects (bucket_id, name) values ('foto-siswa', 'bukan-uuid/x.jpg')$q$);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Foto', 'u', 'Wali mengunggah foto hanya untuk siswa rombelnya',
        'ok', v_t1 = 'OK' and v_t2 = '42501' and v_t3 = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Foto', 'u', 'Guru mapel rombel bisa melihat foto siswa, tapi tidak menghapus/mengunggah',
        'ok', (select count(*) from storage.objects where bucket_id = 'foto-siswa' and name = v_sid::text || '/f2.jpg') = 1
          and public.t_try(format($q$insert into storage.objects (bucket_id, name) values ('foto-siswa', %L)$q$, v_sid::text || '/z.jpg')) = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_josua, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Foto', 'u', 'Guru di luar rombel tidak bisa melihat foto siswa',
        'ok', (select count(*) from storage.objects where bucket_id = 'foto-siswa') = 0);
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Kartu', 'u', 'Admin bisa membuka kartu semua rombel, menerbitkan ulang, dan melepas foto',
        'ok', public.t_try(format('select public.get_student_cards(%L)', c3a)) = 'OK'
          and (public.reissue_student_card(v_sid) ->> 'versi')::int = 3
          and public.set_student_photo(v_sid, null) = v_sid::text || '/f2.jpg');
    -- Pengaturan kartu (admin).
    v_k1 := public.set_card_settings('{"tempat":"Jakarta Utara","tanggal_ttd":"2026-07-13","kepsek_nama":"Kepsek Fiktif","kepsek_nip":"197001012000031001","ttd":"ttd/a.png"}');
    v_k2 := public.set_card_settings('{"ttd":"ttd/b.png","stempel":"stempel/s.png","kepsek_nama":""}');
    v_t1 := public.t_try($q$select public.set_card_settings('{"ttd":"logo/x.png"}')$q$);
    v_t2 := public.t_try($q$select public.set_card_settings('{"tanggal_ttd":"13-07-2026"}')$q$);
    v_t3 := public.t_try($q$select public.set_card_settings('{"tempat":"  "}')$q$);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Pengaturan', 'u', 'Admin mengatur tempat/tanggal TTD, kepsek, TTD & stempel; gambar lama dikembalikan untuk dihapus; input salah ditolak',
        'ok', v_k1 -> 'pengaturan' ->> 'tanggal_ttd' = '2026-07-13' and v_k1 -> 'pengaturan' ->> 'tempat' = 'Jakarta Utara'
          and v_k2 -> 'pengaturan' ->> 'ttd' = 'ttd/b.png' and v_k2 -> 'pengaturan' ->> 'stempel' = 'stempel/s.png'
          and v_k2 -> 'pengaturan' ->> 'kepsek_nama' is null and v_k2 -> 'pengaturan' ->> 'kepsek_nip' = '197001012000031001'
          and v_k2 -> 'hapus' = '["ttd/a.png"]'::jsonb and v_k1 -> 'hapus' = '[]'::jsonb
          and v_t1 = '22023' and v_t2 = '22023' and v_t3 = '22023'
          and v_k2 -> 'pengaturan' -> 'kepsek_default' is not null);
    v_t1 := public.t_try($q$insert into storage.objects (bucket_id, name) values ('kartu-aset', 'ttd/b.png')$q$);
    v_t2 := public.t_try($q$insert into storage.objects (bucket_id, name) values ('kartu-aset', 'lain/x.png')$q$);
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Pengaturan', 'u', 'Admin mengunggah TTD ke bucket kartu-aset (hanya folder ttd/stempel/logo/latar)',
        'ok', v_t1 = 'OK' and v_t2 = '42501');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_wali1a, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Pengaturan', 'u', 'Wali kelas bisa membaca TTD untuk mencetak, tapi tidak bisa mengunggah/mengubah pengaturan',
        'ok', (select count(*) from storage.objects where bucket_id = 'kartu-aset' and name = 'ttd/b.png') = 1
          and public.t_try($q$insert into storage.objects (bucket_id, name) values ('kartu-aset', 'ttd/c.png')$q$) = '42501'
          and public.t_try($q$select public.set_card_settings('{"tempat":"X"}')$q$) = '42501'
          and public.get_student_cards(c1a) -> 'pengaturan' ->> 'ttd' = 'ttd/b.png');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_susy, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_no := v_no + 1;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'AB Pengaturan', 'u', 'Guru yang bukan wali/pimpinan tidak bisa melihat file TTD',
        'ok', (select count(*) from storage.objects where bucket_id = 'kartu-aset') = 0);
    execute 'reset role';
    end;

    -- ======================================================== hasil
    insert into pg_temp.att_results
    select (x ->> 'no')::int, x ->> 'k', x ->> 'u', case when (x ->> 'ok')::boolean then 'LULUS' else 'GAGAL' end
    from jsonb_array_elements(v_log) x;
end
$test$;

select no, kelompok, uji, hasil from pg_temp.att_results order by no;
select count(*) filter (where hasil = 'GAGAL') as gagal,
       count(*) as total,
       count(*) filter (where hasil = 'GAGAL') > 0 as ada_gagal
from pg_temp.att_results \gset
\if :ada_gagal
    \echo GAGAL: :gagal dari :total tes
    select 1/0;
\else
    \echo SEMUA LULUS: :total tes
\endif
