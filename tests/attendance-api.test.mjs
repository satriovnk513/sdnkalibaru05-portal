// Tes offline API absensi: /api/guru-login dan /api/admin/teacher-accounts.
// Supabase ditiru dengan fetch palsu; data fiktif.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-fiktif';
process.env.VERCEL_ENV = 'production';

const { default: login, classifyIdentifier } = await import('../api/guru-login.js');
const { default: accounts, buildRows, normalizeRequest, generatePassword } = await import('../api/admin/teacher-accounts.js');

const ORIGIN = 'https://sdnkalibaru05.sch.id';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const GURU = '00000000-0000-4000-8000-0000000000b1';
const ST = (n) => `00000000-0000-4000-8000-00000000000${n}`;

let db;
let calls;

function reset() {
    calls = [];
    db = {
        tokens: { 'jwt-admin': ADMIN, 'jwt-guru': GURU },
        passwords: { 'guru@fiktif.test': 'rahasia123' },
        roles: [{ user_id: ADMIN, role: 'admin' }],
        staff: [
            { id: ST(1), name: 'Guru Fiktif Satu', role: 'Guru Kelas|Guru Kelas', order_index: 1 },
            { id: ST(2), name: 'Guru Fiktif Dua', role: 'Guru Kelas|Guru Kelas', order_index: 2 },
            { id: ST(3), name: 'Operator Fiktif', role: 'Tenaga Kependidikan|Operator', order_index: 3 },
            { id: ST(4), name: 'Belum Daftar', role: 'Guru Kelas|Guru Kelas', order_index: 4 },
        ],
        reqs: [
            { staff_id: ST(1), email: 'guru@fiktif.test', login_id: '990000000000000001', make_admin: false },
            { staff_id: ST(2), email: 'dua@fiktif.test', login_id: null, make_admin: false },
            { staff_id: ST(3), email: 'op@fiktif.test', login_id: null, make_admin: true },
        ],
        accs: [{ user_id: GURU, staff_id: ST(1), email: 'guru@fiktif.test', login_id: '990000000000000001', is_active: true, created_at: '2026-11-12' }],
        authUsers: new Set(['guru@fiktif.test']),
        failLinkFor: null,
    };
}

function json(status, body) {
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const auth = opts.headers?.Authorization || '';
    calls.push({ method, path: u.pathname + u.search, body });
    const p = u.pathname;
    const q = u.searchParams;

    if (p === '/auth/v1/user') {
        const id = db.tokens[auth.replace('Bearer ', '')];
        return id ? json(200, { id, email: 'x@fiktif.test' }) : json(401, { msg: 'bad jwt' });
    }
    if (p === '/auth/v1/token') {
        return db.passwords[body.email] === body.password
            ? json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
            : json(400, { error: 'invalid_grant' });
    }
    if (p === '/auth/v1/admin/users' && method === 'POST') {
        if (db.authUsers.has(body.email)) return json(422, { msg: 'exists' });
        db.authUsers.add(body.email);
        return json(200, { id: `11111111-0000-4000-8000-${String(db.authUsers.size).padStart(12, '0')}` });
    }
    if (p.startsWith('/auth/v1/admin/users/')) return json(200, {});
    if (p === '/rest/v1/user_roles' && method === 'GET') {
        const uid = (q.get('user_id') || '').replace('eq.', '');
        if (uid) return json(200, db.roles.filter((r) => r.user_id === uid && r.role === 'admin'));
        return json(200, db.roles.filter((r) => r.role === 'admin').map((r) => ({ user_id: r.user_id })));
    }
    if (p === '/rest/v1/user_roles' && method === 'POST') { db.roles.push(body); return json(201); }
    if (p === '/rest/v1/staff') return json(200, db.staff);
    if (p === '/rest/v1/teacher_account_requests' && method === 'GET') return json(200, db.reqs);
    if (p === '/rest/v1/teacher_accounts' && method === 'GET') {
        const email = q.get('email')?.replace('eq.', '');
        const nip = q.get('login_id')?.replace('eq.', '');
        let rows = db.accs;
        if (email) rows = rows.filter((a) => a.email === decodeURIComponent(email));
        if (nip) rows = rows.filter((a) => a.login_id === nip);
        return json(200, rows);
    }
    if (p === '/rest/v1/teacher_accounts' && method === 'POST') {
        if (db.failLinkFor === body.staff_id) return json(409, { code: '23505' });
        db.accs.push({ ...body, is_active: true });
        return json(201);
    }
    if (p === '/rest/v1/teacher_accounts' && method === 'PATCH') {
        const sid = q.get('staff_id').replace('eq.', '');
        Object.assign(db.accs.find((a) => a.staff_id === sid), body);
        return json(204);
    }
    return json(404, { msg: `tidak ditiru: ${method} ${p}` });
};

