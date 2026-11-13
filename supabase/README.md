# Supabase — Modul Data Siswa

Folder ini berisi migration dan tes RLS untuk tabel siswa. Proyek ini belum memakai
Supabase CLI, jadi semua langkah dijalankan manual lewat **Supabase SQL Editor**.

> **Privat.** Jangan pernah menaruh data siswa asli di folder ini, di migration, atau
> di tes. Tes hanya memakai siswa fiktif (NIK berawalan `99`, kode provinsi yang tidak
> ada). Folder ini tidak ikut ter-deploy ke Vercel (lihat `.vercelignore`).

| File | Isi |
|---|---|
| `migrations/20261022000001_student_information_system.sql` | Tabel `student_records` dan `student_import_batches`, constraint, indeks, trigger `updated_at`, grant, RLS, RPC `student_summary()` |
| `tests/student_rls_test.sql` | 40 tes untuk kondisi **setelah migration 001 saja** (admin read-only) |
| `migrations/20261023000001_student_crud.sql` | CRUD admin: tambah/ubah, arsip (soft delete), riwayat perubahan, trigger penjaga |
| `tests/student_crud_precheck.sql` | Pemeriksaan sebelum migration CRUD (angka saja) |
| `tests/student_crud_test.sql` | 36 tes untuk kondisi **setelah migration CRUD** |

**Model akses (setelah migration CRUD):** admin dashboard bisa **melihat, menambah,
mengubah, mengarsipkan, dan memulihkan** siswa. **Tidak ada hapus permanen** dari
browser: "hapus" = arsip (`archived_at`), bisa dipulihkan. Hapus permanen hanya lewat
SQL Editor (riwayat siswa itu ikut terhapus). Riwayat impor tetap hanya ditulis importer.

## Migration CRUD (20261023000001) — urutan menjalankan

Jalankan **sebelum** merge UI CRUD ke `main`, karena UI baru memakai kolom `archived_at`
dan tabel riwayat.

1. Buka **SQL Editor**, jalankan `tests/student_crud_precheck.sql`.
   Semua kolom kecuali `total_siswa` harus **0**. Jika tidak, berhenti dan laporkan angkanya.
2. Jalankan seluruh isi `migrations/20261023000001_student_crud.sql`.
   Hasil: `Success. No rows returned`.
3. Jalankan `tests/student_crud_test.sql`. Hasil: **36 baris, semuanya `LULUS`**.
4. Jalankan lagi query **Cek kebersihan** di bawah; angka harus sama seperti sebelumnya.
5. Jalankan `select * from public.student_summary();` → 559 / 535 / 24 / 17, `diarsipkan` 0.

Yang dilakukan migration ini:

- Kolom baru `created_by`, `updated_by`, `archived_at`, `archived_by` (tabel lama tidak disentuh).
- Tabel `student_record_changes` (riwayat: siapa, kapan, field, nilai lama → baru).
  Admin hanya bisa **membaca**; ditulis otomatis oleh trigger. Tidak bisa dipalsukan/dihapus dari browser.
- Grant `INSERT`, `UPDATE` untuk `authenticated` + policy admin. **Tanpa `DELETE`.**
- Trigger penjaga untuk penulisan dari browser: kolom inti selalu diturunkan dari
  `payload`; `id`, `created_at`, `created_by`, `import_batch_id`, `matching_notes`,
  `source_names` tidak bisa diubah; identitas (NIK, KK, HP, …) wajib teks; siswa
  terarsip tidak bisa diubah sebelum dipulihkan.
- `student_summary()` hanya menghitung siswa aktif dan menambah kolom `diarsipkan`.
- Penulisan importer (`service_role`) tidak diubah dan tidak dicatat.

Rollback darurat (jika perlu, setelah persetujuan): UI lama tetap aman dipakai dengan
skema baru, jadi cukup revert commit UI. Skema tidak perlu di-rollback.

## Syarat sebelum menjalankan di produksi

1. Ketiga file sudah ditinjau baris demi baris.
2. **Backup produksi tersedia.** Cek di Dashboard → **Database → Backups**. Kalau paket
   yang dipakai tidak punya backup harian, buat logical backup lebih dulu
   (mis. `pg_dump` oleh pemilik project).
