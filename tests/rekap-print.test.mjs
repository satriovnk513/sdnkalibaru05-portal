// Tes offline modul cetak & Excel rekap absensi (data fiktif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import RP from '../rekap-print.js';

const header = {
    kelas: '3 A', tahun_ajaran: '2026/2027',
    wali: [{ posisi: 1, nama: 'Taripah, S.Pd.', nip: '990000000000000002' }, { posisi: 2, nama: 'Guru Pendamping, S.Pd.', nip: null }],
    kepala_sekolah: { nama: 'Lilis Kholisoh, S.Pd.SD', nip: '990000000000000009' },
};
const days = Array.from({ length: 31 }, (_, i) => {
    const d = `2026-12-${String(i + 1).padStart(2, '0')}`;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return { tanggal: d, libur: dow === 0 || dow === 6 || i + 1 === 25 || i + 1 >= 19, diisi: i < 3 };
});
const month = {
    kelas: '3 A', tahun: 2026, bulan: 12, hari_efektif: 12, hari: days,
    siswa: [
        { no: 1, nama: 'Siswa Fiktif <Satu> & "Dua"', jk: 'L', nis: '9001', nisn: '0090000001', status: { '2026-12-01': 'H', '2026-12-02': 'S', '2026-12-03': 'A' } },
        { no: 2, nama: 'Siswa Fiktif Dua', jk: 'P', nis: '9002', nisn: '0090000002', status: { '2026-12-01': 'H', '2026-12-02': 'H', '2026-12-03': 'D' } },
    ],
};
const sem = {
    semester: 1, mulai: '2026-07-13', selesai: '2026-12-31', sampai_hari_ini: '2026-11-13', hari_efektif: 85, hari_terisi: 3,
    siswa: [
        { no: 1, nama: 'Siswa Fiktif Satu', jk: 'L', nis: '9001', nisn: '0090000001', H: 8, S: 1, I: 0, A: 1, D: 0 },
        { no: 2, nama: 'Siswa Fiktif Dua', jk: 'P', nis: '9002', nisn: '0090000002', H: 0, S: 0, I: 0, A: 0, D: 0 },
    ],
};

test('HTML bulanan: kop, kelas Romawi, kolom libur merah, total, tanda tangan', () => {
    const h = RP.monthlyHtml(month, header, { wali: 1, showNip: true });
    assert.match(h, /DAFTAR HADIR SISWA/);
    assert.match(h, /TAHUN PELAJARAN 2026 \/ 2027/);
    assert.match(h, /KELAS : III\.A/);
    assert.match(h, /BULAN : DESEMBER 2026/);
    assert.equal((h.match(/<th class="libur">/g) || []).length, days.filter((d) => d.libur).length);
    assert.match(h, /Laki-laki = 1<br>Perempuan = 1/);
    assert.match(h, /LILIS KHOLISOH, S\.Pd\.SD/);
    assert.match(h, /TARIPAH, S\.Pd\./);
    assert.match(h, /Jakarta, 31 Desember 2026/);
    assert.match(h, /NIP\. 990000000000000009/);
    assert.match(h, /SISWA FIKTIF &lt;SATU&gt; &amp; &quot;DUA&quot;/, 'nama di-escape');
    assert.doesNotMatch(h, /<SATU>/);
    assert.match(h, />✓</, 'hadir ditandai centang');
    assert.doesNotMatch(h, /•/, 'tidak ada titik lagi');
});

test('tanggal tanda tangan bulanan = tanggal terakhir bulan yang dipilih', () => {
    assert.equal(RP.akhirBulan(2026, 11), '2026-11-30');
    assert.equal(RP.akhirBulan(2026, 12), '2026-12-31');
    assert.equal(RP.akhirBulan(2027, 2), '2027-02-28');
    assert.equal(RP.akhirBulan(2028, 2), '2028-02-29');
    const nov = { ...month, bulan: 11, hari: month.hari.slice(0, 13) };
    assert.match(RP.monthlyHtml(nov, header, {}), /Jakarta, 30 November 2026/, 'walau data hari tidak lengkap');
});

test('HTML bulanan: blanko kosong dan pilihan wali 2 tanpa NIP', () => {
    const h = RP.monthlyHtml(month, header, { wali: 2, showNip: false, blank: true });
    assert.doesNotMatch(h, />✓</);
    assert.match(h, /GURU PENDAMPING, S\.Pd\./);
    assert.doesNotMatch(h, /NIP\./);
});

test('HTML semester: persentase; tanda tangan ganjil 31 Desember, genap 30 Juni (tahun semester itu)', () => {
    const h = RP.semesterHtml(sem, header, {});
    assert.match(h, /REKAP ABSENSI SEMESTER GANJIL/);
    assert.match(h, /80%/);
    assert.match(h, /<td>–<\/td>/);
    assert.match(h, /Jakarta, 31 Desember 2026/);
    const genap = { ...sem, semester: 2, mulai: '2027-01-01', selesai: '2027-07-10', sampai_hari_ini: '2026-11-13' };
    assert.match(RP.semesterHtml(genap, header, {}), /Jakarta, 30 Juni 2027/);
    assert.equal(RP.ttdSemester({ semester: 2, mulai: '2028-01-01' }), '2028-06-30');
});

