# Supabase — Modul Data Siswa

Folder ini berisi migration dan tes RLS untuk tabel siswa. Proyek ini belum memakai
Supabase CLI, jadi semua langkah dijalankan manual lewat **Supabase SQL Editor**.

> **Privat.** Jangan pernah menaruh data siswa asli di folder ini, di migration, atau
> di tes. Tes hanya memakai siswa fiktif (NIK berawalan `99`, kode provinsi yang tidak
> ada). Folder ini tidak ikut ter-deploy ke Vercel (lihat `.vercelignore`).

| File | Isi |
|---|---|
| `migrations/20261022000001_student_information_system.sql` | Tabel `student_records` dan `student_import_batches`, constraint, indeks, trigger `updated_at`, grant, RLS, RPC `student_summary()` |
| `tests/student_rls_test.sql` | 36 tes: struktur, anon, non-admin, admin, constraint, kebersihan. Data uji dibersihkan otomatis |

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
   - Aman dijalankan ulang. Menjalankan dua kali menghasilkan struktur yang sama.
2. **Cek kebersihan, sebelum tes.** Jalankan query *Cek kebersihan* di bawah, lalu catat
   hasilnya.
3. **Tes RLS.** Tempel seluruh isi `tests/student_rls_test.sql` → **Run**.
   - Diharapkan: tabel **36 baris**, kolom `hasil` semuanya `LULUS`.
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
  'summary_security_definer', (select prosecdef from pg_proc where oid = 'public.student_summary()'::regprocedure),
  'summary_anon_execute', has_function_privilege('anon', 'public.student_summary()', 'EXECUTE')
) as hasil;
```

Diharapkan:

- `enabled` dan `forced` = `true` untuk kedua tabel;
- 5 policy, semuanya dengan `roles` = `{authenticated}`;
- `anon_grants` = `0`;
- `summary_security_definer` = `false`;
- `summary_anon_execute` = `false`.

## Hasil yang diharapkan per jenis pengguna

| Pengguna | `student_records` | `student_import_batches` | `student_summary()` |
|---|---|---|---|
| **anon** (pengunjung, tanpa login) | Semua operasi ditolak: `permission denied` (tidak punya grant) | Ditolak | Ditolak (`EXECUTE` dicabut) |
| **Login non-admin** (mis. akun guru aplikasi lain) | SELECT 0 baris, INSERT ditolak RLS, UPDATE/DELETE mengenai 0 baris | SELECT 0 baris, tulis ditolak | Semua angka 0, `daftar_kelas` kosong |
| **Admin** (`user_roles.role = 'admin'`) | SELECT/INSERT/UPDATE/DELETE diizinkan | Hanya SELECT | Angka dihitung dari tabel |
| **service_role** (importer server-side) | Penuh, melewati RLS | Penuh | Penuh |

UI versi awal tetap read-only, walaupun admin diizinkan menulis di level database.

## Riwayat migration (jika nanti memakai Supabase CLI)

Migration ini dijalankan lewat SQL Editor, jadi belum tercatat di riwayat migration CLI.
Jika project nanti di-link dengan Supabase CLI, tandai migration ini sebagai sudah
dijalankan. Jangan dijalankan ulang lewat `db push`.

```bash
supabase migration repair 20261022000001 --status applied
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
