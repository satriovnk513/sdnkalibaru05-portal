// Uji unit modul nilai: rumus, Excel multi-lembar (tulis → baca), impor, cetak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const N = require('../nilai.js');
const X = require('../xlsx-read.js');
const XB = require('../xlsx-book.js');

const KELAS = '11111111-2222-3333-4444-555555555555';
function data() {
    return {
        kelas: { id: KELAS, nama: '3A', tingkat: 3, rombel: 'A', tahun_ajaran: '2026/2027' },
        semester: 1,
        wali: [{ nama: 'Sunarsih, S.Pd', nip: '1970', posisi: 1 }],
        kepala_sekolah: { nama: 'Lilis Kholisoh, S.Pd.SD', nip: '1968' },
        mapel: [
            { id: 'm1', kode: 'MTK', nama: 'Matematika', singkat: 'Matematika', kktp: 75, hidden: false, guru_mapel: null, can_edit: true },
            { id: 'm2', kode: 'BIN', nama: 'Bahasa Indonesia', singkat: 'B. Indonesia', kktp: null, hidden: false, guru_mapel: null, can_edit: true },
            { id: 'm3', kode: 'PAI', nama: 'PAI', singkat: 'PAI', kktp: 70, hidden: false, guru_mapel: ['Susy'], can_edit: false },
            { id: 'm4', kode: 'SER', nama: 'Serasi', singkat: 'Serasi', kktp: null, hidden: true, guru_mapel: null, can_edit: true },
        ],
        siswa: [
            { id: 's1', no: 1, nis: '4798', nisn: '3147757403', nama: 'Aisyah Putri', jk: 'P' },
            { id: 's2', no: 2, nis: '4791', nisn: '3144127428', nama: 'Bima Saputra', jk: 'L' },
            { id: 's3', no: 3, nis: '', nisn: '3137103765', nama: 'Citra Anjani', jk: 'P' },
        ],
        nilai: [
            { s: 's1', m: 'm1', uh1: 80, uh2: 85, uh3: 90, sts: 78, sas: 82 },
            { s: 's2', m: 'm1', uh1: 70, uh2: null, uh3: null, sts: 60, sas: 70 },
        ],
    };
}

test('hitung: 50% rata UH terisi + 25% STS + 25% SAS, dibulatkan biasa', () => {
    assert.deepEqual(N.hitung({ uh1: 80, uh2: 85, uh3: 90, sts: 78, sas: 82 }), { rataUh: 85, akhir: 83, uhKurang: 0, lengkap: true });
    // 0,5 dibulatkan ke atas: 50*0.5? → (71+72)/2=71.5 → 35.75 + 17.5 + 17.5 = 70.75 → 71
    assert.equal(N.hitung({ uh1: 71, uh2: 72, sts: 70, sas: 70 }).akhir, 71);
    assert.equal(N.hitung({ uh1: 70, sts: 71, sas: 71 }).akhir, 71);   // 35 + 17.75 + 17.75 = 70.5 → 71
    const kurang = N.hitung({ uh1: 70, sts: 60, sas: 70 });
    assert.equal(kurang.akhir, 68);
    assert.equal(kurang.uhKurang, 2);
    assert.equal(N.hitung({ uh1: 90, uh2: 90, sts: 90 }).akhir, null);      // SAS kosong
    assert.equal(N.hitung({ sts: 90, sas: 90 }).akhir, null);               // UH kosong semua
    assert.equal(N.status({ uh1: 80, sts: 80, sas: 80 }, 75), 'tuntas');
    assert.equal(N.status({ uh1: 60, sts: 60, sas: 60 }, 75), 'belum');
    assert.equal(N.status({ uh1: 60, sts: 60, sas: 60 }, null), 'kktp');
    assert.equal(N.status({ uh1: 60 }, 75), 'kosong');
    assert.equal(N.status({}, 75), '');
});