3. Migration hanya **menambah** objek baru di dalam satu transaksi. Migration tidak
   memakai `DROP TABLE`, `TRUNCATE`, atau `CASCADE`, dan tidak mengubah tabel lama
   maupun `user_roles`. `DROP ... IF EXISTS` hanya dipakai untuk policy/trigger baru
   milik tabel siswa, agar aman dijalankan ulang.

## Langkah menjalankan

Biarkan role SQL Editor pada `postgres` (bawaan). Setiap langkah memakai **New query**
tersendiri.

1. **Migration.** Tempel **seluruh** isi
   `migrations/20261022000001_student_information_system.sql` → **Run**.
   - Diharapkan: `Success. No rows returned`.
   - Semua perintah ada dalam satu transaksi (`begin … commit`). Jika muncul error,
     tidak ada yang berubah. Salin pesan error-nya tanpa data pribadi.
   - Aman dijalankan ulang **setelah versi migration yang sama ini berhasil
     diterapkan**; hasilnya struktur yang sama. Migration ini **bukan** alat untuk
     memperbaiki tabel draf dengan struktur berbeda (`create table if not exists` tidak
     mengubah tabel yang sudah ada). Policy tulis dari draf lama
     (`student_records_admin_insert/update/delete`) dihapus jika ada.
2. **Cek kebersihan, sebelum tes.** Jalankan query *Cek kebersihan* di bawah, lalu catat
   hasilnya.
3. **Tes RLS.** Tempel seluruh isi `tests/student_rls_test.sql` → **Run**.
   - Diharapkan: tabel **40 baris**, kolom `hasil` semuanya `LULUS`.
   - Jika ada yang gagal, muncul error `GAGAL <kode>: <penjelasan>`. Postgres membatalkan
     seluruh blok tes secara otomatis, termasuk data uji serta perubahan role dan JWT claims.
   - Tes boleh dijalankan ulang kapan saja, termasuk setelah data asli diimpor. Tes tidak
     mengubah atau menampilkan isi data asli; tes hanya menghitung jumlah untuk mencocokkan
     `student_summary()`.
4. **Cek kebersihan, setelah tes (berhasil maupun gagal).** Jalankan lagi query *Cek
   kebersihan*. Hasilnya harus:
   - `siswa_fiktif` = 0, `batch_fiktif` = 0, `objek_permanen_tes` = 0;
   - `user_roles` dan `auth_users` sama dengan hasil langkah 2;
   - `role_sekarang` = `postgres` dan `jwt_claims` kosong.
5. **Cek struktur (opsional).** Jalankan query *Cek struktur* di bawah.

## Query: Cek kebersihan

Hanya menampilkan angka, tidak menampilkan data pribadi.

```sql
select json_build_object(
  'siswa_fiktif',       (select count(*) from public.student_records where nik like '990000000000000_'),
  'batch_fiktif',       (select count(*) from public.student_import_batches
                          where source_name in ('UJI-RLS-FIKTIF', 'UJI-ADMIN')),
  'user_roles',         (select count(*) from public.user_roles),
  'auth_users',         (select count(*) from auth.users),
  'objek_permanen_tes', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where c.relname like 'student_rls_test%'
                            and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%')
                      + (select count(*) from pg_proc where proname like 'student_rls_test%'),
  'role_sekarang',      current_user,
  'jwt_claims',         coalesce(current_setting('request.jwt.claims', true), ''),
  'postgres_bypass_rls', (select rolbypassrls from pg_roles where rolname = current_user)
) as hasil;
```

`postgres_bypass_rls` seharusnya `true`. Artinya `postgres` bisa melihat semua baris,
termasuk sisa data uji. Jika nilainya `false`, laporkan: hitungan `siswa_fiktif` dan
`batch_fiktif` dari `postgres` mungkin tidak bisa dipercaya karena tabel memakai
`FORCE ROW LEVEL SECURITY`. Bagian F di dalam tes tetap memeriksa sebagai `service_role`.

## Query: Cek struktur

```sql
select json_build_object(
  'rls', (select json_agg(json_build_object('table', relname, 'enabled', relrowsecurity, 'forced', relforcerowsecurity))
          from pg_class where oid in ('public.student_records'::regclass, 'public.student_import_batches'::regclass)),
  'policies', (select json_agg(json_build_object('table', tablename, 'policy', policyname, 'roles', roles, 'cmd', cmd)
                               order by tablename, policyname)
               from pg_policies where tablename in ('student_records', 'student_import_batches')),
  'anon_grants', (select count(*) from information_schema.role_table_grants
                  where grantee = 'anon' and table_name in ('student_records', 'student_import_batches')),
  'authenticated_grants', (select json_agg(distinct table_name || ':' || privilege_type)
                  from information_schema.role_table_grants
                  where grantee = 'authenticated' and table_name in ('student_records', 'student_import_batches')),
  'summary_security_definer', (select prosecdef from pg_proc where oid = 'public.student_summary()'::regprocedure),
  'summary_anon_execute', has_function_privilege('anon', 'public.student_summary()', 'EXECUTE')
) as hasil;
```

