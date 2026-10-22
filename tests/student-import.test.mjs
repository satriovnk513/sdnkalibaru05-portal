// Run: node --test tests/*.test.mjs
// Integrasi Postgres sungguhan (opsional): PGLITE_MODULE_DIR=<node_modules berisi @electric-sql/pglite>
// Semua data FIKTIF. Tidak ada koneksi ke Supabase sungguhan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
    validateAndBuild, loadAndValidate, runImport, classifyKey, compareManifest, ImportError, EXPECTED,
} from '../scripts/import-students.mjs';
import { makeFakeFile, FAKE_FIELDS, FAKE_PRESENCE, fakeManifestFor } from './fixtures/fake-students.mjs';
import { makeFetch, memoryBackend, pgliteBackend } from './helpers/fake-postgrest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts/import-students.mjs');
const MIGRATION = join(ROOT, 'supabase/migrations/20261022000001_student_information_system.sql');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_SERVICE_KEY = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role', ref: 'fiktif' })}.tanda-tangan-palsu`;
const FAKE_ANON_KEY = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon' })}.tanda-tangan-palsu`;

// Folder privat sementara (700) + file (600), di luar repo.
const BASE = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'student-import-test-'));
function writeDataset(doc, name = 'student-data-fiktif.json', { fileMode = 0o600, dirMode = 0o700 } = {}) {
    const dir = mkdtempSync(join(BASE, 'priv-'));
    chmodSync(dir, dirMode);
    const file = join(dir, name);
    writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc));
    chmodSync(file, fileMode);
    return file;
}
test.after(() => rmSync(BASE, { recursive: true, force: true }));

const dataset = () => makeFakeFile();
const PII_KEY = /(^|_)(nik|no_kk|no_hp|no_telp|nama)(_|$)|nama_ibu|nik_wali/;
const PII = [...new Set(makeFakeFile().records.flatMap((r) => Object.entries(r)
    .filter(([k, v]) => PII_KEY.test(k) && typeof v === 'string' && v.length > 6).map(([, v]) => v)))];
const idxWith = (d, f, from = 0) => d.records.findIndex((r, i) => i >= from && f in r && r[f] !== null);
const idxWithout = (d, f) => d.records.findIndex((r) => !(f in r));
function assertNoSecrets(text, label) {
    for (const v of PII) assert.ok(!text.includes(v), `${label}: output memuat data pribadi fiktif`);
    assert.ok(!text.includes(FAKE_SERVICE_KEY) && !text.includes('tanda-tangan-palsu'), `${label}: output memuat key`);
    assert.ok(!text.includes('DETAIL-RAHASIA'), `${label}: output memuat details PostgREST`);
}
const expectIssue = (doc, re) => {
    try { validateAndBuild(doc); } catch (e) {
        assert.ok(e instanceof ImportError);
        assert.ok(e.issues.some((m) => re.test(m)), `issue ${re} tidak ditemukan: ${e.issues.slice(0, 5).join(' | ')}`);
        e.issues.forEach((m) => assertNoSecrets(m, 'issue'));
        return;
    }
    assert.fail('validasi seharusnya gagal');
};

