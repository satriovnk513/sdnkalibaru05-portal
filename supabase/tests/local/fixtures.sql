-- =============================================================================
-- Data FIKTIF untuk tes lokal Absensi. Nama guru = nama publik di halaman
-- Guru & Staf (dibutuhkan seed). Siswa sepenuhnya fiktif (NIK berawalan 99).
-- =============================================================================

insert into public.staff (name, role) values
    ('Lilis Kholisoh, S.Pd.SD',         'Kepala Sekolah|Kepala Sekolah'),
    ('Taripah, S.Pd.',                  'Wakil Kepala Sekolah|Wakil Kepala Sekolah'),
    ('Yayuk Pujayanti, S.Pd.',          'Wakil Kepala Sekolah|Wakil Kepala Sekolah'),
    ('Dara Chaerunnisa, S.Pd.',         'Bendahara Sekolah|Bendahara Sekolah'),
    ('Sunarsih, S.Pd.',                 'Guru Kelas|Guru Kelas'),
    ('Ika Fitri Herti Winarsih, S.Pd.', 'Guru Kelas|Guru Kelas'),
    ('Purnawati, S.Pd.',                'Guru Kelas|Guru Kelas'),
    ('Choirunnisa, S.Pd.',              'Guru Kelas|Guru Kelas'),
    ('Suharni, S.Pd.',                  'Guru Kelas|Guru Kelas'),
    ('Siti Maysyaroh, S.Pd.',           'Guru Kelas|Guru Kelas'),
    ('Ahmad Soleh, S.Pd.',              'Guru Kelas|Guru Kelas'),
    ('Akna Dewi, S.Pd.',                'Guru Kelas|Guru Kelas'),
    ('Annisa Khoirotunnisa, S.Pd.',     'Guru Kelas|Guru Kelas'),
    ('Samsuri, S.Pd.',                  'Guru Kelas|Guru Kelas'),
    ('Nuryamah, S.Pd.',                 'Guru Kelas|Guru Kelas'),
    ('Fauziah Ambar Parawansa, S.Pd.',  'Guru Kelas|Guru Kelas'),
    ('Desy Iswahyuni, S.Pd.',           'Guru Kelas|Guru Kelas'),
    ('Abdul Azis, S.Pd.',               'Guru Kelas|Guru Kelas'),
    ('Susy Nurhayati',                  'Guru Mata Pelajaran|Guru Pendidikan Agama Islam'),
    ('Nurul Mawaddah, S.Pd.',           'Guru Mata Pelajaran|Guru Pendidikan Agama Islam'),
    ('Nasori, S.Pd.',                   'Guru Mata Pelajaran|Guru Olahraga'),
    ('Josua Prasetyo, S.Pd.',           'Guru Mata Pelajaran|Guru Olahraga'),
    ('Paroji',                          'Tenaga Kependidikan|Operator');

-- Siswa fiktif. Dimasukkan sebagai postgres (trigger penjaga browser tidak aktif).
insert into public.student_records (nik, nama_siswa, nipd, nisn, kelas, status_daftar, payload)
select v.nik, v.nama, v.nipd, v.nisn, v.kelas, v.status,
       jsonb_build_object(
           'nik_siswa', v.nik, 'nama_siswa', v.nama, 'siswa_nipd', v.nipd, 'siswa_nisn', v.nisn,
           'kelas', v.kelas, 'status_daftar', v.status,
           'siswa_jenis_kelamin_nama', v.jk, 'siswa_agama', v.agama,
           'siswa_no_kk', '9911111111111111',
           'ayah_nama', 'Ayah Fiktif ' || v.nipd, 'ayah_nik', '9922222222222222',
           'ibu_nama', 'IBU FIKTIF ' || v.nipd, 'siswa_nama_ibu_kandung', 'IBU FIKTIF ' || v.nipd,
           'wali_nama', v.wali, 'ayah_penghasilan', 'Rp. 5,000,000 - Rp. 20,000,000',
           'kontak_no_hp', '+62 812-0000-0001', 'ibu_no_hp', '081200000001', 'ayah_no_hp', '6281200000002',
           'siswa_no_hp', '0812 0000 0003',
           'lain_kebutuhan_khusus', 'Tidak ada', 'siswa_alamat', 'Jl. Fiktif No. 1')
from (values
    ('9900000000000101', 'Siswa Fiktif Satu',   '9001', '0090000001', '1 A', 'Tercantum di daftar kelas', 'Laki-laki', 'Islam',   'IBU FIKTIF 9001'),
    ('9900000000000102', 'Siswa Fiktif Dua',    '9002', '0090000002', '1 A', 'Tercantum di daftar kelas', 'Perempuan', 'Islam',   'Wali Lain 9002'),
    ('9900000000000103', 'Siswa Fiktif Tiga',   '9003', '0090000003', '1 A', 'Tercantum di daftar kelas', 'Perempuan', 'Kristen', null),
    ('9900000000000301', 'Siswa Fiktif Empat',  '9004', '0090000004', '3 A', 'Tercantum di daftar kelas', 'Laki-laki', 'Islam',   null),
    ('9900000000000302', 'Siswa Fiktif Lima',   '9005', '0090000005', '3 A', 'Tercantum di daftar kelas', 'Laki-laki', 'Hindu',   null),
    ('9900000000000401', 'Siswa Fiktif Enam',   '9006', '0090000006', '4 A', 'Tercantum di daftar kelas', 'Perempuan', 'Islam',   null),
    ('9900000000000999', 'Siswa Fiktif Verif',  '9009', '0090000009', null,  'Perlu verifikasi lebih lanjut', 'Pilih', null, null)
) as v(nik, nama, nipd, nisn, kelas, status, jk, agama, wali);
