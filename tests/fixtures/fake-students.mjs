// Data siswa FIKTIF untuk pengujian importer. Tidak ada data asli.
// NIK berawalan 99 (kode provinsi yang tidak ada); nomor telepon berawalan 0000.

export const FAKE_CLASSES = Array.from({ length: 17 }, (_, i) => `${Math.floor(i / 3) + 1}${'ABC'[i % 3]}`);

const pad = (n, w) => String(n).padStart(w, '0');

export function makeFakeStudent(i, { listed = true } = {}) {
    const nik = '99' + pad(i, 14);
    const rec = {
        nik,
        nama_siswa: `Siswa Fiktif ${pad(i, 3)}`,
        nipd: pad(i, 6),                 // nol di depan harus tetap
        nisn: '00' + pad(i, 8),          // nol di depan harus tetap
        kelas: listed ? FAKE_CLASSES[i % FAKE_CLASSES.length] : null,
        nama_ibu_kandung: `Ibu Fiktif ${pad(i, 3)}`,
        status_daftar: listed ? 'Tercantum di daftar kelas' : 'Perlu verifikasi lebih lanjut',
        status_dukcapil: 'Fiktif',
        no_kk: '99' + pad(i + 5000, 14),
        no_hp_ayah: '0000' + pad(i, 8),
        kode_pos: '0' + pad(i % 10000, 4),
        rt: '00' + (i % 9 + 1),
        rw: '0' + pad(i % 20, 2),
        anggota_keluarga_jumlah: '3',
        anggota_1_nik: '99' + pad(i + 9000, 14),
        anggota_1_nama: `Anggota Fiktif ${pad(i, 3)}`,
        anggota_1_hubungan: 'Kakak',
        anggota_keluarga_validitas: 'Fiktif',
        tinggi_badan: 120 + (i % 30),    // angka non-identifier boleh
    };
    // Lengkapi sampai 110 field payload.
    for (let f = 1; Object.keys(rec).length < 110; f++) rec[`keterangan_fiktif_${pad(f, 3)}`] = `nilai ${f}`;
    rec._sources = { nama_siswa: 'KJP', nisn: 'Dapodik', kelas: 'Daftar kelas' };
    rec._catatan = ['Data uji fiktif'];
    rec._asal_data = listed ? ['KJP', 'Dapodik', 'Daftar kelas'] : ['Dapodik'];
    return rec;
}

/** 559 siswa: 535 tercantum (17 rombel) + 24 perlu verifikasi. */
export function makeFakeDataset() {
    const out = [];
    for (let i = 1; i <= 535; i++) out.push(makeFakeStudent(i, { listed: true }));
    for (let i = 536; i <= 559; i++) out.push(makeFakeStudent(i, { listed: false }));
    return out;
}