// ============================================================================ validasi
test('fixture sparse bentuk asli valid: 559/535/24/17, 110 dideklarasikan = 110 ditemukan, payload apa adanya', () => {
    const doc = dataset();
    const src = doc.records;
    const { rows, report } = validateAndBuild(doc);
    assert.equal(report.total, 559); assert.equal(report.listed, 535);
    assert.equal(report.review, 24); assert.equal(report.rombel, 17);
    assert.equal(report.nik_unik, 559);
    assert.equal(report.field_sumber_dideklarasikan, 110);
    assert.equal(report.field_sumber_ditemukan, 110);
    assert.equal(report.field_hadir_di_semua_record.length, 9);
    assert.deepEqual(report.field_operasional, ['status_daftar']);
    assert.equal(report.kemungkinan_key_payload, 111);
    assert.deepEqual(report.field_presence_counts, FAKE_PRESENCE, 'kehadiran per field sama dengan manifest');
    const k = report.key_payload_per_record;
    assert.ok(k.min < k.max && k.max <= 111 && k.min >= 5, JSON.stringify(k));
    // Identifier memakai nama sumber asli.
    for (const f of ['nik_siswa', 'siswa_nipd', 'siswa_nisn', 'siswa_no_kk', 'siswa_no_hp', 'siswa_rt', 'siswa_rw',
        'siswa_kode_pos', 'siswa_no_telepon', 'wali_nik_wali', 'wali_no_kk', 'wali_no_hp', 'wali_no_telp', 'wali_kode_pos',
        'kontak_no_hp', 'kontak_kode_pos', 'anggota_1_nik', 'ayah_nik', 'ibu_nik', 'ayah_no_hp', 'ibu_no_hp',
        'lain_nomor_akta', 'lain_hp_orang_tua_ppdb']) {
        assert.ok(report.field_identifier_teks.includes(f), `identifier ${f}`);
    }
    for (const f of ['nama_siswa', 'kelas', 'siswa_alamat', 'lain_lintang']) assert.ok(!report.field_identifier_teks.includes(f), `bukan identifier ${f}`);
    assert.ok(report.field_angka_non_identifier.includes('lain_lintang'));
    // Payload = record sumber apa adanya tanpa 3 metadata, untuk SETIAP record (sparse tetap sparse).
    rows.forEach((r, i) => {
        const { _sources, _catatan, _asal_data, ...bio } = src[i];
        assert.deepEqual(r.payload, bio);
        assert.equal(Object.keys(r.payload).length, Object.keys(bio).length);
        assert.deepEqual(r.field_sources, _sources); assert.deepEqual(r.matching_notes, _catatan); assert.deepEqual(r.source_names, _asal_data);
    });
    // Mapping inti.
    const r0 = rows[0], s0 = src[0];
    assert.equal(r0.nik, s0.nik_siswa); assert.equal(r0.nama_ibu_kandung, s0.siswa_nama_ibu_kandung);
    assert.equal(r0.status_daftar, s0.status_daftar); assert.equal(r0.kelas, s0.kelas);
    const iNisn = idxWith(doc, 'siswa_nisn');
    assert.equal(rows[iNisn].nisn, src[iNisn].siswa_nisn); assert.ok(rows[iNisn].nisn.startsWith('00'));
    assert.equal(rows[558].kelas, '');
});

test('field opsional yang hilang diterima; kolom inti opsional jadi null; payload tidak ditambah key', () => {
    const doc = dataset();
    const { rows } = validateAndBuild(doc);
    for (const [col, src] of [['nipd', 'siswa_nipd'], ['nisn', 'siswa_nisn']]) {
        const i = idxWithout(doc, src);
        assert.ok(i >= 0, `fixture punya record tanpa ${src}`);
        assert.equal(rows[i][col], null);
        assert.ok(!(src in rows[i].payload), `payload tidak boleh ditambah ${src}`);
    }
    // Hapus field opsional dari sebagian record tambahan: tetap valid, tanpa string kosong baru.
    const d2 = dataset();
    for (let i = 0; i < 100; i++) { delete d2.records[i].siswa_alamat; delete d2.records[i].status_dukcapil; delete d2.records[i].siswa_nama_ibu_kandung; }
    const { rows: r2 } = validateAndBuild(d2);
    for (let i = 0; i < 100; i++) {
        assert.ok(!('siswa_alamat' in r2[i].payload));
        assert.equal(r2[i].status_dukcapil, null); assert.equal(r2[i].nama_ibu_kandung, null);
        assert.ok(!Object.values(r2[i].payload).includes('') || d2.records[i].kelas === '', 'tidak ada string kosong baru');
    }
    // Nilai null eksplisit dipertahankan sebagai null (bukan dihapus, bukan string kosong).
    const iNull = doc.records.findIndex((r) => Object.values(r).includes(null));
    const nullKey = Object.keys(doc.records[iNull]).find((k) => doc.records[iNull][k] === null);
    assert.ok(nullKey in rows[iNull].payload); assert.equal(rows[iNull].payload[nullKey], null);
});

