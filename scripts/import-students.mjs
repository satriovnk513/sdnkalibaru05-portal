#!/usr/bin/env node
// =============================================================================
// Importer Data Siswa — SDN Kalibaru 05
//
// Mode default: DRY-RUN (validasi offline, tanpa jaringan, tanpa key).
//   node scripts/import-students.mjs --file <path.json>
//
// Mode eksekusi (hanya setelah disetujui):
//   SUPABASE_SERVICE_ROLE_KEY="$SB_KEY" node scripts/import-students.mjs \
//     --execute --file <path.json> --confirm-sha256 <hash dari dry-run>
//
// Aturan privasi:
// - Output hanya agregat. Tidak pernah mencetak NIK, KK, HP, alamat, nama, atau
//   nilai biodata lain. Pesan error menyebut nomor urut record dan NAMA field saja.
// - Detail error PostgREST (`details`/`hint`) tidak pernah dicetak karena bisa
//   memuat isi baris.
// - Key hanya dibaca dari environment variable saat eksekusi; tidak pernah
//   dicetak, ditulis ke file, atau dikirim ke mana pun selain Supabase.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SUPABASE_URL = 'https://wwpbghdepykfqgzhyvmh.supabase.co';
export const STATUS_LISTED = 'Tercantum di daftar kelas';
export const STATUS_REVIEW = 'Perlu verifikasi lebih lanjut';
export const EXPECTED = Object.freeze({ total: 559, listed: 535, review: 24, rombel: 17, fields: 110 });

// Kolom inti student_records <- key pada record sumber. Payload tetap memakai key asli.
export const CORE_MAP = Object.freeze({
    nik: 'nik_siswa',
    nama_siswa: 'nama_siswa',
    nipd: 'siswa_nipd',
    nisn: 'siswa_nisn',
    kelas: 'kelas',
    nama_ibu_kandung: 'siswa_nama_ibu_kandung',
    status_daftar: 'status_daftar',
    status_dukcapil: 'status_dukcapil',
});
export const CORE_FIELDS = Object.freeze(Object.keys(CORE_MAP));
// Field operasional di luar daftar `fields` sumber.
export const OPERATIONAL_FIELDS = Object.freeze(['status_daftar']);
export const META_FIELDS = Object.freeze({
    _sources: { column: 'field_sources', type: 'object' },
    _catatan: { column: 'matching_notes', type: 'array' },
    _asal_data: { column: 'source_names', type: 'array' },
});

// Field yang harus tetap berupa teks (identitas numerik, nomor, kode).
const IDENTIFIER_KEY = /(^|_)(nik|nisn|nipd|npsn|kk|no|nomor|hp|telp|telepon|tlp|wa|whatsapp|kode_?pos|rt|rw|nim|nis|akta|kip|kks|pkh|kps|rekening|nuptk|nip)(_|$)/i;
const SCIENTIFIC = /^[+-]?\d+(\.\d+)?e[+-]?\d+$/i;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class ImportError extends Error {
    constructor(message, issues = []) { super(message); this.issues = issues; }
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function isIdentifierKey(key) {
    return IDENTIFIER_KEY.test(key);
}

// ----------------------------------------------------------------------------- file
export function checkFileLocation(filePath) {
    const issues = [];
    const real = realpathSync(filePath);
    const repo = realpathSync(REPO_ROOT);
    if (real === repo || real.startsWith(repo + sep)) issues.push('File data berada di dalam repository. Pindahkan ke ~/private/sdnkalibaru05-students/.');
    const fileMode = statSync(real).mode & 0o777;
    const dirMode = statSync(dirname(real)).mode & 0o777;
    if (fileMode & 0o077) issues.push(`Izin file ${fileMode.toString(8)}; wajib 600 (chmod 600).`);
    if (dirMode & 0o077) issues.push(`Izin folder ${dirMode.toString(8)}; wajib 700 (chmod 700).`);
    return { real, fileMode, dirMode, issues };
}

export function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

// ----------------------------------------------------------------------------- validasi
/**
 * Struktur wajib: object dengan `records` (array) dan `fields` (array string).
 * Key top-level lain (version, school, schoolYear, labels, summary) diabaikan.
 */
export function parseDocument(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new ImportError('File bukan JSON yang valid.'); }
    if (typeOf(data) !== 'object') throw new ImportError('Struktur JSON tidak dikenali: top-level harus object.');
    if (!Array.isArray(data.records)) throw new ImportError('Struktur JSON tidak dikenali: "records" harus array.');
    if (!Array.isArray(data.fields) || !data.fields.every((f) => typeof f === 'string')) {
        throw new ImportError('Struktur JSON tidak dikenali: "fields" harus array string.');
    }
    return { fields: data.fields, records: data.records, topLevelKeys: Object.keys(data) };
}

