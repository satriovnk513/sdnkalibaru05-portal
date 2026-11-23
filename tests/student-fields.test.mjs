// Uji metadata field Data Siswa: label, pengelompokan tab, dan daftar pilihan dropdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
global.window = {};
require('../student-fields.js');
const F = global.window.StudentFields;

test('pengelompokan tab', () => {
    assert.equal(F.GROUPS.length, 7);
    assert.equal(F.groupOf('nik_siswa'), 'siswa');
    assert.equal(F.groupOf('ayah_nama'), 'ayah');
    assert.equal(F.groupOf('kontak_no_hp'), 'kontak');
    assert.equal(F.groupOf('anggota_1_nik'), 'keluarga');
    assert.equal(F.groupOf('field_asing'), 'lain');
});

test('label Bahasa Indonesia', () => {
    assert.equal(F.labelOf('nik_siswa'), 'NIK');
    assert.equal(F.labelOf('ayah_pendidikan_nama'), 'Pendidikan');
    assert.equal(F.labelOf('lain_berat_badan'), 'Berat Badan (kg)');
    assert.equal(F.labelOf('siswa_kode_pos'), 'Kode Pos');
});

test('isian berpilihan tetap jadi dropdown, isian bebas tidak', () => {
    for (const k of ['nama_siswa', 'siswa_alamat', 'siswa_tempat_lahir', 'siswa_no_hp', 'lain_anak_ke',
        'lain_berat_badan', 'siswa_kelurahan_nama', 'siswa_kabupaten_nama', 'kelas', 'keterangan']) {
        assert.equal(F.optionsOf(k), null, `${k} seharusnya isian bebas`);
    }
    for (const k of ['status_dukcapil', 'siswa_agama', 'siswa_jenis_tinggal', 'siswa_alat_transportasi',
        'siswa_jenis_kelamin_nama', 'siswa_provinsi_nama', 'ayah_pendidikan_nama', 'ayah_pekerjaan_nama',
        'ayah_penghasilan', 'ibu_pendidikan_nama', 'ibu_penghasilan', 'wali_agama_nama', 'wali_validitas',
        'wali_status_pernikahan_nama', 'wali_tipe_alamat_nama', 'wali_jabatan_golongan_nama',
        'kontak_hubungan_nama', 'kontak_kelengkapan', 'anggota_1_hubungan', 'anggota_keluarga_validitas',
        'lain_penerima_kps', 'lain_penerima_kip', 'lain_usulan_pip', 'lain_alasan_pip',
        'lain_kebutuhan_khusus', 'lain_status_lapor_diri', 'lain_status_pendaftaran']) {
        const o = F.optionsOf(k);
        assert.ok(Array.isArray(o) && o.length >= 2, `${k} seharusnya punya daftar pilihan`);
        assert.equal(new Set(o).size, o.length, `${k} punya pilihan ganda`);
        assert.ok(o.every((v) => typeof v === 'string' && v.trim() === v && v), `${k} punya pilihan kosong/berspasi`);
    }
});

test('pilihan yang sama dipakai konsisten lintas ayah/ibu/wali', () => {
    for (const suffix of ['pendidikan_nama', 'pekerjaan_nama', 'penghasilan']) {
        const [a, i, w] = ['ayah', 'ibu', 'wali'].map((g) => F.optionsOf(`${g}_${suffix}`));
        assert.deepEqual(a, i);
        assert.deepEqual(a, w);
    }
    assert.deepEqual(F.optionsOf('siswa_agama'), F.optionsOf('wali_agama_nama'));
    assert.deepEqual(F.optionsOf('wali_validitas'), F.optionsOf('anggota_keluarga_validitas'));
});

test('pilihan menampung nilai yang sudah ada di data sekolah', () => {
    const dipakai = {
        siswa_agama: ['Islam', 'Kristen', 'Hindu'],
        siswa_jenis_tinggal: ['Bersama orang tua', 'Wali', 'Lainnya'],
        siswa_alat_transportasi: ['Jalan kaki', 'Sepeda', 'Sepeda motor', 'Angkutan umum/bus/pete-pete', 'Lainnya'],
        ayah_pekerjaan_nama: ['Buruh', 'Nelayan', 'PNS/TNI/Polri', 'Sudah Meninggal', 'Wiraswasta'],
        wali_status_pernikahan_nama: ['Janda/Duda', 'Lajang', 'Menikah'],
        wali_jabatan_golongan_nama: ['Honorer', 'Kontrak', 'Tetap', 'Tidak Bekerja'],
        kontak_hubungan_nama: ['Kakek/Nenek', 'Suami/Istri', 'Ipar dari Istri/Suami'],
        anggota_1_hubungan: ['Adik', 'Ayah', 'Ibu', 'Kakak', 'Wali'],
        lain_alasan_pip: ['Menolak', 'Pemegang PKH/KPS/KKS', 'Siswa Miskin/Rentan Miskin'],
        lain_kebutuhan_khusus: ['Tidak ada', 'J - Bakat Istimewa'],
        siswa_provinsi_nama: ['DKI JAKARTA'],
    };
    for (const [k, nilai] of Object.entries(dipakai)) {
        const o = F.optionsOf(k);
        for (const v of nilai) assert.ok(o.includes(v), `${k}: "${v}" hilang dari daftar pilihan`);
    }
});
