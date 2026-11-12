// Tes offline script pembuat akun guru (tanpa jaringan, data fiktif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEntries, generatePassword } from '../scripts/create-teacher-accounts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(ROOT, 'scripts/create-teacher-accounts.mjs');

test('validasi: email dinormalkan ke huruf kecil', () => {
    const [a] = validateEntries([{ staff_name: 'A', email: ' DIswahyuni@Example.com ' }]);
    assert.equal(a.email, 'diswahyuni@example.com');
    assert.equal(a.login_id, null);
});

test('validasi: menolak email/NIP ganda, NIP bukan angka, nama kosong', () => {
    assert.throws(() => validateEntries([{ staff_name: 'A', email: 'x@y.id' }, { staff_name: 'B', email: 'X@y.id' }]), /email ganda/);
    assert.throws(() => validateEntries([{ staff_name: 'A', email: 'x@y.id', login_id: '12' }]), /login_id/);
    assert.throws(() => validateEntries([{ staff_name: '', email: 'x@y.id' }]), /staff_name/);
    assert.throws(() => validateEntries([]), /tidak kosong/);
});

test('password acak 10 karakter tanpa huruf membingungkan', () => {
    const p = generatePassword();
    assert.equal(p.length, 10);
    assert.doesNotMatch(p, /[0O1lI]/);
    assert.notEqual(generatePassword(), generatePassword());
});

test('contoh file lolos validasi', () => {
    const raw = JSON.parse(readFileSync(resolve(ROOT, 'scripts/teacher-accounts.example.json'), 'utf8'));
    assert.equal(validateEntries(raw).length, 4);
});

test('menolak file di luar data-private/', () => {
    assert.throws(() => execFileSync('node', [SCRIPT, '--file', resolve(ROOT, 'scripts/teacher-accounts.example.json')], { stdio: 'pipe' }),
        (e) => /data-private/.test(e.stderr.toString()));
});

test('dry-run tidak butuh key dan tidak mencetak email', () => {
    const dir = resolve(ROOT, 'data-private');
    mkdirSync(dir, { recursive: true });
    const f = resolve(dir, `tes-akun-${process.pid}.json`);
    writeFileSync(f, readFileSync(resolve(ROOT, 'scripts/teacher-accounts.example.json')));
    try {
        const out = execFileSync('node', [SCRIPT, '--file', f], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
        assert.match(out, /File valid: 4 akun \(2 admin, 1 akun lama, 3 tanpa NIP\/NUPTK\)/);
        assert.match(out, /DRY-RUN/);
        assert.doesNotMatch(out, /@example\.com/);
    } finally {
        rmSync(f, { force: true });
    }
});