/**
 * Validasi seluruh record dan bangun baris student_records.
 * Tidak mengubah nilai sumber: nilai disalin apa adanya.
 * Melempar ImportError berisi daftar masalah (tanpa nilai pribadi).
 */
export function validateAndBuild({ fields, records }, expected = EXPECTED) {
    const issues = [];      // per record, dibatasi 200 baris
    const structural = [];  // struktur & agregat, selalu dilaporkan
    const add = (msg) => { if (issues.length < 200) issues.push(msg); };
    const addS = (msg) => structural.push(msg);

    // ---- struktur: fields & mapping
    if (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string')) throw new ImportError('"fields" harus array string.');
    const fieldSet = new Set(fields);
    const dupFields = fields.filter((f, i) => fields.indexOf(f) !== i);
    if (fields.length !== expected.fields) addS(`"fields" berisi ${fields.length} nama, seharusnya ${expected.fields}`);
    if (dupFields.length) addS(`"fields" memuat nama ganda: ${[...new Set(dupFields)].join(', ')}`);
    for (const k of Object.keys(META_FIELDS)) if (fieldSet.has(k)) addS(`"fields" tidak boleh memuat metadata ${k}`);
    const operational = OPERATIONAL_FIELDS.filter((f) => !fieldSet.has(f));
    const allowed = new Set([...fields, ...operational]);
    for (const [col, src] of Object.entries(CORE_MAP)) {
        if (!allowed.has(src)) addS(`mapping kolom inti ${col} <- "${src}" tidak ada di "fields" maupun field operasional`);
    }
    const missingCount = new Map();
    const extraCount = new Map();
    const rows = [];
    const nikSeen = new Map();
    const fieldKeys = new Set();
    const numericNonIdentifierKeys = new Set();
    const metaPresent = { _sources: 0, _catatan: 0, _asal_data: 0 };
    let listed = 0, review = 0;
    const rombel = new Map();

    if (!Array.isArray(records)) throw new ImportError('Data siswa bukan array.');

    records.forEach((rec, i) => {
        const n = i + 1; // nomor urut, bukan data pribadi
        if (typeOf(rec) !== 'object') { add(`record #${n}: bukan object`); return; }

        const payload = {};
        const row = { field_sources: null, matching_notes: null, source_names: null };

        for (const f of allowed) if (!(f in rec)) missingCount.set(f, (missingCount.get(f) || 0) + 1);
        for (const k of Object.keys(rec)) {
            if (!(k in META_FIELDS) && !allowed.has(k)) extraCount.set(k, (extraCount.get(k) || 0) + 1);
        }
        for (const k of Object.keys(META_FIELDS)) if (!(k in rec)) missingCount.set(k, (missingCount.get(k) || 0) + 1);

        for (const [key, value] of Object.entries(rec)) {
            if (key in META_FIELDS) {
                const spec = META_FIELDS[key];
                metaPresent[key] += 1;
                if (value !== null && typeOf(value) !== spec.type) add(`record #${n}: ${key} harus ${spec.type}`);
                else row[spec.column] = value;
                continue;
            }
            fieldKeys.add(key);
            payload[key] = value;
            if (isIdentifierKey(key)) {
                if (typeof value === 'number') add(`record #${n}: field "${key}" berupa angka; identifier wajib teks`);
                else if (typeof value === 'string' && SCIENTIFIC.test(value.trim())) add(`record #${n}: field "${key}" berformat notasi ilmiah (digit hilang)`);
                else if (!['string', 'null'].includes(typeOf(value))) add(`record #${n}: field "${key}" harus teks atau kosong`);
            } else if (typeof value === 'number') {
                numericNonIdentifierKeys.add(key);
            }
        }

        // Kolom inti dari key sumber (mapping); salin apa adanya; harus teks atau null.
        for (const [col, src] of Object.entries(CORE_MAP)) {
            const v = rec[src];
            if (v === undefined || v === null) { row[col] = null; continue; }
            if (typeof v !== 'string') { add(`record #${n}: field "${src}" (kolom ${col}) harus teks`); row[col] = null; continue; }
            row[col] = v;
        }


        if (typeof row.nik !== 'string' || !/^[0-9]{16}$/.test(row.nik)) add(`record #${n}: NIK (${CORE_MAP.nik}) kosong atau bukan 16 digit`);
        else if (nikSeen.has(row.nik)) add(`record #${n}: NIK sama dengan record #${nikSeen.get(row.nik)}`);
        else nikSeen.set(row.nik, n);

        if (blank(row.nama_siswa)) add(`record #${n}: nama_siswa kosong`);

        if (row.status_daftar === STATUS_LISTED) {
            listed += 1;
            if (blank(row.kelas)) add(`record #${n}: tercantum di daftar kelas tetapi kelas kosong`);
            else rombel.set(row.kelas, (rombel.get(row.kelas) || 0) + 1);
        } else if (row.status_daftar === STATUS_REVIEW) {
            review += 1;
        } else if (row.status_daftar === null) {
            if (CORE_MAP.status_daftar in rec) add(`record #${n}: status_daftar kosong`);
        } else {
            add(`record #${n}: status_daftar tidak dikenal`);
        }

        if (typeOf(payload) !== 'object' || Object.keys(payload).length === 0) add(`record #${n}: payload kosong`);
        row.payload = payload;
        rows.push(row);
    });

    for (const [f, c] of missingCount) addS(`field "${f}" tidak ada pada ${c} record`);
    for (const [f, c] of extraCount) addS(`key tak dikenal "${f}" (bukan field sumber/operasional/metadata) pada ${c} record`);

    const total = records.length;
    if (total !== expected.total) addS(`Total siswa ${total}, seharusnya ${expected.total}`);
    if (listed !== expected.listed) addS(`"${STATUS_LISTED}" ${listed}, seharusnya ${expected.listed}`);
    if (review !== expected.review) addS(`"${STATUS_REVIEW}" ${review}, seharusnya ${expected.review}`);
    if (rombel.size !== expected.rombel) addS(`Rombel ${rombel.size}, seharusnya ${expected.rombel}`);

    const report = {
        total, listed, review,
        rombel: rombel.size,
        siswa_per_rombel: Object.fromEntries([...rombel.entries()].sort(([a], [b]) => a.localeCompare(b, 'id', { numeric: true }))),
        nik_unik: nikSeen.size,
        field_sumber: fields.length,
        field_operasional: operational,
        key_payload: allowed.size,
        field_identifier_teks: [...fieldKeys].filter(isIdentifierKey).sort(),
        field_angka_non_identifier: [...numericNonIdentifierKeys].sort(),
        record_dengan_metadata: metaPresent,
        mapping_inti: Object.fromEntries(Object.entries(CORE_MAP).map(([c, src]) => [c, src])),
    };
    if (structural.length || issues.length) {
        const all = [...structural, ...issues];
        throw new ImportError(`Validasi gagal (${all.length}${issues.length >= 200 ? '+' : ''} masalah).`, all);
    }
    return { rows, report };
}

export function loadAndValidate(filePath, { expected = EXPECTED, enforceLocation = true } = {}) {
    const loc = checkFileLocation(filePath);
    if (enforceLocation && loc.issues.length) throw new ImportError('Lokasi/izin file tidak aman.', loc.issues);
    const buf = readFileSync(loc.real);
    const hash = sha256(buf);
    const doc = parseDocument(buf.toString('utf8'));
    const { rows, report } = validateAndBuild(doc, expected);
    report.top_level_keys = doc.topLevelKeys;
    return { rows, report, hash, bytes: buf.length, sourceName: basename(loc.real), location: loc };
}

// ----------------------------------------------------------------------------- key
export function classifyKey(key) {
    if (!key) return 'missing';
    if (key.startsWith('sb_secret_')) return 'secret';
    if (key.startsWith('sb_publishable_')) return 'publishable';
    const parts = key.split('.');
    if (parts.length === 3) {
        try {
            const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            if (claims.role === 'service_role') return 'service_role';
            return `jwt:${claims.role || 'unknown'}`;
        } catch { return 'invalid'; }
    }
    return 'invalid';
}

// ----------------------------------------------------------------------------- PostgREST
function makeClient({ url, key, fetchImpl = globalThis.fetch, timeoutMs = 120000 }) {
    const base = url.replace(/\/+$/, '') + '/rest/v1';
    async function call(method, path, { body, prefer } = {}) {
        const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (prefer) headers.Prefer = prefer;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        let res;
        try {
            res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
        } catch (e) {
            throw new ImportError(`Jaringan gagal pada ${method} ${path.split('?')[0]} (${e.name === 'AbortError' ? 'timeout' : 'koneksi'}).`);
        } finally { clearTimeout(t); }
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* abaikan */ }
        if (!res.ok) {
            // Hanya code + message; details/hint bisa memuat isi baris.
            const code = json && json.code ? json.code : res.status;
            const msg = json && json.message ? String(json.message).slice(0, 200) : `HTTP ${res.status}`;
            throw new ImportError(`Supabase menolak ${method} ${path.split('?')[0]}: ${code} ${msg}`);
        }
        return { json, headers: res.headers, status: res.status };
    }
    async function count(table, filter = '') {
        const { headers } = await call('GET', `/${table}?select=id&limit=1${filter ? '&' + filter : ''}`, { prefer: 'count=exact' });
        const cr = headers.get('content-range') || '';
        const total = Number(cr.split('/')[1]);
        if (!Number.isFinite(total)) throw new ImportError(`Tidak bisa menghitung ${table}.`);
        return total;
    }
    return { call, count };
}

