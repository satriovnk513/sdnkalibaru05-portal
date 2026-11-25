// Tes offline Kartu Siswa (kartu.js). Data fiktif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const K = require('../kartu.js');

const siswa = [
    { student_id: 'a', nama: 'Siti Aisyah', nisn: '0179876543', nis: '2324', jk: 'P', tempat_lahir: 'JAKARTA UTARA', tanggal_lahir: '2018-01-03', token: '7KQ29XHM', versi: 2 },
    { student_id: 'b', nama: 'Andi Saputra', nisn: '0170000001', nis: '1234', jk: 'L', tempat_lahir: '', tanggal_lahir: '', token: '0011ABCD', versi: 1 },
];
const data = { kelas: { nama: '3 B', tahun_ajaran: '2026/2027' }, siswa };

test('kode siswa: KB05-XXXX-XXXX, bisa diketik dengan salah huruf O/I/L', () => {
    assert.equal(K.kode('7KQ29XHM'), 'KB05-7KQ2-9XHM');
    assert.equal(K.tokenDariScan('KB05-7KQ2-9XHM'), '7KQ29XHM');
    assert.equal(K.tokenDariScan(' kb05 7kq2 9xhm '), '7KQ29XHM');
    assert.equal(K.tokenDariScan('7KQ29XHM'), '7KQ29XHM');
    assert.equal(K.tokenDariScan('KB05-OILA-BCDE'), '011ABCDE');
    for (const x of ['', null, 'KB05-123', 'https://sdnkalibaru05.sch.id/guru#/pinjam/abc', '0179876543', 'KB05-UUUU-UUUU']) assert.equal(K.tokenDariScan(x), null, String(x));
});

test('foto massal: NISN di mana saja, NIS hanya di awal nama file, atau nama persis', () => {
    const id = (f) => K.cocokkanFoto(f, siswa)?.student_id || null;
    assert.equal(id('0179876543.jpg'), 'a');
    assert.equal(id('Foto Siti 0179876543.JPG'), 'a');
    assert.equal(id('2324.png'), 'a');
    assert.equal(id('1234 - Andi.jpeg'), 'b');
    assert.equal(id('C:\\foto\\andi saputra.jpg'), 'b');
    assert.equal(id('IMG_1234.jpg'), null, 'nomor file kamera tidak dianggap NIS');
    assert.equal(id('DSC 2324.jpg'), null);
    assert.equal(id('Andi.jpg'), null, 'nama harus persis');
    assert.equal(id('x.jpg'), null);
});

test('cetak A4: 10 kartu per lembar, bisa lewati slot, QR tidak memuat NISN', () => {
    const banyak = { ...data, siswa: Array.from({ length: 12 }, (_, i) => ({ ...siswa[i % 2], student_id: `s${i}`, token: `000000${String(i).padStart(2, '0')}` })) };
    const html = K.dokumen(banyak, { format: 'a4' });
    assert.match(html, /@page \{ size: A4 portrait; margin: 0; \}/);
    assert.equal(html.match(/<div class="kertas">/g).length, 2);
    assert.equal(html.match(/class="kt"/g).length, 12);
    assert.equal(html.match(/class="slot kosong"/g).length, 8);
    const lewat = K.dokumen(banyak, { format: 'a4', skip: 9 });
    assert.equal(lewat.match(/<div class="kertas">/g).length, 3);
    assert.ok(!html.includes('0179876543"'), 'NISN tidak masuk atribut/QR');
});

test('cetak PVC: satu kartu per halaman 85,6 × 54 mm, hanya siswa terpilih', () => {
    const html = K.dokumen(data, { format: 'pvc', pilih: ['b'] });
    assert.match(html, /@page \{ size: 85.6mm 54mm; margin: 0; \}/);
    assert.equal(html.match(/<div class="kertas">/g).length, 1);
    assert.match(html, /Andi Saputra/);
    assert.ok(!/Siti Aisyah/.test(html));
    assert.equal(K.namaFile(data, 'pvc'), 'Kartu_Pelajar_III.B_PVC');
});

test('isi kartu: kelas Romawi + TA, TTL rapi, jenis kelamin, kartu ke-2, kotak foto bila belum ada', () => {
    const html = K.dokumen(data, { fotos: { a: 'data:image/jpeg;base64,AAAA' } });
    assert.match(html, /III\.B \(2026\/2027\)/);
    assert.match(html, /Jakarta Utara, 3 Januari 2018/);
    assert.match(html, /Perempuan/);
    assert.match(html, /Laki-laki/);
    assert.match(html, /Kartu ke-2/);
    assert.match(html, /KB05-7KQ2-9XHM/);
    assert.match(html, /data:image\/jpeg;base64,AAAA/);
    assert.match(html, /Tempel<br>foto/);
    assert.match(html, /<td>–<\/td>/, 'TTL kosong jadi strip');
    assert.ok(!/<script/i.test(K.dokumen({ ...data, siswa: [{ ...siswa[0], nama: '<script>x</script>' }] })), 'nama di-escape');
});

test('tanda tangan: tanggal & kepsek dari pengaturan, atau dari data guru bila kosong', () => {
    const kd = { nama: 'Kepala Fiktif, S.Pd', nip: '197001012000031001' };
    const a = K.dokumen({ ...data, pengaturan: { tempat: 'Jakarta Utara', tanggal_ttd: '2026-07-13', kepsek_default: kd } }, { aset: { ttd: 'data:image/png;base64,TTD', stempel: 'data:image/png;base64,CAP' } });
    assert.match(a, /Jakarta Utara, 13 Juli 2026/);
    assert.match(a, /Kepala Fiktif, S\.Pd/);
    assert.match(a, /NIP\. 197001012000031001/);
    assert.match(a, /class="kt-ttd-gbr" src="data:image\/png;base64,TTD"/);
    assert.match(a, /class="kt-stempel" src="data:image\/png;base64,CAP"/);
    const b = K.dokumen({ ...data, pengaturan: { tempat: 'Jakarta', kepsek_nama: 'Nama Lain', kepsek_default: kd } }, { tanggal: '2026-11-25' });
    assert.match(b, /Jakarta, 25 November 2026/, 'tanggal kosong → tanggal cetak');
    assert.match(b, /Nama Lain/);
    assert.ok(!/197001012000031001/.test(b), 'nama diganti manual → NIP data guru tidak dipakai');
    assert.ok(!/class="kt-ttd-gbr"/.test(b), 'TTD belum ada → area kosong');
    assert.ok(!/alamat/i.test(K.kartuHtml(siswa[0], {}).replace(/Jl\. Kalibaru Barat IV No\. 60, Cilincing, Jakarta Utara/, '')), 'alamat siswa tidak dicetak');
});