test('angka: bulat 0–100, kosong = null, lainnya galat', () => {
    assert.equal(N.angka(''), null);
    assert.equal(N.angka(' 80 '), 80);
    assert.equal(N.angka('80.0'), 80);
    assert.equal(N.angka('0'), 0);
    assert.equal(N.angka('100'), 100);
    assert.match(N.angka('101').galat, /0–100/);
    assert.match(N.angka('-1').galat, /0–100/);
    assert.match(N.angka('80,5').galat, /bulat/);
    assert.match(N.angka('A').galat, /bukan angka/);
});

test('buku: lembar Petunjuk + per mapel tampil (+Leger), rumus & proteksi', async () => {
    const bytes = N.buku(data(), { leger: true });
    const book = await X.readBook(bytes);
    assert.deepEqual(book.map((b) => b.name), ['Petunjuk', 'Matematika', 'Bahasa Indonesia', 'PAI', 'Leger']);
    const mtk = book[1].rows;
    assert.equal(mtk[2][3], '75');
    assert.match(mtk[3][0], new RegExp(`^#NILAI\\|MAPEL:MTK\\|KELAS:${KELAS}\\|SEM:1`));
    assert.deepEqual(mtk[5].slice(0, 9), ['No', 'NIS', 'NISN', 'Nama Siswa', 'UH 1', 'UH 2', 'UH 3', 'STS', 'SAS']);
    assert.deepEqual(mtk[6].slice(0, 9), ['1', '4798', '3147757403', 'AISYAH PUTRI', '80', '85', '90', '78', '82']);
    assert.match(book[3].rows[0][0], /hanya lihat/);
    const xml = new TextDecoder().decode(bytes);
    assert.match(xml, /<sheetProtection sheet="1"/);
    assert.match(xml, /<f>IF\(OR\(COUNT\(E7:G7\)=0,H7=&quot;&quot;,I7=&quot;&quot;\),&quot;&quot;,ROUND\(AVERAGE\(E7:G7\)\*0\.5\+H7\*0\.25\+I7\*0\.25,0\)\)<\/f>/);
    assert.match(xml, /type="whole" operator="between"[^>]*sqref="E7:I9"/);
    assert.match(xml, /<protection locked="0"\/>/);
    assert.match(xml, /fullCalcOnLoad="1"/);
    // Template kosong: hanya mapel terpilih, tanpa nilai
    const tpl = await X.readBook(N.buku(data(), { isi: false, mapelIds: ['m1'] }));
    assert.deepEqual(tpl.map((b) => b.name), ['Petunjuk', 'Matematika']);
    assert.deepEqual(tpl[1].rows[6].slice(4, 9), ['', '', '', '', '']);
});

test('XlsxBook: nama lembar unik & dibersihkan', async () => {
    const b = await X.readBook(XB.build({ sheets: [{ name: 'A/B', rows: [['x']] }, { name: 'a b', rows: [['y']] }] }));
    assert.deepEqual(b.map((s) => s.name), ['A B', 'a b (2)']);
});

test('bacaImpor: hanya perubahan, kosong tidak menghapus, galat & lewati dilaporkan', async () => {
    const d = data();
    const book = await X.readBook(N.buku(d, { leger: true }));
    const mtk = book[1].rows;
    mtk[2][3] = '76';           // KKTP berubah
    mtk[7][5] = '72';           // Bima UH2 baru
    mtk[7][4] = '';             // Bima UH1 dikosongkan → tidak menghapus
    mtk[8][4] = '101';          // Citra UH1 tidak sah
    mtk[8][7] = '80';           // Citra STS baru (dicocokkan lewat NISN karena NIS kosong)
    book[2].rows[6][4] = '88';  // BIN Aisyah
    book[3].rows[6][4] = '99';  // PAI → dilewati
    const r = N.bacaImpor(book, d);
    assert.deepEqual(r.items, [
        { subject_id: 'm1', kktp: 76, entries: [{ student_id: 's2', uh2: 72 }, { student_id: 's3', sts: 80 }] },
        { subject_id: 'm2', entries: [{ student_id: 's1', uh1: 88 }] },
    ]);
    assert.deepEqual(r.total, { baru: 3, berubah: 0, galat: 1, mapel: 2 });
    const [l1, l2, l3] = r.lembar;
    assert.deepEqual(l1.kktp, { lama: 75, baru: 76 });
    assert.match(l1.galat[0], /Baris 9 UH 1 \(Citra Anjani\): 101 di luar 0–100/);
    assert.equal(l2.status, 'ok');
    assert.equal(l3.status, 'lewati');
    assert.match(l3.alasan, /guru mapel \(Susy\)/);
    assert.equal(r.lembar.length, 3, 'Petunjuk & Leger tidak dilaporkan');
});

