-- =============================================================================
-- Tes CRUD + RLS Modul Data Siswa — SDN Kalibaru 05
--
-- Jalankan di Supabase SQL Editor SETELAH migration
--   20261022000001_student_information_system.sql dan
--   20261023000001_student_crud.sql.
--
-- File ini menggantikan supabase/tests/student_rls_test.sql untuk kondisi
-- setelah migration CRUD (tes lama mengharapkan admin read-only, sehingga
-- beberapa pemeriksaannya memang akan gagal setelah migration CRUD).
--
-- Seluruh tes ada dalam satu blok DO. Data uji FIKTIF (NIK berawalan 99)
-- disisipkan, diuji, lalu dihapus permanen di akhir blok (riwayatnya ikut
-- terhapus). Jika satu tes gagal, blok berhenti dengan pesan "GAGAL ..." dan
-- SEMUA perubahan dibatalkan otomatis.
--
-- Tes memakai uid admin pertama dari public.user_roles untuk mensimulasikan
-- session admin (request.jwt.claims, hanya di dalam transaksi ini) dan uid acak
-- untuk user non-admin. Tes TIDAK membuat akun dan TIDAK membuat objek
-- permanen; hanya tabel TEMPORARY untuk hasil.
--
-- Hasil yang diharapkan: tabel daftar tes, semuanya "LULUS".
-- =============================================================================

drop table if exists pg_temp.student_crud_test_session;
create temp table student_crud_test_session as
select current_user::text                                          as role_before,
       coalesce(current_setting('request.jwt.claims', true), '')    as claims_before;

drop table if exists pg_temp.student_crud_test_results;
create temp table student_crud_test_results (no integer, kelompok text, uji text, hasil text);

do $test$
declare
    c_nik_1    constant text := '9988000000000011';  -- dibuat admin
    c_nik_2    constant text := '9988000000000012';  -- untuk uji NIK ganda
    c_nik_svc  constant text := '9988000000000013';  -- ditulis service_role
    c_kelas    constant text := 'UJI-CRUD';
    c_email    constant text := 'admin-uji@fiktif.invalid';
    v_admin    uuid;
    v_nonadmin uuid := gen_random_uuid();
    v_id       uuid;
    v_svc_id   uuid;
    v_row      record;
    v_sum      record;
    v_count    bigint;
    v_rows     bigint;
    v_denied   boolean;
    v_state    text;
    v_payload  jsonb;
    v_log      jsonb := '[]'::jsonb;
    v_no       integer := 0;
    v_base_user_roles bigint;
    v_base_auth_users bigint;
    v_admin_claims    text;
    v_nonadmin_claims text;