const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
    return v;
};
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

const VERIFY_COLUMNS = [...CORE_FIELDS, 'payload', 'field_sources', 'matching_notes', 'source_names', 'import_batch_id'];

async function verifyImport(db, rows, batchId, expected) {
    const problems = [];
    const total = await db.count('student_records');
    const listed = await db.count('student_records', `status_daftar=eq.${encodeURIComponent(STATUS_LISTED)}`);
    const review = await db.count('student_records', `status_daftar=eq.${encodeURIComponent(STATUS_REVIEW)}`);
    const inBatch = await db.count('student_records', `import_batch_id=eq.${batchId}`);
    const batches = await db.count('student_import_batches');
    const { json: summaryRows } = await db.call('POST', '/rpc/student_summary', { body: {} });
    const summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;

    if (total !== expected.total) problems.push(`total di database ${total}`);
    if (listed !== expected.listed) problems.push(`tercantum di database ${listed}`);
    if (review !== expected.review) problems.push(`perlu verifikasi di database ${review}`);
    if (inBatch !== expected.total) problems.push(`baris dengan batch ini ${inBatch}`);
    if (batches !== 1) problems.push(`jumlah batch ${batches}`);
    if (!summary || Number(summary.jumlah_rombel) !== expected.rombel) problems.push('rombel student_summary() tidak sesuai');
    if (summary && Number(summary.total_siswa) !== expected.total) problems.push('total student_summary() tidak sesuai');

    // Bandingkan setiap baris dengan sumber (identitas & seluruh payload).
    const byNik = new Map(rows.map((r) => [r.nik, r]));
    const stored = [];
    for (let from = 0; ; from += 500) {
        const { json } = await db.call('GET', `/student_records?select=${VERIFY_COLUMNS.join(',')}&order=nik.asc&limit=500&offset=${from}`);
        stored.push(...json);
        if (json.length < 500) break;
    }
    if (stored.length !== rows.length) problems.push(`baris terbaca ${stored.length}`);
    let mismatch = 0;
    const seen = new Set();
    for (const s of stored) {
        const src = byNik.get(s.nik);
        if (!src || seen.has(s.nik)) { mismatch += 1; continue; }
        seen.add(s.nik);
        const cols = [...CORE_FIELDS, 'payload', 'field_sources', 'matching_notes', 'source_names'];
        if (s.import_batch_id !== batchId || cols.some((c) => !same(s[c], src[c]))) mismatch += 1;
    }
    if (mismatch) problems.push(`${mismatch} baris berbeda dari sumber`);
    return { ok: problems.length === 0, problems, summary: summary ? { ...summary, daftar_kelas: undefined } : null };
}

