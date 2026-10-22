# Importer Data Siswa (`scripts/import-students.mjs`)

Script lokal untuk impor awal 559 siswa ke `student_records`. Script ini dijalankan
di server (VPS) dan **tidak pernah** dipakai dari browser.

- **Tanpa dependensi.** Cukup Node.js 18 ke atas (memakai `fetch` bawaan).
- **Default: dry-run.** Validasi berjalan offline, tanpa jaringan dan tanpa key.
- **Privasi.** Output hanya berisi angka agregat, nomor urut record, dan nama field.
  NIK, KK, HP, alamat, nama, dan nilai biodata lain tidak pernah dicetak. Bagian
  `details` dan `hint` dari error Supabase juga tidak dicetak, karena bisa memuat isi
  baris.

## 1. Letak file data

```bash
mkdir -p ~/private/sdnkalibaru05-students
chmod 700 ~/private ~/private/sdnkalibaru05-students
# unggah file JSON ke folder itu, lalu:
chmod 600 ~/private/sdnkalibaru05-students/*.json
```

Importer menolak file jika:

- file berada di dalam repository;
- izin file bukan 600 (group/other punya akses);
- izin folder bukan 700.

## 2. Dry-run (aman, tanpa key)

```bash
cd ~/projects/sdnkalibaru05-portal
node scripts/import-students.mjs --file ~/private/sdnkalibaru05-students/<file>.json
```

Validasi seluruh file dilakukan **sebelum** ada penulisan apa pun:

- struktur wajib: top-level object dengan `records` (array) dan `fields` (array string).
  Key lain (`version`, `school`, `schoolYear`, `labels`, `summary`) diabaikan, tetapi
  namanya dilaporkan;
- `fields` berisi tepat 110 nama unik, dan setiap nama ada di setiap record;
- `status_daftar` adalah **field operasional** di luar `fields`, sehingga payload berisi
  111 key (110 sumber + 1 operasional). Ini bukan duplikasi. Key lain di luar field
  sumber, field operasional, dan metadata ditolak;
- mapping kolom inti (key sumber tetap dipakai apa adanya di `payload`):
  `nik`←`nik_siswa`, `nama_siswa`←`nama_siswa`, `nipd`←`siswa_nipd`,
  `nisn`←`siswa_nisn`, `kelas`←`kelas`, `nama_ibu_kandung`←`siswa_nama_ibu_kandung`,
  `status_daftar`←`status_daftar`, `status_dukcapil`←`status_dukcapil`. Semuanya wajib
  ada dan bertipe teks atau null;
- total 559, tercantum 535, perlu verifikasi 24, rombel 17;
- NIK 16 digit dan unik, nama siswa tidak kosong;
- siswa berstatus tercantum wajib punya kelas;
- `status_daftar` hanya salah satu dari 2 nilai yang diizinkan;
- `_sources` → `field_sources` (object), `_catatan` → `matching_notes` (array),
  `_asal_data` → `source_names` (array);
- `payload` berupa object, tanpa ketiga key metadata di atas;
- field identifier (NIK, NISN, NIPD, KK, HP/telp, kode pos, RT/RW, dll.) wajib berupa
  teks. Nilai angka atau notasi ilmiah (misalnya `3.17E+15`) ditolak, karena
  menandakan digit atau nol di depan sudah hilang.
- Nilai sumber **tidak diubah**: tidak di-trim, tidak dikonversi, disalin apa adanya.

Dry-run mencetak SHA-256 file. Hash ini wajib dipakai pada langkah eksekusi.

## 3. Metode transaksi dan cleanup

Urutan saat `--execute`:

