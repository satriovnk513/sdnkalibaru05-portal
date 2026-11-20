// Uji unit modul Catatan Siswa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../catatan.js');

const notes = [
    { id: '1', student_id: 'a', jenis: 'apresiasi', tanggal: '2026-09-02', judul: 'Juara 2 lomba mewarnai', penulis: 'Bu Sunarsih' },
    { id: '2', student_id: 'a', jenis: 'perilaku', tingkat: 'serius', tanggal: '2026-10-11', judul: 'Bertengkar <b>', penulis: 'Pak Arif' },
    { id: '3', student_id: 'b', jenis: 'perilaku', tingkat: 'ringan', tanggal: '2026-10-01', judul: 'Terlambat', tindak_lanjut: 'Dinasihati', penulis: 'Bu Sunarsih' },
    { id: '4', student_id: 'b', jenis: 'catatan', tanggal: '2026-08-20', judul: 'Sering mengantuk', penulis: 'Bu Sunarsih' },
];
const kelas = {
    kelas: { id: 'c', nama: '3 A', tingkat: 3, rombel: 'A', tahun_ajaran: '2026/2027' }, semester: 1, lihat_semua: true,
    wali: [{ nama: 'Taripah, S.Pd.', nip: '1970', posisi: 1 }], kepala_sekolah: { nama: 'Lilis Kholisoh, S.Pd.SD', nip: '1968' },
    siswa: [{ id: 'a', no: 1, nama: 'Aisyah' }, { id: 'b', no: 2, nama: 'Bima' }, { id: 'c', no: 3, nama: 'Citra' }],
    catatan: notes,
};

test('label & kode', () => {
    assert.equal(C.label(notes[0]), 'Apresiasi');
    assert.equal(C.label(notes[1]), 'Perilaku · Serius');
    assert.equal(C.label({ jenis: 'perilaku', tingkat: 'perhatian' }), 'Perilaku · Perlu perhatian');
    assert.deepEqual(notes.map(C.kode), ['★', '! S', '! R', '✎']);
});

test('hitung per siswa & ringkas', () => {
    const h = C.hitung(notes);
    assert.deepEqual(h.get('a'), { apresiasi: 1, perilaku: 1, catatan: 0, serius: 1, seriusTerbuka: 1, total: 2 });
    assert.deepEqual(h.get('b'), { apresiasi: 0, perilaku: 1, catatan: 1, serius: 0, seriusTerbuka: 0, total: 2 });
    assert.equal(h.get('c'), undefined);
    const r = C.ringkas(notes);
    assert.equal(r.apresiasi, 1); assert.equal(r.perilaku, 2); assert.equal(r.catatan, 1); assert.equal(r.serius, 1);
    assert.deepEqual(r.seriusTerbuka.map((n) => n.id), ['2']);
});

test('tanggal & kelas', () => {
    assert.equal(C.tglSedang('2026-11-03'), '3 Nov 2026');
    assert.equal(C.kelasTitik('3 A'), '3.A');
    assert.equal(C.kelasTitik({ nama: '6 B' }), '6.B');
});

test('rangkuman kelas: semua siswa, urut tanggal, aman HTML, ttd', () => {
    const h = C.htmlKelas(kelas, { tanggal: '2026-12-18' });
    assert.match(h, /RANGKUMAN CATATAN SISWA/);
    assert.match(h, /SEMESTER GANJIL/);
    assert.match(h, /KELAS : III\.A/);
    assert.ok(h.indexOf('AISYAH') < h.indexOf('BIMA') && h.indexOf('BIMA') < h.indexOf('CITRA'));
    assert.ok(h.indexOf('Juara 2') < h.indexOf('Bertengkar'), 'urut tanggal');
    assert.match(h, /Bertengkar &lt;b&gt; — tindak lanjut belum diisi/);
    assert.match(h, /Terlambat — Dinasihati/);
    assert.match(h, /Tidak ada catatan\./);
    assert.match(h, /TARIPAH, S.Pd./); assert.match(h, /LILIS KHOLISOH/);
    assert.doesNotMatch(h, /Berisi catatan yang Anda tulis saja/);
    assert.match(C.htmlKelas({ ...kelas, lihat_semua: false }), /Berisi catatan yang Anda tulis saja/);
});

test('catatan satu siswa', () => {
    const h = C.htmlSiswa({ siswa: { id: 'a', nama: 'Aisyah Putri', nis: '9001', kelas: '3 A' }, catatan: notes.filter((n) => n.student_id === 'a') }, { tanggal: '2026-12-18' });
    assert.match(h, /CATATAN SISWA/);
    assert.match(h, /AISYAH PUTRI · NIS 9001/);
    assert.match(h, /KELAS : 3\.A/);
    assert.match(h, /Perilaku · Serius/);
    assert.match(h, /Belum diisi/);
    assert.match(h, /Pak Arif/);
    assert.doesNotMatch(h, /<b>Bertengkar <b>/);
});