begin
    -- ---------------------------------------------------------------- persiapan
    select count(*) into v_base_user_roles from public.user_roles;
    select count(*) into v_base_auth_users from auth.users;

    select ur.user_id into v_admin from public.user_roles ur
    where ur.role = 'admin' order by ur.user_id limit 1;
    if v_admin is null then
        raise exception 'GAGAL persiapan: tidak ada baris admin di public.user_roles';
    end if;
    if exists (select 1 from public.student_records where nik in (c_nik_1, c_nik_2, c_nik_svc, '9988000000000077')) then
        raise exception 'GAGAL persiapan: NIK uji fiktif sudah ada; hentikan dan periksa';
    end if;

    v_admin_claims    := json_build_object('sub', v_admin, 'role', 'authenticated', 'email', c_email)::text;
    v_nonadmin_claims := json_build_object('sub', v_nonadmin, 'role', 'authenticated')::text;

    v_payload := jsonb_build_object(
        'nik_siswa', c_nik_1, 'nama_siswa', 'Siswa Fiktif CRUD', 'kelas', c_kelas,
        'status_daftar', 'Tercantum di daftar kelas', 'siswa_nisn', '0099000001',
        'siswa_nama_ibu_kandung', 'Ibu Fiktif CRUD', 'siswa_no_kk', '9900000000000099',
        'lain_berat_badan', 25);

    -- ------------------------------------------------- A. struktur & hak akses
    v_no := v_no + 1;
    select count(*) into v_count from pg_class
    where oid in ('public.student_records'::regclass, 'public.student_import_batches'::regclass,
                  'public.student_record_changes'::regclass)
      and relrowsecurity and relforcerowsecurity;
    if v_count <> 3 then raise exception 'GAGAL A%: RLS belum aktif/forced pada ketiga tabel', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'RLS aktif dan FORCE pada 3 tabel siswa');

    v_no := v_no + 1;
    select count(*) into v_count from pg_policies
    where schemaname = 'public'
      and tablename in ('student_records', 'student_import_batches', 'student_record_changes')
      and (roles && array['anon', 'public']::name[]);
    if v_count <> 0 then raise exception 'GAGAL A%: ada % policy untuk anon/public', v_no, v_count; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'Tidak ada policy untuk anon/public');

    v_no := v_no + 1;
    if has_table_privilege('anon', 'public.student_records', 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('anon', 'public.student_import_batches', 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('anon', 'public.student_record_changes', 'SELECT,INSERT,UPDATE,DELETE')
       or has_function_privilege('anon', 'public.student_summary()', 'EXECUTE') then
        raise exception 'GAGAL A%: anon masih punya grant pada objek siswa', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'anon tanpa grant apa pun pada tabel/RPC siswa');

    v_no := v_no + 1;
    if not has_table_privilege('authenticated', 'public.student_records', 'SELECT')
       or not has_table_privilege('authenticated', 'public.student_records', 'INSERT')
       or not has_table_privilege('authenticated', 'public.student_records', 'UPDATE')
       or has_table_privilege('authenticated', 'public.student_records', 'DELETE')
       or has_table_privilege('authenticated', 'public.student_import_batches', 'INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', 'public.student_record_changes', 'INSERT,UPDATE,DELETE') then
        raise exception 'GAGAL A%: grant authenticated tidak sesuai', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u',
        'authenticated: siswa SELECT/INSERT/UPDATE tanpa DELETE; batch & riwayat hanya SELECT');

    v_no := v_no + 1;
    select count(*) into v_count from pg_policies
    where schemaname = 'public'
      and tablename in ('student_records', 'student_import_batches', 'student_record_changes')
      and roles = array['authenticated']::name[]
      and (tablename, cmd) in (('student_records', 'SELECT'), ('student_records', 'INSERT'),
                               ('student_records', 'UPDATE'), ('student_import_batches', 'SELECT'),
                               ('student_record_changes', 'SELECT'));
    if v_count <> 5 or exists (select 1 from pg_policies
            where schemaname = 'public'
              and tablename in ('student_records', 'student_import_batches', 'student_record_changes')
              and cmd in ('DELETE', 'ALL')) then
        raise exception 'GAGAL A%: policy tidak sesuai (ditemukan % policy yang diharapkan)', v_no, v_count;
    end if;
    select count(*) into v_count from pg_policies
    where schemaname = 'public'
      and tablename in ('student_records', 'student_import_batches', 'student_record_changes')
      and not ((coalesce(qual, '') || coalesce(with_check, '')) like '%user_roles%'
               and (coalesce(qual, '') || coalesce(with_check, '')) like '%admin%');
    if v_count <> 0 then raise exception 'GAGAL A%: ada policy tanpa pemeriksaan admin', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u', 'Tepat 5 policy admin, tidak ada policy DELETE');

    v_no := v_no + 1;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname in ('student_summary', 'student_records_guard_write')
                 and p.prosecdef)
       or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'student_records_audit' and p.prosecdef
                 and p.proconfig @> array['search_path=""'])
       or has_function_privilege('authenticated', 'public.student_records_audit()', 'EXECUTE')
       or has_function_privilege('anon', 'public.student_records_audit()', 'EXECUTE') then
        raise exception 'GAGAL A%: atribut keamanan fungsi tidak sesuai', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Struktur', 'u',
        'summary & guard SECURITY INVOKER; audit DEFINER dengan search_path kosong, tidak bisa dipanggil langsung');

    -- ------------------------------------------------------------- B. anon
    execute 'set local role anon';
    v_no := v_no + 1;
    v_denied := false;
    begin perform 1 from public.student_records limit 1;
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL B%: anon bisa membaca student_records', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'SELECT siswa ditolak');

    v_no := v_no + 1;
    v_denied := false;
    begin insert into public.student_records (nik, nama_siswa, status_daftar, payload)
          values (c_nik_2, 'x', 'Perlu verifikasi lebih lanjut', '{}');
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL B%: anon bisa INSERT siswa', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'INSERT siswa ditolak');

    v_no := v_no + 1;
    v_denied := false;
    begin perform 1 from public.student_record_changes limit 1;
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL B%: anon bisa membaca riwayat', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'SELECT riwayat ditolak');

    v_no := v_no + 1;
    v_denied := false;
    begin perform * from public.student_summary();
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL B%: anon bisa memanggil student_summary()', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Anon', 'u', 'RPC student_summary() ditolak');
    execute 'reset role';

    -- --------------------------------------------------------- C. non-admin
    perform set_config('request.jwt.claims', v_nonadmin_claims, true);
    execute 'set local role authenticated';

    v_no := v_no + 1;
    select count(*) into v_count from public.student_records;
    if v_count <> 0 then raise exception 'GAGAL C%: non-admin melihat % siswa', v_no, v_count; end if;
    select count(*) into v_count from public.student_record_changes;
    if v_count <> 0 then raise exception 'GAGAL C%: non-admin melihat riwayat', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'SELECT siswa & riwayat = 0 baris');

    v_no := v_no + 1;
    v_denied := false;
    begin insert into public.student_records (payload) values (v_payload);
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL C%: non-admin bisa menambah siswa', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'Tambah siswa ditolak RLS');

    v_no := v_no + 1;
    update public.student_records set payload = payload where true;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'GAGAL C%: non-admin mengubah % siswa', v_no, v_rows; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'Ubah siswa = 0 baris');

    v_no := v_no + 1;
    v_denied := false;
    begin delete from public.student_records where true;
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL C%: non-admin bisa DELETE', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Non-admin', 'u', 'Hapus siswa ditolak');
    execute 'reset role';

    -- ------------------------------------------------------------ D. admin: tambah
    perform set_config('request.jwt.claims', v_admin_claims, true);
    execute 'set local role authenticated';

    v_no := v_no + 1;
    insert into public.student_records (payload, id, import_batch_id, created_by, source_names, matching_notes)
    values (v_payload, '00000000-0000-4000-8000-000000000099', null, v_nonadmin, '["Palsu"]', '["Palsu"]')
    returning * into v_row;
    v_id := v_row.id;
    if v_row.nik <> c_nik_1 or v_row.nama_siswa <> 'Siswa Fiktif CRUD' or v_row.kelas <> c_kelas
       or v_row.nisn <> '0099000001' or v_row.nama_ibu_kandung <> 'Ibu Fiktif CRUD'
       or v_row.status_daftar <> 'Tercantum di daftar kelas' or v_row.nipd is not null then
        raise exception 'GAGAL D%: kolom inti tidak diturunkan dari payload', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin tambah', 'u', 'Kolom inti diturunkan dari payload (NISN nol di depan utuh)');

    v_no := v_no + 1;
    if v_id = '00000000-0000-4000-8000-000000000099' or v_row.created_by <> v_admin or v_row.updated_by <> v_admin
       or v_row.import_batch_id is not null or v_row.source_names <> '["Input admin"]'::jsonb
       or v_row.matching_notes is not null or v_row.archived_at is not null
       or v_row.field_sources ->> 'nama_siswa' <> 'Admin' then
        raise exception 'GAGAL D%: kolom sistem bisa dipalsukan saat tambah', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin tambah', 'u', 'id/created_by/batch/sumber tidak bisa dipalsukan');

    v_no := v_no + 1;
    select count(*) into v_count from public.student_record_changes
    where student_id = v_id and action = 'create' and changed_by = v_admin and changed_by_email = c_email
      and changes -> 'nama_siswa' ->> 'baru' = 'Siswa Fiktif CRUD';
    if v_count <> 1 then raise exception 'GAGAL D%: riwayat tambah tidak tercatat', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin tambah', 'u', 'Riwayat "create" tercatat (admin, email, nilai baru)');

    v_no := v_no + 1;
    v_state := null;
    begin insert into public.student_records (payload) values (v_payload);
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '23505' then raise exception 'GAGAL D%: NIK ganda tidak ditolak (%)', v_no, v_state; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin tambah', 'u', 'NIK ganda ditolak');

    v_no := v_no + 1;
    v_state := null;
    begin insert into public.student_records (payload)
          values (v_payload || jsonb_build_object('nik_siswa', '998800000000001'));
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '23514' then raise exception 'GAGAL D%: NIK 15 digit tidak ditolak (%)', v_no, v_state; end if;
    v_state := null;
    begin insert into public.student_records (payload) values (v_payload - 'nik_siswa');
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '23502' then raise exception 'GAGAL D%: tanpa NIK tidak ditolak (%)', v_no, v_state; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin tambah', 'u', 'NIK bukan 16 digit / tanpa NIK ditolak');

    v_no := v_no + 1;
    v_state := null;
    begin insert into public.student_records (payload)
          values (v_payload || jsonb_build_object('nik_siswa', c_nik_2, 'siswa_no_kk', 9900000000000099));
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '22023' then raise exception 'GAGAL D%: identitas bertipe angka tidak ditolak', v_no; end if;
    v_state := null;
    begin insert into public.student_records (payload)
          values (v_payload || jsonb_build_object('nik_siswa', c_nik_2, 'siswa_alamat', jsonb_build_object('a', 1)));
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '22023' then raise exception 'GAGAL D%: nilai objek tidak ditolak', v_no; end if;
    v_state := null;
    begin insert into public.student_records (payload)
          values (v_payload || jsonb_build_object('nik_siswa', c_nik_2, '_sources', '{}'::jsonb));
    exception when others then v_state := sqlstate; end;
    if v_state is null then raise exception 'GAGAL D%: key metadata di payload tidak ditolak', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin tambah', 'u', 'Identitas angka, nilai objek, key metadata ditolak');

    v_no := v_no + 1;
    v_state := null;
    begin insert into public.student_records (payload)
          values (v_payload || jsonb_build_object('nik_siswa', c_nik_2, 'kelas', ''));
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '23514' then raise exception 'GAGAL D%: tercantum tanpa kelas tidak ditolak', v_no; end if;
    v_state := null;
    begin insert into public.student_records (payload)
          values (v_payload || jsonb_build_object('nik_siswa', c_nik_2, 'status_daftar', 'Lainnya'));
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '23514' then raise exception 'GAGAL D%: status tidak valid tidak ditolak', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin tambah', 'u', 'Tercantum tanpa kelas & status tidak valid ditolak');

    -- ------------------------------------------------------------- E. admin: ubah
    v_no := v_no + 1;
    update public.student_records
    set payload = (payload || jsonb_build_object('kelas', 'UJI-CRUD-2', 'siswa_nipd', '0099')) - 'lain_berat_badan'
    where id = v_id
    returning * into v_row;
    if v_row.kelas <> 'UJI-CRUD-2' or v_row.nipd <> '0099' or v_row.payload ? 'lain_berat_badan'
       or v_row.field_sources ->> 'kelas' <> 'Admin' or v_row.field_sources ->> 'lain_berat_badan' <> 'Admin'
       or v_row.updated_by <> v_admin then
        raise exception 'GAGAL E%: ubah tidak menyinkronkan kolom inti/sumber', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin ubah', 'u', 'Ubah payload menyinkronkan kolom inti, sumber "Admin", updated_by');

    v_no := v_no + 1;
    select changes into v_payload from public.student_record_changes
    where student_id = v_id and action = 'update' order by id desc limit 1;
    if v_payload is null or (select count(*) from jsonb_object_keys(v_payload)) <> 3
       or v_payload -> 'kelas' ->> 'lama' <> c_kelas or v_payload -> 'kelas' ->> 'baru' <> 'UJI-CRUD-2'
       or (v_payload -> 'lain_berat_badan' -> 'lama')::text <> '25'
       or jsonb_typeof(v_payload -> 'lain_berat_badan' -> 'baru') <> 'null' then
        raise exception 'GAGAL E%: riwayat ubah tidak tepat', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin ubah', 'u', 'Riwayat "update" hanya field yang berubah, nilai lama -> baru');

    v_no := v_no + 1;
    update public.student_records
    set created_at = '2000-01-01', created_by = v_nonadmin, import_batch_id = null,
        source_names = '["Palsu"]', matching_notes = '["Palsu"]', nik = '9988000000000077'
    where id = v_id
    returning * into v_row;
    if v_row.created_at = '2000-01-01'::timestamptz or v_row.created_by <> v_admin
       or v_row.source_names <> '["Input admin"]'::jsonb or v_row.matching_notes is not null
       or v_row.nik <> c_nik_1 then
        raise exception 'GAGAL E%: kolom sistem bisa diubah dari browser', v_no;
    end if;
    select count(*) into v_count from public.student_record_changes where student_id = v_id and action = 'update';
    if v_count <> 1 then raise exception 'GAGAL E%: perubahan tanpa beda biodata ikut tercatat', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin ubah', 'u', 'Kolom sistem & kolom inti langsung tidak bisa diubah; tanpa beda = tanpa riwayat');

    v_no := v_no + 1;
    update public.student_records set payload = payload || jsonb_build_object('nik_siswa', c_nik_2)
    where id = v_id returning nik into v_state;
    if v_state <> c_nik_2 then raise exception 'GAGAL E%: NIK tidak bisa diubah lewat payload', v_no; end if;
    update public.student_records set payload = payload || jsonb_build_object('nik_siswa', c_nik_1) where id = v_id;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin ubah', 'u', 'NIK bisa dikoreksi lewat payload (tetap divalidasi)');

    -- ------------------------------------------------------ F. admin: arsip/pulihkan
    v_no := v_no + 1;
    update public.student_records set archived_at = '2000-01-01' where id = v_id returning * into v_row;
    if v_row.archived_at is null or v_row.archived_at < now() - interval '1 minute' or v_row.archived_by <> v_admin then
        raise exception 'GAGAL F%: arsip tidak tercatat benar', v_no;
    end if;
    select count(*) into v_count from public.student_record_changes where student_id = v_id and action = 'archive';
    if v_count <> 1 then raise exception 'GAGAL F%: riwayat arsip tidak tercatat', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin arsip', 'u', 'Arsip: waktu server, archived_by admin, riwayat "archive"');

    v_no := v_no + 1;
    select * into v_sum from public.student_summary();
    if v_sum.total_siswa <> (select count(*) from public.student_records where archived_at is null)
       or v_sum.diarsipkan <> (select count(*) from public.student_records where archived_at is not null)
       or v_sum.diarsipkan < 1 or c_kelas = any (v_sum.daftar_kelas) or 'UJI-CRUD-2' = any (v_sum.daftar_kelas) then
        raise exception 'GAGAL F%: ringkasan tidak mengecualikan siswa terarsip', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin arsip', 'u', 'student_summary() hanya menghitung siswa aktif + jumlah arsip');

    v_no := v_no + 1;
    v_state := null;
    begin update public.student_records set payload = payload || '{"kelas":"X"}' where id = v_id;
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '22023' then raise exception 'GAGAL F%: siswa terarsip bisa diubah', v_no; end if;
    v_state := null;
    begin update public.student_records set archived_at = null, payload = payload || '{"kelas":"X"}' where id = v_id;
    exception when others then v_state := sqlstate; end;
    if v_state is distinct from '22023' then raise exception 'GAGAL F%: pulihkan + ubah biodata tidak ditolak', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin arsip', 'u', 'Siswa terarsip tidak bisa diubah; pulihkan tidak boleh sekaligus ubah');

    v_no := v_no + 1;
    update public.student_records set archived_at = null where id = v_id returning * into v_row;
    if v_row.archived_at is not null or v_row.archived_by is not null then
        raise exception 'GAGAL F%: pulihkan gagal', v_no;
    end if;
    select count(*) into v_count from public.student_record_changes where student_id = v_id and action = 'restore';
    if v_count <> 1 then raise exception 'GAGAL F%: riwayat pulihkan tidak tercatat', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin arsip', 'u', 'Pulihkan berhasil, riwayat "restore"');

    v_no := v_no + 1;
    v_denied := false;
    begin delete from public.student_records where id = v_id;
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL F%: admin browser bisa hapus permanen', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin arsip', 'u', 'Hapus permanen dari browser ditolak');

    v_no := v_no + 1;
    v_denied := false;
    begin insert into public.student_record_changes (student_id, action) values (v_id, 'update');
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL F%: admin bisa memalsukan riwayat', v_no; end if;
    v_denied := false;
    begin delete from public.student_record_changes where student_id = v_id;
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL F%: admin bisa menghapus riwayat', v_no; end if;
    v_denied := false;
    begin insert into public.student_import_batches (source_name, source_hash, record_count, listed_count, review_count)
          values ('x', repeat('a', 64), 0, 0, 0);
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'GAGAL F%: admin bisa menulis batch impor', v_no; end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Admin arsip', 'u', 'Riwayat & batch impor tidak bisa ditulis/dihapus admin');

    select count(*) into v_count from public.student_record_changes where student_id = v_id;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- --------------------------------------------------------- G. server-side
    v_no := v_no + 1;
    execute 'set local role service_role';
    insert into public.student_records (nik, nama_siswa, status_daftar, payload)
    values (c_nik_svc, 'Siswa Fiktif Server', 'Perlu verifikasi lebih lanjut', '{"nama_siswa":"Siswa Fiktif Server"}')
    returning id into v_svc_id;
    if (select nik from public.student_records where id = v_svc_id) <> c_nik_svc
       or exists (select 1 from public.student_record_changes where student_id = v_svc_id) then
        raise exception 'GAGAL G%: penulisan service_role diubah trigger atau tercatat', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Server-side', 'u', 'Penulisan importer (service_role) tidak diubah & tidak tercatat');

    v_no := v_no + 1;
    delete from public.student_records where id in (v_id, v_svc_id);
    if exists (select 1 from public.student_record_changes where student_id in (v_id, v_svc_id)) or v_count < 4 then
        raise exception 'GAGAL G%: hapus permanen tidak ikut menghapus riwayat', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Server-side', 'u', 'Hapus permanen via SQL ikut menghapus riwayatnya');
    execute 'reset role';

    -- ------------------------------------------------------------ H. kebersihan
    v_no := v_no + 1;
    if exists (select 1 from public.student_records where nik in (c_nik_1, c_nik_2, c_nik_svc, '9988000000000077') or kelas like 'UJI-CRUD%')
       or exists (select 1 from public.student_record_changes where changed_by_email = c_email) then
        raise exception 'GAGAL H%: data uji fiktif tersisa', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Kebersihan', 'u', 'Tidak ada siswa/riwayat fiktif tersisa');

    v_no := v_no + 1;
    if (select count(*) from public.user_roles) <> v_base_user_roles
       or (select count(*) from auth.users) <> v_base_auth_users then
        raise exception 'GAGAL H%: user_roles/auth.users berubah', v_no;
    end if;
    v_log := v_log || jsonb_build_object('no', v_no, 'k', 'Kebersihan', 'u', 'user_roles dan auth.users tidak berubah');

    insert into pg_temp.student_crud_test_results (no, kelompok, uji, hasil)
    select (e ->> 'no')::int, e ->> 'k', e ->> 'u', 'LULUS' from jsonb_array_elements(v_log) e;
end
$test$;

insert into pg_temp.student_crud_test_results (no, kelompok, uji, hasil)
select (select coalesce(max(no), 0) + 1 from pg_temp.student_crud_test_results), 'Kebersihan',
       'Role & JWT claims kembali seperti sebelum tes',
       case when current_user::text = s.role_before
             and coalesce(current_setting('request.jwt.claims', true), '') = s.claims_before
            then 'LULUS' else 'GAGAL' end
from pg_temp.student_crud_test_session s;

select no, kelompok, uji, hasil from pg_temp.student_crud_test_results order by no;
