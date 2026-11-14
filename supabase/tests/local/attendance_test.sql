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
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Profil', 'u', 'Profil tanpa NIK, KK, NIK ayah, penghasilan',
        'ok', position('9900000000000101' in v_j::text) = 0
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
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'PIN lemah ditolak (123456, 111111, 121212, 987654, 12345)',
        'ok', public.recovery_pin_is_weak('123456') and public.recovery_pin_is_weak('111111') and public.recovery_pin_is_weak('121212')
          and public.recovery_pin_is_weak('987654') and public.recovery_pin_is_weak('12345') and public.recovery_pin_is_weak('12a456')
          and not public.recovery_pin_is_weak('483920'));
    v_no := v_no + 1; v_r := public.t_try(format('select public.set_recovery_pin(%L, %L)', u_wali1a, '123456'));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'L PIN', 'u', 'set_recovery_pin menolak PIN lemah', 'ok', v_r = '22023');
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