function call(handler, { method = 'POST', body, token, origin = ORIGIN } = {}) {
    return new Promise((resolve) => {
        const res = {
            headers: {}, statusCode: 200,
            setHeader(k, v) { this.headers[k] = v; },
            status(c) { this.statusCode = c; return this; },
            json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); return this; },
            end() { resolve({ status: this.statusCode, headers: this.headers }); return this; },
        };
        const headers = { origin, 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` };
        if (token) headers.authorization = `Bearer ${token}`;
        handler({ method, headers, body }, res);
    });
}

beforeEach(reset);

// ---------------------------------------------------------------- guru-login
test('identifier: email dinormalkan, NIP boleh pakai spasi/titik, lainnya ditolak', () => {
    assert.deepEqual(classifyIdentifier(' Guru@Fiktif.Test '), { kind: 'email', value: 'guru@fiktif.test' });
    assert.deepEqual(classifyIdentifier('19860828 202221 2 012'), { kind: 'nip', value: '198608282022212012' });
    assert.equal(classifyIdentifier('abc'), null);
    assert.equal(classifyIdentifier('1234'), null);
});

test('login dengan NIP berhasil dan mengembalikan token', async () => {
    const r = await call(login, { body: { identifier: '990000000000000001', password: 'rahasia123' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.access_token, 'at');
});

test('login dengan email berhasil', async () => {
    const r = await call(login, { body: { identifier: 'GURU@fiktif.test', password: 'rahasia123' } });
    assert.equal(r.status, 200);
});

test('password salah dan NIP tak dikenal memberi pesan yang sama', async () => {
    const a = await call(login, { body: { identifier: '990000000000000001', password: 'salah' } });
    const b = await call(login, { body: { identifier: '990000000000000999', password: 'salah' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
});

test('akun nonaktif: status baru diberitahu setelah password benar', async () => {
    db.accs[0].is_active = false;
    const wrong = await call(login, { body: { identifier: '990000000000000001', password: 'salah' } });
    assert.equal(wrong.status, 401);
    const right = await call(login, { body: { identifier: '990000000000000001', password: 'rahasia123' } });
    assert.equal(right.status, 403);
    assert.equal(right.body.access_token, undefined);
});

test('origin lain ditolak, GET ditolak', async () => {
    assert.equal((await call(login, { origin: 'https://evil.test', body: { identifier: 'a@b.c', password: 'x' } })).status, 403);
    assert.equal((await call(login, { method: 'GET' })).status, 405);
});

// ---------------------------------------------------------------- akun guru
test('akun guru: tanpa token 401, guru biasa 403', async () => {
    assert.equal((await call(accounts, { method: 'GET' })).status, 401);
    assert.equal((await call(accounts, { method: 'GET', token: 'jwt-guru' })).status, 403);
});

test('akun guru: GET memberi status tiap staf', async () => {
    const r = await call(accounts, { method: 'GET', token: 'jwt-admin' });
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.rows.map((x) => [x.nama, x.status]));
    assert.deepEqual(by, { 'Guru Fiktif Satu': 'aktif', 'Guru Fiktif Dua': 'siap_dibuat', 'Operator Fiktif': 'siap_dibuat', 'Belum Daftar': 'belum_didaftarkan' });
});

test('akun guru: buat semua → dua akun baru, password sekali, operator jadi admin', async () => {
    const r = await call(accounts, { token: 'jwt-admin', body: { action: 'create' } });
    assert.equal(r.status, 200);
    const ok = r.body.results.filter((x) => x.ok);
    assert.equal(ok.length, 2);
    for (const x of ok) assert.match(x.password, /^[a-zA-Z2-9]{10}$/);
    assert.ok(r.body.results.find((x) => x.nama === 'Guru Fiktif Satu' && !x.ok));
    const created = calls.filter((c) => c.path === '/auth/v1/admin/users');
    assert.ok(created.every((c) => c.body.email_confirm === true));
    assert.ok(db.roles.some((x) => x.role === 'admin' && x.user_id !== ADMIN));
});

test('akun guru: email sudah dipakai → gagal dengan pesan jelas', async () => {
    db.authUsers.add('dua@fiktif.test');
    const r = await call(accounts, { token: 'jwt-admin', body: { action: 'create', staff_ids: [ST(2)] } });
    assert.equal(r.body.results[0].ok, false);
    assert.match(r.body.results[0].pesan, /sudah dipakai/);
});

test('akun guru: gagal menghubungkan → user Auth dihapus lagi', async () => {
    db.failLinkFor = ST(2);
    const r = await call(accounts, { token: 'jwt-admin', body: { action: 'create', staff_ids: [ST(2)] } });
    assert.equal(r.body.results[0].ok, false);
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/auth/v1/admin/users/')));
});

test('akun guru: nonaktifkan memblokir user di Auth; tidak bisa nonaktifkan diri sendiri', async () => {
    const r = await call(accounts, { token: 'jwt-admin', body: { action: 'set_active', staff_id: ST(1), active: false } });
    assert.equal(r.status, 200);
    assert.equal(db.accs[0].is_active, false);
    assert.ok(calls.some((c) => c.method === 'PUT' && c.body?.ban_duration === '876000h'));
    db.accs.push({ user_id: ADMIN, staff_id: ST(3), email: 'op@fiktif.test', login_id: null, is_active: true });
    const self = await call(accounts, { token: 'jwt-admin', body: { action: 'set_active', staff_id: ST(3), active: false } });
    assert.equal(self.status, 400);
});

test('akun guru: validasi data', () => {
    assert.ok(normalizeRequest({ staff_id: ST(1), email: 'bukan-email' }).error);
    assert.ok(normalizeRequest({ staff_id: ST(1), email: 'a@b.cd', login_id: '12a' }).error);
    assert.deepEqual(normalizeRequest({ staff_id: ST(1), email: ' A@B.cd ', login_id: '1986 0828' }),
        { staff_id: ST(1), email: 'a@b.cd', login_id: '19860828', make_admin: false });
    assert.equal(generatePassword().length, 10);
    assert.equal(buildRows({ staff: [], reqs: [], accs: [] }).length, 0);
});

test('tanpa SUPABASE_SERVICE_ROLE_KEY: pesan konfigurasi jelas', async () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
        const r = await call(accounts, { method: 'GET', token: 'jwt-admin' });
        assert.equal(r.status, 500);
        assert.match(r.body.error.message, /SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
        process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
    }
});
