// Data siswa FIKTIF untuk pengujian importer. Tidak ada data asli.
// Meniru bentuk top-level file asli: version, school, schoolYear, labels, fields,
// records, summary. NIK berawalan 99 (kode provinsi yang tidak ada); nomor
// telepon berawalan 0000.

export const FAKE_CLASSES = Array.from({ length: 17 }, (_, i) => `${Math.floor(i / 3) + 1}${'ABC'[i % 3]}`);

const pad = (n, w) => String(n).padStart(w, '0');

// 110 field sumber. status_daftar BUKAN field sumber: ia field operasional tambahan.
const BASE_FIELDS = [
    'nik_siswa', 'nama_siswa', 'siswa_nipd', 'siswa_nisn', 'kelas', 'siswa_nama_ibu_kandung',
    'status_dukcapil', 'no_kk', 'no_hp_ayah', 'kode_pos', 'rt', 'rw', 'anggota_keluarga_jumlah',
    'anggota_1_nik', 'anggota_1_nama', 'anggota_1_hubungan', 'anggota_keluarga_validitas', 'tinggi_badan',
];
export const FAKE_FIELDS = [...BASE_FIELDS];
for (let f = 1; FAKE_FIELDS.length < 110; f++) FAKE_FIELDS.push(`keterangan_fiktif_${pad(f, 3)}`);

export function makeFakeRecord(i, { listed = true } = {}) {
    const values = {
        nik_siswa: '99' + pad(i, 14),
        nama_siswa: `Siswa Fiktif ${pad(i, 3)}`,
        siswa_nipd: pad(i, 6),               // nol di depan harus tetap
        siswa_nisn: '00' + pad(i, 8),        // nol di depan harus tetap
        kelas: listed ? FAKE_CLASSES[i % FAKE_CLASSES.length] : null,
        siswa_nama_ibu_kandung: `Ibu Fiktif ${pad(i, 3)}`,
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
        tinggi_badan: 120 + (i % 30),        // angka non-identifier boleh
    };
    const rec = {};
    // Sebagian field sengaja null, meniru data kosong.
    for (const f of FAKE_FIELDS) rec[f] = f in values ? values[f] : (f.endsWith('7') ? null : `nilai ${f}`);
    rec.status_daftar = listed ? 'Tercantum di daftar kelas' : 'Perlu verifikasi lebih lanjut';
    rec._sources = { nama_siswa: 'KJP', siswa_nisn: 'Dapodik', kelas: 'Daftar kelas' };
    rec._catatan = ['Data uji fiktif'];
    rec._asal_data = listed ? ['KJP', 'Dapodik', 'Daftar kelas'] : ['Dapodik'];
    return rec;
}

/** 559 record: 535 tercantum (17 rombel) + 24 perlu verifikasi. */
export function makeFakeRecords() {
    const out = [];
    for (let i = 1; i <= 535; i++) out.push(makeFakeRecord(i, { listed: true }));
    for (let i = 536; i <= 559; i++) out.push(makeFakeRecord(i, { listed: false }));
    return out;
}

/** File lengkap dengan bentuk top-level seperti file asli. */
export function makeFakeFile() {
    return {
        version: 1,
        school: 'SD Fiktif Uji',
        schoolYear: '2026/2027',
        labels: Object.fromEntries(FAKE_FIELDS.map((f) => [f, f.replace(/_/g, ' ')])),
        fields: [...FAKE_FIELDS],
        records: makeFakeRecords(),
        summary: { total: 559, listed: 535, review: 24, rombel: 17 },
    };
}
