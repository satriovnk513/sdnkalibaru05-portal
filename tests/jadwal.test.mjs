// Uji unit modul jadwal: penggabungan sel, daftar per hari, Excel & cetak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const J = require('../jadwal.js');
const X = require('../xlsx-read.js');

function data() {
    const slot = [];
    const t = ['06:30', '07:05', '07:40', '08:15', '08:50', '09:25', '09:45', '10:20', '10:55', '11:30', '12:05', '12:40'];
    for (let i = 0; i < 11; i++) slot.push({ no: i + 1, mulai: t[i], selesai: t[i + 1], istirahat: i === 5 });
    const m = (hari, jam, kode, extra = {}) => ({ hari, jam, jenis: 'mapel', subject_id: `m-${kode}`, kode, mapel: kode, singkat: kode === 'BIN' ? 'Bahasa Indonesia' : kode, kegiatan: null, staff_id: null, guru: null, ...extra });
    const k = (hari, jam, kegiatan) => ({ hari, jam, jenis: 'kegiatan', subject_id: null, kode: null, kegiatan, staff_id: null, guru: null });
    return {
        kelas: { id: 'c3a', nama: '3 A', tingkat: 3, rombel: 'A', tahun_ajaran: '2026/2027' },
        wali: [{ nama: 'Taripah, S.Pd.', nip: '1970', posisi: 1 }],
        kepala_sekolah: { nama: 'Lilis Kholisoh, S.Pd.SD', nip: '1968' },
        slot,
        isi: [
            k(1, 1, 'Upacara Bendera'), k(1, 2, 'Upacara Bendera'),
            m(1, 3, 'PAI', { staff_id: 's1', guru: 'Susy Nurhayati' }), m(1, 4, 'PAI', { staff_id: 's1', guru: 'Susy Nurhayati' }), m(1, 5, 'PAI', { staff_id: 's1', guru: 'Susy Nurhayati' }),
            m(1, 7, 'BIN'), m(1, 8, 'BIN'),
            m(2, 5, 'MTK'), m(2, 7, 'MTK'),   // dipisah istirahat → tidak digabung
            k(5, 9, 'Pulang'), k(5, 10, 'Pulang'), k(5, 11, 'Pulang'),
        ],
        mapel: [],
    };
}

test('susun: isi sama berturut-turut digabung, istirahat memutus gabungan', () => {
    const rows = J.susun(data());
    assert.equal(rows.length, 11);
    assert.equal(rows[0].sel[0].rowspan, 2);           // Upacara jam 1–2
    assert.equal(rows[1].sel[0], null);
    assert.equal(rows[2].sel[0].rowspan, 3);           // PAI jam 3–5
    assert.equal(rows[5].istirahat, true);
    assert.equal(rows[4].sel[1].rowspan, 1);           // MTK jam 5 (sebelum istirahat)
    assert.equal(rows[6].sel[1].rowspan, 1);           // MTK jam 7 (sesudah istirahat)
    assert.equal(rows[8].sel[4].rowspan, 3);           // Pulang Jumat 9–11
    assert.equal(rows[0].sel[2].e, null);              // Rabu kosong
});

test('hariIni: blok per hari + rentang jam/waktu', () => {
    const b = J.hariIni(data(), 1);
    const txt = b.map((x) => (x.istirahat ? 'IST' : `${J.rentangJam(x)} ${J.rentangWaktu(x)} ${J.teks(x.e) || '-'}`));
    assert.deepEqual(txt.slice(0, 5), ['1–2 06.30–07.40 Upacara Bendera', '3–5 07.40–09.25 PAI', 'IST', '7–8 09.45–10.55 Bahasa Indonesia', '9 10.55–11.30 -']);
    assert.equal(J.hariDari('2026-11-16'), 1);   // Senin
    assert.equal(J.hariDari('2026-11-20'), 5);   // Jumat
    assert.equal(J.hariDari('2026-11-21'), 0);   // Sabtu
});

test('mengajarHari: jam berurutan di kelas & mapel yang sama digabung', () => {
    const list = [
        { class_id: 'a', kelas: '1 A', hari: 1, jam: 3, mulai: '07:40', selesai: '08:15', subject_id: 'p' },
        { class_id: 'a', kelas: '1 A', hari: 1, jam: 4, mulai: '08:15', selesai: '08:50', subject_id: 'p' },
        { class_id: 'b', kelas: '3 A', hari: 1, jam: 7, mulai: '09:45', selesai: '10:20', subject_id: 'p' },
        { class_id: 'a', kelas: '1 A', hari: 2, jam: 1, mulai: '06:30', selesai: '07:05', subject_id: 'p' },
    ];
    const r = J.mengajarHari(list, 1);
    assert.equal(r.length, 2);
    assert.deepEqual([r[0].jamAwal, r[0].jamAkhir, r[0].mulai, r[0].selesai], [3, 4, '07:40', '08:50']);
});

test('Excel jadwal: judul, header hari, sel bergabung & istirahat', async () => {
    const bytes = J.xlsx(data());
    const [sh] = await X.readBook(bytes);
    assert.equal(sh.name, 'Jadwal 3 A');
    assert.equal(sh.rows[0][1], 'JADWAL PELAJARAN');
    assert.equal(sh.rows[1][1], 'TAHUN PELAJARAN 2026 / 2027');
    assert.equal(sh.rows[2][6], 'KELAS : III.A');
    assert.deepEqual(sh.rows[4], ['NO.', 'WAKTU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', "JUM'AT"]);
    assert.equal(sh.rows[5][1], '06.30–07.05');
    assert.equal(sh.rows[5][2], 'UPACARA BENDERA');
    assert.equal(sh.rows[7][2], 'PAI\nSusy Nurhayati');
    assert.equal(sh.rows[10][2], 'ISTIRAHAT');
    assert.equal(sh.rows[11][2], 'BHS INDONESIA');
    const xml = new TextDecoder().decode(bytes);
    for (const m of ['B1:G1', 'B2:G2', 'C6:C7', 'C8:C10', 'C11:G11', 'G14:G16']) assert.match(xml, new RegExp(`<mergeCell ref="${m}"/>`));
});

test('cetak jadwal: kop, rowspan, istirahat, tanda tangan', () => {
    const h = J.htmlTabel(data(), { tanggal: '2026-11-20' });
    assert.match(h, /JADWAL PELAJARAN/);
    assert.match(h, /KELAS : III\.A/);
    assert.match(h, /<td rowspan="3" class="">PAI<small>Susy Nurhayati<\/small><\/td>/);
    assert.match(h, /<td colspan="5" class="ist">ISTIRAHAT<\/td>/);
    assert.match(h, /20 November 2026/);
    assert.match(h, /TARIPAH, S\.Pd\./);
    assert.equal(J.namaFile(data()), 'Jadwal_Pelajaran_Kelas_3_A_2026-2027');
});
