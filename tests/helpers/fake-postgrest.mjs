// Tiruan minimal PostgREST untuk menguji scripts/import-students.mjs tanpa jaringan.
// Hanya mendukung endpoint yang dipakai importer. Dua backend:
//  - memoryBackend(): in-memory, meniru constraint penting (tanpa dependensi)
//  - pgliteBackend(): Postgres sungguhan (PGlite) + migration asli (opsional)
// Setiap request POST berisi array diproses all-or-nothing, seperti PostgREST.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

class HttpError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function parse(url) {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    const params = new URLSearchParams(u.search);
    const filters = [];
    for (const [k, v] of params) {
        if (['select', 'limit', 'offset', 'order'].includes(k)) continue;
        if (!v.startsWith('eq.')) throw new HttpError(400, 'TEST', `filter tidak didukung: ${k}`);
        filters.push([k, decodeURIComponent(v.slice(3))]);
    }
    return { path, params, filters };
}

const json = (status, body, headers = {}) => new Response(body === undefined || status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
});

/**
 * fetch palsu. `hooks.before({method, path, body})` boleh melempar (simulasi
 * jaringan putus sebelum sampai server) atau mengembalikan Response (mis. 500).
 * `hooks.after({method, path, body, response})` boleh melempar SETELAH server
 * memproses (simulasi timeout padahal data sudah tersimpan).
 */
export function makeFetch(backend, hooks = {}) {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        const { path, params, filters } = parse(url);
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        const prefer = opts.headers?.Prefer || '';
        calls.push({ method, path, headers: opts.headers });
        const ctx = { method, path, body, n: calls.length };
        if (hooks.before) { const r = await hooks.before(ctx); if (r) return r; }
        let response;
        try {
            if (method === 'GET') {
                const rows = await backend.select(path, filters, params);
                const headers = prefer.includes('count=exact') ? { 'Content-Range': `${rows.length ? '0-0' : '*'}/${rows.total}` } : {};
                response = json(200, rows.page, headers);
            } else if (method === 'POST' && path.startsWith('rpc/')) {
                response = json(200, await backend.rpc(path.slice(4)));
            } else if (method === 'POST') {
                const out = await backend.insert(path, Array.isArray(body) ? body : [body]);
                response = prefer.includes('return=representation') ? json(201, out) : json(201, undefined);
            } else if (method === 'DELETE') {
                await backend.remove(path, filters);
                response = json(204, undefined);
            } else throw new HttpError(405, 'TEST', 'metode tidak didukung');
        } catch (e) {
            response = json(e.status || 400, { code: e.code || 'XX000', message: e.message, details: 'DETAIL-RAHASIA-JANGAN-DICETAK' });
        }
        if (hooks.after) await hooks.after({ ...ctx, response });
        return response;
    };
    return { fetchImpl, calls };
}

// ----------------------------------------------------------------------------- memory
export function memoryBackend() {
    const tables = { student_records: [], student_import_batches: [] };
    const check = (cond, code, msg) => { if (!cond) throw new HttpError(400, code, msg); };
    const backend = {
        tables,
        async select(table, filters, params) {
            const all = tables[table].filter((r) => filters.every(([k, v]) => String(r[k]) === v));
            const sorted = params.get('order') === 'nik.asc' ? [...all].sort((a, b) => a.nik.localeCompare(b.nik)) : all;
            const off = Number(params.get('offset') || 0);
            const lim = Number(params.get('limit') || 1000);
            const page = sorted.slice(off, off + lim).map((r) => structuredClone(r));
            return Object.assign({ page, total: all.length, length: page.length });
        },
        async insert(table, rows) {
            const t = tables[table];
            const staged = [];
            for (const r of rows) {
                if (table === 'student_records') {
                    check(/^[0-9]{16}$/.test(r.nik || ''), '23514', 'new row violates check constraint "student_records_nik_format"');
                    check(![...t, ...staged].some((x) => x.nik === r.nik), '23505', 'duplicate key value violates unique constraint "student_records_nik_key"');
                    check(['Tercantum di daftar kelas', 'Perlu verifikasi lebih lanjut'].includes(r.status_daftar), '23514', 'status');
                    check(!['_sources', '_catatan', '_asal_data'].some((k) => k in r.payload), '23514', 'payload metadata');
                    check(tables.student_import_batches.some((b) => b.id === r.import_batch_id), '23503', 'foreign key');
                } else {
                    check(/^[0-9a-f]{64}$/.test(r.source_hash), '23514', 'hash');
                    check(!t.some((x) => x.source_hash === r.source_hash), '23505', 'duplicate source_hash');
                }
                staged.push({ id: randomUUID(), ...structuredClone(r) });
            }
            t.push(...staged); // all-or-nothing
            return staged.map((r) => ({ id: r.id }));
        },
        async remove(table, filters) {
            tables[table] = tables[table].filter((r) => !filters.every(([k, v]) => String(r[k]) === v));
            if (table === 'student_import_batches') {
                tables.student_records.forEach((r) => { if (!tables.student_import_batches.some((b) => b.id === r.import_batch_id)) r.import_batch_id = null; });
            }
        },
        async rpc(name) {
            if (name !== 'student_summary') throw new HttpError(404, 'PGRST202', 'rpc');
            const r = tables.student_records;
            const listed = r.filter((x) => x.status_daftar === 'Tercantum di daftar kelas');
            const kelas = [...new Set(listed.map((x) => x.kelas).filter((k) => k && k.trim()))].sort();
            return [{ total_siswa: r.length, tercantum: listed.length, perlu_verifikasi: r.length - listed.length, jumlah_rombel: kelas.length, daftar_kelas: kelas }];
        },
        counts: () => ({ records: tables.student_records.length, batches: tables.student_import_batches.length }),
    };
    return backend;
}

