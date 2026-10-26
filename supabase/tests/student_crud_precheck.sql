-- Pemeriksaan sebelum migration CRUD (hanya membaca, hasil berupa angka, tanpa biodata).
-- Semua kolom harus 0 agar setiap siswa hasil impor bisa diubah dari dashboard
-- tanpa ditolak trigger penjaga.
select
    count(*)                                                       as total_siswa,
    count(*) filter (where exists (
        select 1 from jsonb_object_keys(s.payload) k
        where k !~ '^[a-z0-9_]{1,64}$'))                           as key_tidak_valid,
    count(*) filter (where exists (
        select 1 from jsonb_each(s.payload) e
        where jsonb_typeof(e.value) not in ('string', 'number', 'boolean', 'null'))) as nilai_bukan_skalar,
    count(*) filter (where exists (
        select 1 from jsonb_each(s.payload) e
        where jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 1000))  as nilai_terlalu_panjang,
    count(*) filter (where exists (
        select 1 from jsonb_each(s.payload) e
        where jsonb_typeof(e.value) = 'number'
          and e.key ~ '(^|_)(nik|nik_wali|nisn|nipd|no_kk|no_hp|no_telp|no_telepon|kode_pos|rt|rw|nomor_akta|hp_orang_tua_ppdb)$')) as identitas_angka,
    count(*) filter (where
        s.nik              is distinct from (s.payload ->> 'nik_siswa')
     or s.nama_siswa       is distinct from (s.payload ->> 'nama_siswa')
     or s.nipd             is distinct from (s.payload ->> 'siswa_nipd')
     or s.nisn             is distinct from (s.payload ->> 'siswa_nisn')
     or s.kelas            is distinct from (s.payload ->> 'kelas')
     or s.nama_ibu_kandung is distinct from (s.payload ->> 'siswa_nama_ibu_kandung')
     or s.status_daftar    is distinct from (s.payload ->> 'status_daftar')
     or s.status_dukcapil  is distinct from (s.payload ->> 'status_dukcapil')) as kolom_inti_beda_payload
from public.student_records s;