Diharapkan:

- `enabled` dan `forced` = `true` untuk kedua tabel;
- **2 policy**, keduanya `cmd` = `SELECT` dan `roles` = `{authenticated}`:
  `student_records_admin_select` dan `student_import_batches_admin_select`;
- `anon_grants` = `0`;
- `authenticated_grants` = hanya `student_import_batches:SELECT` dan `student_records:SELECT`;
- `summary_security_definer` = `false`;
- `summary_anon_execute` = `false`.

## Hasil yang diharapkan per jenis pengguna

| Pengguna | `student_records` | `student_import_batches` | `student_summary()` |
|---|---|---|---|
| **anon** (pengunjung, tanpa login) | Semua operasi ditolak: `permission denied` (tidak punya grant) | Ditolak | Ditolak (`EXECUTE` dicabut) |
| **Login non-admin** (mis. akun guru aplikasi lain) | SELECT 0 baris; INSERT/UPDATE/DELETE ditolak | SELECT 0 baris; tulis ditolak | Semua angka 0, `daftar_kelas` kosong |
| **Admin** (`user_roles.role = 'admin'`) | Setelah migration CRUD: SELECT, INSERT, UPDATE (dijaga trigger, tercatat di riwayat); **DELETE ditolak** | **SELECT saja** | Angka siswa aktif |
| **service_role** (importer server-side) | Penuh, melewati RLS | Penuh | Penuh |

Kunci `service_role` tidak pernah dipakai di browser. Riwayat perubahan
(`student_record_changes`): admin SELECT saja; anon dan non-admin ditolak/0 baris.

## Riwayat migration (jika nanti memakai Supabase CLI)

Migration ini dijalankan lewat SQL Editor, jadi belum tercatat di riwayat migration CLI.
Jika project nanti di-link dengan Supabase CLI, tandai migration ini sebagai sudah
dijalankan. Jangan dijalankan ulang lewat `db push`.

```bash
supabase migration repair 20261022000001 --status applied
supabase migration repair 20261023000001 --status applied
```

## Catatan

- Tes beralih ke role `service_role`, `anon`, dan `authenticated` dengan `SET LOCAL ROLE`
  di dalam transaksi. Jika muncul `permission denied to set role`, laporkan errornya.
  Artinya role editor bukan `postgres`.
- Tes tidak membuat akun dan tidak menulis ke `user_roles` maupun `auth.users`. User
  non-admin disimulasikan dengan uid acak di JWT claims; admin disimulasikan dengan uid
  admin yang sudah ada, hanya di dalam transaksi tes.
- Satu-satunya objek yang dibuat tes adalah tabel **TEMPORARY** (`student_rls_test_results`,
  `student_rls_test_session`). Tabel ini hanya terlihat di session SQL Editor tersebut dan
  hilang saat session ditutup.
- Tidak ada skrip *down*/hapus tabel. Menghapus tabel siswa harus lewat persetujuan
  terpisah.

---

# Modul Absensi Siswa — Fase 0 (fondasi data)

Acuan: PRD Absensi Siswa. Fase 0 hanya menyiapkan database dan akun; belum ada
halaman yang terlihat guru.

> **Status produksi (12 Nov 2026):** migration dan seed SUDAH diterapkan
> (migration `attendance_foundation` dan `seed_penugasan_2026_2027`). Isi fungsi
> dicocokkan dengan versi yang lolos tes lokal (md5 `prosrc`, komentar diabaikan).
> Hasil seed: 17 rombel, 17 wali kelas, 34 penugasan mapel, 535 siswa terdaftar.
> Akun guru BELUM dibuat.

