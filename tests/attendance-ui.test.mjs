// Uji UI Absensi Fase 1 di Chrome: /guru (HP 360 px) dan tab admin baru.
//
// Opsional, dilewati bila dependensi tidak tersedia:
//   PLAYWRIGHT_MODULE_DIR=<node_modules berisi playwright-core>
//   CHROMIUM_PATH=<path executable Chrome/Chromium>
//   UI_SCREENSHOT_DIR=<folder screenshot> (opsional)
//
// supabase-js dari CDN diganti tests/fixtures/fake-supabase-browser.js; API Vercel ditiru.
// Semua data fiktif. Tidak ada request ke Supabase asli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PW_DIR = process.env.PLAYWRIGHT_MODULE_DIR;
const CHROME = process.env.CHROMIUM_PATH;
const OUT = process.env.UI_SCREENSHOT_DIR || '';
const skipReason = !PW_DIR || !CHROME ? 'set PLAYWRIGHT_MODULE_DIR dan CHROMIUM_PATH untuk uji UI'
    : (!existsSync(CHROME) ? 'CHROMIUM_PATH tidak ditemukan' : false);

const results = [];
const cleanup = [];
if (!skipReason) {
    try {
        await runUi();
    } catch (e) {
        const lines = String(e.message).split('\n');
        const where = lines.find((l) => /waiting for (locator|selector|function)/.test(l)) || '';
        results.push([false, `alur UI berhenti: ${lines[0]} ${where.trim().slice(0, 140)}`]);
    } finally {
        for (const fn of cleanup.reverse()) await Promise.resolve().then(fn).catch(() => {});
    }
}
if (skipReason) test('UI Absensi (dilewati)', { skip: skipReason }, () => {});
for (const [ok, msg] of results) test(`UI Absensi: ${msg}`, () => assert.ok(ok, msg));

