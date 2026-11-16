// Tes offline template "Cetak & Dokumen" (dokumen-templates.js). Data fiktif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const Dok = require('../dokumen-templates.js');
const RP = require('../rekap-print.js');

const data = {
    kelas: '1 A', tahun_ajaran: '2026/2027', tanggal: '2026-11-16',
    wali: [{ posisi: 1, nama: 'Sunarsih, S.Pd.', nip: '990000000000000001' }],
    kepala_sekolah: { nama: 'Kepala Fiktif, S.Pd.SD', nip: '990000000000000009' },
    siswa: [
        { student_id: 'a', no: 1, nama: 'SISWA <SATU> & "DUA"', jk: 'L', nis: '9001', nisn: '0090000001', nik: '3172000000000001', no_kk: '3172111111111111',
            tempat_lahir: 'Jakarta', tanggal_lahir: '2019-05-12', agama: 'Islam', ayah: 'Ayah Satu', ibu: 'Ibu Satu', hp: '081200000001', alamat: 'Jl. Fiktif 1' },
        { student_id: 'b', no: 2, nama: 'SISWA DUA', jk: 'P', nis: '9002', nisn: '0090000002', ibu: 'Ibu Dua' },
    ],
};
const opts = (id, over = {}) => ({ ...Dok.defaults(Dok.typeOf(id), '2026-11-16'), ...over });

test('semua jenis dokumen punya pembuat, format, dan isian bawaan', () => {
    assert.ok(Dok.TYPES.length >= 8);
    for (const t of Dok.TYPES) {
        assert.ok(t.formats.includes('print') && t.formats.includes('word'), t.id);
        const o = opts(t.id, t.fields.some((f) => f.type === 'siswa') ? { siswa: 'a' } : {});
        const doc = Dok.build(t.id, data, o);
        assert.ok(doc && doc.body.length > 200 && doc.title, `dokumen ${t.id} terbentuk`);
        assert.doesNotMatch(doc.body, /<SATU>/, `${t.id}: nama di-escape`);
        assert.doesNotMatch(doc.body, /undefined|null|NaN/, `${t.id}: tidak ada nilai kosong mentah`);
    }
});

test('daftar siswa: hanya kolom yang dipilih, NIK ikut bila diminta, landscape bila kolom banyak', () => {
    const a = Dok.build('daftar', data, opts('daftar'));
    assert.match(a.body, /<th>NISN<\/th>/);
    assert.doesNotMatch(a.body, /3172000000000001/, 'NIK tidak tampil bila tidak dipilih');
    assert.equal(a.landscape, false);
    const b = Dok.build('daftar', data, opts('daftar', { kolom: ['nik', 'no_kk', 'ttl', 'ayah', 'ibu', 'alamat'] }));
    assert.match(b.body, /3172000000000001/);
    assert.match(b.body, /Jakarta, 12 Mei 2019/);
    assert.equal(b.landscape, true);
    assert.match(b.body, /Laki-laki 1, Perempuan 1/);
});

test('blanko: jumlah kolom dan judul kolom sesuai isian', () => {
    const d = Dok.build('blanko', data, opts('blanko', { jumlah: 4, label: 'PH1, PH2' }));
    assert.equal((d.body.match(/<th class="kosong">/g) || []).length, 4);
    assert.match(d.body, /<th class="kosong">PH1<\/th><th class="kosong">PH2<\/th><th class="kosong"><\/th>/);
    assert.equal(Dok.build('blanko', data, opts('blanko', { jumlah: 99 })).body.match(/<th class="kosong">/g).length, 20, 'dibatasi 20 kolom');
});

test('daftar hadir: tanda tangan zig-zag; versi orang tua menampilkan nama orang tua', () => {
    const d = Dok.build('hadir', data, opts('hadir', { penanda: 'ortu', kegiatan: 'Ambil Rapor' }));
    assert.match(d.body, /Nama Orang Tua \/ Wali/);
    assert.match(d.body, /Ayah Satu/);
    assert.match(d.body, /Ibu Dua/, 'pakai nama ibu bila ayah kosong');
    assert.match(d.body, /Senin, 16 November 2026/);
    assert.match(d.body, /<td width="17%">1\.<\/td><td width="17%">&nbsp;<\/td>/);
    assert.match(d.body, /<td width="17%">&nbsp;<\/td><td width="17%">2\.<\/td>/);
});

