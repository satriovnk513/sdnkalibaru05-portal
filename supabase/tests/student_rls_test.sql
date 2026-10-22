-- =============================================================================
-- Tes RLS Modul Data Siswa — SDN Kalibaru 05
--
-- Jalankan di Supabase SQL Editor SETELAH migration
-- 20261022000001_student_information_system.sql.
--
-- Seluruh tes ada dalam satu blok DO. Data uji FIKTIF (NIK berawalan 99,
-- kode provinsi yang tidak ada) disisipkan, diuji, lalu dihapus di akhir blok.
-- Jika ada satu tes gagal, blok berhenti dengan pesan "GAGAL ..." dan SEMUA
-- perubahan dibatalkan otomatis, termasuk data uji.
--
-- Hasil yang diharapkan: tabel berisi daftar tes, semuanya "LULUS".
--
-- Tes memakai uid admin pertama dari public.user_roles untuk mensimulasikan
-- session admin (hanya di dalam transaksi ini, lewat request.jwt.claims), dan
-- uid acak yang tidak ada di user_roles untuk mensimulasikan user non-admin.
-- =============================================================================

drop table if exists pg_temp.student_rls_test_results;
create temp table student_rls_test_results (
    no        integer,
    kelompok  text,
    uji       text,
    hasil     text
);

do $test$
declare
    c_nik_a     constant text := '9900000000000001';  -- fiktif, tercantum
    c_nik_b     constant text := '9900000000000002';  -- fiktif, perlu verifikasi
    c_nik_c     constant text := '9900000000000003';  -- fiktif, dipakai uji tulis admin
    c_kelas     constant text := 'UJI-RLS';
    v_admin     uuid;
    v_nonadmin  uuid := gen_random_uuid();
    v_batch     uuid;
    v_count     bigint;
    v_rows      bigint;
    v_sum       record;
    v_direct    record;
    v_log       jsonb := '[]'::jsonb;
    v_no        integer := 0;