| # | Langkah | Jika gagal |
|---|---|---|
| 1 | Validasi seluruh file (offline) | Berhenti. Tidak ada koneksi jaringan |
| 2 | `--confirm-sha256` harus sama dengan hash file | Berhenti. Tidak ada koneksi jaringan |
| 3 | Kedua tabel siswa wajib **kosong** dan hash belum pernah diimpor | Berhenti tanpa perubahan |
| 4 | INSERT 1 baris `student_import_batches` (hash, jumlah) | Tidak ada yang tertulis |
| 5 | INSERT **semua 559 siswa dalam satu request** | Cleanup |
| 6 | Verifikasi: jumlah, rombel via `student_summary()`, lalu **setiap baris** dibandingkan dengan sumber (kolom inti, payload, metadata, batch id) | Cleanup |

- **All-or-nothing untuk siswa.** PostgREST menjalankan satu request dalam satu
  transaksi Postgres. Jadi 559 baris masuk semua, atau tidak ada sama sekali. Ini
  diuji pada Postgres sungguhan: baris ke-300 dibuat gagal, hasilnya 0 baris sebelum
  cleanup.
- **Cleanup** berjalan otomatis jika langkah 5–6 gagal, termasuk karena timeout
  (siswa mungkin sudah tersimpan), jaringan putus, verifikasi tidak cocok, atau
  Ctrl-C. Langkahnya:
  1. `DELETE student_records where import_batch_id = <batch>`;
  2. `DELETE student_import_batches where id = <batch>`;
  3. memastikan kedua tabel kembali kosong.
- **Jika cleanup gagal** (misalnya koneksi putus total), script mencetak batch id.
  Impor berikutnya otomatis menolak berjalan karena tabel tidak kosong. Bersihkan
  manual di SQL Editor:

  ```sql
  begin;
  delete from public.student_records        where import_batch_id = '<batch-id>';
  delete from public.student_import_batches where id = '<batch-id>';
  select (select count(*) from public.student_records) as siswa,
         (select count(*) from public.student_import_batches) as batch;  -- harus 0 dan 0
  commit;
  ```

- Script hanya menyentuh `student_records`, `student_import_batches`, dan RPC
  `student_summary()`. Tabel lama tidak disentuh.
- Script tidak memakai akun admin browser. Key yang diterima hanya `service_role`
  (JWT) atau `sb_secret_...`; anon/publishable key ditolak.

## 4. Eksekusi (HANYA setelah disetujui terpisah)

Dijalankan sendiri oleh pemilik melalui SSH. Key diketik ke prompt tersembunyi:

```bash
cd ~/projects/sdnkalibaru05-portal
set +x
read -rsp 'Tempel Supabase service_role / secret key: ' SB_KEY; printf '\n'
SUPABASE_SERVICE_ROLE_KEY="$SB_KEY" node scripts/import-students.mjs \
  --execute \
  --file ~/private/sdnkalibaru05-students/<file>.json \
  --confirm-sha256 <SHA-256 dari dry-run>
unset SB_KEY
```

- Riwayat shell hanya menyimpan teks `$SB_KEY`, bukan nilai key-nya. Key tidak
  muncul sebagai argumen, sehingga tidak terlihat di `ps`.
- Variabel `SB_KEY` tidak di-export. Key hanya ada di environment proses `node` selama
  impor berjalan.
- Catatan jujur: selama proses berjalan, environment proses bisa dibaca oleh user
  yang sama di server (dan root) lewat `/proc`. Agent Hermes berjalan sebagai user
  yang sama, tetapi tidak membaca atau menyimpannya.
- Jangan menaruh key di `.env` di dalam repo, di argumen command, atau di chat.
- Setelah impor, key **lama** tidak perlu dirotasi kecuali pernah terekspos. Kalau
  ingin lebih aman, buat secret key khusus impor di dashboard, lalu hapus setelah selesai.

## 5. Pengujian

```bash
node --test tests/*.test.mjs
# tambahan uji Postgres sungguhan (PGlite + migration asli):
PGLITE_MODULE_DIR=/path/ke/node_modules node --test tests/*.test.mjs
```

Semua data uji fiktif (`tests/fixtures/fake-students.mjs`, NIK berawalan 99).
