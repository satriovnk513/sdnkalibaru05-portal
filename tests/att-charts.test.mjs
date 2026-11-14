// Tes offline modul grafik absensi (att-charts.js). Data fiktif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const AC = createRequire(import.meta.url)('../att-charts.js');
const t = { H: 25, S: 2, I: 1, A: 1, D: 1 };

test('persentase kehadiran: dispensasi dihitung hadir; kosong → null', () => {
    assert.equal(AC.pct(t), 86.7);
    assert.equal(AC.pct({ H: 0, S: 0, I: 0, A: 0, D: 3 }), 100);
    assert.equal(AC.pct({}), null);
    assert.equal(AC.pctText(null), '–');
    assert.equal(AC.pctText(86.7), '86,7%');
});

test('kartu rekap per tanggal: lima baris termasuk Dispensasi, dengan angka dan label', () => {
    const html = AC.rows(t);
    for (const s of ['Hadir (H)', 'Izin (I)', 'Sakit (S)', 'Alpa (A)', 'Dispensasi (D)', '25 siswa', '1 siswa']) assert.ok(html.includes(s), s);
    assert.equal((html.match(/class="ac-row"/g) || []).length, 5);
    assert.match(AC.badge(t), /86,7%/);
    assert.match(AC.badge({}), /empty/);
});

test('donat & batang komposisi punya label teks (tidak hanya warna)', () => {
    for (const html of [AC.donut(t), AC.bars(t)]) for (const l of Object.values(AC.LABEL)) assert.ok(html.includes(l), l);
    assert.match(AC.donut({}), /Belum ada data/);
});

test('tren: batang bertumpuk & garis %, kosong → pesan', () => {
    const pts = [{ label: '1', title: '1 Nov', H: 3 }, { label: '2', title: '2 Nov', H: 1, A: 2 }];
    assert.match(AC.stacked(pts), /<rect /);
    assert.match(AC.line(pts), /Terendah <b>33,3%<\/b> \(2 Nov\)/);
    assert.match(AC.stacked([]), /ac-empty/);
    assert.match(AC.line([{ label: '1' }]), /ac-empty/);
});

test('siswa paling sering tidak hadir: urut terbanyak, yang selalu hadir tidak tampil', () => {
    const html = AC.students([{ nama: 'Hadir Terus', H: 5 }, { nama: 'Sering Alpa', A: 3, S: 1 }, { nama: 'Sakit Sekali', S: 1 }]);
    assert.ok(html.indexOf('Sering Alpa') < html.indexOf('Sakit Sekali'));
    assert.ok(!html.includes('Hadir Terus'));
    assert.match(html, /4 hari/);
    assert.match(AC.students([{ nama: 'X', H: 1 }]), /Tidak ada siswa/);
});

test('nama siswa di-escape', () => {
    assert.ok(!AC.students([{ nama: '<img src=x onerror=1>', A: 1 }]).includes('<img'));
});

test('gabung per bulan untuk rentang semester', () => {
    const B = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const m = AC.byMonth([{ tanggal: '2026-10-01', H: 3 }, { tanggal: '2026-10-02', H: 2, A: 1 }, { tanggal: '2026-11-03', H: 3 }], B);
    assert.deepEqual(m.map((x) => [x.label, x.H, x.A, x.hari]), [['Okt', 5, 1, 2], ['Nov', 3, 0, 1]]);
    assert.equal(m[0].title, 'Oktober 2026 (2 hari)');
});
