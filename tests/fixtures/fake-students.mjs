// Data siswa FIKTIF untuk pengujian importer. Tidak ada data asli.
// Nama 110 field dan hitungan kehadiran per field diambil dari
// tests/fixtures/schema-manifest.json (manifest tanpa data pribadi), sehingga
// fixture meniru struktur dan sifat SPARSE file asli: field opsional yang kosong
// tidak selalu ditulis pada setiap record.
// Nilai sepenuhnya karangan: NIK/KK berawalan 99 (kode provinsi yang tidak ada),
// nomor telepon berawalan 0000, nama "… Fiktif …".

import { readFileSync } from 'node:fs';

const MANIFEST = JSON.parse(readFileSync(new URL('./schema-manifest.json', import.meta.url), 'utf8'));

export const FAKE_FIELDS = Object.freeze([...MANIFEST.declared_fields]);
export const FAKE_PRESENCE = Object.freeze({ ...MANIFEST.field_presence_counts });
export const FAKE_CLASSES = Array.from({ length: 17 }, (_, i) => `${Math.floor(i / 3) + 1}${'ABC'[i % 3]}`);
export const TOTAL = 559;
export const LISTED = 535;

const pad = (n, w) => String(n).padStart(w, '0');
const offsetOf = (field) => {
    if (field === 'kelas_lama') return TOTAL - LISTED; // hanya pada 24 siswa perlu verifikasi
    let h = 0;
    for (const ch of field) h = (h * 31 + ch.charCodeAt(0)) % TOTAL;
    return h;
};
/** Field hadir pada record ke-i (0-based) tepat sebanyak hitungan di manifest. */
const isPresent = (field, i) => ((i + offsetOf(field)) % TOTAL) < FAKE_PRESENCE[field];

function fakeValue(field, n, fieldIdx, listed) {
    if (field === 'nik_siswa') return '99' + pad(n, 14);
    if (field === 'nama_siswa') return `Siswa Fiktif ${pad(n, 3)}`;
    if (field === 'siswa_nipd') return pad(n, 6);                     // nol di depan harus tetap
    if (field === 'siswa_nisn') return '00' + pad(n, 8);              // nol di depan harus tetap
    if (field === 'kelas') return listed ? FAKE_CLASSES[n % FAKE_CLASSES.length] : '';
    if (field === 'status_dukcapil') return 'Fiktif';
    if (/(^|_)nik(_|$)|no_kk$/.test(field)) return '99' + pad(fieldIdx * 1000 + n, 14);
    if (/(^|_)(no_hp|no_telp|no_telepon|hp)(_|$)/.test(field)) return '0000' + pad(n, 8);
    if (/_(rt|rw)$/.test(field)) return '00' + ((n % 9) + 1);
    if (/kode_pos$/.test(field)) return '0' + pad(n % 10000, 4);
    if (/tanggal_lahir$/.test(field)) return `2015-01-${pad((n % 28) + 1, 2)}`;
    if (/tahun_lahir$/.test(field)) return '1985';
    if (field === 'lain_nomor_akta') return `000${n}/AKTA/FIKTIF`;
    if (field === 'lain_lintang') return -6.1;                          // angka non-identifier boleh
    if (field === 'lain_bujur') return 106.9;
    if (/(berat|tinggi|lingkar|anak_ke|saudara|jarak)/.test(field)) return (n % 30) + 1;
    if (/(^|_)nama(_|$)|nama_ibu/.test(field)) return `Nama Fiktif ${field} ${pad(n, 3)}`;
    if (n % 50 === 0) return null;                                      // nilai null eksplisit
    return `Fiktif ${field}`;
}

export function makeFakeRecord(n, { listed = true } = {}) {
    const i = n - 1;
    const rec = {};
    FAKE_FIELDS.forEach((f, idx) => { if (isPresent(f, i)) rec[f] = fakeValue(f, n, idx, listed); });
    rec.status_daftar = listed ? 'Tercantum di daftar kelas' : 'Perlu verifikasi lebih lanjut';
    rec._sources = { nama_siswa: 'KJP', siswa_nisn: 'Dapodik', kelas: 'Daftar kelas' };
    rec._catatan = ['Data uji fiktif'];
    rec._asal_data = listed ? ['KJP', 'Dapodik', 'Daftar kelas'] : ['Dapodik'];
    return rec;
}

/** 559 record: 535 tercantum (17 rombel) + 24 perlu verifikasi. */
export function makeFakeRecords() {
    const out = [];
    for (let n = 1; n <= LISTED; n++) out.push(makeFakeRecord(n, { listed: true }));
    for (let n = LISTED + 1; n <= TOTAL; n++) out.push(makeFakeRecord(n, { listed: false }));
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
        summary: { total: TOTAL, listed: LISTED, review: TOTAL - LISTED, rombel: 17 },
    };
}

/** Manifest fixture: sama dengan manifest asli, tetapi hash/ukuran/rentang dari fixture. */
export function fakeManifestFor(report, { hash, bytes }) {
    return {
        ...MANIFEST,
        source_sha256: hash,
        source_bytes: bytes,
        record_nonmetadata_key_count: report.key_payload_per_record,
    };
}