begin
    -- ---------------------------------------------------------------- persiapan
    execute 'set local role service_role';

    select ur.user_id into v_admin
    from public.user_roles ur
    where ur.role = 'admin'
    order by ur.user_id
    limit 1;

    if v_admin is null then
        raise exception 'GAGAL persiapan: tidak ada baris admin di public.user_roles';
    end if;

    if exists (select 1 from public.student_records where nik in (c_nik_a, c_nik_b, c_nik_c)) then
        raise exception 'GAGAL persiapan: NIK uji fiktif sudah ada di tabel; hentikan dan periksa';
    end if;

    insert into public.student_import_batches (source_name, source_hash, record_count, listed_count, review_count)
    values ('UJI-RLS-FIKTIF', md5(random()::text) || md5(random()::text), 2, 1, 1)
    returning id into v_batch;

    insert into public.student_records
        (nik, nama_siswa, nipd, nisn, kelas, nama_ibu_kandung, status_daftar, payload,
         field_sources, matching_notes, source_names, import_batch_id)
    values
        (c_nik_a, 'Siswa Fiktif Satu', '9901', '9900000001', c_kelas, 'Ibu Fiktif Satu',
         'Tercantum di daftar kelas',
         '{"nama_siswa":"Siswa Fiktif Satu","anggota_keluarga_jumlah":"3"}',
         '{"nama_siswa":"KJP"}', '["Data uji fiktif"]', '["KJP","Daftar kelas"]', v_batch),
        (c_nik_b, 'Siswa Fiktif Dua', null, null, null, 'Ibu Fiktif Dua',
         'Perlu verifikasi lebih lanjut',
         '{"nama_siswa":"Siswa Fiktif Dua"}',
         null, null, '["Dapodik"]', v_batch);

    execute 'reset role';

    -- ------------------------------------------------- A. struktur & hak akses
    v_no := v_no + 1;
    if not exists (select 1 from pg_class
                   where oid = 'public.student_records'::regclass
                     and relrowsecurity and relforcerowsecurity)
       or not exists (select 1 from pg_class
                   where oid = 'public.student_import_batches'::regclass
                     and relrowsecurity and relforcerowsecurity) then
        raise exception 'GAGAL A%: RLS belum aktif/forced pada tabel siswa', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'RLS aktif dan FORCE pada kedua tabel');

    v_no := v_no + 1;
    select count(*) into v_count
    from pg_policies
    where schemaname = 'public'
      and tablename in ('student_records', 'student_import_batches')
      and (roles && array['anon', 'public']::name[]);
    if v_count <> 0 then
        raise exception 'GAGAL A%: ada % policy untuk anon/public', v_no, v_count;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'Tidak ada policy untuk anon/public');

    v_no := v_no + 1;
    if has_table_privilege('anon', 'public.student_records', 'SELECT')
       or has_table_privilege('anon', 'public.student_records', 'INSERT')
       or has_table_privilege('anon', 'public.student_records', 'UPDATE')
       or has_table_privilege('anon', 'public.student_records', 'DELETE')
       or has_table_privilege('anon', 'public.student_import_batches', 'SELECT')
       or has_table_privilege('anon', 'public.student_import_batches', 'INSERT')
       or has_table_privilege('anon', 'public.student_import_batches', 'UPDATE')
       or has_table_privilege('anon', 'public.student_import_batches', 'DELETE')
       or has_function_privilege('anon', 'public.student_summary()', 'EXECUTE') then
        raise exception 'GAGAL A%: anon masih punya grant pada tabel/RPC siswa', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'anon tanpa grant SELECT/INSERT/UPDATE/DELETE/EXECUTE');

    v_no := v_no + 1;
    if has_table_privilege('authenticated', 'public.student_import_batches', 'INSERT')
       or has_table_privilege('authenticated', 'public.student_import_batches', 'UPDATE')
       or has_table_privilege('authenticated', 'public.student_import_batches', 'DELETE') then
        raise exception 'GAGAL A%: authenticated bisa menulis student_import_batches', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'student_import_batches tidak bisa ditulis user login');

    v_no := v_no + 1;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'student_summary' and p.prosecdef) then
        raise exception 'GAGAL A%: student_summary() bukan SECURITY INVOKER', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'student_summary() SECURITY INVOKER');

    -- ------------------------------------------------------------- B. anon
    v_no := v_no + 1;
    begin
        execute 'set local role anon';
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        perform count(*) from public.student_records;
        raise exception 'GAGAL B%: anon bisa membaca student_records', v_no;
    exception when insufficient_privilege then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'SELECT student_records ditolak');

    v_no := v_no + 1;
    begin
        execute 'set local role anon';
        perform count(*) from public.student_import_batches;
        raise exception 'GAGAL B%: anon bisa membaca student_import_batches', v_no;
    exception when insufficient_privilege then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'SELECT student_import_batches ditolak');

    v_no := v_no + 1;
    begin
        execute 'set local role anon';
        insert into public.student_records (nik, nama_siswa, status_daftar, payload)
        values ('9900000000000009', 'Fiktif Anon', 'Perlu verifikasi lebih lanjut', '{}');
        raise exception 'GAGAL B%: anon bisa INSERT', v_no;
    exception when insufficient_privilege then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'INSERT ditolak');

    v_no := v_no + 1;
    begin
        execute 'set local role anon';
        update public.student_records set nama_siswa = 'x' where nik = c_nik_a;
        raise exception 'GAGAL B%: anon bisa UPDATE', v_no;
    exception when insufficient_privilege then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'UPDATE ditolak');

    v_no := v_no + 1;
    begin
        execute 'set local role anon';
        delete from public.student_records where nik = c_nik_a;
        raise exception 'GAGAL B%: anon bisa DELETE', v_no;
    exception when insufficient_privilege then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'DELETE ditolak');

    v_no := v_no + 1;
    begin
        execute 'set local role anon';
        perform * from public.student_summary();
        raise exception 'GAGAL B%: anon bisa memanggil student_summary()', v_no;
    exception when insufficient_privilege then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'RPC student_summary() ditolak');

    -- ------------------------------------------------ C. login non-admin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
        json_build_object('sub', v_nonadmin, 'role', 'authenticated')::text, true);

    v_no := v_no + 1;
    select count(*) into v_count from public.student_records;
    if v_count <> 0 then
        raise exception 'GAGAL C%: non-admin melihat % baris siswa', v_no, v_count;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'SELECT student_records = 0 baris');

    v_no := v_no + 1;
    select count(*) into v_count from public.student_import_batches;
    if v_count <> 0 then
        raise exception 'GAGAL C%: non-admin melihat % batch impor', v_no, v_count;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'SELECT student_import_batches = 0 baris');

    v_no := v_no + 1;
    begin
        insert into public.student_records (nik, nama_siswa, status_daftar, payload)
        values ('9900000000000008', 'Fiktif Non Admin', 'Perlu verifikasi lebih lanjut', '{}');
        raise exception 'GAGAL C%: non-admin bisa INSERT', v_no;
    exception when insufficient_privilege then null;  -- RLS violation = 42501
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'INSERT ditolak RLS');

    v_no := v_no + 1;
    update public.student_records set nama_siswa = 'Diubah Non Admin' where nik = c_nik_a;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
        raise exception 'GAGAL C%: non-admin mengubah % baris', v_no, v_rows;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'UPDATE mengenai 0 baris');

    v_no := v_no + 1;
    delete from public.student_records where nik in (c_nik_a, c_nik_b);
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
        raise exception 'GAGAL C%: non-admin menghapus % baris', v_no, v_rows;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'DELETE mengenai 0 baris');

    v_no := v_no + 1;
    select * into v_sum from public.student_summary();
    if v_sum.total_siswa <> 0 or v_sum.jumlah_rombel <> 0 or cardinality(v_sum.daftar_kelas) <> 0 then
        raise exception 'GAGAL C%: student_summary() bocor ke non-admin', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'student_summary() = 0 dan kelas kosong');

    -- ----------------------------------------------------------- D. admin
    perform set_config('request.jwt.claims',
        json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    v_no := v_no + 1;
    select count(*) into v_count from public.student_records where nik in (c_nik_a, c_nik_b);
    if v_count <> 2 then
        raise exception 'GAGAL D%: admin hanya melihat % dari 2 siswa fiktif', v_no, v_count;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin', 'u', 'SELECT melihat 2 siswa fiktif');

    v_no := v_no + 1;
    select nama_siswa, nipd, nisn, nama_ibu_kandung, source_names into v_direct
    from public.student_records where nik = c_nik_a;
    if v_direct.nama_siswa <> 'Siswa Fiktif Satu' or v_direct.nisn <> '9900000001'
       or v_direct.source_names <> '["KJP","Daftar kelas"]'::jsonb then
        raise exception 'GAGAL D%: nilai yang dibaca admin tidak sama dengan yang disimpan', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin', 'u', 'Nilai identitas dibaca utuh sebagai text');

    v_no := v_no + 1;
    select count(*) into v_count from public.student_import_batches where id = v_batch;
    if v_count <> 1 then
        raise exception 'GAGAL D%: admin tidak bisa membaca batch impor', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin', 'u', 'SELECT student_import_batches berhasil');

    v_no := v_no + 1;
    begin
        insert into public.student_import_batches (source_name, source_hash, record_count, listed_count, review_count)
        values ('UJI-ADMIN', md5(random()::text) || md5(random()::text), 0, 0, 0);
        raise exception 'GAGAL D%: admin browser bisa menulis student_import_batches', v_no;
    exception when insufficient_privilege then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin', 'u', 'INSERT student_import_batches ditolak (khusus importer)');

    v_no := v_no + 1;
    select * into v_sum from public.student_summary();
    select
        count(*) as total,
        count(*) filter (where status_daftar = 'Tercantum di daftar kelas') as tercantum,
        count(*) filter (where status_daftar = 'Perlu verifikasi lebih lanjut') as review,
        count(distinct kelas) filter (where status_daftar = 'Tercantum di daftar kelas'
                                        and nullif(btrim(kelas), '') is not null) as rombel
    into v_direct
    from public.student_records;
    if v_sum.total_siswa <> v_direct.total or v_sum.tercantum <> v_direct.tercantum
       or v_sum.perlu_verifikasi <> v_direct.review or v_sum.jumlah_rombel <> v_direct.rombel
       or v_sum.total_siswa < 2 then
        raise exception 'GAGAL D%: student_summary() tidak sama dengan hitungan langsung', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin', 'u', 'student_summary() sama dengan hitungan langsung');

    v_no := v_no + 1;
    if not (c_kelas = any (v_sum.daftar_kelas))
       or exists (select 1 from unnest(v_sum.daftar_kelas) k where k is null or btrim(k) = '') then
        raise exception 'GAGAL D%: daftar_kelas salah atau memuat nilai kosong', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin', 'u', 'daftar_kelas tanpa nilai kosong');

    v_no := v_no + 1;
    insert into public.student_records (nik, nama_siswa, status_daftar, payload)
    values (c_nik_c, 'Siswa Fiktif Tiga', 'Perlu verifikasi lebih lanjut', '{}');
    update public.student_records set nama_ibu_kandung = 'Ibu Fiktif Tiga' where nik = c_nik_c;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'GAGAL D%: admin tidak bisa UPDATE', v_no;
    end if;
    delete from public.student_records where nik = c_nik_c;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'GAGAL D%: admin tidak bisa DELETE', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin', 'u', 'INSERT, UPDATE, DELETE berhasil');

    execute 'reset role';

    -- -------------------------------------------------- E. constraint data
    execute 'set local role service_role';

    v_no := v_no + 1;
    begin
        insert into public.student_records (nik, nama_siswa, status_daftar, payload)
        values ('99000000000001', 'NIK Pendek', 'Perlu verifikasi lebih lanjut', '{}');
        raise exception 'GAGAL E%: NIK 14 digit diterima', v_no;
    exception when check_violation then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Constraint', 'u', 'NIK bukan 16 digit ditolak');

    v_no := v_no + 1;
    begin
        insert into public.student_records (nik, nama_siswa, status_daftar, payload)
        values (c_nik_a, 'NIK Ganda', 'Perlu verifikasi lebih lanjut', '{}');
        raise exception 'GAGAL E%: NIK ganda diterima', v_no;
    exception when unique_violation then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Constraint', 'u', 'NIK ganda ditolak');

    v_no := v_no + 1;
    begin
        insert into public.student_records (nik, nama_siswa, status_daftar, payload)
        values ('9900000000000007', 'Status Salah', 'Tercantum di daftar kelas 2026/2027', '{}');
        raise exception 'GAGAL E%: status_daftar tidak valid diterima', v_no;
    exception when check_violation then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Constraint', 'u', 'status_daftar di luar 2 nilai ditolak');

    v_no := v_no + 1;
    begin
        insert into public.student_records (nik, nama_siswa, status_daftar, kelas, payload)
        values ('9900000000000006', 'Tanpa Kelas', 'Tercantum di daftar kelas', '  ', '{}');
        raise exception 'GAGAL E%: siswa tercantum tanpa kelas diterima', v_no;
    exception when check_violation then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Constraint', 'u', 'Tercantum tanpa kelas ditolak');

    v_no := v_no + 1;
    begin
        insert into public.student_records (nik, nama_siswa, status_daftar, payload)
        values ('9900000000000005', 'Metadata di Payload', 'Perlu verifikasi lebih lanjut', '{"_sources":{}}');
        raise exception 'GAGAL E%: payload berisi _sources diterima', v_no;
    exception when check_violation then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Constraint', 'u', 'payload berisi _sources/_catatan/_asal_data ditolak');

    v_no := v_no + 1;
    begin
        insert into public.student_records (nik, nama_siswa, status_daftar, payload, matching_notes)
        values ('9900000000000004', 'Catatan Salah Tipe', 'Perlu verifikasi lebih lanjut', '{}', '{"a":1}');
        raise exception 'GAGAL E%: matching_notes berupa object diterima', v_no;
    exception when check_violation then null;
    end;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Constraint', 'u', 'Tipe JSONB metadata divalidasi');

    v_no := v_no + 1;
    -- now() konstan dalam satu transaksi, jadi uji dengan nilai lama yang
    -- seharusnya ditimpa trigger.
    update public.student_records
       set status_dukcapil = 'Uji', updated_at = '2000-01-01 00:00:00+00'
     where nik = c_nik_b;
    if not exists (select 1 from public.student_records
                   where nik = c_nik_b and updated_at > '2000-01-01 00:00:00+00') then
        raise exception 'GAGAL E%: trigger updated_at tidak berjalan', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Constraint', 'u', 'Trigger updated_at berjalan');

    -- ------------------------------------------------------ bersihkan data uji
    delete from public.student_records where nik in (c_nik_a, c_nik_b, c_nik_c);
    delete from public.student_import_batches where id = v_batch;
    execute 'reset role';

    insert into student_rls_test_results (no, kelompok, uji, hasil)
    select (e->>'no')::int, e->>'k', e->>'u', 'LULUS'
    from jsonb_array_elements(v_log) e;
end
$test$;

select no, kelompok, uji, hasil from student_rls_test_results order by no;