test('bacaImpor: nilai sama dengan portal tidak dihitung; berubah dihitung', async () => {
    const d = data();
    const book = await X.readBook(N.buku(d));
    book[1].rows[6][4] = '81';
    const r = N.bacaImpor(book, d);
    assert.deepEqual(r.total, { baru: 0, berubah: 1, galat: 0, mapel: 1 });
    assert.deepEqual(r.lembar[0].perubahan.map((p) => [p.field, p.lama, p.baru]), [['uh1', 80, 81]]);
});

test('bacaImpor: file kelas/semester lain ditolak, siswa asing & ganda diperingatkan', async () => {
    const d = data();
    const book = await X.readBook(N.buku(d, { mapelIds: ['m1', 'm2'] }));
    book[1].rows[3][0] = book[1].rows[3][0].replace(KELAS, '99999999-2222-3333-4444-555555555555');
    book[2].rows[9] = ['4', '9999', '', 'SISWA LAIN', '70', '', '', '', ''];
    book[2].rows[10] = ['5', '4798', '', 'AISYAH PUTRI', '70', '', '', '', ''];
    book[2].rows[6][4] = '60';
    const r = N.bacaImpor(book, d);
    assert.equal(r.lembar[0].status, 'lewati');
    assert.match(r.lembar[0].alasan, /kelas lain/);
    assert.equal(r.lembar[1].peringatan.length, 2);
    assert.match(r.lembar[1].peringatan[0], /SISWA LAIN tidak ada di daftar kelas/);
    assert.match(r.lembar[1].peringatan[1], /muncul dua kali/);
    const d2 = { ...data(), semester: 2 };
    const r2 = N.bacaImpor(await X.readBook(N.buku(data())), d2);
    assert.ok(r2.lembar.every((l) => l.status === 'lewati' && /semester ganjil/.test(l.alasan)));
});

test('bacaImpor: lembar buatan sendiri tanpa kode dikenali dari nama lembar', () => {
    const book = [{ name: 'matematika', rows: [['KKTP', '70'], ['NO', 'NAMA', 'UH1', 'UH2', 'UH3', 'PTS', 'PAS'], ['1', 'bima saputra', '75', '', '', '', '90']] }];
    const r = N.bacaImpor(book, data());
    assert.deepEqual(r.items, [{ subject_id: 'm1', kktp: 70, entries: [{ student_id: 's2', uh1: 75, sas: 90 }] }]);
});

test('cetak: daftar nilai mapel & leger', () => {
    const d = data();
    const h = N.htmlMapel(d, 'm1', { tanggal: '2026-12-19' });
    assert.match(h, /DAFTAR NILAI MATEMATIKA/);
    assert.match(h, /SEMESTER GANJIL/);
    assert.match(h, /KELAS : III\.A/);
    assert.match(h, /class="b mrh">68</);
    assert.match(h, /Belum tuntas · UH belum lengkap/);
    assert.match(h, /19 Desember 2026/);
    assert.match(h, /LILIS KHOLISOH, S\.Pd\.SD/);
    assert.match(N.htmlMapel(d, 'm3'), /Guru Mata Pelajaran/);
    const l = N.htmlLeger(d, { tanggal: '2026-12-19' });
    assert.match(l, /LEGER NILAI AKHIR SISWA/);
    assert.ok(!/>SER</.test(l), 'mapel tersembunyi tidak ikut');
    assert.match(l, /<td class="b">83<\/td><td class="b">83<\/td>/);
    assert.equal(N.namaFile('Leger Nilai', d), 'Leger_Nilai_Kelas_3A_Smt_1_2026-2027');
});
