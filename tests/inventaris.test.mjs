// Uji unit fungsi bersama inventaris: impor Excel, QR, template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Inv = require('../inventaris.js');
const X = require('../xlsx-read.js');
const QR = require('../qr.js');
const R = require('../rekap-print.js');

test('parseImport mengenali judul kolom fleksibel & melewati baris kosong', () => {
    const rows = [
        ['DAFTAR BARANG'],
        [],
        ['No', 'Kode Barang', 'Nama Barang', 'Merek', 'Ruang', 'Kondisi', 'Jenis pinjam', 'Thn', 'Qty', 'Keterangan'],
        ['1', 'LAP-9', 'Laptop', 'Acer', 'TU', 'Baik', 'Jangka panjang', '2024', '1', 'ok'],
        ['', '', '', '', '', '', '', '', '', ''],
        ['3', '', 'Speaker', '', '', '', '', '', '2.0', ''],
        ['4', '', '', 'X', '', '', '', '', '', ''],
        ['5', '', 'Kursi', '', '', '', '', '', 'dua', ''],
    ];
    const { items, errors } = Inv.parseImport(rows);
    assert.equal(items.length, 2);
    assert.deepEqual({ ...items[0] }, { baris: 4, kode: 'LAP-9', nama: 'Laptop', merk: 'Acer', lokasi: 'TU', kondisi: 'Baik', jenis_pinjam: 'Jangka panjang', jumlah: 1, catatan: 'ok' });
    assert.equal(items[1].jumlah, 2);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /Baris 7: nama barang kosong/);
    assert.match(errors[1], /Baris 8: jumlah "dua"/);
});

test('parseImport tanpa kolom nama → pesan jelas', () => {
    assert.match(Inv.parseImport([['Kode', 'Merk']]).errors[0], /Nama barang/);
});

test('codeFromScan mengambil token dari URL stiker atau kode ketikan', () => {
    assert.equal(Inv.codeFromScan('https://sdnkalibaru05.sch.id/guru#/pinjam/abc123def456'), 'abc123def456');
    assert.equal(Inv.codeFromScan('  LAP-001 '), 'LAP-001');
    assert.equal(Inv.qrUrl('abc'), 'https://sdnkalibaru05.sch.id/guru#/pinjam/abc');
});

test('template impor bisa dibaca balik oleh pembaca Excel sendiri', async () => {
    const bytes = Inv.templateXlsx(R.buildXlsx);
    const rows = await X.read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'template.xlsx');
    const { items, errors } = Inv.parseImport(rows);
    assert.equal(errors.length, 0);
    assert.equal(items.length, 3);
    assert.equal(items[1].kode, 'SPK');
    assert.equal(items[1].jumlah, 2);
    assert.equal(items[0].jenis_pinjam, 'Jangka panjang');
});

test('QR: ukuran versi naik sesuai panjang teks, SVG berisi zona tenang putih', () => {
    assert.equal(QR.matrix('A').version, 1);
    assert.equal(QR.matrix(Inv.qrUrl('abc123def456')).version, 4);
    const svg = QR.svg('halo', { size: 100 });
    assert.match(svg, /^<svg[^>]+viewBox="0 0 29 29" width="100" height="100"/);
    assert.match(svg, /<rect width="29" height="29" fill="#fff"\/>/);
    assert.throws(() => QR.matrix('x'.repeat(500)), /terlalu panjang/);
});

test('stickerHtml: 24 per A4, slot awal bisa dilewati, nama di-escape', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ nama: i ? `Barang ${i}` : '<b>Jahil</b>', kode: `B-${i}`, qr_token: `t${i}` }));
    const html = Inv.stickerHtml(items, { qr: () => '<svg></svg>', skip: 2 });
    assert.equal((html.match(/class="kertas"/g) || []).length, 2);
    assert.equal((html.match(/class="st kosong"/g) || []).length, 2);
    assert.ok(html.includes('&lt;b&gt;Jahil&lt;/b&gt;'));
    assert.ok(!html.includes('<b>Jahil</b>'));
});