async function cleanup(db, batchId, log) {
    try {
        await db.call('DELETE', `/student_records?import_batch_id=eq.${batchId}`, { prefer: 'return=minimal' });
        await db.call('DELETE', `/student_import_batches?id=eq.${batchId}`, { prefer: 'return=minimal' });
        const left = (await db.count('student_records')) + (await db.count('student_import_batches'));
        if (left !== 0) throw new ImportError(`masih ada ${left} baris`);
        log('Cleanup berhasil: kedua tabel siswa kembali kosong.');
        return true;
    } catch (e) {
        log(`CLEANUP GAGAL (${e.message}). Jalankan SQL cleanup di scripts/README-import.md dengan batch id ${batchId}.`);
        return false;
    }
}

/**
 * Eksekusi impor. Urutan:
 *  1. validasi seluruh file (tanpa jaringan)   4. INSERT 1 baris batch
 *  2. cocokkan --confirm-sha256                5. INSERT semua siswa dalam SATU request
 *  3. pastikan kedua tabel kosong & hash baru  6. verifikasi penuh
 * Kegagalan pada 4–6 (termasuk timeout/Ctrl-C) -> cleanup berdasarkan batch id.
 */
export async function runImport({ file, confirmSha256, url = DEFAULT_SUPABASE_URL, key, fetchImpl, log = console.log, expected = EXPECTED, enforceLocation = true, signal }) {
    const kind = classifyKey(key);
    if (kind !== 'service_role' && kind !== 'secret') {
        throw new ImportError(kind === 'missing'
            ? 'SUPABASE_SERVICE_ROLE_KEY tidak ada di environment. Lihat scripts/README-import.md.'
            : `Key bukan service_role/secret (jenis: ${kind}). Impor dibatalkan.`);
    }
    const { rows, report, hash, sourceName } = loadAndValidate(file, { expected, enforceLocation });
    log(`Validasi lulus: ${report.total} siswa, ${report.listed} tercantum, ${report.review} perlu verifikasi, ${report.rombel} rombel.`);
    if (!confirmSha256 || confirmSha256 !== hash) throw new ImportError('--confirm-sha256 tidak cocok dengan SHA-256 file. Jalankan dry-run dan salin hash-nya.');

    const db = makeClient({ url, key, fetchImpl });
    const existingRecords = await db.count('student_records');
    const existingBatches = await db.count('student_import_batches');
    if (existingRecords !== 0 || existingBatches !== 0) {
        throw new ImportError(`Tabel siswa tidak kosong (student_records ${existingRecords}, student_import_batches ${existingBatches}). Tidak ada perubahan.`);
    }
    if ((await db.count('student_import_batches', `source_hash=eq.${hash}`)) !== 0) throw new ImportError('File dengan hash ini sudah pernah diimpor. Tidak ada perubahan.');
    log('Prasyarat lulus: kedua tabel siswa kosong, hash file belum pernah diimpor.');

    let batchId = null;
    let interrupted = false;
    const onAbort = () => { interrupted = true; };
    signal?.addEventListener('abort', onAbort);
    try {
        const { json } = await db.call('POST', '/student_import_batches?select=id', {
            prefer: 'return=representation',
            body: { source_name: sourceName, source_hash: hash, record_count: report.total, listed_count: report.listed, review_count: report.review },
        });
        batchId = json?.[0]?.id;
        if (!batchId) throw new ImportError('Batch tidak mengembalikan id.');
        log('Batch impor dibuat.');
        if (interrupted) throw new ImportError('Dihentikan pengguna.');

        // Satu request = satu transaksi di PostgREST: semua 559 baris masuk atau tidak sama sekali.
        await db.call('POST', '/student_records', { prefer: 'return=minimal', body: rows.map((r) => ({ ...r, import_batch_id: batchId })) });
        log(`${rows.length} baris siswa ditulis dalam satu transaksi.`);
        if (interrupted) throw new ImportError('Dihentikan pengguna.');

        const v = await verifyImport(db, rows, batchId, expected);
        if (!v.ok) throw new ImportError('Verifikasi pasca-impor gagal.', v.problems);
        log('Verifikasi lulus: jumlah, rombel, dan seluruh nilai sama dengan sumber.');
        return { ok: true, batchId, report, summary: v.summary };
    } catch (e) {
        log(`Impor gagal: ${e.message}${e.issues?.length ? ' — ' + e.issues.join('; ') : ''}`);
        if (batchId) await cleanup(db, batchId, log);
        else log('Belum ada data yang ditulis.');
        throw e;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}

// ----------------------------------------------------------------------------- CLI
function parseArgs(argv) {
    const a = { execute: false };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--execute') a.execute = true;
        else if (k === '--file') a.file = argv[++i];
        else if (k === '--confirm-sha256') a.confirm = argv[++i];
        else if (k === '--help' || k === '-h') a.help = true;
        else throw new ImportError(`Argumen tidak dikenal: ${k}`);
    }
    return a;
}

