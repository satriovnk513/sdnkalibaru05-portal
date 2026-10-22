# Supabase — Modul Data Siswa

Folder ini berisi migration dan tes RLS untuk tabel siswa. Proyek ini belum memakai
Supabase CLI, jadi semua langkah dijalankan manual lewat **Supabase SQL Editor**.

> **Privat.** Jangan pernah menaruh data siswa asli di folder ini, di migration, atau
> di tes. Tes hanya memakai siswa fiktif (NIK berawalan `99`). Folder ini tidak ikut
> ter-deploy ke Vercel (lihat `.vercelignore`).

| File | Isi |
|---|---|
| `migrations/20261022000001_student_information_system.sql` | Tabel `student_records` dan `student_import_batches`, constraint, indeks, trigger `updated_at`, grant, RLS, RPC `student_summary()` |
| `tests/student_rls_test.sql` | 31 tes: struktur, anon, non-admin, admin, constraint. Data uji dibersihkan otomatis |

## Langkah menjalankan

1. Buka dashboard Supabase project `wwpbghdepykfqgzhyvmh` → **SQL Editor** → **New query**.
   Biarkan role editor pada `postgres` (bawaan).
2. Tempel **seluruh** isi `migrations/20261022000001_student_information_system.sql` → **Run**.
   - Diharapkan: `Success. No rows returned`.
   - Semua perintah ada dalam satu transaksi. Jika muncul error, tidak ada yang berubah.
     Salin pesan error-nya tanpa data pribadi.
   - Aman dijalankan ulang. Menjalankan dua kali menghasilkan struktur yang sama.
3. **New query** lagi → tempel seluruh isi `tests/student_rls_test.sql` → **Run**.
   - Diharapkan: tabel 31 baris, kolom `hasil` semuanya `LULUS`.
   - Jika ada yang gagal, muncul error `GAGAL <kode>: <penjelasan>`, dan semua data uji
     otomatis dibatalkan.
   - Tes boleh dijalankan ulang kapan saja, termasuk setelah data asli diimpor. Tes tidak
     mengubah atau membaca isi data asli, hanya menghitung jumlah untuk mencocokkan
     `student_summary()`.
4. Opsional, cek ringkas (tanpa data pribadi):

   ```sql
   select json_build_object(
     'rls', (select json_agg(json_build_object('table', relname, 'enabled', relrowsecurity, 'forced', relforcerowsecurity))
             from pg_class where oid in ('public.student_records'::regclass, 'public.student_import_batches'::regclass)),
     'policies', (select json_agg(json_build_object('table', tablename, 'policy', policyname, 'roles', roles, 'cmd', cmd) order by tablename, policyname)
                  from pg_policies where tablename in ('student_records', 'student_import_batches')),
     'anon_grants', (select count(*) from information_schema.role_table_grants
                     where grantee = 'anon' and table_name in ('student_records', 'student_import_batches')),
     'row_counts', (select json_build_object('records', (select count(*) from public.student_records),
                                             'batches', (select count(*) from public.student_import_batches)))
   ) as hasil;
   ```

   Diharapkan: `enabled` dan `forced` = `true` untuk kedua tabel, 5 policy, semua `roles`
   = `{authenticated}`, `anon_grants` = `0`. Sebelum impor, `row_counts` = 0.

## Hasil yang diharapkan per jenis pengguna

| Pengguna | `student_records` | `student_import_batches` | `student_summary()` |
|---|---|---|---|
| **anon** (pengunjung, tanpa login) | Semua operasi ditolak: `permission denied` (tidak punya grant) | Ditolak | Ditolak (`EXECUTE` dicabut) |
| **Login non-admin** (mis. akun guru aplikasi lain) | SELECT 0 baris, INSERT ditolak RLS, UPDATE/DELETE mengenai 0 baris | SELECT 0 baris, tulis ditolak | Semua angka 0, `daftar_kelas` kosong |
| **Admin** (`user_roles.role = 'admin'`) | SELECT/INSERT/UPDATE/DELETE diizinkan | Hanya SELECT | Angka dihitung dari tabel |
| **service_role** (importer server-side) | Penuh, melewati RLS | Penuh | Penuh |

UI versi awal tetap read-only, walaupun admin diizinkan menulis di level database.

## Catatan

- `postgres` di SQL Editor biasanya punya `BYPASSRLS`, sehingga melihat semua baris.
  Ini wajar dan bukan celah: SQL Editor hanya bisa dibuka lewat dashboard Supabase.
- Tes beralih ke role `service_role`, `anon`, dan `authenticated` dengan `SET LOCAL ROLE`
  di dalam transaksi. Jika muncul `permission denied to set role`, laporkan errornya.
  Artinya role editor bukan `postgres`.
- Tidak ada skrip *down*/hapus tabel. Menghapus tabel siswa harus lewat persetujuan
  terpisah.