// ----------------------------------------------------------------------------- pglite
const SUPABASE_MOCK = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.user_roles (user_id uuid primary key references auth.users(id), role text not null);
alter table public.user_roles enable row level security;
create policy own_role on public.user_roles for select to authenticated using (user_id = auth.uid());
create table public.news (id serial primary key, title text);
insert into public.news (title) values ('berita lama');
`;

export async function pgliteBackend({ moduleDir, migrationPath }) {
    const { PGlite } = await import(pathToFileURL(`${moduleDir}/@electric-sql/pglite/dist/index.js`).href);
    const { pg_trgm } = await import(pathToFileURL(`${moduleDir}/@electric-sql/pglite/dist/contrib/pg_trgm.js`).href);
    const db = await PGlite.create({ extensions: { pg_trgm } });
    await db.exec(SUPABASE_MOCK);
    await db.exec(readFileSync(migrationPath, 'utf8'));

    const ALLOWED = new Set(['student_records', 'student_import_batches']);
    const COLS = /^[a-z_]+(,[a-z_]+)*$/;
    const ident = (s) => { if (!/^[a-z_]+$/.test(s)) throw new HttpError(400, 'TEST', 'ident'); return `"${s}"`; };
    const where = (filters, start = 1) => filters.length
        ? 'where ' + filters.map(([k], i) => `${ident(k)}::text = $${i + start}`).join(' and ')
        : '';
    const asService = (fn) => db.transaction(async (tx) => {
        await tx.query('set local role service_role');
        try { return await fn(tx); } catch (e) { throw new HttpError(400, e.code || 'XX000', e.message); }
    });

    return {
        db,
        async select(table, filters, params) {
            if (!ALLOWED.has(table)) throw new HttpError(404, 'PGRST205', 'table');
            const sel = params.get('select') || 'id';
            if (!COLS.test(sel)) throw new HttpError(400, 'TEST', 'select');
            return asService(async (tx) => {
                const vals = filters.map(([, v]) => v);
                const total = (await tx.query(`select count(*)::int n from public.${ident(table)} ${where(filters)}`, vals)).rows[0].n;
                const order = params.get('order') === 'nik.asc' ? 'order by nik' : '';
                const lim = Number(params.get('limit') || 1000), off = Number(params.get('offset') || 0);
                const page = (await tx.query(`select ${sel.split(',').map(ident).join(',')} from public.${ident(table)} ${where(filters)} ${order} limit ${lim} offset ${off}`, vals)).rows;
                return { page, total, length: page.length };
            });
        },
        async insert(table, rows) {
            if (!ALLOWED.has(table)) throw new HttpError(404, 'PGRST205', 'table');
            const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
            return asService(async (tx) => (await tx.query(
                `insert into public.${ident(table)} (${keys.map(ident).join(',')})
                 select ${keys.map(ident).join(',')} from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb)
                 returning id`, [JSON.stringify(rows)])).rows);
        },
        async remove(table, filters) {
            if (!ALLOWED.has(table) || !filters.length) throw new HttpError(400, 'TEST', 'delete');
            await asService((tx) => tx.query(`delete from public.${ident(table)} ${where(filters)}`, filters.map(([, v]) => v)));
        },
        async rpc(name) {
            if (name !== 'student_summary') throw new HttpError(404, 'PGRST202', 'rpc');
            return asService(async (tx) => (await tx.query('select * from public.student_summary()')).rows.map((r) => ({
                ...r, total_siswa: Number(r.total_siswa), tercantum: Number(r.tercantum),
                perlu_verifikasi: Number(r.perlu_verifikasi), jumlah_rombel: Number(r.jumlah_rombel),
            })));
        },
        async counts() {
            const r = (await db.query(`select (select count(*)::int from public.student_records) records,
                                              (select count(*)::int from public.student_import_batches) batches,
                                              (select count(*)::int from public.news) news`)).rows[0];
            return r;
        },
    };
}
