// Run: node --test tests/*.test.mjs
// Integrasi Postgres sungguhan (opsional): PGLITE_MODULE_DIR=<node_modules berisi @electric-sql/pglite>
// Semua data FIKTIF. Tidak ada koneksi ke Supabase sungguhan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
    validateAndBuild, loadAndValidate, runImport, classifyKey, ImportError, EXPECTED,
} from '../scripts/import-students.mjs';
import { makeFakeFile, FAKE_FIELDS } from './fixtures/fake-students.mjs';
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
const PII = makeFakeFile().records.flatMap((r) => [
    r.nik_siswa, r.nama_siswa, r.siswa_nama_ibu_kandung, r.no_kk, r.no_hp_ayah, r.anggota_1_nik, r.anggota_1_nama,
]);
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
test('fixture bentuk asli valid: 559 / 535 / 24 / 17, 110 field + 1 operasional = 111 key payload', () => {
    const doc = dataset();
    const src = doc.records;
    const { rows, report } = validateAndBuild(doc);
    assert.equal(report.total, 559); assert.equal(report.listed, 535);
    assert.equal(report.review, 24); assert.equal(report.rombel, 17);
    assert.equal(report.nik_unik, 559);
    assert.equal(report.field_sumber, 110);
    assert.deepEqual(report.field_operasional, ['status_daftar']);
    assert.equal(report.key_payload, 111);
    for (const f of ['nik_siswa', 'siswa_nisn', 'siswa_nipd', 'no_kk', 'no_hp_ayah', 'kode_pos', 'rt', 'rw', 'anggota_1_nik']) {
        assert.ok(report.field_identifier_teks.includes(f), `identifier ${f}`);
    }
    assert.deepEqual(report.field_angka_non_identifier, ['tinggi_badan']);
    const r0 = rows[0], s0 = src[0];
    assert.deepEqual(r0.field_sources, s0._sources);
    assert.deepEqual(r0.matching_notes, s0._catatan);
    assert.deepEqual(r0.source_names, s0._asal_data);
    for (const k of ['_sources', '_catatan', '_asal_data']) assert.ok(!(k in r0.payload));
    // Mapping kolom inti dari key sumber.
    assert.equal(r0.nik, s0.nik_siswa); assert.equal(r0.nipd, s0.siswa_nipd);
    assert.equal(r0.nisn, s0.siswa_nisn); assert.ok(r0.nisn.startsWith('00'));
    assert.equal(r0.nama_ibu_kandung, s0.siswa_nama_ibu_kandung);
    assert.equal(r0.status_daftar, s0.status_daftar); assert.equal(r0.kelas, s0.kelas);
    // Payload memakai key asli, tanpa metadata, tanpa key hasil rename.
    const { _sources, _catatan, _asal_data, ...bio } = s0;
    assert.deepEqual(r0.payload, bio);
    assert.equal(Object.keys(r0.payload).length, 111);
    assert.ok(!('nik' in r0.payload) && !('nisn' in r0.payload) && !('nipd' in r0.payload));
    assert.equal(r0.payload.kode_pos, s0.kode_pos); assert.equal(r0.payload.rt, s0.rt);
    assert.equal(rows[558].kelas, null);
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
    { const d = dataset(); d.fields.pop(); d.records.forEach((r) => delete r[FAKE_FIELDS[109]]); expectIssue(d, /"fields" berisi 109 nama, seharusnya 110/); }
    { const d = dataset(); d.fields[109] = d.fields[108]; expectIssue(d, /"fields" memuat nama ganda: keterangan_fiktif_091/); }
    { const d = dataset(); delete d.records[3].kode_pos; expectIssue(d, /field "kode_pos" tidak ada pada 1 record/); }
    { const d = dataset(); d.records.forEach((r) => { delete r.status_daftar; }); expectIssue(d, /field "status_daftar" tidak ada pada 559 record/); }
    { const d = dataset(); d.records[0].kolom_asing = 'x'; expectIssue(d, /key tak dikenal "kolom_asing"/); }
    { const d = dataset(); d.fields = d.fields.map((f) => (f === 'siswa_nisn' ? 'nisn_lain' : f)); d.records.forEach((r) => { r.nisn_lain = r.siswa_nisn; delete r.siswa_nisn; }); expectIssue(d, /mapping kolom inti nisn <- "siswa_nisn" tidak ada/); }
    { const d = dataset(); d.records[4].siswa_nama_ibu_kandung = 7; expectIssue(d, /record #5: field "siswa_nama_ibu_kandung" \(kolom nama_ibu_kandung\) harus teks/); }
    { const d = dataset(); delete d.records[2]._asal_data; expectIssue(d, /field "_asal_data" tidak ada pada 1 record/); }
    { const d = dataset(); d.fields.push('_sources'); expectIssue(d, /tidak boleh memuat metadata _sources/); }
});

test('validasi menolak setiap pelanggaran aturan (pesan tanpa data pribadi)', () => {
    { const d = dataset(); d.records.pop(); expectIssue(d, /Total siswa 558/); }
    { const d = dataset(); d.records[10].nik_siswa = d.records[3].nik_siswa; expectIssue(d, /record #11: NIK sama dengan record #4/); }
    { const d = dataset(); d.records[5].nik_siswa = d.records[5].nik_siswa.slice(1); expectIssue(d, /record #6: NIK \(nik_siswa\) kosong atau bukan 16 digit/); }
    { const d = dataset(); d.records[5].nik_siswa = Number(d.records[5].nik_siswa); expectIssue(d, /record #6: field "nik_siswa" berupa angka/); }
    { const d = dataset(); d.records[7].siswa_nisn = Number(d.records[7].siswa_nisn); expectIssue(d, /record #8: field "siswa_nisn" berupa angka/); }
    { const d = dataset(); d.records[7].kode_pos = 1234; expectIssue(d, /record #8: field "kode_pos" berupa angka/); }
    { const d = dataset(); d.records[9].no_kk = '9.90000000000501E+15'; expectIssue(d, /record #10: field "no_kk" berformat notasi ilmiah/); }
    { const d = dataset(); d.records[2].nama_siswa = '   '; expectIssue(d, /record #3: nama_siswa kosong/); }
    { const d = dataset(); d.records[2].kelas = ''; expectIssue(d, /record #3: tercantum di daftar kelas tetapi kelas kosong/); }
    { const d = dataset(); d.records[2].status_daftar = 'Tercantum di daftar kelas 2026/2027'; expectIssue(d, /record #3: status_daftar tidak dikenal/); }
    { const d = dataset(); d.records[2]._catatan = { a: 1 }; expectIssue(d, /record #3: _catatan harus array/); }
    { const d = dataset(); d.records[2]._sources = ['x']; expectIssue(d, /record #3: _sources harus object/); }
    { const d = dataset(); d.records.forEach((r) => { if (r.kelas === '6B') r.kelas = '6A'; }); expectIssue(d, /Rombel 16, seharusnya 17/); }
    { const d = dataset(); d.records[0].status_daftar = 'Perlu verifikasi lebih lanjut'; d.records[0].kelas = null; expectIssue(d, /seharusnya 535/); }
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
    assert.match(out, /Field sumber\s+: 110/);
    assert.match(out, /Field operasional: 1 \(status_daftar\)/);
    assert.match(out, /Key payload\s+: 111/);
    assert.ok(!out.includes('NETWORK-DIPANGGIL'));
    assertNoSecrets(out, 'dry-run');
});

test('CLI dry-run gagal validasi: tanpa data pribadi', () => {
    const d = dataset(); d.records[4].nik_siswa = d.records[1].nik_siswa; d.records[6].siswa_nisn = 12;
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
    const r = (await backend.db.query(`select nisn, payload->>'kode_pos' kp, payload->>'rt' rt, jsonb_typeof(payload->'nik_siswa') t, payload->>'siswa_nisn' pn, (select count(*)::int from jsonb_object_keys(payload)) nk
                                         from public.student_records order by nik limit 1`)).rows[0];
    assert.equal(r.nisn, '0000000001'); assert.equal(r.kp, '00001'); assert.equal(r.rt, '002'); assert.equal(r.t, 'string');
    assert.equal(r.pn, '0000000001'); assert.equal(r.nk, 111);
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
