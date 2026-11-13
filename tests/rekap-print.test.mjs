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
});

test('HTML bulanan: blanko kosong dan pilihan wali 2 tanpa NIP', () => {
    const h = RP.monthlyHtml(month, header, { wali: 2, showNip: false, blank: true });
    assert.doesNotMatch(h, />•</);
    assert.match(h, /GURU PENDAMPING, S\.Pd\./);
    assert.doesNotMatch(h, /NIP\./);
});

test('HTML semester: persentase dan tanggal tanda tangan = hari ini bila semester berjalan', () => {
    const h = RP.semesterHtml(sem, header, {});
    assert.match(h, /REKAP ABSENSI SEMESTER GANJIL/);
    assert.match(h, /80%/);
    assert.match(h, /<td>–<\/td>/);
    assert.match(h, /Jakarta, 13 November 2026/);
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
print(m.title, '|', m['D1'].value, '|', m['D4'].value, '|', m['D8'].value, '|', m['F8'].value, '|', m['G8'].value, '|', m.cell(8, 5 + 31 + 1).value, '|', m['F6'].value, '|', m.cell(7, 5 + 19).fill.fgColor.rgb, '|', len(m.merged_cells.ranges))
print(s.title, '|', s['D1'].value, '|', s['D7'].value, '|', s['F7'].value, '|', s['K7'].value, '|', s['K8'].value)
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
        assert.deepEqual(l1.slice(0, 9), ['III.A Desember 2026', 'DAFTAR HADIR SISWA', 'KELAS : III.A', 'SISWA FIKTIF <SATU> & "DUA"', '•', 'S', '1', 'BULAN : DESEMBER 2026', 'FFFF0000']);
        assert.equal(Number(l1[9]), 9);
        assert.deepEqual(l2, ['Semester GANJIL III.A', 'REKAP ABSENSI SEMESTER GANJIL', 'SISWA FIKTIF SATU', '8', '80', '–']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('CRC32 sesuai nilai standar', () => {
    assert.equal(RP.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