test('pct dan namaTtd', () => {
    assert.equal(RP.pct({ H: 8, S: 1, I: 0, A: 1 }), 80);
    assert.equal(RP.pct({ H: 0, S: 0, I: 0, A: 0 }), null);
    assert.equal(RP.pct({ H: 7, S: 1, I: 0, A: 1, D: 1 }), 80, 'dispensasi dihitung hadir');
    assert.equal(RP.namaTtd('Abdul Azis, S.Pd.'), 'ABDUL AZIS, S.Pd.');
    assert.equal(RP.namaTtd('Paroji'), 'PAROJI');
});

const py = spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' });
test('XLSX valid dibuka openpyxl: bulanan & semester', { skip: py.status !== 0 ? 'openpyxl tidak tersedia' : false }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'rekap-'));
    try {
        const fm = join(dir, 'bulanan.xlsx');
        const fs = join(dir, 'semester.xlsx');
        const logoPng = new Uint8Array(readFileSync(new URL('../logo-cetak.png', import.meta.url)));
        writeFileSync(fm, RP.monthlyXlsx(month, header, { logoPng }));
        writeFileSync(fs, RP.semesterXlsx(sem, header, { logoPng }));
        const script = `
import sys, openpyxl
m = openpyxl.load_workbook(sys.argv[1]).active
s = openpyxl.load_workbook(sys.argv[2]).active
print(m.title, '|', m['C1'].value, '|', m.cell(3, 5 + 31 + 3 - 6 + 1).value, '|', m['D7'].value, '|', m['F7'].value, '|', m['G7'].value, '|', m.cell(7, 5 + 31 + 1).value, '|', m['F5'].value, '|', m.cell(6, 5 + 19).fill.fgColor.rgb, '|', len(m.merged_cells.ranges), '|', m.column_dimensions['F'].width, '|', m.sheet_view.showGridLines, '|', m.page_setup.fitToHeight, '|', m.row_dimensions[7].height, '|', m['B7'].number_format)
print(s.title, '|', s['C1'].value, '|', s['D6'].value, '|', s['F6'].value, '|', s['K6'].value, '|', s['K7'].value)
import zipfile
for f in sys.argv[1:3]:
    z = zipfile.ZipFile(f)
    assert z.testzip() is None
    print(len(z.read('xl/media/image1.png')), '|', 'drawing r:id' in z.read('xl/worksheets/sheet1.xml').decode())
`;
        const r = spawnSync('python3', ['-c', script, fm, fs], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        const [l1, l2, i1, i2] = r.stdout.trim().split('\n').map((l) => l.split(' | '));
        assert.deepEqual(i1, [String(logoPng.length), 'True'], 'logo tertanam di Excel bulanan');
        assert.deepEqual(i2, [String(logoPng.length), 'True'], 'logo tertanam di Excel semester');
        assert.deepEqual(l1.slice(0, 9), ['III.A Desember 2026', 'DAFTAR HADIR SISWA', 'KELAS : III.A', 'SISWA FIKTIF <SATU> & "DUA"', '✓', 'S', '1', 'BULAN : DESEMBER 2026', 'FFFF0000']);
        assert.equal(Number(l1[9]), 10);
        assert.deepEqual(l1.slice(10), ['3.3', 'False', '1', '13.5', '@'], 'kolom tanggal cukup lebar, tanpa garis grid, 1 halaman, NIS sebagai teks');
        assert.deepEqual(l2, ['Semester GANJIL III.A', 'REKAP ABSENSI SEMESTER GANJIL', 'SISWA FIKTIF SATU', '8', '80%', '–']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

const soffice = spawnSync('soffice', ['--version'], { encoding: 'utf8' });
test('XLSX blanko: kotak tanggal kosong, jumlah S/I/A rumus yang menghitung sendiri saat diisi', { skip: py.status !== 0 ? 'openpyxl tidak tersedia' : false }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'blanko-'));
    try {
        const f = join(dir, 'blanko.xlsx');
        writeFileSync(f, RP.monthlyXlsx(month, header, { blank: true }));
        const script = `
import sys, openpyxl
m = openpyxl.load_workbook(sys.argv[1]).active
akhir = 5 + 31
isi = [m.cell(r, c).value for r in (7, 8) for c in range(6, akhir + 1)]
print(m.title, '|', sum(1 for v in isi if v not in (None, '')), '|', m.cell(7, akhir + 1).value, '|', m.cell(7, akhir + 3).value, '|', next(str(m.cell(r, 1).value)[:4] for r in range(1, m.max_row + 1) if str(m.cell(r, 1).value or '').startswith('Isi')))
m['F7'] = 'S'; m['G7'] = 'S'; m['H7'] = 'A'
m.parent.save(sys.argv[2])
`;
        const isi = join(dir, 'isi.xlsx');
        const r = spawnSync('python3', ['-c', script, f, isi], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        const [judul, terisi, rumusS, rumusA, ket] = r.stdout.trim().split(' | ');
        assert.equal(judul, 'Blanko III.A Desember 2026');
        assert.equal(Number(terisi), 0, 'semua kotak tanggal kosong');
        assert.equal(rumusS, '=IF(COUNTIF(F7:AJ7,"S")=0,"",COUNTIF(F7:AJ7,"S"))');
        assert.equal(rumusA, '=IF(COUNTIF(F7:AJ7,"A")=0,"",COUNTIF(F7:AJ7,"A"))');
        assert.equal(ket, 'Isi:');
        if (soffice.status === 0) {
            const c = spawnSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', dir, isi], { encoding: 'utf8', timeout: 60000 });
            assert.equal(c.status, 0, c.stderr);
            const baris7 = readFileSync(join(dir, 'isi.csv'), 'utf8').split('\n')[6].split(',');
            assert.deepEqual(baris7.slice(-3), ['2', '', '1'], 'setelah diisi S, S, A → jumlah S=2, I kosong, A=1');
            const baris8 = readFileSync(join(dir, 'isi.csv'), 'utf8').split('\n')[7].split(',');
            assert.deepEqual(baris8.slice(-3), ['', '', ''], 'baris yang belum diisi tetap bersih (tanpa angka 0)');
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('HTML blanko: keterangan cara mengisi, judul jendela Blanko', () => {
    const h = RP.monthlyHtml(month, header, { blank: true });
    assert.match(h, /Isi: ✓ = hadir, S = sakit/);
    assert.match(h, /<title>Blanko Daftar Hadir III\.A Desember 2026<\/title>/);
    assert.doesNotMatch(h, /<td class="h">/, 'tidak ada tanda hadir');
});

test('label NIP/NUPTK di tanda tangan: tidak pernah "NIP. NUPTK."', () => {
    assert.equal(RP.labelNip('NUPTK. 7448776677230133'), 'NUPTK. 7448776677230133');
    assert.equal(RP.labelNip('197804252025211064'), 'NIP. 197804252025211064');
    assert.equal(RP.labelNip('NIP. 197804252025211064'), 'NIP. 197804252025211064');
    assert.equal(RP.labelNip('nuptk 123'), 'NUPTK. 123');
    assert.equal(RP.labelNip('-'), 'NIP. -');
    assert.equal(RP.labelNip(null), 'NIP. -');
    assert.deepEqual(RP.pisahNip('NUPTK. 7448'), { jenis: 'NUPTK', nomor: '7448' });
    const h = RP.monthlyHtml(month, { ...header, wali: [{ nama: 'Annisa Khoirotunnisa, S.Pd.', nip: 'NUPTK. 7448776677230133', posisi: 1 }] }, { showNip: true });
    assert.match(h, /<div>NUPTK\. 7448776677230133<\/div>/);
    assert.doesNotMatch(h, /NIP\. NUPTK/);
});

test('CRC32 sesuai nilai standar', () => {
    assert.equal(RP.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('logo Excel: nempel kiri judul kop, di tengah tinggi kop, ukuran ikut kop', () => {
    const png = new Uint8Array(readFileSync(new URL('../logo-cetak.png', import.meta.url)));
    const rows = [[null, { v: 'JUDUL' }], [null, { v: 'SEKOLAH' }], [], ['No', 'Nama']];
    const L = RP.kopLogo({ rows, widths: [4, 30], heights: { 1: 18, 2: 18, 3: 6 }, png });
    const { left, top, width: w, height: h } = L.box;
    const xText = RP.colPx(L.widths[0]);
    assert.ok(left + w <= xText - 6 && left + w >= xText - 10, 'jarak ±8px ke judul');
    const kopH = L.box.kopHeight; assert.equal(L.box.kopRows, 2); assert.equal(kopH, 48);
    assert.ok(Math.abs(top - (kopH - h) / 2) <= 1, 'tengah vertikal');
    assert.ok(Math.max(w, h) >= 36 && Math.max(w, h) <= 56, 'ukuran 36–56px');
    assert.ok(L.widths[0] > 4, 'kolom A dilebarkan supaya logo muat');
    assert.match(L.drawing, /<xdr:oneCellAnchor><xdr:from><xdr:col>0<\/xdr:col>/);
    // judul di kolom A → logo tidak boleh menimpa (tetap di margin, teks digeser tidak dipaksa)
    const L2 = RP.kopLogo({ rows: [[{ v: 'X' }]], widths: [], heights: {}, png });
    assert.ok(L2.box.left >= 0);
});
