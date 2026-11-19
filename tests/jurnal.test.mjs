// Uji unit modul jurnal mengajar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JR = require('../jurnal.js');
const X = require('../xlsx-read.js');

test('rentang jam', () => {
    assert.equal(JR.rentang([4, 5, 7, 8, 9, 10, 11]), '4–5, 7–11');
    assert.equal(JR.rentang([3]), '3');
    assert.equal(JR.rentang([2, 1, 1]), '1–2');
});

test('susunHari: jadwal dikelompokkan per kelas+mapel, dipasangkan catatan; catatan lain di bawah', () => {
    const day = {
        jadwal: [
            { class_id: 'a', kelas: '3 A', subject_id: 'kok', kode: 'KOK', mapel: 'Kokurikuler', jam: 4, mulai: '08:15', selesai: '08:50' },
            { class_id: 'a', kelas: '3 A', subject_id: 'kok', kode: 'KOK', mapel: 'Kokurikuler', jam: 5, mulai: '08:50', selesai: '09:25' },
            { class_id: 'a', kelas: '3 A', subject_id: 'mtk', kode: 'MTK', mapel: 'Matematika', jam: 2, mulai: '07:05', selesai: '07:40' },
            { class_id: 'a', kelas: '3 A', subject_id: 'kok', kode: 'KOK', mapel: 'Kokurikuler', jam: 7, mulai: '09:45', selesai: '10:20' },
        ],
        catatan: [
            { id: 'n1', class_id: 'a', subject_id: 'mtk', judul: null, status: 'terlaksana', materi: 'Pecahan' },
            { id: 'n2', class_id: null, subject_id: null, judul: 'Rapat', status: 'terlaksana' },
            { id: 'n3', class_id: 'a', subject_id: 'ipas', mapel: 'IPAS', judul: null, jam: '3', status: 'tidak' },
        ],
    };
    const it = JR.susunHari(day);
    assert.equal(it.length, 4);
    assert.deepEqual([it[0].mapel, it[0].jam, it[0].waktu, it[0].catatan], ['Kokurikuler', '4–5, 7', '08.15–10.20', null]);
    assert.equal(it[1].catatan.materi, 'Pecahan');
    assert.equal(it[2].lama, true);          // catatan dari jadwal lama
    assert.equal(it[3].jenis, 'lain');
    assert.deepEqual(JR.ringkas(it), { total: 3, dicatat: 2 });
});

test('unduhan bulanan: Excel & cetak', async () => {
    const m = { tahun: 2026, bulan: 11, guru: { nama: 'Sunarsih, S.Pd.', nip: '1970' }, catatan: [
        { tanggal: '2026-11-18', kelas: '1 A', mapel: 'Matematika', judul: null, jam: '1–2', status: 'terlaksana', materi: 'Penjumlahan', keterangan: null },
        { tanggal: '2026-11-18', kelas: null, mapel: null, judul: 'Rapat', jam: null, status: 'tidak', materi: null, keterangan: 'Ditunda' },
    ] };
    const [sh] = await X.readBook(JR.xlsx(m));
    assert.equal(sh.rows[0][0], 'JURNAL MENGAJAR — NOVEMBER 2026');
    assert.deepEqual(sh.rows[4].slice(0, 8), ['1', '18 November 2026', 'Rabu', '1.A', 'Matematika', '1–2', 'Terlaksana', 'Penjumlahan']);
    assert.deepEqual(sh.rows[5].slice(4, 7), ['Rapat', '', 'Tidak terlaksana']);
    const h = JR.html(m);
    assert.match(h, /CATATAN HARIAN GURU/);
    assert.match(h, /NOVEMBER 2026/);
    assert.match(h, /class="mrh">Tidak terlaksana/);
    assert.equal(JR.namaFile(m), 'Jurnal_Mengajar_November_2026');
});
