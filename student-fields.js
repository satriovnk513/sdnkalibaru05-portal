// Metadata tampilan Data Siswa: label Bahasa Indonesia dan kelompok detail.
// Hanya berisi NAMA field (dari skema sumber), tidak berisi data siswa.
(function () {
    'use strict';

    // Urutan field sumber (110) + field operasional status_daftar.
    const FIELD_ORDER = [
        'nik_siswa', 'nama_siswa', 'siswa_nipd', 'siswa_nisn', 'kelas', 'kelas_lama', 'keterangan', 'status_dukcapil',
        'siswa_no_kk', 'siswa_tempat_lahir', 'siswa_tanggal_lahir', 'siswa_nama_ibu_kandung', 'siswa_no_hp', 'siswa_alamat',
        'siswa_rt', 'siswa_rw', 'siswa_jenis_kelamin_nama', 'siswa_provinsi_nama', 'siswa_kabupaten_nama',
        'siswa_kecamatan_nama', 'siswa_kelurahan_nama', 'wali_nik_wali', 'wali_no_kk', 'wali_nama', 'wali_tempat_lahir',
        'wali_tanggal_lahir', 'wali_nama_ibu_wali', 'wali_alamat', 'wali_rt', 'wali_rw', 'wali_kode_pos', 'wali_no_hp',
        'wali_no_telp', 'wali_jenis_kelamin_nama', 'wali_agama_nama', 'wali_tipe_alamat_nama',
        'wali_status_tempat_tinggal_nama', 'wali_provinsi_nama', 'wali_kabupaten_nama', 'wali_kecamatan_nama',
        'wali_kelurahan_nama', 'wali_status_pernikahan_nama', 'wali_pendidikan_nama', 'wali_pekerjaan_nama',
        'wali_jabatan_golongan_nama', 'wali_validitas', 'kontak_nama', 'kontak_no_hp', 'kontak_alamat', 'kontak_rt',
        'kontak_rw', 'kontak_kode_pos', 'kontak_hubungan_nama', 'kontak_provinsi_nama', 'kontak_kabupaten_nama',
        'kontak_kecamatan_nama', 'kontak_kelurahan_nama', 'kontak_kelengkapan', 'anggota_keluarga_jumlah',
        'anggota_1_nik', 'anggota_1_nama', 'anggota_1_hubungan', 'anggota_keluarga_validitas', 'siswa_agama',
        'siswa_dusun', 'siswa_kode_pos', 'siswa_jenis_tinggal', 'siswa_alat_transportasi', 'siswa_no_telepon',
        'lain_penerima_kps', 'lain_penerima_kip', 'lain_nomor_akta', 'lain_usulan_pip', 'lain_alasan_pip',
        'lain_kebutuhan_khusus', 'lain_sekolah_asal', 'lain_anak_ke', 'lain_berat_badan', 'lain_tinggi_badan',
        'lain_lingkar_kepala', 'lain_saudara_kandung', 'lain_jarak_sekolah', 'lain_lintang', 'lain_bujur',
        'lain_nama_orang_tua_ppdb', 'lain_hp_orang_tua_ppdb', 'lain_status_lapor_diri', 'lain_status_pendaftaran',
        'ayah_nama', 'ayah_nik', 'ayah_tahun_lahir', 'ayah_tanggal_lahir', 'ayah_tempat_lahir', 'ayah_pendidikan_nama',
        'ayah_pekerjaan_nama', 'ayah_penghasilan', 'ayah_no_hp', 'ayah_alamat', 'ibu_nama', 'ibu_nik', 'ibu_tahun_lahir',
        'ibu_tanggal_lahir', 'ibu_tempat_lahir', 'ibu_pendidikan_nama', 'ibu_pekerjaan_nama', 'ibu_penghasilan',
        'ibu_no_hp', 'ibu_alamat', 'wali_tahun_lahir', 'wali_penghasilan', 'status_daftar',
    ];

    // Label untuk bagian setelah prefix grup dihapus.
    const BASE_LABELS = {
        nik: 'NIK', nik_wali: 'NIK', no_kk: 'Nomor KK', nama: 'Nama', tempat_lahir: 'Tempat Lahir',
        tanggal_lahir: 'Tanggal Lahir', tahun_lahir: 'Tahun Lahir', alamat: 'Alamat', rt: 'RT', rw: 'RW',
        kode_pos: 'Kode Pos', no_hp: 'Nomor HP', no_telp: 'Nomor Telepon', no_telepon: 'Nomor Telepon',
        jenis_kelamin_nama: 'Jenis Kelamin', agama_nama: 'Agama', agama: 'Agama', tipe_alamat_nama: 'Tipe Alamat',
        status_tempat_tinggal_nama: 'Status Tempat Tinggal', provinsi_nama: 'Provinsi',
        kabupaten_nama: 'Kabupaten/Kota', kecamatan_nama: 'Kecamatan', kelurahan_nama: 'Kelurahan',
        status_pernikahan_nama: 'Status Pernikahan', pendidikan_nama: 'Pendidikan', pekerjaan_nama: 'Pekerjaan',
        jabatan_golongan_nama: 'Jabatan/Golongan', validitas: 'Validitas Data', penghasilan: 'Penghasilan',
        hubungan_nama: 'Hubungan dengan Siswa', kelengkapan: 'Kelengkapan Data', dusun: 'Dusun',
        jenis_tinggal: 'Jenis Tinggal', alat_transportasi: 'Alat Transportasi', nama_ibu_wali: 'Nama Ibu Kandung Wali',
    };

    const SPECIAL = {
        nik_siswa: 'NIK', nama_siswa: 'Nama Lengkap', siswa_nipd: 'NIPD', siswa_nisn: 'NISN', kelas: 'Kelas',
        kelas_lama: 'Kelas Sebelumnya', keterangan: 'Keterangan', status_dukcapil: 'Status Dukcapil',
        siswa_nama_ibu_kandung: 'Nama Ibu Kandung', status_daftar: 'Status Daftar Kelas',
        anggota_keluarga_jumlah: 'Jumlah Anggota Keluarga', anggota_1_nik: 'Anggota 1 — NIK',
        anggota_1_nama: 'Anggota 1 — Nama', anggota_1_hubungan: 'Anggota 1 — Hubungan',
        anggota_keluarga_validitas: 'Validitas Data Keluarga', kontak_nama: 'Nama Kontak',
        lain_penerima_kps: 'Penerima KPS', lain_penerima_kip: 'Penerima KIP', lain_nomor_akta: 'Nomor Akta Lahir',
        lain_usulan_pip: 'Usulan PIP', lain_alasan_pip: 'Alasan Layak PIP', lain_kebutuhan_khusus: 'Kebutuhan Khusus',
        lain_sekolah_asal: 'Sekolah Asal', lain_anak_ke: 'Anak Ke-', lain_berat_badan: 'Berat Badan (kg)',
        lain_tinggi_badan: 'Tinggi Badan (cm)', lain_lingkar_kepala: 'Lingkar Kepala (cm)',
        lain_saudara_kandung: 'Jumlah Saudara Kandung', lain_jarak_sekolah: 'Jarak ke Sekolah (km)',
        lain_lintang: 'Lintang', lain_bujur: 'Bujur', lain_nama_orang_tua_ppdb: 'Nama Orang Tua (PPDB)',
        lain_hp_orang_tua_ppdb: 'Nomor HP Orang Tua (PPDB)', lain_status_lapor_diri: 'Status Lapor Diri',
        lain_status_pendaftaran: 'Status Pendaftaran', wali_nama: 'Nama Wali', ayah_nama: 'Nama Ayah',
        ibu_nama: 'Nama Ibu',
    };

    const GROUPS = [
        { id: 'siswa', title: 'Data Siswa', prefixes: ['siswa_'], extra: ['nik_siswa', 'nama_siswa', 'kelas', 'kelas_lama', 'status_dukcapil'] },
        { id: 'ayah', title: 'Ayah', prefixes: ['ayah_'] },
        { id: 'ibu', title: 'Ibu', prefixes: ['ibu_'] },
        { id: 'wali', title: 'Wali', prefixes: ['wali_'] },
        { id: 'kontak', title: 'Kontak Darurat', prefixes: ['kontak_'] },
        { id: 'keluarga', title: 'Anggota Keluarga', prefixes: ['anggota_'] },
        { id: 'lain', title: 'Keterangan Lain', prefixes: ['lain_'], extra: ['keterangan', 'status_daftar'] },
    ];

    function groupOf(key) {
        for (const g of GROUPS) if (g.extra && g.extra.includes(key)) return g.id;
        for (const g of GROUPS) if (g.prefixes.some((p) => key.startsWith(p))) return g.id;
        return 'lain';
    }

    function labelOf(key) {
        if (SPECIAL[key]) return SPECIAL[key];
        const rest = key.replace(/^(siswa|ayah|ibu|wali|kontak|anggota|lain)_/, '');
        if (BASE_LABELS[rest]) return BASE_LABELS[rest];
        return rest.split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    window.StudentFields = Object.freeze({ FIELD_ORDER, GROUPS, groupOf, labelOf });
})();