| File | Isi |
|---|---|
| `migrations/20261112000001_attendance_foundation.sql` | Tabel akun guru, tahun ajaran, rombel, keanggotaan rombel, wali kelas (maks. 2), mapel, penugasan mapel, hari libur, absensi + riwayat; fungsi hak akses; RLS; RPC `get_class_roster`, `get_student_profile`, `save_attendance`, `archive_attendance_session`, `restore_attendance_session` |
| `seed/20261112_penugasan_2026_2027.sql` | Tahun ajaran 2026/2027, 17 rombel, PAI & PJOK, keanggotaan rombel dari Data Siswa, 17 wali kelas, 34 penugasan mapel |
| `tests/local/run.sh` | Menjalankan migration lama + baru + seed + 53 tes hak akses di Postgres lokal sementara |
| `../scripts/create-teacher-accounts.mjs` | Membuat akun guru/admin dari file di `data-private/` (tidak di-commit) |

**Keputusan keamanan penting**

- Email dan NIP login disimpan di `teacher_accounts`, **bukan** di `staff`, karena
  `staff` dibaca publik oleh halaman Guru & Staf.
- Guru tidak pernah mendapat akses ke `student_records`. Daftar siswa dan profil
  diambil lewat RPC yang hanya mengembalikan field aman (tanpa NIK, KK,
  penghasilan, anggota keluarga, akta, koordinat, PPDB/Dukcapil).
- Absensi hanya ditulis lewat `save_attendance`; tidak ada grant tulis langsung.
- Repo ini publik: daftar email/NIP guru dan file password awal **wajib** di
  `data-private/` (di-ignore Git).

## Tes lokal (tanpa menyentuh Supabase)

```bash
# Butuh PostgreSQL 15+ (initdb, pg_ctl, psql). Jangan dijalankan sebagai root.
bash supabase/tests/local/run.sh
# Diharapkan: "SEMUA LULUS: 53 tes"
```

## Menerapkan ke produksi — urutan

Jalankan hanya setelah disetujui, dengan backup tersedia (lihat syarat di atas).

1. **SQL Editor → New query:** tempel seluruh isi
   `migrations/20261112000001_attendance_foundation.sql` → Run.
   Diharapkan `Success. No rows returned`.
2. **New query:** tempel `seed/20261112_penugasan_2026_2027.sql` → Run.
   Diharapkan baris hasil: `rombel 17`, `wali_kelas 17`, `penugasan_mapel 34`,
   dan `siswa_terdaftar` = `siswa_tercantum` (535).
3. Siapkan `data-private/akun-guru.json` (format: `scripts/teacher-accounts.example.json`).
4. Dry-run: `node scripts/create-teacher-accounts.mjs --file data-private/akun-guru.json`
5. Eksekusi:
   ```bash
   SUPABASE_SERVICE_ROLE_KEY="$SB_KEY" node scripts/create-teacher-accounts.mjs \
     --execute --file data-private/akun-guru.json --out data-private/password-awal.csv
   ```
   Password awal hanya ada di file `--out`. Bagikan langsung ke tiap guru, lalu hapus file itu.

Rollback darurat: semua objek di migration ini baru dan tidak dipakai halaman
mana pun sampai Fase 1, jadi data lama tidak terpengaruh.

---

# Modul Absensi Siswa — Fase 1 (portal guru + admin)

| File | Isi |
|---|---|
| `guru.html`, `guru.js` | Portal Guru (`/guru`), mobile-first: login email/NIP, beranda, absensi harian & mapel, data siswa (lihat saja), rekap bulanan, ganti password |
| `attendance-sheet.js`, `attendance.css` | Komponen bersama: lembar absensi H/S/I/A/D, tabel standar (cari, urut, Tampilkan 10/25/50/100), konfirmasi, draf offline |
| `admin-attendance.js` | Tab admin **Kelola Absensi** (isi/koreksi dengan alasan, arsip, riwayat) dan **Akun Guru** |
| `api/guru-login.js` | Login dengan email atau NIP/NUPTK (NIP dicocokkan ke email di server) |
| `api/admin/teacher-accounts.js` | Buat akun, reset password, aktif/nonaktif. Hanya admin |
| `migrations/20261112000003_attendance_phase1.sql` | `teacher_account_requests` + RPC `get_guru_home`, `get_attendance_sheet`, `get_class_month_recap` |

> **Status produksi (13 Nov 2026):** migration Fase 1 SUDAH diterapkan, dan
> `teacher_account_requests` sudah berisi 24 baris (22 guru + 2 operator).
> Akun login BELUM dibuat: admin menekan **Buat semua akun** di tab Akun Guru.

## Syarat sebelum dipakai

