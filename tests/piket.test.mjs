// Uji unit modul piket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../piket.js');
const X = require('../xlsx-read.js');

const data = (mode = 'bulanan') => ({
    kelas: { id: 'c', nama: '3 A', tingkat: 3, rombel: 'A', tahun_ajaran: '2026/2027' },
    mode, tanggal: '2026-11-20', semester: 1,
    wali: [{ nama: 'Taripah, S.Pd.', nip: '1970', posisi: 1 }], kepala_sekolah: { nama: 'Lilis Kholisoh, S.Pd.SD', nip: '1968' },
    siswa: [
        { id: 'a', no: 2, nama: 'Bima', jk: 'L', hari: 1 }, { id: 'b', no: 1, nama: 'Aisyah', jk: 'P', hari: 1 },
        { id: 'c', no: 3, nama: 'Citra', jk: 'P', hari: 2 }, { id: 'd', no: 4, nama: 'Dimas', jk: 'L', hari: 5 },
    ],
});

test('perHari & hitung', () => {
    const h = P.perHari(data());
    assert.deepEqual(h.map((l) => l.map((s) => s.nama)), [['Aisyah', 'Bima'], ['Citra'], [], [], ['Dimas']]);
    assert.deepEqual(P.hitung(h[0]), { L: 1, P: 1 });
});

test('label periode', () => {
    assert.equal(P.labelPeriode(data()), 'November 2026');
    assert.equal(P.labelPeriode(data('semester')), 'Semester Ganjil 2026/2027');
    assert.equal(P.namaFile(data()), 'Jadwal_Piket_Kelas_3_A_November_2026');
});

test('Excel & cetak piket', async () => {
    const [sh] = await X.readBook(P.xlsx(data()));
    assert.equal(sh.rows[0][0], 'JADWAL PIKET KELAS 3.A');
    assert.deepEqual(sh.rows[3].filter(Boolean), ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT']);
    assert.deepEqual(sh.rows[5].slice(0, 6), ['1', 'AISYAH', 'P', '1', 'CITRA', 'P']);
    assert.equal(sh.rows[sh.rows.length - 1][0], '2 siswa · 1 L, 1 P');
    const h = P.html(data(), { tanggal: '2026-11-20' });
    assert.match(h, /JADWAL PIKET KELAS/);
    assert.match(h, /Periode: <b>November 2026<\/b>/);
    assert.match(h, /<td class="nm">DIMAS<\/td>/);
    assert.match(h, /TARIPAH, S\.Pd\./);
});
