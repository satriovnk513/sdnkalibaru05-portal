// Tes offline API absensi: /api/guru-login dan /api/admin/teacher-accounts.
// Supabase ditiru dengan fetch palsu; data fiktif.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-fiktif';
process.env.VERCEL_ENV = 'production';

const { default: login, classifyIdentifier } = await import('../api/guru-login.js');
const { default: accounts, buildRows, normalizeRequest, generatePassword } = await import('../api/admin/teacher-accounts.js');
const { default: setPin, pinIsWeak } = await import('../api/guru-pin.js');
const { default: resetPw } = await import('../api/guru-reset-password.js');
const { default: changePw, passwordProblem } = await import('../api/guru-change-password.js');

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
        emails: { [ADMIN]: 'admin@fiktif.test', [GURU]: 'guru@fiktif.test' },
        pins: {},            // user_id → { pin, fails, locked }
        pwChanged: {},
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
        return id ? json(200, { id, email: db.emails[id] || 'x@fiktif.test' }) : json(401, { msg: 'bad jwt' });
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
    if (p.startsWith('/auth/v1/admin/users/')) {
        if (method === 'PUT' && body?.password) db.pwChanged[p.split('/').pop()] = body.password;
        return json(200, {});
    }
    if (p === '/rest/v1/rpc/set_recovery_pin') {
        if (!db.accs.some((a) => a.user_id === body.p_user)) return json(400, { code: 'P0002' });
        db.pins[body.p_user] = { pin: body.p_pin, fails: 0, locked: false };
        return json(204);
    }
    if (p === '/rest/v1/rpc/verify_recovery_pin') {
        const r = db.pins[body.p_user];
        if (!r) return json(200, 'tidak_ada');
        if (r.locked) return json(200, 'terkunci');
        if (r.pin === body.p_pin) { r.fails = 0; return json(200, 'ok'); }
        r.fails += 1;
        if (r.fails >= 5) { r.locked = true; r.fails = 0; return json(200, 'terkunci'); }
        return json(200, 'salah');
    }
    if (p === '/rest/v1/rpc/clear_recovery_pin') {
        const had = Boolean(db.pins[body.p_user]);
        delete db.pins[body.p_user];
        return json(200, had);
    }
    if (p === '/rest/v1/teacher_recovery_pins') return json(200, Object.keys(db.pins).map((user_id) => ({ user_id })));
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
        const uid = q.get('user_id')?.replace('eq.', '');
        if (uid) rows = rows.filter((a) => a.user_id === uid);
        if (email) rows = rows.filter((a) => a.email === decodeURIComponent(email));
        if (nip) rows = rows.filter((a) => a.login_id === nip);
        return json(200, rows);
    }
    if (p === '/rest/v1/teacher_accounts' && method === 'POST') {
        if (db.failLinkFor === body.staff_id) return json(409, { code: '23505' });
        db.accs.push({ is_active: true, ...body });
        return json(201);
    }
    if (p === '/rest/v1/teacher_accounts' && method === 'PATCH') {
        const sid = q.get('staff_id')?.replace('eq.', '');
        const uid = q.get('user_id')?.replace('eq.', '');
        const acc = db.accs.find((a) => (sid ? a.staff_id === sid : a.user_id === uid));
        if (acc) Object.assign(acc, body);
        return json(204);
    }
    return json(404, { msg: `tidak ditiru: ${method} ${p}` });
};