test('surat per siswa: tanpa siswa → null; dengan siswa → kop, nomor kosong jadi titik-titik, tanda tangan', () => {
    assert.equal(Dok.build('aktif', data, opts('aktif')), null);
    const d = Dok.build('aktif', data, opts('aktif', { siswa: 'a', keperluan: 'persyaratan KJP' }));
    assert.match(d.body, /SEKOLAH DASAR NEGERI KALIBARU 05 PAGI/);
    assert.match(d.body, /SURAT KETERANGAN AKTIF SEKOLAH/);
    assert.match(d.body, /Nomor : \.{10,}/);
    assert.match(d.body, /persyaratan KJP/);
    assert.match(d.body, /Jakarta, 16 November 2026/);
    assert.match(d.body, /<u>Kepala Fiktif, S\.Pd\.SD<\/u>/);
    const p = Dok.build('panggilan', data, opts('panggilan', { siswa: 'b', nomor: '12/SD/2026' }));
    assert.match(p.body, /12\/SD\/2026/);
    assert.match(p.body, /Bapak\/Ibu <b>Ibu Dua<\/b>/);
    assert.match(p.body, /Wali Kelas/);
});

test('undangan: satu lembar umum, atau satu lembar per siswa; biodata semua siswa', () => {
    const umum = Dok.build('undangan', data, opts('undangan'));
    assert.equal((umum.body.match(/class="pb"/g) || []).length, 0);
    assert.match(umum.body, /Orang Tua\/Wali Murid Kelas <b>I\.A<\/b>/);
    const per = Dok.build('undangan', data, opts('undangan', { perSiswa: true }));
    assert.equal((per.body.match(/class="pb"/g) || []).length, 1, '2 siswa → 1 pemisah halaman');
    const bio = Dok.build('biodata', data, opts('biodata', { siswa: '*' }));
    assert.equal((bio.body.match(/BIODATA SISWA/g) || []).length, 2);
    assert.match(bio.body, /No\. Kartu Keluarga/);
});

test('halaman: cetak punya tombol, Word punya namespace & pemisah halaman, pratinjau polos', () => {
    const doc = Dok.build('undangan', data, opts('undangan', { perSiswa: true }));
    assert.match(Dok.page(doc, 'print'), /Cetak \/ Simpan PDF/);
    const w = Dok.page(doc, 'word');
    assert.match(w, /schemas-microsoft-com:office:word/);
    assert.match(w, /page-break-before:always/);
    assert.doesNotMatch(w, /class="tbar"/);
    assert.doesNotMatch(Dok.page(doc, 'preview'), /class="tbar"|<script/i);
    assert.match(Dok.page(Dok.build('blanko', data, opts('blanko', { jumlah: 12 })), 'print'), /size: A4 landscape/);
});

test('Excel daftar & blanko valid dibuka openpyxl; surat tidak punya Excel', (t) => {
    assert.equal(Dok.xlsx('aktif', data, {}), null);
    const py = spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' });
    if (py.status !== 0) return t.skip('openpyxl tidak tersedia');
    const dir = mkdtempSync(join(tmpdir(), 'dok-'));
    try {
        const f1 = join(dir, 'a.xlsx'); const f2 = join(dir, 'b.xlsx');
        writeFileSync(f1, RP.buildXlsx(Dok.xlsx('daftar', data, opts('daftar', { kolom: ['nisn', 'nik'] }))));
        writeFileSync(f2, RP.buildXlsx(Dok.xlsx('blanko', data, opts('blanko', { jumlah: 3, label: 'PH1' }))));
        const r = spawnSync('python3', ['-c', `
import openpyxl, sys
a = openpyxl.load_workbook(sys.argv[1]).active
b = openpyxl.load_workbook(sys.argv[2]).active
print(a['D1'].value, '|', a['A6'].value, '|', a['C6'].value, '|', a['D6'].value, '|', a['B7'].value, '|', a['D7'].value)
print(b['E6'].value, '|', b['C8'].value, '|', b.max_column)
`, f1, f2], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        const [l1, l2] = r.stdout.trim().split('\n').map((l) => l.split(' | '));
        assert.deepEqual(l1, ['DAFTAR NAMA SISWA', 'No', 'NISN', 'NIK', 'SISWA <SATU> & "DUA"', '3172000000000001']);
        assert.deepEqual(l2, ['PH1', 'SISWA DUA', '7']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
