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

    select max(g)::date into v_d from generate_series(public.jakarta_today() - 7, public.jakarta_today(), interval '1 day') g
        where extract(isodow from g) not in (6, 7);
    select max(g)::date into v_sat from generate_series(public.jakarta_today() - 7, public.jakarta_today() - 1, interval '1 day') g
        where extract(isodow from g) = 6;
    select min(g)::date into v_old from (
        select g from generate_series(public.jakarta_today() - 20, public.jakarta_today() - 1, interval '1 day') g
        where extract(isodow from g) not in (6, 7) order by g desc limit 5) x;

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
    v_no := v_no + 1; v_r := public.t_try(format('select public.save_attendance(%L, %L, %L, null, %L)', c1a, v_old, 'harian', e_1a));
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'D Wali 1A', 'u', 'Lebih dari 3 hari sekolah lalu ditolak', 'ok', v_r = '42501');

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