function printDryRun(r) {
    const rep = r.report;
    console.log('=== DRY-RUN Data Siswa (agregat, tanpa data pribadi) ===');
    console.log(`File            : ${r.sourceName} (${r.bytes} byte), izin file ${r.location.fileMode.toString(8)}, folder ${r.location.dirMode.toString(8)}`);
    console.log(`SHA-256         : ${r.hash}`);
    console.log(`Total siswa     : ${rep.total} (target ${EXPECTED.total})`);
    console.log(`Tercantum       : ${rep.listed} (target ${EXPECTED.listed})`);
    console.log(`Perlu verifikasi: ${rep.review} (target ${EXPECTED.review})`);
    console.log(`Rombel          : ${rep.rombel} (target ${EXPECTED.rombel})`);
    console.log(`NIK unik 16 digit: ${rep.nik_unik}`);
    console.log(`Siswa per rombel: ${JSON.stringify(rep.siswa_per_rombel)}`);
    console.log(`Key top-level   : ${rep.top_level_keys.join(', ')}`);
    console.log(`Field sumber    : ${rep.field_sumber} (dari "fields", nama unik, ada di setiap record)`);
    console.log(`Field operasional: ${rep.field_operasional.length} (${rep.field_operasional.join(', ') || '-'}), bukan duplikasi`);
    console.log(`Key payload     : ${rep.key_payload} (= ${rep.field_sumber} sumber + ${rep.field_operasional.length} operasional; nama key asli dipertahankan)`);
    console.log(`Mapping inti    : ${Object.entries(rep.mapping_inti).map(([c, s]) => `${c}<-${s}`).join(', ')}`);
    console.log(`Field identifier (wajib teks, lulus): ${rep.field_identifier_teks.join(', ') || '-'}`);
    console.log(`Field bernilai angka (bukan identifier): ${rep.field_angka_non_identifier.join(', ') || '-'}`);
    console.log(`Record dengan metadata: ${JSON.stringify(rep.record_dengan_metadata)}`);
    const body = JSON.stringify(r.rows.map((x) => ({ ...x, import_batch_id: '00000000-0000-0000-0000-000000000000' })));
    console.log(`Ukuran request impor siswa: ${Buffer.byteLength(body)} byte (1 request)`);
    console.log('Hasil           : VALID. Tidak ada koneksi jaringan dan tidak ada data yang ditulis.');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.file) {
        console.log('Pakai: node scripts/import-students.mjs --file <data.json> [--execute --confirm-sha256 <hash>]');
        process.exit(args.help ? 0 : 2);
    }
    if (!args.execute) {
        printDryRun(loadAndValidate(args.file));
        return;
    }
    const ctrl = new AbortController();
    process.on('SIGINT', () => { console.log('Ctrl-C diterima: menghentikan dan membersihkan...'); ctrl.abort(); });
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const res = await runImport({ file: args.file, confirmSha256: args.confirm, url, key, signal: ctrl.signal });
    console.log(`=== IMPOR BERHASIL === batch ${res.batchId}: ${res.report.total} siswa, ${res.report.listed} tercantum, ${res.report.review} perlu verifikasi, ${res.report.rombel} rombel.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((e) => {
        console.error(`GAGAL: ${e.message}`);
        if (e.issues?.length) e.issues.forEach((m) => console.error(`  - ${m}`));
        process.exit(1);
    });
}
