#!/usr/bin/env node
// =============================================================================
// Pembuat Akun Guru (Absensi Fase 0) — SDN Kalibaru 05
//
// Mode default: DRY-RUN (validasi file, tanpa jaringan, tanpa key).
//   node scripts/create-teacher-accounts.mjs --file data-private/akun-guru.json
//
// Mode eksekusi (setelah migration + seed absensi diterapkan):
//   SUPABASE_SERVICE_ROLE_KEY="$SB_KEY" node scripts/create-teacher-accounts.mjs \
//     --execute --file data-private/akun-guru.json --out data-private/password-awal.csv
//
// Format file (contoh: scripts/teacher-accounts.example.json):
//   [{ "staff_name": "Sunarsih, S.Pd.", "email": "...", "login_id": "1986...", "admin": false }]
//   - staff_name harus sama persis dengan nama di tabel staff (halaman Guru & Staf).
//   - login_id = NIP/NUPTK (angka saja) atau null.
//   - admin: true → akun juga diberi peran admin.
//   - existing: true → akun sudah ada di Supabase Auth (mis. admin lama); hanya
//     dihubungkan, password tidak diubah.
//
// Aturan:
// - Akun dibuat langsung dengan email_confirm = true. TIDAK ada email undangan
//   atau verifikasi yang dikirim (beberapa alamat Gmail pendek mungkin milik
//   orang lain). Reset password dilakukan admin.
// - File input dan output berisi data pribadi: wajib di folder data-private/
//   (di-ignore Git). Script menolak path lain.
// - Password awal HANYA ditulis ke file --out. Tidak pernah dicetak ke layar.
// - Key hanya dibaca dari environment variable dan tidak pernah dicetak.
// - Aman dijalankan ulang: guru yang sudah punya akun dilewati.
// =============================================================================

import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_DIR = resolve(ROOT, 'data-private');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wwpbghdepykfqgzhyvmh.supabase.co';
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function fail(msg) {
    console.error(`GAGAL: ${msg}`);
    process.exit(1);
}

function parseArgs(argv) {
    const args = { execute: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--execute') args.execute = true;
        else if (a === '--file') args.file = argv[++i];
        else if (a === '--out') args.out = argv[++i];
        else fail(`argumen tidak dikenal: ${a}`);
    }
    if (!args.file) fail('wajib --file <path di data-private/>');
    if (args.execute && !args.out) fail('mode --execute wajib --out <path .csv di data-private/>');
    return args;
}

function assertPrivatePath(p, mustExist) {
    const abs = resolve(p);
    const checked = mustExist ? realpathSync(abs) : resolve(realpathSync(dirname(abs)), abs.split(sep).pop());
    if (!checked.startsWith(PRIVATE_DIR + sep)) {
        fail(`file data pribadi harus berada di folder data-private/ (di-ignore Git): ${p}`);
    }
    return checked;
}

export function validateEntries(raw) {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('file harus berisi array akun yang tidak kosong');
    const seenEmail = new Set();
    const seenLogin = new Set();
    const seenStaff = new Set();
    return raw.map((r, i) => {
        const n = i + 1;
        if (typeof r !== 'object' || r === null) throw new Error(`akun #${n}: harus object`);
        const staff_name = typeof r.staff_name === 'string' ? r.staff_name.trim() : '';
        const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
        const login_id = r.login_id == null || r.login_id === '' ? null : String(r.login_id).replace(/\s/g, '');
        if (!staff_name) throw new Error(`akun #${n}: staff_name kosong`);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`akun #${n}: email tidak valid`);
        if (login_id !== null && !/^[0-9]{8,20}$/.test(login_id)) throw new Error(`akun #${n}: login_id harus 8–20 angka`);
        if (seenEmail.has(email)) throw new Error(`akun #${n}: email ganda`);
        if (login_id && seenLogin.has(login_id)) throw new Error(`akun #${n}: login_id ganda`);
        if (seenStaff.has(staff_name)) throw new Error(`akun #${n}: staff_name ganda`);
        seenEmail.add(email);
        if (login_id) seenLogin.add(login_id);
        seenStaff.add(staff_name);
        return { staff_name, email, login_id, admin: r.admin === true, existing: r.existing === true };
    });
}

export function generatePassword(length = 10) {
    let out = '';
    for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    return out;
}

function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function api(key, method, path, body, extraHeaders = {}) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
        method,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* abaikan */ }
    return { status: res.status, ok: res.ok, json };
}

