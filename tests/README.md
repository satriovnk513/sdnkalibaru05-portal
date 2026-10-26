# Pengujian modul Data Siswa

Semua tes memakai **data fiktif** (NIK berawalan `99`, nama "Siswa Fiktif …").
Tidak ada data siswa asli, key, atau credential di folder ini. Folder `tests/`
tidak ikut terdeploy (`.vercelignore`).

| File | Isi | Kebutuhan |
|---|---|---|
| `student-import.test.mjs` | Importer: validasi, data sparse, manifest, dry-run tanpa PII, impor atomik dan cleanup | Node.js; opsional PGlite |
| `student-ui.test.mjs` | Dashboard admin end-to-end di Chromium dengan Supabase tiruan | `playwright-core` + Chromium |
| `../supabase/tests/student_crud_test.sql` | RLS + CRUD di database sungguhan (anon, non-admin, admin, trigger, riwayat) | Supabase SQL Editor |

## Menjalankan

```bash
# Tes dasar (tanpa dependensi). Tes Postgres dan UI otomatis dilewati.
node --test tests/*.test.mjs

# Lengkap
PGLITE_MODULE_DIR=/path/node_modules \
PLAYWRIGHT_MODULE_DIR=/path/node_modules \
CHROMIUM_PATH=/path/chrome \
node --test tests/*.test.mjs

# Opsional: simpan screenshot desktop/tablet/ponsel
UI_SCREENSHOT_DIR=/tmp/shots ... node --test tests/student-ui.test.mjs
```

Dependensi bisa dipasang di luar repo, misalnya:

```bash
mkdir -p ~/test-deps && cd ~/test-deps
npm i @electric-sql/pglite playwright-core
npx playwright-core install chromium   # atau pakai Chrome yang sudah ada
```

## Cakupan uji UI (`student-ui.test.mjs`)

- Tanpa login: hanya form login, tidak ada request ke data siswa.
- Akun non-admin: ditolak di layar login, tidak ada request ke data siswa.
- Admin: kartu ringkasan 559 / 535 / 24 / 17 di Dashboard dan tab Data Siswa.
- Pencarian nama, NIK, NISN (nol di depan), NIPD, nama ibu; empty state; karakter khusus.
- Filter kelas dan status; pilihan 10 / 50 / semua; pagination.
- Ekspor CSV: semua hasil filter (bukan hanya halaman), ikut pencarian, UTF-8 BOM,
  header Bahasa Indonesia, NIK utuh, pengaman formula injection, nama file sesuai filter.
- Detail: 7 tab, banner `Perlu verifikasi lebih lanjut`, `—` untuk kosong,
  tanpa `undefined`/`null`/nama field teknis/JSON mentah, tutup dengan Esc.
- Responsif: desktop 1366, tablet 820, ponsel 390 tanpa scroll horizontal; nama tidak menyempit.
- CRUD: tambah (validasi form, NIK ganda ditolak, hanya isian terisi dikirim), ubah
  (form terisi nilai asli, hanya field yang diubah berbeda, tipe angka dipertahankan,
  konflik versi terdeteksi), riwayat perubahan, arsip dengan konfirmasi, filter Arsip,
  pulihkan, dan tidak ada request `DELETE`.
- Modul Guru, Berita, Galeri, Ekstrakurikuler, Memori KaliBot, Pengaturan AI tetap terbuka tanpa error JS.
- Console tanpa biodata; tidak ada request ke `/api/chat`; logout kembali ke login.

Catatan: uji UI memakai Supabase tiruan, jadi **keamanan akses yang sebenarnya**
dibuktikan oleh `supabase/tests/student_rls_test.sql` (RLS) dan pengecekan anon key
langsung ke project (lihat `supabase/README.md`), bukan oleh uji UI.