async function runUi() {
    const { chromium } = await import(pathToFileURL(join(PW_DIR, 'playwright-core', 'index.mjs')).href);
    if (OUT) mkdirSync(OUT, { recursive: true });
    const shot = (page, name) => (OUT ? page.screenshot({ path: join(OUT, name), fullPage: true }) : null);
    const check = (ok, msg) => results.push([Boolean(ok), msg]);
    const FAKE = readFileSync(join(REPO, 'tests/fixtures/fake-supabase-browser.js'));

    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
    const server = createServer((req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/admin' || p === '/guru') p = `${p}.html`;
        const f = join(REPO, p);
        if (!f.startsWith(`${REPO}/`) || !existsSync(f) || /^\/(tests|scripts|supabase|data-private|api)\//.test(p)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
        res.end(readFileSync(f));
    }).listen(0);
    cleanup.push(() => server.close());
    const BASE = `http://127.0.0.1:${server.address().port}`;

    const apiCalls = [];
    const browser = await chromium.launch({ executablePath: CHROME });
    cleanup.push(() => browser.close());

    async function newPage(path, viewport) {
        const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 700, isMobile: viewport.width < 700 });
        ctx.setDefaultTimeout(8000);
        await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
        await ctx.route(/^https:\/\/(fonts\.|wwpbghdepykfqgzhyvmh|.*vercel)/, (r) => r.fulfill({ status: 204, body: '' }));
        await ctx.route('**/_vercel/**', (r) => r.fulfill({ status: 204 }));
        await ctx.route('**/api/guru-login', async (r) => {
            const b = JSON.parse(r.request().postData() || '{}');
            apiCalls.push({ api: 'login', identifier: b.identifier });
            if (b.password !== 'benar123') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Email/NIP atau password salah.' } }) });
            return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'at-wali', refresh_token: 'rt', expires_in: 3600 }) });
        });
        await ctx.route('**/api/admin/teacher-accounts', async (r) => {
            const req = r.request();
            const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
            apiCalls.push({ api: 'accounts', method: req.method(), action: body?.action, auth: req.headers().authorization });
            if (req.method() === 'GET') {
                return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [
                    { staff_id: 's1', nama: 'Sunarsih, S.Pd.', jabatan: 'Guru Kelas', email: 'sunarsih@fiktif.test', login_id: '990000000000000001', admin: false, status: 'aktif' },
                    { staff_id: 's2', nama: 'Guru Fiktif Dengan Nama Panjang Sekali, S.Pd.', jabatan: 'Guru Kelas', email: 'panjang.sekali.alamatnya@fiktif.test', login_id: '990000000000000002', admin: false, status: 'siap_dibuat' },
                    { staff_id: 's3', nama: 'Operator Fiktif', jabatan: 'Operator', email: 'op@fiktif.test', login_id: null, admin: true, status: 'siap_dibuat' },
                    { staff_id: 's4', nama: 'Tenaga Fiktif', jabatan: 'Tenaga Kebersihan', email: null, login_id: null, admin: false, status: 'belum_didaftarkan' },
                ] }) });
            }
            if (body.action === 'create') {
                return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [
                    { staff_id: 's2', nama: 'Guru Fiktif Dengan Nama Panjang Sekali, S.Pd.', email: 'panjang.sekali.alamatnya@fiktif.test', login_id: '990000000000000002', password: 'Abc23defGh', ok: true },
                    { staff_id: 's3', nama: 'Operator Fiktif', ok: false, pesan: 'Email sudah dipakai akun lain.' },
                ] }) });
            }
            return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${BASE}${path}`);
        return { ctx, page, errors };
    }

    const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    // ============================================================ GURU — HP 360 px
    {
        const { ctx, page, errors } = await newPage('/guru', { width: 360, height: 780 });
        await page.waitForSelector('#gLogin:not(.g-hidden)');
        check(await overflow(page) <= 0, 'login guru tidak bergeser ke samping di 360 px');
        check((await page.getAttribute('#gId', 'autocomplete')) === 'username', 'kolom login memakai autocomplete username');
        await shot(page, 'guru-01-login-360.png');

        await page.fill('#gId', '990000000000000001');
        await page.fill('#gPw', 'salah');
        await page.click('#gLoginBtn');
        await page.waitForSelector('#gLoginErr:not(.g-hidden)');
        check(/salah/.test(await page.textContent('#gLoginErr')), 'password salah menampilkan pesan');

        await page.fill('#gPw', 'benar123');
        await page.click('#gLoginBtn');
        await page.waitForSelector('#gApp:not(.g-hidden)');
        await page.waitForSelector('.g-task');
        check(/Halo, Sunarsih/.test(await page.textContent('#gTitle')), 'beranda menyapa nama guru');
        check(/Belum diisi/.test(await page.textContent('.g-task')), 'kartu menandai absensi belum diisi');
        check(await overflow(page) <= 0, 'beranda tidak bergeser ke samping');
        await shot(page, 'guru-02-beranda-360.png');

        await page.click('.g-task a.att-btn-primary');
        await page.waitForSelector('.att-list .att-item');
        check((await page.$$('.att-list .att-item')).length === 3, 'lembar absensi memuat 3 siswa');
        check(await overflow(page) <= 0, 'lembar absensi tidak bergeser ke samping (nama panjang)');
        const btnH = await page.$eval('.att-status button', (b) => b.getBoundingClientRect().height);
        check(btnH >= 44, `tombol status minimal 44 px (${Math.round(btnH)} px)`);
        check(await page.isHidden('.g-nav'), 'navigasi bawah disembunyikan agar tombol Simpan terlihat');
        check(await page.$$eval('.att-status button[aria-pressed="true"]', (b) => b.length) === 0, 'status awal kosong (tidak otomatis Hadir)');
        check(/3<\/b> dari 3 siswa belum diabsen/.test(await page.innerHTML('.att-progress')), 'penanda "3 dari 3 belum diabsen" tampil');
        await page.click('.att-item[data-i="1"] [data-st="S"]');
        check(/^1/.test(await page.textContent('.att-count.S b')), 'penghitung Sakit bertambah');
        // Ketuk lagi = kosong
        await page.click('.att-item[data-i="1"] [data-st="S"]');
        check(/^0/.test(await page.textContent('.att-count.S b'))
            && (await page.getAttribute('.att-item[data-i="1"] [data-st="S"]', 'aria-pressed')) === 'false', 'ketuk status yang sama mengosongkan lagi');
        await page.click('.att-item[data-i="1"] [data-st="S"]');
        await page.click('.att-item[data-i="0"] [data-st="H"]');
        // Simpan dengan 1 siswa kosong → ditolak, nama ditandai
        await page.click('#attSave');
        await page.waitForSelector('.att-item.att-missing');
        check(await page.$('.att-sheet') === null, 'simpan ditahan saat masih ada siswa kosong (tidak ada konfirmasi)');
        check(/Siswa Fiktif Tiga/.test(await page.textContent('#attMissing'))
            && (await page.$$('.att-item.att-missing')).length === 1, 'siswa yang kosong disebut namanya dan ditandai merah');
        check(!(await page.evaluate(() => window.__fake.calls.some((c) => c.fn === 'save_attendance'))), 'tidak ada data terkirim saat masih kosong');
        await shot(page, 'guru-03b-belum-lengkap-360.png');
        await page.click('.att-item[data-i="2"] [data-st="H"]');
        check((await page.$$('.att-item.att-missing')).length === 0, 'tanda merah hilang setelah status dipilih');
        check(/Semua siswa sudah diabsen/.test(await page.textContent('#attMissing')), 'kotak peringatan berubah jadi hijau setelah lengkap');
        check(/Semua 3 siswa sudah diabsen/.test(await page.textContent('.att-progress')), 'penanda berubah jadi "semua sudah diabsen"');
        await page.click('.att-item[data-i="1"] [data-note]');
        await page.fill('[data-note-input="1"]', 'Demam');
        await shot(page, 'guru-03-absen-360.png');
        await page.click('#attSave');
        await page.waitForSelector('.att-sheet');
        check(/1 sakit/.test(await page.textContent('.att-sheet')), 'konfirmasi menampilkan ringkasan');
        await shot(page, 'guru-04-konfirmasi-360.png');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => window.__fake.calls.some((c) => c.fn === 'save_attendance'));
        const saved = await page.evaluate(() => window.__fake.calls.find((c) => c.fn === 'save_attendance').args);
        check(saved.p_entries.length === 3 && saved.p_entries.find((e) => e.status === 'S')?.note === 'Demam', 'RPC menerima 3 status + catatan');
        await page.waitForSelector('.att-badge.ok');
        check(/Tersimpan/.test(await page.textContent('#gSheet')), 'lembar menampilkan status tersimpan');

        // Gagal kirim → draf tetap ada
        await page.evaluate(() => { window.__fake.failRpc.save_attendance = 'Failed to fetch'; });
        await page.click('.att-item[data-i="0"] [data-st="A"]');
        await page.click('#attSave');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => /Koneksi terputus/.test(document.getElementById('attToastHost')?.textContent || ''));
        check(true, 'gagal kirim memberi pesan koneksi');
        await page.reload();
        await page.waitForSelector('.att-list');
        check(/belum terkirim/i.test(await page.textContent('#gSheet')), 'isian yang belum terkirim dipulihkan setelah muat ulang');
        await page.evaluate(() => { delete window.__fake.failRpc.save_attendance; });

        // Kembali ke beranda lewat tombol kembali, lalu Siswa + profil
        await page.click('#gBack');
        await page.waitForSelector('.g-task');
        check(await page.isVisible('.g-nav'), 'navigasi bawah muncul lagi di beranda');
        await page.click('.g-nav a[data-nav="siswa"]');
        await page.waitForSelector('.att-table tbody tr');
        check(/Menampilkan 1–3 dari 3 data/.test(await page.textContent('[data-info]')), 'daftar siswa memakai keterangan "Menampilkan x–y dari z data"');
        check(await page.$('select[data-size] option[value="100"]') !== null, 'pilihan Tampilkan 10/25/50/100 tersedia');
        check(await overflow(page) <= 0, 'daftar siswa (kartu) tidak bergeser ke samping');
        await shot(page, 'guru-05-siswa-360.png');
        await page.click('.att-table tbody tr a');
        await page.waitForSelector('.g-prof');
        const prof = await page.textContent('.g-prof');
        check(/081200000001/.test(prof) && (await page.$('a[href^="https://wa.me/62812"]')) !== null, 'profil menampilkan HP + tombol WhatsApp');
        check(await overflow(page) <= 0, 'profil tidak bergeser ke samping');
        await shot(page, 'guru-06-profil-360.png');

        // Rekap
        await page.click('.g-nav a[data-nav="rekap"]');
        await page.waitForSelector('.att-student-card');
        check(await overflow(page) <= 0, 'rekap (kartu) tidak bergeser ke samping');
        await shot(page, 'guru-07-rekap-360.png');

        // Akun
        await page.click('.g-nav a[data-nav="akun"]');
        await page.fill('#gPw1', 'abcdefgh');
        await page.fill('#gPw2', 'abcdefgX');
        await page.click('#gPwForm button[type="submit"]');
        await page.waitForSelector('#attToastHost .att-alert.err');
        check(/tidak sama/.test(await page.textContent('#attToastHost')), 'ganti password menolak konfirmasi yang beda');
        await shot(page, 'guru-08-akun-360.png');
        await page.click('#gLogout');
        await page.waitForSelector('#gLogin:not(.g-hidden)');
        check(true, 'keluar kembali ke halaman login');
        check(errors.length === 0, `tidak ada error JavaScript di /guru (${errors.join(' | ').slice(0, 120)})`);
        await ctx.close();
    }

    // ============================================================ ADMIN — laptop + HP
    for (const vp of [{ width: 1366, height: 900, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
        const { ctx, page, errors } = await newPage('/admin', { width: vp.width, height: vp.height });
        await page.fill('#adminEmail', 'admin@fiktif.test');
        await page.fill('#adminPassword', 'x');
        await page.click('.btn-login');
        await page.waitForSelector('#mainContent', { state: 'visible' });
        if (vp.tag === '1366') check(/Portal Guru/.test(await page.textContent('.login-box')), 'login admin menautkan ke Portal Guru');

        await page.evaluate(() => showTab('tabTeacherAccounts'));
        await page.waitForSelector('#accTable .att-table');
        check(/2 siap dibuat/.test(await page.textContent('#accSummary')), `[${vp.tag}] Akun Guru: ringkasan status`);
        check((await page.textContent('#topbarTitle')) === 'Akun Guru', `[${vp.tag}] judul topbar Akun Guru`);
        check(await overflow(page) <= 0, `[${vp.tag}] tab Akun Guru tidak bergeser ke samping`);
        await page.waitForTimeout(500);
        await shot(page, `admin-01-akun-${vp.tag}.png`);
        await page.click('#accCreateAll');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForSelector('#accPwTitle');
        const modal = await page.textContent('.att-sheet');
        check(/Abc23defGh/.test(modal) && /1 gagal/.test(modal) && /sekali ini/.test(modal), `[${vp.tag}] password tampil sekali + daftar gagal`);
        check(apiCalls.some((c) => c.api === 'accounts' && c.action === 'create' && /^Bearer /.test(c.auth || '')), `[${vp.tag}] API akun dipanggil dengan token admin`);
        await shot(page, `admin-02-password-${vp.tag}.png`);
        await page.click('.att-sheet [data-act="close"]');

        await page.evaluate(() => showTab('tabAttendance'));
        await page.waitForSelector('#attSheet .att-list');
        check(await overflow(page) <= 0, `[${vp.tag}] tab Kelola Absensi tidak bergeser ke samping`);
        await page.click('[data-all="H"]');
        check(await page.$('.att-sheet') === null && /Semua 3 siswa sudah diabsen/.test(await page.textContent('.att-progress')),
            `[${vp.tag}] Tandai semua Hadir langsung mengisi semua tanpa konfirmasi`);
        await page.click('#attSave');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => window.__fake.calls.some((c) => c.fn === 'save_attendance'));
        await page.waitForSelector('#attArchive');
        // Sesi sudah ada → koreksi wajib alasan
        await page.click('#attSave');
        await page.waitForSelector('#attSheetInput');
        await page.click('.att-sheet [data-act="yes"]');
        check(await page.isVisible('#attSheetInput'), `[${vp.tag}] koreksi admin tidak bisa disimpan tanpa alasan`);
        await page.fill('#attSheetInput', 'Surat sakit menyusul');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => window.__fake.calls.filter((c) => c.fn === 'save_attendance').some((c) => c.args.p_reason === 'Surat sakit menyusul'));
        check(true, `[${vp.tag}] koreksi admin terkirim dengan alasan`);
        await page.waitForSelector('#attHistTable');
        await shot(page, `admin-03-kelola-${vp.tag}.png`);
        check(errors.length === 0, `[${vp.tag}] tidak ada error JavaScript di /admin (${errors.join(' | ').slice(0, 120)})`);
        await ctx.close();
    }
}