async function findAuthUserIdByEmail(key, email) {
    for (let page = 1; page <= 20; page++) {
        const r = await api(key, 'GET', `/auth/v1/admin/users?page=${page}&per_page=200`);
        if (!r.ok) throw new Error(`gagal membaca daftar user (HTTP ${r.status})`);
        const users = r.json?.users ?? [];
        const hit = users.find((u) => (u.email || '').toLowerCase() === email);
        if (hit) return hit.id;
        if (users.length < 200) return null;
    }
    return null;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const inPath = assertPrivatePath(args.file, true);
    let entries;
    try {
        entries = validateEntries(JSON.parse(readFileSync(inPath, 'utf8')));
    } catch (e) {
        fail(e.message);
    }

    const admins = entries.filter((e) => e.admin).length;
    console.log(`File valid: ${entries.length} akun (${admins} admin, ${entries.filter((e) => e.existing).length} akun lama, ${entries.filter((e) => !e.login_id).length} tanpa NIP/NUPTK).`);
    if (!args.execute) {
        console.log('DRY-RUN selesai. Tidak ada yang dikirim ke Supabase. Tambahkan --execute untuk membuat akun.');
        return;
    }

    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) fail('SUPABASE_SERVICE_ROLE_KEY belum di-set');
    const outPath = assertPrivatePath(args.out, false);
    if (existsSync(outPath)) fail('file --out sudah ada; pakai nama baru supaya password lama tidak tertimpa');

    const staffRes = await api(key, 'GET', '/rest/v1/staff?select=id,name');
    if (!staffRes.ok) fail(`gagal membaca staff (HTTP ${staffRes.status})`);
    const staffByName = new Map();
    for (const s of staffRes.json) {
        staffByName.set(s.name, staffByName.has(s.name) ? null : s.id);
    }
    const missing = entries.filter((e) => !staffByName.get(e.staff_name)).map((e) => e.staff_name);
    if (missing.length) fail(`nama tidak ditemukan atau ganda di staff: ${missing.join('; ')}`);

    const existingAcc = await api(key, 'GET', '/rest/v1/teacher_accounts?select=staff_id');
    if (!existingAcc.ok) fail(`gagal membaca teacher_accounts (HTTP ${existingAcc.status}). Migration absensi sudah diterapkan?`);
    const linked = new Set(existingAcc.json.map((r) => r.staff_id));

    const rows = [['nama', 'email', 'nip_nuptk', 'password_awal', 'status']];
    const tally = { dibuat: 0, dihubungkan: 0, dilewati: 0, gagal: 0 };

    for (const e of entries) {
        const staffId = staffByName.get(e.staff_name);
        if (linked.has(staffId)) {
            tally.dilewati++;
            rows.push([e.staff_name, e.email, e.login_id ?? '', '', 'sudah punya akun']);
            continue;
        }
        let userId = null;
        let password = '';
        let status = '';
        if (e.existing) {
            userId = await findAuthUserIdByEmail(key, e.email);
            if (!userId) {
                tally.gagal++;
                rows.push([e.staff_name, e.email, e.login_id ?? '', '', 'GAGAL: akun lama tidak ditemukan']);
                continue;
            }
            status = 'akun lama dihubungkan';
        } else {
            password = generatePassword();
            const created = await api(key, 'POST', '/auth/v1/admin/users', {
                email: e.email,
                password,
                email_confirm: true,
                user_metadata: { full_name: e.staff_name },
            });
            if (!created.ok) {
                tally.gagal++;
                rows.push([e.staff_name, e.email, e.login_id ?? '', '', `GAGAL: buat user (HTTP ${created.status})`]);
                continue;
            }
            userId = created.json?.id;
            status = 'dibuat';
        }

        const acc = await api(key, 'POST', '/rest/v1/teacher_accounts',
            { user_id: userId, staff_id: staffId, email: e.email, login_id: e.login_id },
            { Prefer: 'return=minimal' });
        if (!acc.ok) {
            tally.gagal++;
            rows.push([e.staff_name, e.email, e.login_id ?? '', password, `GAGAL: hubungkan akun (HTTP ${acc.status})`]);
            continue;
        }
        if (e.admin) {
            const role = await api(key, 'POST', '/rest/v1/user_roles?on_conflict=user_id,role',
                { user_id: userId, role: 'admin' },
                { Prefer: 'resolution=ignore-duplicates,return=minimal' });
            if (!role.ok) status += `; GAGAL beri peran admin (HTTP ${role.status})`;
        }
        if (e.existing) tally.dihubungkan++; else tally.dibuat++;
        rows.push([e.staff_name, e.email, e.login_id ?? '', password, status]);
    }

    writeFileSync(outPath, rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n', { mode: 0o600 });
    console.log(`Selesai: ${tally.dibuat} dibuat, ${tally.dihubungkan} dihubungkan, ${tally.dilewati} dilewati, ${tally.gagal} gagal.`);
    console.log('Password awal ada di file --out (tidak dicetak di layar). Bagikan langsung ke tiap guru, lalu hapus file itu.');
    if (tally.gagal) process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((e) => fail(e.message));
}