Vercel → Settings → Environment Variables, target Production + Preview:

- `SUPABASE_SERVICE_ROLE_KEY` — dari Supabase → Project Settings → API. Tanpa ini
  login guru dan tab Akun Guru menampilkan pesan "belum dikonfigurasi".

Key ini hanya dibaca di server (`api/_lib/supa.js`), tidak pernah dikirim ke browser.

## Tes

```bash
node --test tests/attendance-api.test.mjs          # 14 tes API (offline)
bash supabase/tests/local/run.sh                   # 63 tes hak akses database
PLAYWRIGHT_MODULE_DIR=... CHROMIUM_PATH=... node --test tests/attendance-ui.test.mjs   # 45 tes UI (360, 390, 1366 px)
```

---

# Modul Absensi — menu Akademik & Kelas

Menu admin baru (grup **AKADEMIK** di sidebar), file `admin-akademik.js`:

| Menu | Isi |
|---|---|
| Data Kelas | Rombel tahun ajaran aktif + jumlah siswa + wali; tambah/edit/hapus (hapus ditolak jika masih ada siswa/absensi) |
| Wali Kelas | Form wali 1 (wajib) + wali 2 pendamping (opsional), daftar per kelas dengan NIP. RPC `set_homeroom` |
| Mata Pelajaran | Tambah/edit/hapus mapel; **Atur guru** = centang kelas yang diajar tiap guru. RPC `set_subject_assignments` |
| Tahun Ajaran | Tambah/edit/hapus; **Jadikan aktif** (tepat satu). RPC `set_active_academic_year` |
| Hari Libur | Kalender bulanan + daftar; klik tanggal untuk tambah/ubah; libur rentang (Sabtu–Minggu dilewati); **Sinkron Libur Nasional**. RPC `sync_holidays` |

Migration `20261113000001_attendance_akademik.sql` (**sudah diterapkan di produksi 13 Nov 2026**):

- `holiday_catalog`: 57 tanggal Agustus 2026 – Desember 2027 dari SKB 3 Menteri 2026
  (No. 1497/2025, 2/2025, 5/2025), SKB 3 Menteri 2027 (No. 1205, 3, 2 Tahun 2026), dan
  Kalender Pendidikan DKI 2026/2027 (Kepdis No. 346/2026: libur semester 19 Des 2026 –
  2 Jan 2027 dan 26 Jun – 10 Jul 2027). Sudah disinkronkan ke `school_holidays`.
- Tahun ajaran 2026/2027 mulai 13 Juli 2026 (hari pertama sekolah menurut Kepdis).
- Belum ada di katalog: libur awal Ramadan (mengikuti ketentuan pemerintah) dan libur
  semester TA 2027/2028. Tambahkan lewat menu Hari Libur saat sudah terbit, atau tambah
  baris ke `holiday_catalog` lewat migration baru lalu klik Sinkron.

## Laporan (20261113000002)

- `get_class_report_header(class)` — kop laporan: kelas, tahun ajaran, wali kelas 1/2 + NIP, kepala sekolah + NIP.
- `get_class_semester_recap(class, 1|2)` — total H/S/I/A/D per siswa dari absensi **harian** dalam semester (ganjil = Juli–Des, genap = Jan–akhir TA), hari efektif s.d. hari ini, dan hari yang sudah terisi.
- Hak akses sama dengan rekap bulanan (`can_view_class`). Hanya menambah fungsi.
- Front-end: `rekap-print.js` membuat dokumen cetak (format kertas "DAFTAR HADIR SISWA", A4 landscape) dan file Excel (.xlsx) tanpa library luar. Admin: menu **Laporan** → Rekap Bulanan / Rekap Semester. Guru: `/guru` → Rekap → *Cetak & unduh*.
- Tes: `supabase/tests/local/run.sh` bagian K, `node --test tests/rekap-print.test.mjs`.

## Absen tanggal bebas (20261113000003)

- `earliest_backfill_date()` sekarang = awal tahun ajaran aktif, jadi guru bisa mengisi absensi tanggal mana pun yang sudah lewat dalam tahun ajaran (dulu hanya 3 hari sekolah terakhir).
- Tetap ditolak: tanggal yang akan datang, Sabtu/Minggu/hari libur, dan mengubah absensi yang sudah disimpan di hari sebelumnya (koreksi lewat admin).
- % kehadiran di rekap: Dispensasi dihitung hadir (`(H + D) ÷ hari terisi`).