test('struktur top-level: hanya object dengan records (array) dan fields (array string)', () => {
    const bad = [
        ['top-level array', JSON.stringify(makeFakeFile().records), /top-level harus object/],
        ['tanpa records', JSON.stringify({ ...makeFakeFile(), records: undefined }), /"records" harus array/],
        ['records bukan array', JSON.stringify({ ...makeFakeFile(), records: {} }), /"records" harus array/],
        ['tanpa fields', JSON.stringify({ ...makeFakeFile(), fields: undefined }), /"fields" harus array string/],
        ['fields bukan string', JSON.stringify({ ...makeFakeFile(), fields: [1, 2] }), /"fields" harus array string/],
        ['bukan JSON', '{oops', /bukan JSON/],
    ];
    for (const [label, text, re] of bad) {
        assert.throws(() => loadAndValidate(writeDataset(text)), (e) => re.test(e.message), label);
    }
    // Key top-level lain diabaikan, tetapi dilaporkan namanya.
    const ok = loadAndValidate(writeDataset(dataset()));
    assert.deepEqual(ok.report.top_level_keys, ['version', 'school', 'schoolYear', 'labels', 'fields', 'records', 'summary']);
});

test('validasi struktur fields dan mapping', () => {
    { const d = dataset(); d.fields.pop(); d.records.forEach((r) => delete r.wali_penghasilan); expectIssue(d, /"fields" berisi 109 nama, seharusnya 110/); }
    { const d = dataset(); d.fields[109] = d.fields[108]; expectIssue(d, /"fields" memuat nama ganda: wali_tahun_lahir/); }
    // Field dideklarasikan tetapi tidak pernah muncul.
    { const d = dataset(); d.records.forEach((r) => delete r.wali_tahun_lahir); expectIssue(d, /tidak pernah muncul di record mana pun: wali_tahun_lahir/); }
    // Field wajib hilang ditolak.
    for (const f of ['nik_siswa', 'nama_siswa', 'kelas', 'status_daftar']) {
        const d = dataset(); delete d.records[3][f];
        expectIssue(d, new RegExp(`field wajib "${f}" tidak ada pada 1 record`));
    }
    { const d = dataset(); delete d.records[2]._asal_data; expectIssue(d, /field wajib "_asal_data" tidak ada pada 1 record/); }
    { const d = dataset(); delete d.records[2]._sources; expectIssue(d, /field wajib "_sources" tidak ada pada 1 record/); }
    // Key asing ditolak.
    { const d = dataset(); d.records[0].kolom_asing = 'x'; expectIssue(d, /key tak dikenal "kolom_asing"/); }
    { const d = dataset(); d.records[5].nik = d.records[5].nik_siswa; expectIssue(d, /key tak dikenal "nik"/); }
    // Mapping inti tidak ada di struktur.
    { const d = dataset(); d.fields = d.fields.map((f) => (f === 'siswa_nisn' ? 'nisn_lain' : f)); d.records.forEach((r) => { if ('siswa_nisn' in r) { r.nisn_lain = r.siswa_nisn; delete r.siswa_nisn; } }); expectIssue(d, /mapping kolom inti nisn <- "siswa_nisn" tidak ada/); }
    { const d = dataset(); d.records[4].siswa_nama_ibu_kandung = 7; expectIssue(d, /record #5: field "siswa_nama_ibu_kandung" \(kolom nama_ibu_kandung\) harus teks/); }
    { const d = dataset(); d.fields.push('_sources'); expectIssue(d, /tidak boleh memuat metadata _sources/); }
});

test('validasi menolak setiap pelanggaran aturan (pesan tanpa data pribadi)', () => {
    const at = (d, f) => { const i = idxWith(d, f); assert.ok(i >= 0, f); return i; };
    { const d = dataset(); d.records.pop(); expectIssue(d, /Total siswa 558/); }
    { const d = dataset(); d.records[10].nik_siswa = d.records[3].nik_siswa; expectIssue(d, /record #11: NIK sama dengan record #4/); }
    { const d = dataset(); d.records[5].nik_siswa = d.records[5].nik_siswa.slice(1); expectIssue(d, /record #6: NIK \(nik_siswa\) kosong atau bukan 16 digit/); }
    { const d = dataset(); d.records[5].nik_siswa = Number(d.records[5].nik_siswa); expectIssue(d, /record #6: field "nik_siswa" berupa angka/); }
    { const d = dataset(); const i = at(d, 'siswa_nisn'); d.records[i].siswa_nisn = Number(d.records[i].siswa_nisn); expectIssue(d, new RegExp(`record #${i + 1}: field "siswa_nisn" berupa angka`)); }
    { const d = dataset(); const i = at(d, 'siswa_kode_pos'); d.records[i].siswa_kode_pos = 1234; expectIssue(d, new RegExp(`record #${i + 1}: field "siswa_kode_pos" berupa angka`)); }
    { const d = dataset(); const i = at(d, 'wali_no_hp'); d.records[i].wali_no_hp = 81234567; expectIssue(d, new RegExp(`record #${i + 1}: field "wali_no_hp" berupa angka`)); }
    { const d = dataset(); const i = at(d, 'siswa_no_kk'); d.records[i].siswa_no_kk = '9.90000000000501E+15'; expectIssue(d, new RegExp(`record #${i + 1}: field "siswa_no_kk" berformat notasi ilmiah`)); }
    { const d = dataset(); d.records[2].nama_siswa = '   '; expectIssue(d, /record #3: nama_siswa kosong/); }
    { const d = dataset(); d.records[2].kelas = ''; expectIssue(d, /record #3: tercantum di daftar kelas tetapi kelas kosong/); }
    { const d = dataset(); d.records[2].status_daftar = 'Tercantum di daftar kelas 2026/2027'; expectIssue(d, /record #3: status_daftar tidak dikenal/); }
    { const d = dataset(); d.records[2]._catatan = { a: 1 }; expectIssue(d, /record #3: _catatan harus array/); }
    { const d = dataset(); d.records[2]._sources = ['x']; expectIssue(d, /record #3: _sources harus object/); }
    { const d = dataset(); d.records.forEach((r) => { if (r.kelas === '6B') r.kelas = '6A'; }); expectIssue(d, /Rombel 16, seharusnya 17/); }
    { const d = dataset(); d.records[0].status_daftar = 'Perlu verifikasi lebih lanjut'; d.records[0].kelas = ''; expectIssue(d, /seharusnya 535/); }
});

test('file wajib di luar repo dengan izin 600 / folder 700', () => {
    const ok = writeDataset(dataset());
    assert.equal(loadAndValidate(ok).report.total, 559);
    assert.throws(() => loadAndValidate(writeDataset(dataset(), 'a.json', { fileMode: 0o644 })), (e) => e.issues.some((m) => /wajib 600/.test(m)));
    assert.throws(() => loadAndValidate(writeDataset(dataset(), 'b.json', { dirMode: 0o755 })), (e) => e.issues.some((m) => /wajib 700/.test(m)));
    const inRepoDir = join(ROOT, 'data-private');
    mkdirSync(inRepoDir, { recursive: true, mode: 0o700 });
    const inRepo = join(inRepoDir, 'student-data-uji.json');
    try {
        writeFileSync(inRepo, '{}'); chmodSync(inRepo, 0o600); chmodSync(inRepoDir, 0o700);
        assert.throws(() => loadAndValidate(inRepo), (e) => e.issues.some((m) => /di dalam repository/.test(m)));
    } finally { rmSync(inRepoDir, { recursive: true, force: true }); }
});

test('jenis key: hanya service_role / sb_secret_ yang diterima', () => {
    assert.equal(classifyKey(FAKE_SERVICE_KEY), 'service_role');
    assert.equal(classifyKey('sb_secret_fiktif'), 'secret');
    assert.equal(classifyKey(FAKE_ANON_KEY), 'jwt:anon');
    assert.equal(classifyKey('sb_publishable_fiktif'), 'publishable');
    assert.equal(classifyKey(undefined), 'missing');
});

// ============================================================================ CLI
const NO_NET = 'data:text/javascript,globalThis.fetch=()=>{throw new Error("NETWORK-DIPANGGIL")}';
function cli(args, env = {}) {
    const r = spawnSync(process.execPath, ['--import', NO_NET, SCRIPT, ...args], {
        encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || '', ...env },
    });
    return { code: r.status, out: r.stdout + r.stderr };
}

test('CLI dry-run: offline, agregat saja, mencetak SHA-256', () => {
    const file = writeDataset(dataset());
    const { code, out } = cli(['--file', file]);
    assert.equal(code, 0, out);
    assert.match(out, /SHA-256\s+: [0-9a-f]{64}/);
    assert.match(out, /VALID/);
    assert.match(out, /Total siswa\s+: 559/);
    assert.match(out, /Field sumber dideklarasikan: 110/);
    assert.match(out, /Field sumber ditemukan\s+: 110/);
    assert.match(out, /Field hadir di semua record: 9/);
    assert.match(out, /Field operasional\s+: 1 \(status_daftar\)/);
    assert.match(out, /Kemungkinan key payload\s+: 111/);
    assert.match(out, /Key payload aktual\/record\s+: min \d+, maks \d+, rata-rata [\d.]+/);
    assert.ok(!out.includes('NETWORK-DIPANGGIL'));
    assertNoSecrets(out, 'dry-run');
});

test('CLI dry-run --manifest: cocok untuk fixture; berbeda -> exit 1', () => {
    const file = writeDataset(dataset());
    const r = loadAndValidate(file);
    const mf = join(dirname(file), 'manifest.json');
    writeFileSync(mf, JSON.stringify(fakeManifestFor(r.report, r)));
    let out = cli(['--file', file, '--manifest', mf]);
    assert.equal(out.code, 0, out.out); assert.match(out.out, /Manifest\s+: COCOK/);
    const bad = fakeManifestFor(r.report, r); bad.field_presence_counts = { ...bad.field_presence_counts, siswa_nisn: 1 };
    writeFileSync(mf, JSON.stringify(bad));
    out = cli(['--file', file, '--manifest', mf]);
    assert.equal(out.code, 1); assert.match(out.out, /TIDAK COCOK[\s\S]*presence "siswa_nisn" manifest 1/);
    assertNoSecrets(out.out, 'manifest');
    // Manifest asli dibandingkan dengan fixture: hanya hash/ukuran/rentang yang boleh berbeda.
    const real = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/schema-manifest.json'), 'utf8'));
    const diffs = compareManifest(r, real);
    assert.ok(diffs.every((x) => /source_sha256|source_bytes|key per record/.test(x)), diffs.join(' | '));
});

test('CLI dry-run gagal validasi: tanpa data pribadi', () => {
    const d = dataset(); d.records[4].nik_siswa = d.records[1].nik_siswa; d.records[idxWith(d, 'siswa_nisn')].siswa_nisn = 12;
    const { code, out } = cli(['--file', writeDataset(d)]);
    assert.equal(code, 1);
    assert.match(out, /NIK sama dengan record #2/);
    assertNoSecrets(out, 'dry-run gagal');
});

test('CLI --execute: tanpa key ditolak; key tidak pernah tercetak', () => {
    const file = writeDataset(dataset());
    let r = cli(['--execute', '--file', file, '--confirm-sha256', 'x']);
    assert.equal(r.code, 1); assert.match(r.out, /SUPABASE_SERVICE_ROLE_KEY tidak ada/);
    r = cli(['--execute', '--file', file, '--confirm-sha256', 'x'], { SUPABASE_SERVICE_ROLE_KEY: FAKE_ANON_KEY });
    assert.equal(r.code, 1); assert.match(r.out, /bukan service_role/);
    r = cli(['--execute', '--file', file, '--confirm-sha256', 'salah'], { SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY });
    assert.equal(r.code, 1); assert.match(r.out, /confirm-sha256 tidak cocok/);
    assert.ok(!r.out.includes('NETWORK-DIPANGGIL'), 'hash salah tidak boleh menyentuh jaringan');
    assertNoSecrets(r.out, 'execute');
});

// ============================================================================ impor (memory)
async function scenario({ backend = memoryBackend(), hooks, doc = dataset(), confirm, signal } = {}) {
    const file = writeDataset(doc);
    const { hash } = loadAndValidate(file);
    const { fetchImpl, calls } = makeFetch(backend, hooks);
    const logs = [];
    let error = null, result = null;
    try {
        result = await runImport({ file, confirmSha256: confirm ?? hash, key: FAKE_SERVICE_KEY, url: 'https://fiktif.supabase.test', fetchImpl, log: (m) => logs.push(m), signal });
    } catch (e) { error = e; }
    const text = logs.join('\n') + (error ? `\n${error.message}\n${(error.issues || []).join('\n')}` : '');
    assertNoSecrets(text, 'log impor');
    calls.forEach((c) => assert.equal(c.headers.apikey, FAKE_SERVICE_KEY));
    return { backend, calls, logs: text, error, result, hash, file };
}

test('impor sukses: 559 baris + 1 batch, verifikasi penuh', async () => {
    const s = await scenario();
    assert.equal(s.error, null, s.logs);
    assert.deepEqual(await s.backend.counts(), { records: 559, batches: 1 });
    const b = s.backend.tables.student_import_batches[0];
    assert.equal(b.source_hash, s.hash); assert.equal(b.record_count, 559);
    assert.equal(b.listed_count, 535); assert.equal(b.review_count, 24);
    const inserts = s.calls.filter((c) => c.method === 'POST' && c.path === 'student_records');
    assert.equal(inserts.length, 1, 'semua siswa dalam satu request');
    assert.match(s.logs, /Verifikasi lulus/);
});

test('prasyarat: tabel tidak kosong -> berhenti tanpa perubahan', async () => {
    const backend = memoryBackend();
    backend.tables.student_import_batches.push({ id: 'lama', source_hash: 'f'.repeat(64) });
    const s = await scenario({ backend });
    assert.match(s.error.message, /tidak kosong/);
    assert.deepEqual(await backend.counts(), { records: 0, batches: 1 });
    assert.ok(!s.calls.some((c) => c.method !== 'GET'), 'tidak ada request tulis');
});

test('impor ulang file yang sama setelah sukses ditolak', async () => {
    const backend = memoryBackend();
    const first = await scenario({ backend });
    assert.equal(first.error, null);
    const second = await scenario({ backend });
    assert.match(second.error.message, /tidak kosong/);
    assert.deepEqual(await backend.counts(), { records: 559, batches: 1 });
});

test('hash konfirmasi salah -> tidak ada request jaringan', async () => {
    const s = await scenario({ confirm: '0'.repeat(64) });
    assert.match(s.error.message, /confirm-sha256/);
    assert.equal(s.calls.length, 0);
});

const insertRecords = (c) => c.method === 'POST' && c.path === 'student_records';
const failureCases = [
    ['server menolak insert siswa (HTTP 500)', { before: (c) => insertRecords(c) && new Response('{"code":"XX000","message":"boom","details":"DETAIL-RAHASIA-JANGAN-DICETAK"}', { status: 500 }) }],
    ['jaringan putus sebelum insert siswa sampai', { before: (c) => { if (insertRecords(c)) throw new TypeError('fetch failed'); } }],
    ['timeout SETELAH 559 siswa tersimpan', { after: (c) => { if (insertRecords(c)) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } } }],
    ['satu baris ke-300 ditolak constraint di tengah request', { before: (c) => { if (insertRecords(c)) c.body[299].nik = '123'; } }],
    ['verifikasi gagal (nol di depan NISN hilang di database)', { after: (c) => { if (c.method === 'POST' && c.path === 'rpc/student_summary') { /* noop */ } } }, (backend) => {
        const orig = backend.insert.bind(backend);
        backend.insert = async (t, rows) => { const r = await orig(t, rows); if (t === 'student_records') backend.tables.student_records[10].nisn = backend.tables.student_records[10].nisn.replace(/^0+/, ''); return r; };
    }],
    ['gagal saat verifikasi (rpc error)', { before: (c) => c.path === 'rpc/student_summary' && new Response('{"code":"XX000","message":"rpc"}', { status: 500 }) }],
];
for (const [name, hooks, mutate] of failureCases) {
    test(`kegagalan di tengah: ${name} -> tidak ada siswa/batch tersisa`, async () => {
        const backend = memoryBackend();
        if (mutate) mutate(backend);
        const s = await scenario({ backend, hooks });
        assert.ok(s.error, 'impor seharusnya gagal');
        assert.match(s.logs, /Cleanup berhasil/);
        assert.deepEqual(await backend.counts(), { records: 0, batches: 0 });
    });
}

test('Ctrl-C setelah batch dibuat -> cleanup, tidak ada sisa', async () => {
    const backend = memoryBackend();
    const ctrl = new AbortController();
    const s = await scenario({ backend, signal: ctrl.signal, hooks: { after: (c) => { if (c.method === 'POST' && c.path === 'student_import_batches') ctrl.abort(); } } });
    assert.match(s.error.message, /Dihentikan/);
    assert.deepEqual(await backend.counts(), { records: 0, batches: 0 });
});

test('cleanup gagal -> pesan batch id + impor berikutnya menolak (tabel tidak kosong)', async () => {
    const backend = memoryBackend();
    const s = await scenario({ backend, hooks: {
        before: (c) => (insertRecords(c) && new Response('{"code":"XX000","message":"boom"}', { status: 500 }))
            || (c.method === 'DELETE' && new Response('{"code":"XX000","message":"delete gagal"}', { status: 500 })),
    } });
    assert.match(s.logs, /CLEANUP GAGAL .* batch id [0-9a-f-]{36}/);
    assert.deepEqual(await backend.counts(), { records: 0, batches: 1 });
    const again = await scenario({ backend });
    assert.match(again.error.message, /tidak kosong/);
});

// ============================================================================ impor (Postgres sungguhan)
const PG = process.env.PGLITE_MODULE_DIR;
const pgOpts = { skip: PG ? false : 'set PGLITE_MODULE_DIR untuk uji Postgres sungguhan' };
const pg = () => pgliteBackend({ moduleDir: PG, migrationPath: MIGRATION });

test('[Postgres] impor sukses dengan migration asli, tabel lama tidak berubah', pgOpts, async () => {
    const backend = await pg();
    const s = await scenario({ backend });
    assert.equal(s.error, null, s.logs);
    const c = await backend.counts();
    assert.deepEqual(c, { records: 559, batches: 1, news: 1 });
    // Setiap payload di database sama persis dengan record sumber (sparse tetap sparse).
    const src = dataset().records;
    const db = (await backend.db.query('select nik, nisn, nipd, payload from public.student_records order by nik')).rows;
    const byNik = new Map(db.map((x) => [x.nik, x]));
    for (const rec of src) {
        const { _sources, _catatan, _asal_data, ...bio } = rec;
        const got = byNik.get(rec.nik_siswa);
        assert.deepEqual(got.payload, bio);
        assert.equal(got.nisn, rec.siswa_nisn ?? null); assert.equal(got.nipd, rec.siswa_nipd ?? null);
    }
    const pres = (await backend.db.query(`select count(*) filter (where payload ? 'siswa_nisn')::int nisn,
        count(*) filter (where payload ? 'wali_tahun_lahir')::int wtl,
        count(*) filter (where nisn is null)::int nisn_null,
        count(*) filter (where jsonb_typeof(payload->'nik_siswa') <> 'string')::int nik_bukan_teks
        from public.student_records`)).rows[0];
    assert.deepEqual(pres, { nisn: 542, wtl: 1, nisn_null: 17, nik_bukan_teks: 0 });
    const sum = (await backend.db.query('select jumlah_rombel::int n from public.student_summary()')).rows[0].n;
    assert.equal(sum, 17);
    const again = await scenario({ backend });
    assert.match(again.error.message, /tidak kosong/);
});

for (const [name, hooks] of failureCases.filter(([, , m]) => !m)) {
    test(`[Postgres] kegagalan: ${name} -> 0 siswa, 0 batch, tabel lama utuh`, pgOpts, async () => {
        const backend = await pg();
        const s = await scenario({ backend, hooks });
        assert.ok(s.error);
        assert.match(s.logs, /Cleanup berhasil/);
        assert.deepEqual(await backend.counts(), { records: 0, batches: 0, news: 1 });
    });
}

test('[Postgres] satu request = satu transaksi: baris ke-300 gagal -> 0 baris SEBELUM cleanup', pgOpts, async () => {
    const backend = await pg();
    let before = null;
    const s = await scenario({ backend, hooks: {
        before: async (c) => {
            if (insertRecords(c)) c.body[299].status_daftar = 'Status Salah';
            if (c.method === 'DELETE' && before === null) before = await backend.counts();
        },
    } });
    assert.ok(s.error);
    assert.equal(before.records, 0, 'tidak ada baris parsial dari request yang gagal');
    assert.equal(before.batches, 1, 'batch ada sebelum cleanup');
    assert.deepEqual(await backend.counts(), { records: 0, batches: 0, news: 1 });
});