function call(handler, { method = 'POST', body, token, origin = ORIGIN, host } = {}) {
    return new Promise((resolve) => {
        const res = {
            headers: {}, statusCode: 200,
            setHeader(k, v) { this.headers[k] = v; },
            status(c) { this.statusCode = c; return this; },
            json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); return this; },
            end() { resolve({ status: this.statusCode, headers: this.headers }); return this; },
        };
        const headers = { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` };
        if (origin) headers.origin = origin;
        if (host) headers.host = host;
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

test('akun guru: buat semua → password awal = NIP/NUPTK (acak jika tak punya), wajib ganti, operator jadi admin', async () => {
    db.reqs[1].login_id = '990000000000000002';
    const r = await call(accounts, { token: 'jwt-admin', body: { action: 'create' } });
    assert.equal(r.status, 200);
    const ok = r.body.results.filter((x) => x.ok);
    assert.equal(ok.length, 2);
    const dua = ok.find((x) => x.nama === 'Guru Fiktif Dua');
    assert.equal(dua.password, '990000000000000002', 'password awal = NIP/NUPTK');
    assert.equal(dua.dari_nip, true);
    const op = ok.find((x) => x.nama === 'Operator Fiktif');
    assert.match(op.password, /^[a-zA-Z2-9]{10}$/, 'tanpa NIP → password acak');
    assert.equal(op.dari_nip, false);
    assert.ok(db.accs.filter((a) => a.staff_id !== ST(1)).every((a) => a.must_change_password === true), 'akun baru wajib ganti password');
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

// ---------------------------------------------------------------- origin
test('GET tanpa header Origin (same-origin di browser) diterima', async () => {
    const r = await call(accounts, { method: 'GET', token: 'jwt-admin', origin: null });
    assert.equal(r.status, 200);
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
});

test('origin sama dengan host deployment diterima, origin asing tetap ditolak', async () => {
    const same = await call(accounts, { method: 'GET', token: 'jwt-admin', origin: 'https://sdnkalibaru05-portal.vercel.app', host: 'sdnkalibaru05-portal.vercel.app' });
    assert.equal(same.status, 200);
    const evil = await call(accounts, { method: 'GET', token: 'jwt-admin', origin: 'https://evil.test', host: 'sdnkalibaru05.sch.id' });
    assert.equal(evil.status, 403);
    const evilLogin = await call(login, { origin: 'https://evil.test', body: { identifier: 'guru@fiktif.test', password: 'rahasia123' } });
    assert.equal(evilLogin.status, 403);
});

// ---------------------------------------------------------------- PIN pemulihan
test('PIN lemah dikenali (sama dengan aturan database)', () => {
    for (const p of ['123456', '654321', '111111', '121212', '123123', '112233', '12345', '12a456', '']) assert.equal(pinIsWeak(p), true, p);
    for (const p of ['483920', '205817', '730194']) assert.equal(pinIsWeak(p), false, p);
});

test('buat PIN: wajib login, password saat ini benar, PIN tidak lemah', async () => {
    let r = await call(setPin, { body: { password: 'rahasia123', pin: '483920' } });
    assert.equal(r.status, 401, 'tanpa token ditolak');
    r = await call(setPin, { token: 'jwt-guru', body: { password: 'salah', pin: '483920' } });
    assert.equal(r.status, 401);
    assert.match(r.body.error.message, /Password saat ini salah/);
    assert.equal(db.pins[GURU], undefined);
    r = await call(setPin, { token: 'jwt-guru', body: { password: 'rahasia123', pin: '123456' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.type, 'weak_pin');
    r = await call(setPin, { token: 'jwt-guru', body: { password: 'rahasia123', pin: '48392' } });
    assert.equal(r.status, 400);
    r = await call(setPin, { token: 'jwt-guru', body: { password: 'rahasia123', pin: '483920' } });
    assert.equal(r.status, 200);
    assert.equal(db.pins[GURU].pin, '483920');
    assert.ok(!calls.some((c) => JSON.stringify(c).includes('rahasia123') && c.path.startsWith('/rest/')), 'password tidak dikirim ke database');
});

test('buat PIN dari origin asing ditolak', async () => {
    const r = await call(setPin, { token: 'jwt-guru', origin: 'https://jahat.test', body: { password: 'rahasia123', pin: '483920' } });
    assert.equal(r.status, 403);
});

test('lupa password: NIP + PIN benar → password diganti', async () => {
    db.pins[GURU] = { pin: '483920', fails: 0, locked: false };
    const r = await call(resetPw, { body: { identifier: '9900 0000 0000 0000 01', pin: '483920', password: 'BaruSekali9' } });
    assert.equal(r.status, 200);
    assert.equal(db.pwChanged[GURU], 'BaruSekali9');
});

test('lupa password: PIN salah, akun tak dikenal, dan belum punya PIN → pesan sama, password tidak berubah', async () => {
    db.pins[GURU] = { pin: '483920', fails: 0, locked: false };
    const a = await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '111000', password: 'BaruSekali9' } });
    const b = await call(resetPw, { body: { identifier: 'tidakada@fiktif.test', pin: '483920', password: 'BaruSekali9' } });
    delete db.pins[GURU];
    const c = await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '483920', password: 'BaruSekali9' } });
    for (const r of [a, b, c]) {
        assert.equal(r.status, 401);
        assert.equal(r.body.error.message, a.body.error.message);
    }
    assert.deepEqual(db.pwChanged, {});
});

test('lupa password: salah PIN 5x → terkunci (423), PIN benar pun ditolak', async () => {
    db.pins[GURU] = { pin: '483920', fails: 0, locked: false };
    const statuses = [];
    for (let i = 0; i < 5; i++) {
        statuses.push((await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: `00000${i}`, password: 'BaruSekali9' } })).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 423]);
    const r = await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '483920', password: 'BaruSekali9' } });
    assert.equal(r.status, 423);
    assert.deepEqual(db.pwChanged, {});
});

test('lupa password: validasi input & akun nonaktif baru diberi tahu setelah PIN benar', async () => {
    db.pins[GURU] = { pin: '483920', fails: 0, locked: false };
    assert.equal((await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '483920', password: 'pendek' } })).status, 400);
    assert.equal((await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '4839', password: 'BaruSekali9' } })).status, 400);
    assert.equal((await call(resetPw, { body: { identifier: 'abc', pin: '483920', password: 'BaruSekali9' } })).status, 400);
    db.accs[0].is_active = false;
    assert.equal((await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '000999', password: 'BaruSekali9' } })).status, 401);
    const r = await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '483920', password: 'BaruSekali9' } });
    assert.equal(r.status, 403);
    assert.deepEqual(db.pwChanged, {});
});

test('admin: daftar akun menampilkan status PIN dan bisa menghapus PIN; guru tidak bisa', async () => {
    db.pins[GURU] = { pin: '483920', fails: 0, locked: false };
    let r = await call(accounts, { method: 'GET', token: 'jwt-admin' });
    assert.equal(r.body.rows.find((x) => x.staff_id === ST(1)).pin, true);
    r = await call(accounts, { token: 'jwt-guru', body: { action: 'clear_pin', staff_id: ST(1) } });
    assert.equal(r.status, 403);
    r = await call(accounts, { token: 'jwt-admin', body: { action: 'clear_pin', staff_id: ST(1) } });
    assert.equal(r.status, 200);
    assert.equal(db.pins[GURU], undefined);
    r = await call(accounts, { method: 'GET', token: 'jwt-admin' });
    assert.equal(r.body.rows.find((x) => x.staff_id === ST(1)).pin, false);
});

// ---------------------------------------------------------------- password awal = NIP
test('reset password oleh admin → kembali ke NIP/NUPTK dan wajib ganti lagi', async () => {
    db.accs[0].must_change_password = false;
    const r = await call(accounts, { token: 'jwt-admin', body: { action: 'reset_password', staff_id: ST(1) } });
    assert.equal(r.status, 200);
    assert.equal(r.body.password, '990000000000000001');
    assert.equal(r.body.dari_nip, true);
    assert.equal(db.pwChanged[GURU], '990000000000000001');
    assert.equal(db.accs[0].must_change_password, true);
});

test('aturan password baru: minimal 8, tidak boleh sama dengan NIP/NUPTK atau email', () => {
    const me = { login_id: '990000000000000001', email: 'guru@fiktif.test' };
    assert.match(passwordProblem('pendek', me), /minimal 8/);
    assert.match(passwordProblem('990000000000000001', me), /NIP/);
    assert.match(passwordProblem('9900 0000 0000 0000 01', me), /NIP/);
    assert.match(passwordProblem('Guru@Fiktif.test', me), /email/);
    assert.equal(passwordProblem('RahasiaBaru7', me), null);
});

test('guru ganti password: tanda wajib-ganti dicabut; NIP sebagai password ditolak; wajib login', async () => {
    db.accs[0].must_change_password = true;
    let r = await call(changePw, { body: { password: 'RahasiaBaru7' } });
    assert.equal(r.status, 401);
    r = await call(changePw, { token: 'jwt-guru', body: { password: '990000000000000001' } });
    assert.equal(r.status, 400);
    assert.equal(db.accs[0].must_change_password, true);
    assert.deepEqual(db.pwChanged, {});
    r = await call(changePw, { token: 'jwt-guru', body: { password: 'RahasiaBaru7' } });
    assert.equal(r.status, 200);
    assert.equal(db.pwChanged[GURU], 'RahasiaBaru7');
    assert.equal(db.accs[0].must_change_password, false);
    r = await call(changePw, { token: 'jwt-admin', body: { password: 'RahasiaBaru7' } });
    assert.equal(r.status, 403, 'akun tanpa data guru ditolak');
});

test('lupa password lewat PIN: password baru = NIP ditolak; sukses mencabut tanda wajib-ganti', async () => {
    db.pins[GURU] = { pin: '483920', fails: 0, locked: false };
    db.accs[0].must_change_password = true;
    let r = await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '483920', password: '990000000000000001' } });
    assert.equal(r.status, 400);
    r = await call(resetPw, { body: { identifier: 'guru@fiktif.test', pin: '483920', password: 'RahasiaBaru7' } });
    assert.equal(r.status, 200);
    assert.equal(db.accs[0].must_change_password, false);
});
