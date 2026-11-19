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
    // Kamera tiruan (pola uji Chrome) supaya pemindai QR di portal bisa dites tanpa kamera asli.
    const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    cleanup.push(() => browser.close());

    async function newPage(path, viewport) {
        const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 700, isMobile: viewport.width < 700, acceptDownloads: true });
        await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
        // UI_THEME=dark menjalankan seluruh alur dalam mode gelap (untuk memeriksa tampilan).
        if (process.env.UI_THEME) await ctx.addInitScript((t) => { try { if (!localStorage.getItem('tema')) localStorage.setItem('tema', t); } catch { /* abaikan */ } }, process.env.UI_THEME);
        ctx.setDefaultTimeout(8000);
        await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
        // jsQR tiruan: "membaca" QR yang isinya diatur tes lewat window.__qrAnswer.
        await ctx.route('https://cdn.jsdelivr.net/npm/jsqr@*/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript',
            body: 'window.__jsqrCalls = 0; window.jsQR = function (d, w, h) { window.__jsqrCalls++; window.__jsqrSize = [w, h]; return window.__qrAnswer ? { data: window.__qrAnswer } : null; };' }));
        await ctx.route(/^https:\/\/(fonts\.|wwpbghdepykfqgzhyvmh|.*vercel)/, (r) => r.fulfill({ status: 204, body: '' }));
        await ctx.route('**/_vercel/**', (r) => r.fulfill({ status: 204 }));
        await ctx.route('**/api/guru-login', async (r) => {
            const b = JSON.parse(r.request().postData() || '{}');
            apiCalls.push({ api: 'login', identifier: b.identifier });
            if (b.password !== 'benar123') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Email/NIP atau password salah.' } }) });
            return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'at-wali', refresh_token: 'rt', expires_in: 3600 }) });
        });
        await ctx.route('**/api/guru-reset-password', async (r) => {
            const b = JSON.parse(r.request().postData() || '{}');
            apiCalls.push({ api: 'reset', identifier: b.identifier, pin: b.pin });
            if (b.pin !== '483920') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Email/NIP atau PIN salah. Belum pernah membuat PIN? Hubungi admin sekolah.' } }) });
            return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        });
        await ctx.route('**/api/guru-change-password', async (r) => {
            const b = JSON.parse(r.request().postData() || '{}');
            apiCalls.push({ api: 'changepw', password: b.password, auth: r.request().headers().authorization });
            if (b.password === '990000000000000001') return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Password baru tidak boleh sama dengan NIP/NUPTK.' } }) });
            await r.request().frame().page().evaluate(() => { window.__fake.tables.teacher_accounts.find((a) => a.user_id === 'u-wali').must_change_password = false; });
            return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        });
        await ctx.route('**/api/guru-pin', async (r) => {
            const b = JSON.parse(r.request().postData() || '{}');
            apiCalls.push({ api: 'pin', pin: b.pin, auth: r.request().headers().authorization });
            if (b.password !== 'benar123') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Password saat ini salah.' } }) });
            await r.request().frame().page().evaluate(() => { window.__fake.pin = true; });
            return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
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
    const { spawnSync } = await import('node:child_process');
    const hasOpenpyxl = spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dlDir = mkdtempSync(join(tmpdir(), 'att-dl-'));
    async function xlsxCells(download, cells) {
        const path = join(dlDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
        await download.saveAs(path);
        if (!hasOpenpyxl) return null;
        const r = spawnSync('python3', ['-c', 'import sys,openpyxl\nws=openpyxl.load_workbook(sys.argv[1]).active\nprint("|".join([str(ws[c].value) for c in sys.argv[2:]] + ["logo" if "xl/media/image1.png" in __import__("zipfile").ZipFile(sys.argv[1]).namelist() else "tanpa-logo"]))', path, ...cells], { encoding: 'utf8' });
        return r.status === 0 ? r.stdout.trim().split('|') : [`ERROR ${r.stderr.slice(0, 120)}`];
    }
    async function popupFrom(page, click) {
        const [pop] = await Promise.all([page.context().waitForEvent('page'), click()]);
        await pop.waitForLoadState();
        await pop.waitForFunction(() => document.querySelector('.page, .kertas'));
        return pop;
    }

    // ============================================================ MODE GELAP / TERANG
    for (const [path, sel] of [['/guru', '#gLogin:not(.g-hidden)'], ['/admin', '.login-box']]) {
        const { ctx, page } = await newPage(path, { width: 390, height: 780 });
        await page.waitForSelector(sel);
        await page.evaluate(() => localStorage.removeItem('tema'));
        await page.reload();
        await page.waitForSelector(sel);
        const btn = page.locator('[data-theme-toggle]:visible').first();
        check(await btn.count() === 1 && (await btn.innerHTML()).includes('svg'), `${path}: tombol mode gelap tampil di halaman masuk`);
        const before = await page.evaluate(() => document.documentElement.dataset.theme);
        await btn.click();
        const after = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, s: localStorage.getItem('tema'), bg: getComputedStyle(document.body).backgroundColor }));
        check(after.t !== before && after.s === after.t, `${path}: tombol mengganti tema dan menyimpannya`);
        await page.evaluate(() => { localStorage.setItem('tema', 'dark'); });
        await page.reload();
        await page.waitForSelector(sel);
        const dark = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name=theme-color]').content }));
        check(dark.t === 'dark' && dark.bg !== 'rgb(255, 255, 255)' && dark.meta !== '#ffffff', `${path}: pilihan mode gelap bertahan setelah dimuat ulang`);
        await page.locator('[data-theme-toggle]:visible').first().click();
        check(await page.evaluate(() => document.documentElement.dataset.theme === 'light' && localStorage.getItem('tema') === 'light'), `${path}: bisa kembali ke mode terang`);
        await ctx.close();
    }

    // ============================================================ GURU — HP 360 px
    {
        const { ctx, page, errors } = await newPage('/guru', { width: 360, height: 780 });
        await page.waitForSelector('#gLogin:not(.g-hidden)');
        check(await overflow(page) <= 0, 'login guru tidak bergeser ke samping di 360 px');
        check((await page.getAttribute('#gId', 'autocomplete')) === 'username', 'kolom login memakai autocomplete username');
        await shot(page, 'guru-01-login-360.png');
        {
            const gap = await page.evaluate(() => document.querySelector('label[for="gPw"]').getBoundingClientRect().top - document.getElementById('gId').getBoundingClientRect().bottom);
            check(gap > 8 && gap < 40, `login: jarak kolom email → password wajar (${Math.round(gap)} px)`);
        }

        // Lupa password lewat PIN
        await page.fill('#gId', '990000000000000001');
        await page.click('#gForgot');
        check(await page.isVisible('#gResetForm') && !(await page.isVisible('#gLoginForm')), 'tombol Lupa password? membuka form PIN');
        check((await page.inputValue('#gRId')) === '990000000000000001', 'NIP yang sudah diketik ikut terisi di form lupa password');
        check((await page.getAttribute('#gRPin', 'inputmode')) === 'numeric', 'kolom PIN memunculkan keypad angka di HP');
        await page.fill('#gRPin', '12ab34');
        check((await page.inputValue('#gRPin')) === '1234', 'kolom PIN hanya menerima angka');
        await page.fill('#gRPin', '111000');
        await page.fill('#gRPw1', 'PasswordBaru1');
        await page.fill('#gRPw2', 'PasswordBaru1');
        await page.click('#gResetBtn');
        await page.waitForSelector('#gResetErr:not(.g-hidden)');
        check(/PIN salah/.test(await page.textContent('#gResetErr')), 'PIN salah menampilkan pesan');
        await shot(page, 'guru-01b-lupa-password-360.png');
        check(await overflow(page) <= 0, 'form lupa password tidak bergeser ke samping');
        await page.fill('#gRPin', '483920');
        await page.click('#gResetBtn');
        await page.waitForSelector('#gLoginForm', { state: 'visible' });
        check(/Password berhasil diganti/.test(await page.textContent('#gLoginErr')) && (await page.inputValue('#gId')) === '990000000000000001',
            'PIN benar → kembali ke login dengan pesan sukses');
        check(apiCalls.some((c) => c.api === 'reset' && c.pin === '483920'), 'API reset dipanggil dengan PIN');

        await page.fill('#gId', '990000000000000001');
        await page.fill('#gPw', 'salah');
        await page.click('#gLoginBtn');
        await page.waitForFunction(() => /password salah/.test(document.getElementById('gLoginErr').textContent) && !document.getElementById('gLoginErr').classList.contains('g-hidden'));
        check(/err/.test(await page.getAttribute('#gLoginErr', 'class')), 'password salah menampilkan pesan (merah, bukan pesan sukses sebelumnya)');

        await page.evaluate(() => { window.__fake.tables.teacher_accounts.find((a) => a.user_id === 'u-wali').must_change_password = true; });
        await page.fill('#gPw', 'benar123');
        await page.click('#gLoginBtn');
        await page.waitForSelector('#gApp:not(.g-hidden)');
        // Password masih password awal (NIP/NUPTK) → wajib buat password baru dulu
        await page.waitForSelector('#gForceForm');
        check(/password awal \(NIP\/NUPTK\)/.test(await page.textContent('#gMain')) && !(await page.isVisible('.g-nav')) && await page.$('.g-task') === null,
            'login pertama: wajib buat password baru, menu lain belum bisa dibuka');
        await page.evaluate(() => { location.hash = '#/siswa'; });
        await page.waitForTimeout(200);
        check(await page.$('#gForceForm') !== null, 'pindah halaman lewat alamat tetap ditahan di layar ganti password');
        await page.fill('#gF1', '990000000000000001');
        await page.fill('#gF2', '990000000000000001');
        await page.click('#gForceBtn');
        await page.waitForSelector('#gForceErr:not(.g-hidden)');
        check(/tidak boleh sama dengan NIP/.test(await page.textContent('#gForceErr')), 'password baru = NIP ditolak');
        if (OUT) await page.screenshot({ path: join(OUT, 'guru-01c-wajib-ganti-360.png'), fullPage: true });
        await page.fill('#gF1', 'RahasiaBaru7');
        await page.fill('#gF2', 'RahasiaBaru7');
        await page.click('#gForceBtn');
        await page.waitForSelector('.g-task');
        check(apiCalls.some((c) => c.api === 'changepw' && c.password === 'RahasiaBaru7' && /^Bearer /.test(c.auth || '')) && await page.isVisible('.g-nav'),
            'setelah password diganti langsung masuk dashboard');
        check(/Selamat datang, Sunarsih/.test(await page.textContent('.g-welcome')) && /Dashboard Guru/.test(await page.textContent('#gTitle')), 'dashboard menyapa nama guru');
        check(/JADWAL MENGAJAR TERDEKAT/.test(await page.textContent('.g-hero')) && /KELAS 1\.A/.test(await page.textContent('.g-hero')) && await page.$('.g-hero-ava') !== null
            && /Mulai Absensi/.test(await page.textContent('.g-hero-btn')), 'kartu utama: foto/inisial guru, kelas, tombol Mulai Absensi');
        check(/Absensi KELAS 1\.A Hari Ini/.test(await page.textContent('.g-task-go')) && !/Isi tanggal lain/.test(await page.textContent('#gMain')), 'kartu wali kelas: satu tombol "Absensi KELAS … Hari Ini"');
        check(/Segera hadir/.test(await page.textContent('.g-soon')), 'kartu Jadwal Kelas bertanda segera hadir');
        await page.waitForSelector('.g-pin-nudge');
        check(/PIN pemulihan/.test(await page.textContent('.g-pin-nudge')), 'dashboard mengingatkan guru yang belum punya PIN');
        check(await page.isVisible('#gTopOut'), 'tombol keluar ada di pojok kanan atas');
        check(await overflow(page) <= 0, 'dashboard tidak bergeser ke samping');
        check(/Belum diisi/.test(await page.textContent('.g-task')), 'kartu menandai absensi belum diisi');
        check(await overflow(page) <= 0, 'beranda tidak bergeser ke samping');
        await shot(page, 'guru-02-beranda-360.png');

        await shot(page, 'guru-02-dashboard-360.png');
        // Mode Sederhana: hanya tombol absen besar
        check(await page.getAttribute('#gMode', 'aria-checked') === 'false', 'sakelar Mode Sederhana ada di dashboard (mati)');
        await page.click('#gMode');
        await page.waitForSelector('.g-big');
        check(await page.$('.g-hero') === null && await page.$('#gDay') === null && await page.$('.g-days') === null && await page.getAttribute('#gMode', 'aria-checked') === 'true',
            'Mode Sederhana: kartu jadwal, rekap, dan pilihan hari disembunyikan');
        check(/Absen Kelas 1\.A/.test(await page.textContent('.g-big')) && /Belum diisi/.test(await page.textContent('.g-big'))
            && (await page.getAttribute('.g-big', 'href')).includes('jenis=harian'), 'Mode Sederhana: tombol besar "Absen Kelas 1.A" + status');
        check(await page.$eval('.g-big', (b) => b.getBoundingClientRect().height) >= 88, 'tombol absen Mode Sederhana tinggi (mudah diketuk)');
        check(await overflow(page) <= 0, 'Mode Sederhana tidak bergeser ke samping');
        await shot(page, 'guru-02a-mode-sederhana-360.png');
        await page.reload();
        await page.waitForSelector('.g-big');
        check(true, 'Mode Sederhana diingat setelah halaman dimuat ulang');
        await page.click('#gMode');
        await page.waitForSelector('.g-hero');
        check(await page.$('.g-big') === null, 'sakelar mengembalikan dashboard lengkap');
        // Kartu Guru Mapel: pilih hari Senin–Jumat, lalu buka absen PAI
        check((await page.$$('.g-days [data-day]')).length === 5, 'kartu jadwal punya pilihan hari Senin–Jumat');
        await page.click('.g-days [data-day]:first-child');
        check(/— Senin/.test(await page.textContent('#gMain')) && await page.getAttribute('.g-days [data-day]:first-child', 'aria-selected') === 'true', 'memilih Senin mengganti jadwal ke hari Senin');
        {
            const monday = await page.getAttribute('.g-days [data-day]:first-child', 'data-day');
            const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()));
            if (monday <= today) {
                check((await page.getAttribute('.g-sched-list .g-sched', 'href')).includes(`tanggal=${monday}`), 'tautan absen mapel memakai tanggal hari yang dipilih');
                await page.click('.g-sched-list .g-sched');
                await page.waitForSelector('.att-list .att-item');
                check(/Non-Muslim<\/b>, mohon diberi status <b>Dispensasi/.test(await page.innerHTML('#gSheet')), 'absen PAI menampilkan keterangan Non-Muslim → Dispensasi');
                await page.click('#gSheet .att-back');
                await page.waitForSelector('.g-task');
                check(true, 'tombol Kembali ke Menu Utama membawa ke dashboard');
            }
        }
        await page.click('.g-task a.g-task-go');
        await page.waitForSelector('.att-list .att-item');
        check((await page.$$('.att-list .att-item')).length === 3, 'lembar absensi memuat 3 siswa');
        check(await overflow(page) <= 0, 'lembar absensi tidak bergeser ke samping (nama panjang)');
        const btnH = await page.$eval('.att-status button', (b) => b.getBoundingClientRect().height);
        check(btnH >= 44, `tombol status minimal 44 px (${Math.round(btnH)} px)`);
        check(await page.isHidden('.g-nav'), 'navigasi bawah disembunyikan agar tombol Simpan terlihat');
        check(await page.$$eval('.att-status button[aria-pressed="true"]', (b) => b.length) === 0, 'status awal kosong (tidak otomatis Hadir)');
        check(/3<\/b> dari 3 siswa belum diabsen/.test(await page.innerHTML('.att-progress')), 'penanda "3 dari 3 belum diabsen" tampil');
        // Panel ringkasan menempel di atas saat digulir; tombol panah melepasnya.
        check(await page.$eval('#gFloat', (el) => el.classList.contains('is-floating') && getComputedStyle(el).position === 'sticky'), 'panel tanggal + ringkasan menempel di atas (floating)');
        await page.evaluate(() => window.scrollTo(0, 400));
        const stuck = await page.evaluate(() => ({ top: document.getElementById('gFloat').getBoundingClientRect().top, head: document.querySelector('.g-top').getBoundingClientRect().bottom }));
        check(Math.abs(stuck.top - stuck.head) <= 1, `saat digulir panel tetap tepat di bawah header (${Math.round(stuck.top)} vs ${Math.round(stuck.head)})`);
        {
            const fh = await page.$eval('#gFloat', (el) => el.getBoundingClientRect().height);
            check(fh <= 250, `panel yang menempel ringkas (${Math.round(fh)} px, maks. 250)`);
        }
        if (OUT) await page.screenshot({ path: join(OUT, 'guru-03a-absen-floating-360.png') });
        await page.click('#gFloat .att-float-toggle');
        check(await page.$eval('#gFloat', (el) => !el.classList.contains('is-floating') && getComputedStyle(el).position !== 'sticky'), 'tombol panah melepas panel (tidak menempel lagi)');
        check(await page.evaluate(() => localStorage.getItem('att-float')) === '0', 'pilihan lepas/tempel diingat');
        await page.evaluate(() => window.scrollTo(0, 0));
        check(/Dispensasi<\/b> pada absensi siswa berlaku hanya untuk/.test(await page.innerHTML('#gSheet')) && /tetap dihitung hadir/.test(await page.innerHTML('#gSheet')), 'keterangan Dispensasi tampil di lembar absensi');
        check(!/Non-Muslim/.test(await page.innerHTML('#gSheet')), 'keterangan Non-Muslim tidak tampil di absensi harian');
        check(await page.$eval('.att-btn-hadir', (b) => getComputedStyle(b).backgroundColor === 'rgb(22, 163, 74)' && b.querySelector('svg') !== null && getComputedStyle(b).boxShadow !== 'none'),
            'tombol Tandai semua Hadir: hijau pekat, ada ikon centang, tampak bisa ditekan');
        check(await page.$eval('#gSheet details.att-ket summary', (s) => /Keterangan status Dispensasi/.test(s.textContent) && s.querySelector('svg') !== null)
            && await page.evaluate(() => localStorage.getItem('att-ket')) === '1', 'keterangan dilipat jadi satu baris berikon "i"');
        check(await page.$eval('.att-btn-reset', (b) => b.getBoundingClientRect().left > document.querySelector('.att-btn-hadir').getBoundingClientRect().right - 1 && (document.documentElement.dataset.theme === 'dark' || getComputedStyle(b).backgroundColor === 'rgb(226, 232, 240)')), 'tombol Reset abu-abu di kanan Tandai semua Hadir');
        check(await page.$eval('#gSheet .att-back', (a) => a.textContent.trim() === 'Kembali ke Menu Utama' && a.getAttribute('href') === '#/'
            && a.getBoundingClientRect().top >= document.querySelector('#attSave').getBoundingClientRect().top), 'tombol Kembali ke Menu Utama ada di bawah tombol Simpan');
        // Reset mengosongkan semua
        await page.click('[data-all="H"]');
        check(await page.$$eval('.att-status button[aria-pressed="true"]', (b) => b.length) === 3, 'Tandai semua Hadir mengisi 3 siswa');
        await page.click('[data-reset]');
        await page.click('.att-sheet [data-act="yes"]');
        check(await page.$$eval('.att-status button[aria-pressed="true"]', (b) => b.length) === 0 && /3<\/b> dari 3/.test(await page.innerHTML('.att-progress')), 'Reset mengosongkan semua status lagi');
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
        check(/Tersimpan/.test(await page.textContent('#gSheetHead')), 'lembar menampilkan status tersimpan');

        // Gagal kirim → draf tetap ada
        await page.evaluate(() => { window.__fake.failRpc.save_attendance = 'Failed to fetch'; });
        await page.click('.att-item[data-i="0"] [data-st="A"]');
        await page.click('#attSave');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => /Koneksi terputus/.test(document.getElementById('attToastHost')?.textContent || ''));
        check(true, 'gagal kirim memberi pesan koneksi');
        await page.reload();
        await page.waitForSelector('.att-list');
        check(/belum terkirim/i.test(await page.textContent('#gSheetHead')), 'isian yang belum terkirim dipulihkan setelah muat ulang');
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
        check(await page.$('#gFloat.att-float [data-q]') !== null && await page.$('#gFloat.att-float select[data-size]') !== null && await page.$('#gFloat #gKelas') !== null,
            'data siswa: Kelas, Cari, Tampilkan ada di panel yang bisa menempel');
        await page.fill('#gFloat [data-q]', 'Dua');
        check(/Menampilkan 1–1 dari 1 data/.test(await page.textContent('[data-info]')), 'data siswa: kolom Cari di panel tetap berfungsi');
        await page.fill('#gFloat [data-q]', '');
        await shot(page, 'guru-05-siswa-360.png');
        await page.click('.att-table tbody tr a');
        await page.waitForSelector('.g-prof');
        const prof = await page.textContent('.g-prof');
        check(/081200000001/.test(prof) && (await page.$('a[href^="https://wa.me/62812"]')) !== null, 'profil menampilkan HP + tombol WhatsApp');
        check(/NIK/.test(prof) && /3172000000000002/.test(prof), 'profil menampilkan NIK siswa');
        check(await overflow(page) <= 0, 'profil tidak bergeser ke samping');
        await shot(page, 'guru-06-profil-360.png');

        // Rekap
        await page.click('.g-nav a[data-nav="rekap"]');
        await page.waitForSelector('.att-student-card');
        check(await overflow(page) <= 0, 'rekap (kartu) tidak bergeser ke samping');
        check(await page.$('#gFloat.att-float #gRkKelas') !== null && /absensi diisi/.test(await page.textContent('#gFloat #gRkInfo')), 'rekap: Kelas, Bulan, dan ringkasan ada di panel yang bisa menempel');
        await shot(page, 'guru-07-rekap-360.png');
        {
            const pop = await popupFrom(page, () => page.click('#gRkPrint'));
            const txt = await pop.textContent('body');
            check(/DAFTAR HADIR SISWA/.test(txt) && /KELAS : I\.A/.test(txt) && /SUNARSIH, S\.Pd\./.test(txt) && /KEPALA FIKTIF, S\.Pd\.SD/.test(txt),
                'guru: cetak daftar hadir berisi kop, kelas Romawi, TTD wali & kepala sekolah');
            const printed = await pop.waitForFunction(() => window.__printed >= 1, null, { timeout: 3000 }).then(() => true, async () => JSON.stringify(await pop.evaluate(() => ({ p: window.__printed, rs: document.readyState, f: String(window.print).slice(0, 40) }))));
            check(printed === true, `guru: dialog cetak terbuka otomatis (${printed})`);
            await pop.close();
            const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#gRkXlsx')]);
            check(/^Daftar_Hadir_I\.A_.*\.xlsx$/.test(dl.suggestedFilename()), `guru: nama file Excel (${dl.suggestedFilename()})`);
            const v = await xlsxCells(dl, ['C1', 'C3']);
            check(!v || (v[0] === 'DAFTAR HADIR SISWA' && v[1] === 'SDN KALIBARU 05 PAGI' && v[2] === 'logo'), `guru: file Excel valid + logo tertanam (${v})`);
            const pop2 = await popupFrom(page, () => page.click('#gRkSemPrint'));
            check(/REKAP ABSENSI SEMESTER/.test(await pop2.textContent('body')), 'guru: cetak rekap semester');
            await pop2.close();
        }

        // Dashboard: kartu rekap per tanggal + peringatan alpa
        await page.evaluate(() => { window.__fake.alpha = [
            { class_id: '00000000-0000-4000-8000-0000000000c1', kelas: '1 A', student_id: '00000000-0000-4000-8000-000000000052', nama: 'Siswa Fiktif Satu', alpa: 5, terakhir: '2026-11-10', hp: '081200000001' },
            { class_id: '00000000-0000-4000-8000-0000000000c1', kelas: '1 A', student_id: '00000000-0000-4000-8000-000000000053', nama: 'Siswa Fiktif Tiga', alpa: 4, terakhir: '2026-11-05', hp: null },
        ]; });
        await page.evaluate(() => {
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
            const S = (n) => `00000000-0000-4000-8000-00000000005${n}`;
            window.__fake.sessions[`00000000-0000-4000-8000-0000000000c1|${today}|harian|-`] = { id: 'sess-stat',
                records: { [S(1)]: { status: 'H' }, [S(2)]: { status: 'S' }, [S(3)]: { status: 'D' } } };
        });
        await page.click('.g-nav a[data-nav="home"]');
        await page.waitForSelector('#gDayBody .ac-rows');
        check((await page.$$('#gDayBody .ac-row')).length === 5 && /Dispensasi \(D\)/.test(await page.textContent('#gDayBody')), 'kartu rekap per tanggal: Hadir, Izin, Sakit, Alpa, Dispensasi');
        check(/Absensi Hari Ini/.test(await page.textContent('#gDayTitle')) && await page.isDisabled('#gDayNext'), 'kartu rekap mulai dari hari ini; tombol berikutnya mati (belum ada besok)');
        {
            const total = await page.$$eval('#gDayBody .ac-row-top b', (b) => b.reduce((n, x) => n + parseInt(x.textContent, 10), 0));
            check(total === 3 && /%/.test(await page.textContent('#gDayBody .ac-badge b')), `kartu rekap menjumlah 3 siswa dan menampilkan % kehadiran (${total})`);
            check((await page.textContent('#gDayBody .ac-badge b')).trim() === '66,7%', 'kehadiran 2 dari 3 (hadir + dispensasi) = 66,7%');
        }
        const before = await page.inputValue('#gDayDate');
        await page.click('#gDayPrev');
        await page.waitForFunction((d) => document.getElementById('gDayDate').value !== d, before);
        await page.waitForFunction(() => /Absensi per Tanggal/.test(document.getElementById('gDayTitle').textContent) && document.getElementById('gDayBody').style.opacity === '');
        check((await page.inputValue('#gDayDate')) < before && !(await page.isDisabled('#gDayNext')), 'tombol sebelumnya memundurkan tanggal satu hari');
        check(/belum diisi|libur/.test(await page.textContent('#gDayBody')), 'tanggal tanpa absensi diberi keterangan');
        await page.click('#gDayNext');
        await page.waitForFunction((d) => document.getElementById('gDayDate').value === d, before);
        check(true, 'tombol berikutnya kembali ke hari ini');
        await page.waitForSelector('#gAlpha');
        check(/2 siswa alpa lebih dari 3 hari/.test(await page.textContent('#gAlpha')) && /5 hari alpa/.test(await page.textContent('#gAlpha'))
            && (await page.getAttribute('#gAlpha li a', 'href')) === '#/siswa/00000000-0000-4000-8000-000000000052', 'notifikasi alpa: jumlah siswa, hari alpa, tautan ke profil');
        check(/terakhir 10 Nov 2026/.test(await page.textContent('#gAlpha')) && !/November/.test(await page.textContent('#gAlpha li')), 'tanggal di notifikasi alpa memakai bulan singkat (10 Nov 2026)');
        {
            const wa = await page.getAttribute('#gAlpha .g-wa[href]', 'href');
            const msg = decodeURIComponent(new URL(wa).searchParams.get('text') || '');
            check(/^https:\/\/wa\.me\/6281200000001\?text=/.test(wa) && (await page.getAttribute('#gAlpha .g-wa[href]', 'target')) === '_blank'
                && /Hubungi Orang Tua/.test(await page.textContent('#gAlpha .g-wa[href]')), 'tombol Hubungi Orang Tua membuka WhatsApp nomor orang tua (format 62)');
            check(/Siswa Fiktif Satu/.test(msg) && /alpa \(tidak hadir tanpa keterangan\) sebanyak 5 hari/.test(msg) && /Sunarsih, S\.Pd\./.test(msg) && /Wali Kelas 1\.A/.test(msg),
                'pesan WhatsApp sudah terisi: nama siswa, jumlah alpa, nama & jabatan wali kelas');
            check(/belum ada/.test(await page.textContent('#gAlpha li:nth-child(2)')) && await page.$('#gAlpha li:nth-child(2) .g-wa[href]') === null, 'siswa tanpa No. HP: keterangan, tanpa tombol WhatsApp');
        }
        check(await page.$eval('.g-hero-body strong i', (i) => getComputedStyle(i).display === 'block' && /^— Wali Kelas$/.test(i.textContent.trim()))
            && /^KELAS 1\.A/.test((await page.textContent('.g-hero-body strong')).trim()), 'kartu utama: "— Wali Kelas" di baris bawah KELAS 1.A');
        check(await overflow(page) <= 0, 'dashboard dengan kartu rekap + notifikasi tidak bergeser ke samping');
        await shot(page, 'guru-02b-dashboard-rekap-360.png');

        // Statistik
        await page.click('.g-nav a[data-nav="statistik"]');
        await page.waitForSelector('#gStat .g-tiles');
        check((await page.$$('.g-nav a')).length === 7 && await overflow(page) <= 0
            && await page.$$eval('.g-nav a', (a) => a.every((x) => x.scrollWidth <= x.clientWidth + 1)), 'menu bawah 7 tombol (termasuk Pinjam di tengah) muat di 360 px tanpa terpotong');
        check(await page.$('#gStKomposisi .ac-donut svg') !== null && await page.$('#gStTren svg rect') !== null, 'statistik bulanan: donat komposisi + batang tren');
        await page.click('[data-komposisi="batang"]');
        check(await page.$('#gStKomposisi .ac-bars') !== null && await page.$('#gStKomposisi .ac-donut') === null, 'komposisi bisa diganti ke grafik batang');
        await page.click('[data-tren="garis"]');
        check(await page.$('#gStTren svg path') !== null && /Terendah/.test(await page.textContent('#gStTren')), 'tren bisa diganti ke grafik garis %');
        await shot(page, 'guru-09-statistik-bulan-360.png');
        await page.click('[data-mode="semester"]');
        await page.waitForFunction(() => /Semester (Ganjil|Genap)/.test(document.querySelector('.g-stat-title')?.textContent || ''));
        check(/per bulan/.test(await page.textContent('#gStat')), 'mode semester: tren digabung per bulan');
        await page.click('[data-mode="hari"]');
        await page.waitForFunction(() => /tidak hadir \/ dispensasi/.test(document.getElementById('gStat')?.textContent || ''));
        check(await page.isVisible('#gStDate') && !(await page.isVisible('#gStMonth')) && await page.$('#gStTren') === null, 'mode harian: pilih tanggal, tanpa grafik tren');
        check(await page.$('#gFloat.att-float #gStKelas') !== null, 'filter statistik ada di panel yang bisa menempel');
        check(await overflow(page) <= 0, 'halaman statistik tidak bergeser ke samping');
        await shot(page, 'guru-09b-statistik-hari-360.png');

        // Cetak & Dokumen
        await page.click('.g-nav a[data-nav="dokumen"]');
        await page.waitForSelector('.g-dok');
        check((await page.$$('.g-dok')).length >= 8 && /Surat keterangan aktif/.test(await page.textContent('#gMain')) && await overflow(page) <= 0,
            'menu Cetak & Dokumen: daftar jenis dokumen tampil, tidak bergeser ke samping');
        await shot(page, 'guru-10-dokumen-360.png');
        await page.click('.g-dok[href="#/dokumen/daftar"]');
        await page.waitForSelector('#gDokForm');
        await page.waitForFunction(() => /SISWA FIKTIF/i.test(document.getElementById('gDokPrev').srcdoc || ''));
        check(!/3172000000000000/.test(await page.getAttribute('#gDokPrev', 'srcdoc')), 'daftar siswa: NIK tidak tampil sebelum dicentang');
        await page.check('[data-dk="kolom"][value="nik"]');
        await page.waitForFunction(() => /3172000000000000/.test(document.getElementById('gDokPrev').srcdoc || ''));
        check(true, 'mencentang kolom NIK langsung memperbarui pratinjau');
        check(await page.$eval('.g-dok-prev', (b) => b.getBoundingClientRect().width <= window.innerWidth) && await overflow(page) <= 0, 'pratinjau diperkecil supaya muat di layar HP');
        {
            const pop = await popupFrom(page, () => page.click('[data-out="print"]'));
            const txt = await pop.textContent('body');
            check(/DAFTAR NAMA SISWA/.test(txt) && /KELAS : I\.A/.test(txt) && /Kepala Fiktif/.test(txt) && /Sunarsih/.test(txt), 'cetak daftar siswa: judul, kelas, tanda tangan kepsek & wali kelas');
            check((await pop.$$('img')).length === 1 && await pop.$eval('img', (i) => i.src.startsWith('data:image/png;base64,') && i.alt === 'Logo sekolah'), 'dokumen daftar: logo sekolah di kiri atas (tertanam), tanpa kop surat');
            await pop.close();
            const [dlx] = await Promise.all([page.waitForEvent('download'), page.click('[data-out="xlsx"]')]);
            const vx = await xlsxCells(dlx, ['D1', 'B7']);
            check(/\.xlsx$/.test(dlx.suggestedFilename()) && (!vx || (vx[0] === 'DAFTAR NAMA SISWA' && /SISWA FIKTIF/i.test(vx[1]) && vx[2] === 'logo')), `daftar siswa: Excel valid + logo (${vx})`);
            const [dlw] = await Promise.all([page.waitForEvent('download'), page.click('[data-out="word"]')]);
            const wp = join(dlDir, 'tes-word.doc');
            await dlw.saveAs(wp);
            const word = readFileSync(wp, 'utf8');
            check(/\.doc$/.test(dlw.suggestedFilename()) && /schemas-microsoft-com:office:word/.test(word) && /DAFTAR NAMA SISWA/.test(word), 'daftar siswa: file Word bisa diunduh dan berisi dokumennya');
        }
        await shot(page, 'guru-10a-dokumen-daftar-360.png');
        await page.click('#gBack');
        await page.waitForSelector('.g-dok');
        await page.click('.g-dok[href="#/dokumen/aktif"]');
        await page.waitForSelector('#gDokForm');
        await page.click('[data-out="print"]');
        await page.waitForSelector('#gDokErr:not(.g-hidden)');
        check(/Pilih siswa/.test(await page.textContent('#gDokErr')), 'surat keterangan: diminta memilih siswa dulu');
        await page.selectOption('#gDk_siswa', { index: 1 });
        await page.fill('#gDk_keperluan', 'persyaratan KJP');
        await page.fill('#gDk_tanggal', '2026-12-05');
        await page.waitForFunction(() => /\.{5,}\/PK\.0101/.test(document.getElementById('gDokPrev').srcdoc || ''));
        check(true, 'nomor surat kosong tampil sebagai titik-titik + /PK.0101');
        check(await page.inputValue('#gDk_kop') === 'sudin' && (await page.$$('#gDk_kop option')).length === 2, 'pilihan kop surat: Suku Dinas (bawaan) atau Dinas');
        await page.selectOption('#gDk_kop', 'dinas');
        await page.waitForFunction(() => /Kop surat Dinas Pendidikan/.test(document.getElementById('gDokPrev').srcdoc || ''));
        check(await page.evaluate(() => localStorage.getItem('dok-kop')) === 'dinas', 'pratinjau berganti ke kop Dinas, pilihan diingat');
        await page.selectOption('#gDk_kop', 'sudin');
        await page.click('#gDokAmbil');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => document.getElementById('gDk_nomor').value === '001');
        check(/001\/PK\.0101/.test(await page.getAttribute('#gDokPrev', 'srcdoc'))
            && await page.evaluate(() => window.__fake.calls.some((c) => c.rpc === 'take_letter_number' && c.args.p_jenis === 'Surat keterangan aktif sekolah' && c.args.p_kode === 'PK.0101')),
            'Ambil nomor berikutnya: nomor 001/PK.0101 dicatat dan masuk ke surat');
        {
            const pop = await popupFrom(page, () => page.click('[data-out="print"]'));
            const txt = await pop.textContent('body');
            check(/SURAT KETERANGAN AKTIF SEKOLAH/.test(txt) && /persyaratan KJP/.test(txt) && /Kepala Sekolah/.test(txt),
                'cetak surat keterangan aktif: isi, keperluan, tanda tangan kepala sekolah');
            check(/Jakarta, 5 Desember 2026/.test(txt) && /Nomor : 001\/PK\.0101/.test(txt), 'surat memakai tanggal tanda tangan yang diisi dan nomor 001/PK.0101');
            const kop = await pop.$eval('.kertas img', (i) => ({ data: i.src.startsWith('data:image/png;base64,'), len: i.src.length, first: document.querySelector('.kertas').firstElementChild.contains(i), alt: i.alt }));
            check(kop.data && kop.len > 100000 && kop.first && /Suku Dinas/.test(kop.alt), `kop surat Suku Dinas (bawaan) tertanam di paling atas surat (${kop.len} karakter)`);
            if (OUT) { await pop.emulateMedia({ media: 'print' }); await pop.setViewportSize({ width: 794, height: 1123 }); await pop.screenshot({ path: join(OUT, 'dokumen-surat-aktif.png') }); }
            await pop.close();
        }
        await page.click('#gBack');
        await page.waitForSelector('.g-dok');
        await page.click('.g-dok[href="#/dokumen/aktif"]');
        await page.waitForSelector('#gDokForm');
        check((await page.inputValue('#gDk_keperluan')) === 'persyaratan KJP', 'isian formulir diingat saat kembali ke dokumen yang sama');
        await page.click('.g-nav a[data-nav="home"]');
        await page.waitForSelector('.g-task');

        // Akun
        await page.click('.g-nav a[data-nav="akun"]');
        await page.fill('#gPw1', 'abcdefgh');
        await page.fill('#gPw2', 'abcdefgX');
        await page.click('#gPwForm button[type="submit"]');
        await page.waitForSelector('#attToastHost .att-alert.err');
        check(/tidak sama/.test(await page.textContent('#attToastHost')), 'ganti password menolak konfirmasi yang beda');
        await page.waitForSelector('#gPinForm');
        check(/Belum dibuat/.test(await page.textContent('#gPinCard')), 'kartu PIN pemulihan: status belum dibuat');
        await page.fill('#gPinPw', 'salah');
        await page.fill('#gPin1', '483920');
        await page.fill('#gPin2', '483920');
        await page.click('#gPinBtn');
        await page.waitForFunction(() => /Password saat ini salah/.test(document.getElementById('attToastHost')?.textContent || ''));
        check(true, 'buat PIN dengan password salah ditolak');
        await page.fill('#gPinPw', 'benar123');
        await page.click('#gPinBtn');
        await page.waitForFunction(() => /Sudah dibuat/.test(document.getElementById('gPinCard')?.textContent || ''));
        check(apiCalls.some((c) => c.api === 'pin' && c.pin === '483920' && /^Bearer /.test(c.auth || '')), 'PIN disimpan lewat API dengan token guru');
        check(/Ganti PIN/.test(await page.textContent('#gPinBtn')), 'setelah tersimpan tombol berubah jadi Ganti PIN');
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
        if (vp.tag === '390') {
            // Tombol Logout harus terlihat di HP walau menu sidebar panjang.
            await page.evaluate(() => toggleSidebar());
            await page.waitForTimeout(400);
            const lo = await page.evaluate(() => { const r = document.querySelector('.logout-item').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: window.innerHeight }; });
            check(lo.top >= 0 && lo.bottom <= lo.vh, `[390] tombol Logout terlihat di sidebar HP (bawah ${Math.round(lo.bottom)} ≤ ${lo.vh})`);
            if (OUT) await page.screenshot({ path: join(OUT, 'admin-00-sidebar-390.png') });
            await page.evaluate(() => toggleSidebar());
        }

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
        {
            // Kelas yang belum absen: pakai hari sekolah terakhir supaya tes tidak bergantung hari.
            const cek = await page.evaluate(() => {
                let d = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())}T00:00:00Z`);
                while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86400000);
                return d.toISOString().slice(0, 10);
            });
            await page.evaluate((d) => { for (const k of Object.keys(window.__fake.sessions)) if (k.includes(`|${d}|harian|`)) delete window.__fake.sessions[k]; }, cek);
            await page.fill('#attCekTanggal', cek);
            await page.click('#attCekReload');
            await page.waitForSelector('#attBelum .att-status-item');
            check(/0 dari 2 kelas/.test(await page.textContent('#attStatus')) && (await page.$$('#attBelum .att-status-item')).length === 2,
                `[${vp.tag}] daftar kelas yang belum absen: 0 dari 2 kelas, dua kelas tercantum`);
            check(/Kelas 1 A/.test(await page.textContent('#attBelum')) && /Sunarsih/.test(await page.textContent('#attBelum')), `[${vp.tag}] tiap kelas menampilkan nama wali kelas`);
            const wa = await page.getAttribute('#attWa', 'href');
            const msg = decodeURIComponent(wa.split('text=')[1] || '');
            check(/^https:\/\/wa\.me\/\?text=/.test(wa) && /Pengingat Absensi Siswa/.test(msg) && /1\. Kelas 1 A — Sunarsih/.test(msg) && /0 dari 2 kelas/.test(msg) && /sdnkalibaru05\.sch\.id\/guru/.test(msg),
                `[${vp.tag}] tombol WhatsApp berisi pesan pengingat siap kirim`);
            check(await overflow(page) <= 0, `[${vp.tag}] kartu kelas belum absen tidak bergeser ke samping`);
            await shot(page, `admin-03a-belum-absen-${vp.tag}.png`);
            await page.evaluate((d) => { window.__fake.sessions[`00000000-0000-4000-8000-0000000000c1|${d}|harian|-`] = { id: 'sess-cek', records: {} }; }, cek);
            await page.click('#attCekReload');
            await page.waitForFunction(() => /1 dari 2 kelas/.test(document.getElementById('attStatus').textContent));
            check((await page.$$('#attBelum .att-status-item')).length === 1 && /Sudah absen \(1\)/.test(await page.textContent('#attStatus')), `[${vp.tag}] kelas yang sudah absen pindah ke daftar "Sudah absen"`);
            await page.evaluate((d) => { delete window.__fake.sessions[`00000000-0000-4000-8000-0000000000c1|${d}|harian|-`]; }, cek);
            await page.click('#attBelum .att-status-item');
            await page.waitForFunction((d) => document.getElementById('attTanggal').value === d, cek);
            check(true, `[${vp.tag}] ketuk nama kelas membuka absensi kelas itu di formulir`);
            await page.fill('#attTanggal', await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())));
            await page.waitForSelector('#attSheet .att-list');
            await page.evaluate(() => { document.querySelector('#attSheet .att-list').dataset.old = '1'; });
            await page.selectOption('#attKelas', { index: 0 });
            await page.click('#attShow');
            await page.waitForSelector('#attSheet .att-list:not([data-old])');
        }
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

    // ============================================================ ADMIN — menu Akademik
    for (const vp of [{ width: 1366, height: 900, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
        const { ctx, page, errors } = await newPage('/admin', { width: vp.width, height: vp.height });
        await page.fill('#adminEmail', 'admin@fiktif.test');
        await page.fill('#adminPassword', 'x');
        await page.click('.btn-login');
        await page.waitForSelector('#mainContent', { state: 'visible' });
        const T = `[${vp.tag}]`;

        // Hari Libur
        await page.evaluate(() => showTab('tabHolidays'));
        await page.waitForSelector('#akCal .ak-cal-grid');
        check((await page.textContent('#topbarTitle')) === 'Hari Libur', `${T} judul Hari Libur`);
        check(await overflow(page) <= 0, `${T} Hari Libur tidak bergeser ke samping`);
        check(/Menampilkan 1–1 dari 1 data/.test(await page.textContent('#akHolTable [data-info]')), `${T} daftar libur memakai Tampilkan/Menampilkan`);
        await page.click('#akHolSync');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => /dari 3 data/.test(document.querySelector('#akHolTable [data-info]').textContent));
        check(/2 hari libur ditambahkan/.test(await page.textContent('#attToastHost')), `${T} Sinkron menambah 2 libur yang belum ada`);
        // Ke Desember 2026 lalu cek 25 Des ditandai libur
        await page.evaluate(() => { const want = '2026-12'; for (let i = 0; i < 24; i++) { if (document.querySelector('[data-date="2026-12-25"]')) break; document.querySelector('[data-cal="1"]').click(); } return want; });
        await page.waitForSelector('[data-date="2026-12-25"].ak-holiday');
        check(true, `${T} kalender menandai 25 Desember sebagai libur`);
        await shot(page, `akademik-01-libur-${vp.tag}.png`);
        // Klik hari kerja biasa → form tambah dengan tanggal terisi
        await page.click('[data-date="2026-12-21"]');
        await page.waitForSelector('#fs_name');
        check((await page.inputValue('#fs_dari')) === '2026-12-21', `${T} klik tanggal mengisi form tambah libur`);
        await page.fill('#fs_sampai', '2026-12-23');
        await page.fill('#fs_name', 'Libur Semester Ganjil');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => /dari 6 data/.test(document.querySelector('#akHolTable [data-info]').textContent));
        check(true, `${T} tambah libur rentang 21–23 Des (3 hari) tersimpan`);
        // Hapus satu
        await page.click('[data-hol-del="2026-12-23"]');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => /dari 5 data/.test(document.querySelector('#akHolTable [data-info]').textContent));
        check(true, `${T} hapus hari libur`);

        // Tahun Ajaran
        await page.evaluate(() => showTab('tabAcademicYears'));
        await page.waitForSelector('#akYearTable .att-table');
        await page.click('#akYearAdd');
        check((await page.inputValue('#fs_name')) === '2027/2028', `${T} tahun ajaran berikutnya terisi otomatis`);
        await page.fill('#fs_name', '2027/2029');
        await page.click('.att-sheet button[type="submit"]');
        check(/YYYY\/YYYY/.test(await page.textContent('#fsErr')), `${T} nama tahun ajaran salah ditolak`);
        await page.fill('#fs_name', '2027/2028');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForSelector('[data-year-act]');
        await page.click('[data-year-act]');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => window.__fake.calls.some((c) => c.fn === 'set_active_academic_year'));
        await page.waitForFunction(() => document.querySelectorAll('#akYearTable [data-year-act]').length === 1);
        check(true, `${T} ganti tahun ajaran aktif`);
        await shot(page, `akademik-02-tahun-${vp.tag}.png`);
        // kembalikan ke 2026/2027
        await page.click('[data-year-act]');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => window.__fake.tables.academic_years.find((y) => y.name === '2026/2027').is_active);

        // Data Kelas
        await page.evaluate(() => showTab('tabClasses'));
        await page.waitForSelector('#akClassTable .att-table');
        check(/2 rombel · 4 siswa/.test(await page.textContent('#akClassInfo')), `${T} Data Kelas: jumlah rombel dan siswa`);
        await page.click('[data-class-del]');
        await page.waitForSelector('#attToastHost .att-alert.err');
        check(/masih punya 3 siswa/.test(await page.textContent('#attToastHost')), `${T} kelas yang masih ada siswanya tidak bisa dihapus`);
        await page.click('#akClassAdd');
        await page.selectOption('#fs_grade', '6');
        await page.selectOption('#fs_section', 'B');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => /3 rombel/.test(document.getElementById('akClassInfo').textContent));
        check(true, `${T} tambah kelas 6 B`);
        check(await overflow(page) <= 0, `${T} Data Kelas tidak bergeser ke samping`);
        await shot(page, `akademik-03-kelas-${vp.tag}.png`);

        // Wali Kelas
        await page.evaluate(() => showTab('tabHomeroom'));
        await page.waitForSelector('#akHrTable .att-table');
        check(/Belum ada/.test(await page.textContent('#akHrTable')), `${T} kelas baru tanpa wali ditandai "Belum ada"`);
        const c6b = await page.evaluate(() => window.__fake.tables.classes.find((c) => c.name === '6 B').id);
        await page.selectOption('#akHrClass', c6b);
        await page.selectOption('#akHrW1', { label: 'Taripah, S.Pd.' });
        await page.selectOption('#akHrW2', { label: 'Taripah, S.Pd.' });
        await page.click('#akHrSave');
        await page.waitForSelector('#attToastHost .att-alert.err');
        check(/tidak boleh sama/.test(await page.textContent('#attToastHost')), `${T} wali 2 sama dengan wali 1 ditolak`);
        await page.selectOption('#akHrW2', { label: 'Guru Fiktif Pendamping, S.Pd.' });
        await page.click('#akHrSave');
        await page.waitForFunction(() => window.__fake.tables.homeroom_assignments.filter((h) => h.position === 2).length === 1);
        await page.waitForFunction(() => /Guru Fiktif Pendamping/.test(document.getElementById('akHrTable').textContent));
        check(true, `${T} wali kelas 1 + pendamping tersimpan`);
        check(await overflow(page) <= 0, `${T} Wali Kelas tidak bergeser ke samping`);
        await shot(page, `akademik-04-wali-${vp.tag}.png`);

        // Mata Pelajaran
        await page.evaluate(() => showTab('tabSubjects'));
        await page.waitForSelector('#akSubTable .att-table');
        check(/Susy Nurhayati/.test(await page.textContent('#akSubTable')), `${T} mapel menampilkan guru pengampu`);
        await page.click('#akSubAdd');
        await page.fill('#fs_code', 'bing');
        await page.fill('#fs_name', 'Bahasa Inggris');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => /BING/.test(document.getElementById('akSubTable').textContent));
        check(/Belum ada guru/.test(await page.textContent('#akSubTable')), `${T} mapel baru (kode jadi huruf besar) tanpa guru`);
        const bing = await page.evaluate(() => window.__fake.tables.subjects.find((x) => x.code === 'BING').id);
        await page.click(`[data-sub-assign="${bing}"]`);
        await page.selectOption('#fs_staff', { label: 'Sunarsih, S.Pd.' });
        await page.check('#fs_kelas input >> nth=0');
        await page.check('#fs_kelas input >> nth=1');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => window.__fake.calls.some((c) => c.fn === 'set_subject_assignments' && c.args.p_class_ids.length === 2));
        await page.waitForFunction(() => /Sunarsih/.test(document.getElementById('akSubTable').textContent));
        check(true, `${T} atur guru mapel ke 2 kelas`);
        await page.click(`[data-sub-del="${bing}"]`);
        await page.waitForSelector('#attToastHost .att-alert.err');
        check(/Cabut dulu penugasan/.test(await page.textContent('#attToastHost')), `${T} mapel yang masih punya guru tidak bisa dihapus`);
        check(await overflow(page) <= 0, `${T} Mata Pelajaran tidak bergeser ke samping`);
        await shot(page, `akademik-05-mapel-${vp.tag}.png`);

        check(errors.length === 0, `${T} tidak ada error JavaScript di menu Akademik (${errors.join(' | ').slice(0, 160)})`);
        await ctx.close();
    }

    // ============================================================ ADMIN — Laporan
    for (const vp of [{ width: 1366, height: 900, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
        const { ctx, page, errors } = await newPage('/admin', { width: vp.width, height: vp.height });
        await page.fill('#adminEmail', 'admin@fiktif.test');
        await page.fill('#adminPassword', 'x');
        await page.click('.btn-login');
        await page.waitForSelector('#mainContent', { state: 'visible' });
        const T = `[${vp.tag}]`;
        // isi satu absensi harian dulu supaya rekap punya data
        await page.evaluate(() => showTab('tabAttendance'));
        await page.waitForSelector('#attSheet .att-list');
        await page.click('[data-all="H"]');
        await page.click('.att-item[data-i="0"] [data-st="S"]');
        await page.click('#attSave');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => window.__fake.calls.some((c) => c.fn === 'save_attendance'));

        await page.evaluate(() => showTab('tabRekapBulanan'));
        await page.waitForSelector('#lpBlnOut .att-recap');
        check((await page.textContent('#topbarTitle')) === 'Rekap Bulanan', `${T} judul Rekap Bulanan`);
        check(/I\.A/.test(await page.textContent('#lpBlnOut')) && (await page.$$('#lpBlnOut .att-recap tbody tr')).length === 3, `${T} pratinjau rekap bulanan 3 siswa`);
        check(await page.$('#lpBlnOut td.c-S') !== null, `${T} pratinjau menandai siswa sakit`);
        check(await overflow(page) <= 0, `${T} Rekap Bulanan tidak bergeser ke samping (tabel tanggal di dalam kotak gulir)`);
        await shot(page, `laporan-01-bulanan-${vp.tag}.png`);
        const pop = await popupFrom(page, () => page.click('#lpBlnPrint'));
        const txt = await pop.textContent('body');
        check(/DAFTAR HADIR SISWA/.test(txt) && /BULAN : /.test(txt) && /Laki-laki = 1/.test(txt) && /Perempuan = 2/.test(txt), `${T} cetak bulanan: kop, bulan, jumlah L/P`);
        {
            const [y, m] = (await page.inputValue('#lpBlnBulan')).split('-').map(Number);
            const akhir = new Date(Date.UTC(y, m, 0)).getUTCDate();
            const BUL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            check(txt.includes(`Jakarta, ${akhir} ${BUL[m - 1]} ${y}`), `${T} tanda tangan bulanan di tanggal akhir bulan (${akhir} ${BUL[m - 1]} ${y})`);
            check(/>✓</.test(await pop.content()) && !/•/.test(txt), `${T} hadir ditandai ✓ (bukan titik)`);
        }
        if (vp.tag === '1366') {
            await pop.emulateMedia({ media: 'print' });
            await pop.setViewportSize({ width: 1123, height: 794 });
            await shot(pop, 'laporan-02-cetak-bulanan.png');
        }
        await pop.close();
        await page.check('#lpBlnBlank');
        const popB = await popupFrom(page, () => page.click('#lpBlnPrint'));
        check(!(/>✓</.test(await popB.content())), `${T} blanko kosong tanpa isian`);
        await popB.close();
        await page.uncheck('#lpBlnBlank');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#lpBlnXlsx')]);
        const v = await xlsxCells(dl, ['C1', 'C3', 'D7']);
        check(!v || (v[0] === 'DAFTAR HADIR SISWA' && v[1] === 'SDN KALIBARU 05 PAGI' && v[2] === 'SISWA FIKTIF DUA' && v[3] === 'logo'), `${T} Excel bulanan valid + logo (${v})`);

        await page.evaluate(() => showTab('tabRekapSemester'));
        await page.waitForSelector('#lpSemTable .att-table');
        check(/Menampilkan 1–3 dari 3 data/.test(await page.textContent('#lpSemTable [data-info]')), `${T} rekap semester memakai tabel standar`);
        check(await overflow(page) <= 0, `${T} Rekap Semester tidak bergeser ke samping`);
        await shot(page, `laporan-03-semester-${vp.tag}.png`);
        await page.selectOption('#lpSemWali', '2');
        const popS = await popupFrom(page, () => page.click('#lpSemPrint'));
        const ts = await popS.textContent('body');
        check(/REKAP ABSENSI SEMESTER/.test(ts) && /% KEHADIRAN/.test(ts), `${T} cetak rekap semester`);
        check(/REKAP ABSENSI SEMESTER GANJIL/.test(ts) ? /Jakarta, 31 Desember \d{4}/.test(ts) : /Jakarta, 30 Juni \d{4}/.test(ts), `${T} tanda tangan semester di akhir Desember (ganjil) / akhir Juni (genap)`);
        if (vp.tag === '1366') {
            await popS.emulateMedia({ media: 'print' });
            await popS.setViewportSize({ width: 1123, height: 794 });
            await shot(popS, 'laporan-04-cetak-semester.png');
        }
        await popS.close();
        const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#lpSemXlsx')]);
        const v2 = await xlsxCells(dl2, ['C1', 'D6']);
        check(!v2 || (/REKAP ABSENSI SEMESTER/.test(v2[0]) && v2[1] === 'SISWA FIKTIF DUA'), `${T} Excel semester valid (${v2})`);
        check(errors.length === 0, `${T} tidak ada error JavaScript di Laporan (${errors.join(' | ').slice(0, 160)})`);

        // ---------------------------------------------------- Cetak & Dokumen (admin)
        await page.evaluate(() => showTab('tabDokumen', document.querySelector('[data-tab="tabDokumen"]')));
        await page.waitForSelector('#dkHost #gDokForm');
        check(/Cetak & Dokumen/.test(await page.textContent('#topbarTitle')) && (await page.$$('#dkTypes option')).length >= 8,
            `${T} menu Cetak & Dokumen ada di admin dengan semua jenis dokumen`);
        check((await page.$$('#dkHost #gDokKelas option')).length >= 2, `${T} admin bisa memilih semua kelas`);
        await page.waitForFunction(() => /SISWA FIKTIF/i.test(document.querySelector('#dkHost iframe')?.srcdoc || ''));
        // Pilih sebagian siswa untuk daftar
        await page.click('#dkHost .g-dok-multi summary');
        await page.click('#dkHost [data-multi="none"]');
        await page.waitForFunction(() => /Pilih minimal satu siswa/.test(document.querySelector('#dkHost iframe')?.srcdoc || ''));
        await page.check('#dkHost [data-dk="pilih"] >> nth=1');
        await page.waitForFunction(() => /1 dari \d+ siswa/.test(document.getElementById('gDkPilihInfo').textContent));
        {
            const pop = await popupFrom(page, () => page.click('#dkHost [data-out="print"]'));
            const rows = await pop.$$eval('.grid tbody tr', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
            const dipilih = await page.$eval('#dkHost [data-dk="pilih"]:checked + span', (x) => x.textContent.replace(/^\d+\.\s*/, ''));
            check(rows.length === 1 && rows[0].startsWith(`1${dipilih}`), `${T} daftar hanya berisi siswa yang dipilih, nomor urut mulai 1 (${rows.join(' / ')})`);
            await pop.close();
        }
        await page.click('#dkHost [data-multi="all"]');
        // Ganti kelas
        const kelas2 = await page.$eval('#dkHost #gDokKelas option:nth-child(2)', (o) => o.value);
        await page.selectOption('#dkHost #gDokKelas', kelas2);
        await page.waitForFunction((v) => document.querySelector('#dkHost #gDokKelas')?.value === v && document.querySelector('#dkHost iframe'), kelas2);
        check(await page.evaluate((v) => window.__fake.calls.some((c) => c.fn === 'get_class_document_data' && c.args?.p_class_id === v), kelas2), `${T} ganti kelas memuat data kelas itu`);
        // Surat per siswa
        await page.selectOption('#dkTypes', 'aktif');
        await page.waitForSelector('#dkHost #gDk_siswa');
        await page.selectOption('#dkHost #gDk_siswa', { index: 1 });
        await page.selectOption('#dkHost #gDk_kop', 'dinas');
        await page.waitForFunction(() => /Kop surat Dinas Pendidikan/.test(document.querySelector('#dkHost iframe')?.srcdoc || ''));
        check(/SURAT KETERANGAN AKTIF SEKOLAH/.test(await page.getAttribute('#dkHost iframe', 'srcdoc')), `${T} admin membuat surat keterangan aktif untuk siswa yang dipilih, kop Dinas`);
        check(await overflow(page) <= 0, `${T} tab Cetak & Dokumen tidak bergeser ke samping`);
        check(!(await page.isVisible('#dkHost #gDokErr')), `${T} kotak pesan galat tersembunyi saat tidak ada galat`);
        await shot(page, `admin-05-dokumen-${T.replace(/\W/g, '')}.png`);
        check(errors.length === 0, `${T} tidak ada error JavaScript di Cetak & Dokumen (${errors.join(' | ').slice(0, 160)})`);
        await ctx.close();
    }

    // ============================================================ INVENTARIS — QR (guru) + admin
    const hasCv2 = spawnSync('python3', ['-c', 'import cv2'], { encoding: 'utf8' }).status === 0;
    /** Baca isi QR dari <svg> dengan OpenCV (null bila OpenCV tidak ada). */
    async function decodeQr(page, svgHtml) {
        if (!hasCv2) return null;
        const p2 = await page.context().newPage();
        await p2.setViewportSize({ width: 420, height: 420 });
        await p2.setContent(`<body style="margin:0;background:#fff"><div style="width:400px;height:400px">${svgHtml.replace(/width="\d+" height="\d+"/, 'width="400" height="400"')}</div></body>`);
        const path = join(dlDir, `qr-${Date.now()}.png`);
        await p2.screenshot({ path });
        await p2.close();
        const r = spawnSync('python3', ['-c', 'import sys,cv2\nimg=cv2.imread(sys.argv[1])\nprint(cv2.QRCodeDetector().detectAndDecode(img)[0])', path], { encoding: 'utf8' });
        return r.status === 0 ? r.stdout.trim() : `ERROR ${r.stderr.slice(0, 100)}`;
    }

    {
        // Guru belum login scan stiker → login → langsung ke halaman barang.
        const { ctx, page, errors } = await newPage('/guru#/pinjam/toklap001aaa', { width: 360, height: 780 });
        await page.waitForSelector('#gLogin:not(.g-hidden)');
        await page.fill('#gId', '990000000000000001');
        await page.fill('#gPw', 'benar123');
        await page.click('#gLoginBtn');
        await page.waitForSelector('#gInvForm');
        check(/Laptop Acer Aspire 3/.test(await page.textContent('#gMain')) && /Tersedia/.test(await page.textContent('.inv-state')),
            'Scan QR saat belum login: setelah masuk langsung ke halaman barang (tersedia)');
        check(!(await page.textContent('#gMain')).includes('SN-ACER-1'), 'halaman scan guru tidak menampilkan nomor seri');
        check((await page.inputValue('#gInvSampai')) === '' && /Kosongkan/.test(await page.textContent('#gInvForm')), 'laptop jangka panjang: tanggal kembali opsional');
        await shot(page, 'inv-01-guru-scan-tersedia-360.png');
        check(await overflow(page) <= 0, 'halaman barang tidak bergeser ke samping di 360 px');
        await page.fill('#gInvKeperluan', 'Mengajar kelas 1A');
        await page.click('#gInvBtn');
        await page.waitForSelector('.inv-state.mine');
        check(await page.evaluate(() => window.__fake.calls.some((c) => c.fn === 'inv_borrow' && c.args.p_code === 'toklap001aaa' && c.args.p_keperluan === 'Mengajar kelas 1A' && c.args.p_sampai === null)),
            'Pinjam sekarang → inv_borrow dengan token QR & keperluan');
        check(/Sedang Anda pinjam/.test(await page.textContent('.inv-state')) && (await page.isVisible('#gInvNote')) && !(await page.$('#gInvKond')), 'setelah pinjam muncul form Kembalikan (tanpa pilihan kondisi — itu tugas admin)');
        await shot(page, 'inv-02-guru-dipinjam-360.png');

        // Barang dipinjam orang lain & barang tidak dipinjam
        await page.evaluate(() => { location.hash = '#/pinjam/tokspk01bbbb'; });
        await page.waitForSelector('.inv-state.busy');
        check(/Susy Nurhayati/.test(await page.textContent('.inv-state')) && !(await page.$('#gInvForm')), 'barang yang dipinjam guru lain: tampil nama peminjam, tanpa tombol pinjam');
        // Barang rusak → keterangan + tawaran barang sejenis yang berfungsi
        await page.evaluate(() => { location.hash = '#/pinjam/tokpro002eee'; });
        await page.waitForSelector('.inv-state.broken');
        check(/tidak bisa dipinjam/.test(await page.textContent('.inv-state.broken')) && /Lampu proyektor mati/.test(await page.textContent('.inv-state.broken')) && !(await page.$('#gInvForm')),
            'scan barang rusak: status Rusak + keterangan, tanpa tombol pinjam');
        check(/PRO-003/.test(await page.textContent('#gInvAlt')) && !/PRO-001/.test(await page.textContent('#gInvAlt')), 'barang rusak: ditawari proyektor lain yang berfungsi & tersedia');
        await shot(page, 'inv-02b-guru-rusak-360.png');
        await page.click('#gInvAlt a[href="#/pinjam/PRO-003"]');
        await page.waitForSelector('.inv-state.ok');
        check(/Proyektor Epson EB-E01/.test(await page.textContent('#gMain')), 'ketuk barang alternatif → langsung ke halaman pinjamnya');
        await page.evaluate(() => { location.hash = '#/pinjam/MEB-001'; });
        await page.waitForSelector('.inv-state.off');
        check(/tidak untuk dipinjam/.test(await page.textContent('.inv-state')), 'cari pakai kode: barang "tidak dipinjam" tidak bisa dipinjam');
        await page.evaluate(() => { location.hash = '#/pinjam/ZZZ-999'; });
        await page.waitForSelector('#gMain .att-alert.err');
        check(/tidak ditemukan/.test(await page.textContent('#gMain')), 'kode salah → pesan barang tidak ditemukan');

        // Dashboard: kotak barang yang saya pinjam
        await page.click('.g-nav a[data-nav="home"]');
        await page.waitForSelector('#gLoans');
        const box = await page.textContent('#gLoans');
        check(/Laptop Acer Aspire 3/.test(box) && /Proyektor/.test(box) && /1 terlambat/.test(box), `dashboard menampilkan barang yang saya pinjam + jumlah terlambat (${box.replace(/\s+/g, ' ').slice(0, 90)})`);
        check(await page.evaluate(() => {
            const loans = document.getElementById('gLoans');
            const firstOther = [...document.querySelectorAll('#gMain .g-box')].find((b) => b.id !== 'gLoans');
            return !firstOther || Boolean(loans.compareDocumentPosition(firstOther) & Node.DOCUMENT_POSITION_FOLLOWING);
        }), 'kotak pinjam barang ada di atas kotak wali kelas / absensi');
        {
            const fab = await page.$eval('.g-nav a.g-nav-fab', (a) => {
                const nav = [...document.querySelectorAll('.g-nav a')].map((x) => x.dataset.nav);
                const r = a.querySelector('.g-fab').getBoundingClientRect();
                return { nav, round: getComputedStyle(a.querySelector('.g-fab')).borderRadius, raised: r.top < a.getBoundingClientRect().top, w: r.width };
            });
            check(fab.nav.join(',') === 'home,siswa,rekap,pinjam,statistik,dokumen,akun' && fab.round === '50%' && fab.raised && fab.w >= 48,
                `menu bawah: tombol bulat Pinjam di tengah antara Rekap & Statistik (${JSON.stringify(fab)})`);
        }
        await shot(page, 'inv-03-guru-dashboard-360.png');

        // Halaman Pinjam Barang + scan (fallback kamera) + ketik kode
        await page.click('#gLoans a[href="#/pinjam"]');
        await page.waitForSelector('#gMyLoans .inv-loan');
        check((await page.$$('#gMyLoans .inv-loan')).length === 2 && /Laptop Acer/.test(await page.textContent('#gMyHist')), 'Pinjam Barang: 2 pinjaman aktif + riwayat');
        await shot(page, 'inv-04-guru-pinjam-360.png');
        // Scan QR → kamera langsung terbuka di dalam portal (tanpa dialog), QR terbaca → halaman barang.
        await page.click('#gScan');
        await page.waitForSelector('.inv-cam video');
        check(!(await page.$('.att-sheet')), 'Scan QR langsung membuka kamera tanpa dialog petunjuk');
        await page.waitForFunction(() => window.__jsqrCalls > 0 && /Arahkan/.test(document.getElementById('gCamMsg')?.textContent || ''));
        check(await page.evaluate(() => document.querySelector('.inv-cam video').videoWidth > 0), 'kamera mengalirkan gambar ke pemindai');
        await shot(page, 'inv-05-guru-kamera-360.png');
        await page.evaluate(() => { window.__qrAnswer = 'https://sdnkalibaru05.sch.id/guru#/pinjam/toklap001aaa'; });
        await page.waitForSelector('.inv-state.mine');
        check(!(await page.$('.inv-cam')) && /Laptop Acer Aspire 3/.test(await page.textContent('#gMain')), 'QR terbaca → kamera ditutup & halaman barang terbuka');
        await page.evaluate(() => { window.__qrAnswer = null; location.hash = '#/pinjam'; });
        await page.waitForSelector('#gScan');
        await page.click('#gScan');
        await page.waitForSelector('.inv-cam');
        await page.click('.inv-cam button');
        check(!(await page.$('.inv-cam')), 'tombol Batal menutup kamera');
        // Izin kamera ditolak → cadangan: foto stiker lalu dibaca.
        await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('ditolak', 'NotAllowedError')); window.__qrAnswer = 'MEB-001'; });
        await page.click('#gScan');
        await page.waitForSelector('.att-sheet');
        check(/Izin kamera ditolak/.test(await page.textContent('.att-sheet')), 'izin kamera ditolak → tawaran foto stiker');
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.att-sheet [data-act="yes"]')]);
        await chooser.setFiles(new URL('../logo-cetak.png', import.meta.url).pathname);
        await page.waitForSelector('.inv-state.off');
        check(/Lemari Arsip/.test(await page.textContent('#gMain')), 'foto stiker dibaca → halaman barang terbuka');
        await page.evaluate(() => { location.hash = '#/pinjam'; });
        await page.waitForSelector('#gMyLoans .inv-loan');
        check(await overflow(page) <= 0, 'halaman Pinjam Barang tidak bergeser ke samping');
        await page.fill('#gKode', 'https://sdnkalibaru05.sch.id/guru#/pinjam/tokpro001ccc');
        await page.click('#gKodeForm button');
        await page.waitForSelector('.inv-state.mine');
        await page.fill('#gInvNote', 'Lampu berkedip');
        await page.click('#gInvBtn');
        await page.waitForSelector('.inv-state.ok');
        check(await page.evaluate(() => window.__fake.calls.some((c) => c.fn === 'inv_return' && c.args.p_code === 'tokpro001ccc' && c.args.p_catatan === 'Lampu berkedip' && !('p_kondisi' in c.args))),
            'Kembalikan → inv_return dengan catatan saja; status barang tetap ditentukan admin');
        await page.click('#gBack');
        await page.waitForSelector('#gMyLoans .inv-loan');
        check((await page.$$('#gMyLoans .inv-loan')).length === 1, 'setelah dikembalikan, pinjaman aktif tinggal 1');
        check(errors.length === 0, `tidak ada error JavaScript di Pinjam Barang (${errors.join(' | ').slice(0, 160)})`);
        await ctx.close();
    }

    for (const vp of [{ width: 1366, height: 900, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
        const T = `[Inventaris ${vp.tag}]`;
        const { ctx, page, errors } = await newPage('/admin', { width: vp.width, height: vp.height });
        await page.fill('#adminEmail', 'admin@fiktif.test');
        await page.fill('#adminPassword', 'x');
        await page.click('.btn-login');
        await page.waitForSelector('#mainContent', { state: 'visible' });
        await page.waitForSelector('#dashInvAlert:not([hidden])');
        check(/1 barang lewat batas kembali/.test(await page.textContent('#dashInvAlert')) && /2 sedang dipinjam/.test(await page.textContent('#dashInvAlert')),
            `${T} Dashboard utama: peringatan barang terlambat (${(await page.textContent('#dashInvAlert')).replace(/\s+/g, ' ').trim()})`);
        await page.click('#dashInvAlert');
        await page.waitForSelector('#invMonth');
        const stats = await page.$$eval('#invStats .inv-stat b', (b) => b.map((x) => x.textContent));
        check(stats.join(',') === '6,2,1,1', `${T} ringkasan: 6 barang, 2 dipinjam, 1 terlambat, 1 rusak (${stats})`);
        {
            const mon = (await page.textContent('#invBody')).replace(/\s+/g, ' ');
            check(/Proyektor Epson EB-X500.*Sunarsih.*Telat 1 hari/.test(mon), `${T} Monitoring: daftar lewat batas kembali + berapa hari telat`);
            check(/Proyektor BenQ MS560.*Lampu proyektor mati/.test(mon), `${T} Monitoring: barang rusak + keterangannya`);
            check(/“Kabel HDMI longgar”.*Taripah/.test(mon), `${T} Monitoring: catatan guru saat mengembalikan`);
            check(/Susy Nurhayati meminjam Speaker Aktif Portable/.test(mon), `${T} Monitoring: aktivitas hari ini`);
            check(/Peminjam teraktif/.test(mon) && (await page.$$('#invBody .inv-days span')).length >= 28, `${T} Monitoring: grafik per hari + peminjam teraktif`);
            await shot(page, `inv-09-admin-monitoring-${vp.tag}.png`);
            check(await overflow(page) <= 0, `${T} Monitoring tidak bergeser ke samping`);
            const bulanIni = await page.textContent('#invMonth');
            await page.click('#invBody [data-mon="-1"]');
            await page.waitForFunction((t) => document.getElementById('invMonth')?.textContent !== t, bulanIni);
            check(!(await page.isDisabled('#invBody [data-mon="1"]')), `${T} Monitoring bisa pindah ke bulan sebelumnya`);
            await page.click('#invBody [data-mon="1"]');
        }
        // Catatan guru → admin tandai rusak dari monitoring
        await page.click('#invBody [data-broken="i-pro3"]');
        await page.fill('#fs_ket', 'Port HDMI longgar');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => /Sudah ditandai rusak/.test(document.getElementById('invBody').textContent));
        check(await page.evaluate(() => window.__fake.calls.some((c) => c.fn === 'inv_set_status' && c.args.p_item === 'i-pro3' && c.args.p_kondisi === 'rusak' && c.args.p_keterangan === 'Port HDMI longgar')),
            `${T} dari catatan guru, admin menandai barang rusak + keterangan`);
        await page.click('#invSeg [data-view="barang"]');
        await page.waitForSelector('#invBody .att-table');
        await page.fill('#invBody [data-q]', 'PRO-003');
        await page.waitForSelector('#invBody [data-fixed="i-pro3"]');
        check(!(await page.$('#invBody [data-lend="i-pro3"]')) && /Port HDMI longgar/.test(await page.textContent('#invBody')), `${T} barang rusak: keterangan tampil, tidak bisa dipinjamkan`);
        await page.click('#invBody [data-fixed="i-pro3"]');
        await page.waitForSelector('#invBody [data-lend="i-pro3"]');
        check(true, `${T} Tandai berfungsi → bisa dipinjam lagi`);
        await page.fill('#invBody [data-q]', '');
        check(/Inventaris/.test(await page.textContent('#topbarTitle')), `${T} judul topbar Inventaris`);
        check(await overflow(page) <= 0, `${T} tab Inventaris tidak bergeser ke samping`);
        await shot(page, `inv-10-admin-barang-${vp.tag}.png`);

        // Tambah barang (kode otomatis)
        await page.click('#invAdd');
        await page.fill('#fs_nama', 'Kamera Canon EOS');
        await page.fill('#fs_kategori', 'Kamera');
        await page.selectOption('#fs_jenis_pinjam', 'harian');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => /KAM-001/.test(document.getElementById('invBody').textContent));
        check(true, `${T} tambah barang → kode otomatis KAM-001`);

        // Impor CSV + Excel
        if (vp.tag === '1366') {
            const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#invTemplate')]);
            const tv = await xlsxCells(dl, ['A1', 'B2', 'K3']);
            check(!tv || (/^Kode/.test(tv[0]) && tv[1] === 'Laptop Acer Aspire 3' && tv[2] === '2'), `${T} template impor Excel valid (${tv})`);
            const csv = join(dlDir, 'impor.csv');
            const { writeFileSync } = await import('node:fs');
            writeFileSync(csv, 'Kode;Nama barang;Kategori;Kondisi;Jenis pinjam;Jumlah\n;Laptop Lenovo;Laptop;Baik;Jangka panjang;2\nTAB;Tablet Samsung;Tablet;;;3\n;;;;;\n;Rusak;;hancur;;\n');
            await page.setInputFiles('#invFile', csv);
            await page.waitForSelector('.att-sheet');
            const prev = await page.textContent('.att-sheet');
            check(/Impor 6 barang/.test(prev) && /× 3/.test(prev), `${T} pratinjau impor CSV: 6 barang (2 + 3 + 1), baris kosong dilewati`);
            await page.click('.att-sheet [data-act="yes"]');
            await page.waitForFunction(() => /Baris 3: Status/.test(document.getElementById('attToastHost')?.textContent || ''));
            check(!(await page.evaluate(() => window.__fake.imported)), `${T} satu baris salah → impor ditolak seluruhnya dengan nomor barisnya`);
            writeFileSync(csv, 'Kode,Nama barang,Kategori,Kondisi,Jenis pinjam,Jumlah\n,Laptop Lenovo,Laptop,Baik,Jangka panjang,2\nTAB,Tablet Samsung,Tablet,,,3\n');
            await page.setInputFiles('#invFile', csv);
            await page.waitForSelector('.att-sheet');
            await page.click('.att-sheet [data-act="yes"]');
            await page.waitForFunction(() => /Impor selesai: 5 barang baru/.test(document.getElementById('attToastHost')?.textContent || ''));
            const body = await page.textContent('#invBody');
            check(/LAP-002/.test(body) || /Menampilkan 1–10 dari 10/.test(body), `${T} impor CSV berhasil: 5 barang baru`);
            const imp = await page.evaluate(() => window.__fake.imported);
            check(imp.length === 2 && imp[0].jumlah === 2 && imp[1].kode === 'TAB', `${T} baris impor dikirim ke database dengan jumlah & kode`);
            if (hasOpenpyxl) {
                const xl = join(dlDir, 'impor.xlsx');
                spawnSync('python3', ['-c', `import openpyxl,sys\nwb=openpyxl.Workbook();ws=wb.active\nws.append(['Daftar barang sekolah'])\nws.append(['No','Kode','Nama Barang','Merk','Lokasi','Tahun','Keterangan'])\nws.append([1,'PRJ-9','Proyektor BenQ','BenQ MS560','Lab',2021,'Baru'])\nwb.save(sys.argv[1])`, xl]);
                await page.setInputFiles('#invFile', xl);
                await page.waitForSelector('.att-sheet');
                check(/Proyektor BenQ/.test(await page.textContent('.att-sheet')), `${T} impor .xlsx: judul kolom dikenali walau ada baris judul di atasnya`);
                await page.click('.att-sheet [data-act="yes"]');
                await page.waitForFunction(() => /PRJ-9/.test(document.getElementById('invBody').textContent) || window.__fake.imported?.[0]?.kode === 'PRJ-9');
                const x = await page.evaluate(() => window.__fake.imported[0]);
                check(x.merk === 'BenQ MS560' && x.lokasi === 'Lab' && x.tahun_perolehan === '2021' && x.catatan === 'Baru', `${T} kolom Excel dipetakan benar (${JSON.stringify(x).slice(0, 120)})`);
            }
        }

        // Stiker QR: pilih 2 barang lalu cetak
        await page.selectOption('#invFilter', 'aktif');
        await page.fill('#invBody [data-q]', 'LAP-001');
        await page.check('#invBody [data-pick="i-lap1"]');
        await page.fill('#invBody [data-q]', 'SPK');
        await page.check('#invBody [data-pick="i-spk1"]');
        check(/\(2\)/.test(await page.textContent('#invPrint')), `${T} tombol cetak menghitung barang yang dipilih`);
        await page.click('#invPrint');
        await page.selectOption('#fs_skip', '1');
        {
            const pop = await popupFrom(page, () => page.click('.att-sheet button[type="submit"]'));
            const n = await pop.$$eval('.st:not(.kosong)', (x) => x.length);
            const blank = await pop.$$eval('.st.kosong', (x) => x.length);
            const first = await pop.$eval('.st:not(.kosong)', (x) => x.textContent.replace(/\s+/g, ' '));
            check(n === 2 && blank >= 1 && /LAP-001/.test(first) && /SDN KALIBARU 05 PAGI/.test(first), `${T} lembar stiker: 2 stiker, slot pertama dilewati (${first.slice(0, 80)})`);
            const sz = await pop.$eval('.kertas', (k) => ({ w: k.getBoundingClientRect().width, cols: getComputedStyle(k).gridTemplateColumns.split(' ').length }));
            check(sz.cols === 3 && Math.abs(sz.w - 793.7) < 3, `${T} stiker A4 3 kolom (${Math.round(sz.w)} px)`);
            if (vp.tag === '1366') {
                await shot(pop, 'inv-12-stiker-a4.png');
                const svg = await pop.$eval('.st:not(.kosong) .qr', (q) => q.innerHTML);
                const txt = await decodeQr(page, svg);
                check(txt === null || txt === 'https://sdnkalibaru05.sch.id/guru#/pinjam/toklap001aaa', `${T} QR di stiker terbaca kamera → tautan pinjam barang (${txt})`);
            }
            await pop.close();
        }
        await page.fill('#invBody [data-q]', '');

        // Pinjamkan atas nama staf, tandai kembali, hapus (arsip)
        check(!(await page.$('#invBody [data-lend="i-meb1"]')), `${T} barang "tidak dipinjam" tidak punya tombol Pinjamkan`);
        await page.fill('#invBody [data-q]', 'KAM-001');
        await page.click('#invBody [data-lend]');
        await page.selectOption('#fs_staff', { label: 'Taripah, S.Pd.' });
        check((await page.inputValue('#fs_sampai')).length === 10, `${T} pinjaman harian: tanggal kembali terisi hari ini`);
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => /Taripah/.test(document.getElementById('invBody').textContent));
        check(true, `${T} admin mencatat pinjaman atas nama guru`);
        await page.fill('#invBody [data-q]', '');
        await page.click('#invSeg [data-view="dipinjam"]');
        await page.waitForFunction(() => document.getElementById('invBody').dataset.view === 'dipinjam' && /Taripah/.test(document.getElementById('invBody').textContent));
        check(/Terlambat/.test(await page.textContent('#invBody')), `${T} tab Sedang dipinjam menandai yang terlambat`);
        await shot(page, `inv-11-admin-dipinjam-${vp.tag}.png`);
        await page.click('#invBody [data-back="i-spk1"]');
        await page.selectOption('#fs_kondisi', 'rusak');
        await page.fill('#fs_keterangan_rusak', 'Kabel power putus');
        await page.click('.att-sheet button[type="submit"]');
        await page.waitForFunction(() => !/Speaker Aktif/.test(document.getElementById('invBody').textContent));
        check(await page.evaluate(() => window.__fake.calls.some((c) => c.fn === 'inv_admin_return' && c.args.p_item === 'i-spk1' && c.args.p_kondisi === 'rusak' && c.args.p_keterangan_rusak === 'Kabel power putus')), `${T} Tandai kembali + status Rusak & keterangan → inv_admin_return`);
        await page.click('#invSeg [data-view="barang"]');
        await page.waitForSelector('#invBody [data-del="i-spk1"]');
        await page.click('#invBody [data-del="i-spk1"]');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => /diarsipkan/.test(document.getElementById('attToastHost')?.textContent || ''));
        check(true, `${T} hapus barang yang punya riwayat → diarsipkan`);
        await page.selectOption('#invFilter', 'arsip');
        await page.waitForSelector('#invBody [data-restore="i-spk1"]');
        check(true, `${T} filter Diarsipkan menampilkan barang arsip + tombol Aktifkan lagi`);

        // Riwayat + Excel
        await page.click('#invSeg [data-view="riwayat"]');
        await page.waitForSelector('#invHistXlsx');
        check(/Susy Nurhayati/.test(await page.textContent('#invBody')), `${T} riwayat pinjam tampil`);
        if (vp.tag === '1366') {
            const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#invHistXlsx')]);
            const v = await xlsxCells(dl, ['A1', 'C3']);
            check(!v || (/RIWAYAT PEMINJAMAN/.test(v[0]) && v[1] === 'Barang' && v[2] === 'logo'), `${T} Excel riwayat pinjam valid + logo (${v})`);
        }
        check(await overflow(page) <= 0, `${T} tidak bergeser ke samping`);
        check(errors.length === 0, `${T} tidak ada error JavaScript (${errors.join(' | ').slice(0, 160)})`);
        await ctx.close();
    }

    // ============================================================ NILAI — guru (HP) + admin
    {
        const T = '[Nilai guru 360]';
        const require = (await import('node:module')).createRequire(import.meta.url);
        const NL = require('../nilai.js');
        const XR = require('../xlsx-read.js');
        const { writeFileSync } = await import('node:fs');
        const C1A = '00000000-0000-4000-8000-0000000000c1';
        const SID = (n) => `00000000-0000-4000-8000-00000000005${n}`;
        const { ctx, page, errors } = await newPage('/guru#/nilai', { width: 360, height: 780 });
        await page.waitForSelector('#gLogin:not(.g-hidden)');
        await page.fill('#gId', '990000000000000001');
        await page.fill('#gPw', 'benar123');
        await page.click('#gLoginBtn');
        await page.waitForSelector('.nl-mp');
        const rows = await page.$$eval('.nl-mp', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
        check(rows.length === 4 && /Matematika ?KKTP 75 · 1\/3 lengkap.*2 belum lengkap/.test(rows[1]) && /PAI ?Diisi guru mapel: Susy Nurhayati.*Lihat saja/.test(rows[2]) && /Belum mulai/.test(rows[0]),
            `${T} daftar mapel: progres, KKTP, mapel guru mapel = lihat saja (${rows.join(' / ').slice(0, 200)})`);
        check(/Kelas 1\.A · Wali kelas/.test(await page.textContent('#gSub')) && (await page.$$('#nlKelas option')).length === 2, `${T} judul kelas + pilihan kelas (wali 1 A, PAI 3 A)`);
        await shot(page, 'nilai-01-mapel-360.png');
        check(await overflow(page) <= 0, `${T} daftar mapel tidak bergeser ke samping`);

        // Isi nilai Matematika
        await page.click('.nl-mp:has-text("Matematika")');
        await page.waitForSelector('#nlKktp');
        const na = () => page.$$eval('[data-na]', (b) => b.map((x) => x.textContent));
        check((await na()).join(',') === '83,68,–', `${T} NA dihitung: 83, 68 (UH sebagian), – (${await na()})`);
        check(/UH 2, UH 3 belum diisi — NA dihitung dari UH yang ada/.test(await page.textContent(`[data-row="${SID(2)}"]`)), `${T} peringatan UH kosong`);
        check(await page.evaluate(() => document.body.classList.contains('g-sheet-open')), `${T} menu bawah disembunyikan, bar Simpan menempel`);
        await page.fill(`[data-s="${SID(2)}"][data-f="uh2"]`, '90');
        check((await na())[1] === '73', `${T} NA langsung berubah saat mengetik (68 → 73)`);
        await page.fill(`[data-s="${SID(3)}"][data-f="uh1"]`, '150');
        check(await page.isDisabled('#nlSave') && /tidak valid/.test(await page.textContent('#nlDirty')), `${T} nilai 150 ditolak, tombol Simpan mati`);
        await page.fill(`[data-s="${SID(3)}"][data-f="uh1"]`, '95');
        await page.fill('#nlKktp', '70');
        check(/3 nilai berubah/.test(await page.textContent('#nlDirty')), `${T} jumlah perubahan belum disimpan (${await page.textContent('#nlDirty')})`);
        await shot(page, 'nilai-02-isi-360.png');
        check(await overflow(page) <= 0, `${T} halaman isi nilai tidak bergeser ke samping`);
        await page.click('#nlSave');
        await page.waitForFunction(() => /Tersimpan/.test(document.getElementById('attToastHost')?.textContent || ''));
        const saved = await page.evaluate(() => window.__fake.calls.filter((c) => c.fn === 'save_grades').pop()?.args);
        check(saved && saved.p_semester === 1 && saved.p_items[0].kktp === 70 && JSON.stringify(saved.p_items[0].entries) === JSON.stringify([{ student_id: SID(2), uh2: 90 }, { student_id: SID(3), uh1: 95 }]),
            `${T} save_grades hanya mengirim yang berubah + KKTP (${JSON.stringify(saved?.p_items).slice(0, 220)})`);

        // Keluar dengan perubahan belum disimpan → konfirmasi
        await page.waitForSelector('#nlKktp');
        await page.fill(`[data-s="${SID(1)}"][data-f="sas"]`, '60');
        await page.click('#gBack');
        await page.waitForSelector('.att-sheet:has-text("Nilai belum disimpan")');
        await page.click('.att-sheet [data-act="no"]');
        check(await page.isVisible('#nlKktp') && /1 nilai berubah/.test(await page.textContent('#nlDirty')), `${T} pindah halaman saat nilai belum disimpan → ditanya dulu; Batal = tetap`);
        await page.click('#gBack');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForSelector('.nl-mp');
        check(true, `${T} Buang perubahan → kembali ke daftar mapel`);

        // Riwayat
        await page.click('[data-nv="riwayat"]');
        await page.waitForSelector('.nl-h');
        const hist = (await page.textContent('#nlHist')).replace(/\s+/g, ' ');
        check((await page.$$('.nl-h')).length === 3 && /HARI INI/.test(hist) && /KKTP · Matematika.*75.*70/.test(hist) && /oleh Sunarsih/.test(hist), `${T} riwayat perubahan (lama → baru, oleh siapa) (${hist.slice(0, 160)})`);
        await shot(page, 'nilai-03-riwayat-360.png');
        await page.click('#gBack');
        await page.waitForSelector('.nl-mp');

        // Excel & PDF
        await page.click('[data-nv="excel"]');
        await page.waitForSelector('#nlTpl');
        await shot(page, 'nilai-04-excel-360.png');
        check(await overflow(page) <= 0, `${T} halaman Excel & PDF tidak bergeser ke samping`);
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#nlTpl')]);
        const tplPath = join(dlDir, 'tpl.xlsx');
        await dl.saveAs(tplPath);
        const book = await XR.readBook(readFileSync(tplPath));
        check(book.map((b) => b.name).join(',') === 'Petunjuk,Bahasa Indonesia,Matematika,Bahasa Inggris' && /Template_Nilai_Kelas_1_A_Smt_1/.test(dl.suggestedFilename()),
            `${T} template: hanya mapel yang bisa diisi (${book.map((b) => b.name)}) ${dl.suggestedFilename()}`);
        check(book[2].rows[6].slice(4, 9).join(',') === '80,85,90,78,82' && book[2].rows[2][3] === '70', `${T} template berisi nilai & KKTP yang sudah ada`);
        if (hasOpenpyxl) {
            const r = spawnSync('python3', ['-c', 'import sys,openpyxl\nwb=openpyxl.load_workbook(sys.argv[1])\nws=wb["Matematika"]\nprint(ws.protection.sheet, ws["E7"].protection.locked, ws["K7"].protection.locked, ws.freeze_panes, len(ws.data_validations.dataValidation))', tplPath], { encoding: 'utf8' });
            check(r.stdout.trim() === 'True False True E7 2', `${T} template terbuka di Excel: lembar terkunci kecuali kotak nilai, beku di E7, validasi 0–100 (${r.stdout.trim() || r.stderr.slice(0, 120)})`);
        }
        // Impor: file buatan guru (nilai diubah di Excel)
        const data = await page.evaluate(async (c) => (await window.supabaseClient.rpc('get_class_grades', { p_class_id: c, p_semester: 1 })).data, C1A);
        data.nilai.push({ s: SID(3), m: 'm-mtk', uh1: 95, uh2: 70, uh3: null, sts: 80, sas: 75 });
        data.nilai.push({ s: SID(1), m: 'm-bin', uh1: 88, uh2: null, uh3: null, sts: null, sas: null });
        const pai = data.nilai.find((n) => n.m === '00000000-0000-4000-8000-0000000000e1' && n.s === SID(1));
        if (pai) pai.uh1 = 50;
        const impPath = join(dlDir, 'Nilai 1A.xlsx');
        writeFileSync(impPath, NL.buku(data));
        await page.setInputFiles('#nlFile', impPath);
        await page.waitForSelector('.att-sheet:has-text("Pratinjau impor")');
        const prev = (await page.textContent('.att-sheet')).replace(/\s+/g, ' ');
        check(/4 ?nilai baru/.test(prev) && /0 ?nilai berubah/.test(prev) && /Lembar PAI diabaikan — Diisi guru mapel \(Susy Nurhayati\)/.test(prev) && /Simpan 4 nilai/.test(prev),
            `${T} pratinjau impor: baru/berubah/dilewati + alasan (${prev.slice(0, 260)})`);
        await shot(page, 'nilai-05-pratinjau-impor-360.png');
        await page.click('.att-sheet [data-act="yes"]');
        await page.waitForFunction(() => /Impor tersimpan/.test(document.getElementById('attToastHost')?.textContent || ''));
        const imp = await page.evaluate(() => window.__fake.calls.filter((c) => c.fn === 'save_grades').pop()?.args);
        check(imp.p_source === 'impor' && imp.p_keep_blank === true && imp.p_items.length === 2, `${T} impor → save_grades (sumber impor, kotak kosong tidak menghapus)`);
        await page.waitForSelector('.nl-mp');
        // PDF leger
        await page.click('[data-nv="excel"]');
        await page.waitForSelector('#nlPdfL');
        const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('#nlPdfL')]);
        await pop.waitForLoadState();
        const lg = (await pop.textContent('body')).replace(/\s+/g, ' ');
        check(/LEGER NILAI AKHIR SISWA/.test(lg) && /SEMESTER GANJIL/.test(lg) && /KEPALA FIKTIF, S\.Pd\.SD/.test(lg) && /SUNARSIH, S\.Pd\./.test(lg), `${T} PDF leger nilai + tanda tangan (${lg.slice(0, 120)})`);
        await shot(pop, 'nilai-06-leger-pdf.png');
        await pop.close();
        const [pop2] = await Promise.all([page.waitForEvent('popup'), page.click('#nlPdfM')]);
        await pop2.waitForLoadState();
        check(/DAFTAR NILAI BAHASA INDONESIA/.test(await pop2.textContent('body')), `${T} PDF daftar nilai per mapel`);
        await pop2.close();

        // Beranda: kartu pintasan Nilai
        await page.evaluate(() => { location.hash = '#/'; });
        await page.waitForSelector('.g-nilai-link');
        check(true, `${T} Beranda punya pintasan Nilai siswa`);
        check(errors.length === 0, `${T} tidak ada error JavaScript (${errors.join(' | ').slice(0, 160)})`);
        await ctx.close();
    }

    for (const vp of [{ width: 1366, height: 900, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
        const T = `[Nilai admin ${vp.tag}]`;
        const { ctx, page, errors } = await newPage('/admin', { width: vp.width, height: vp.height });
        await page.fill('#adminEmail', 'admin@fiktif.test');
        await page.fill('#adminPassword', 'x');
        await page.click('.btn-login');
        await page.waitForSelector('#mainContent', { state: 'visible' });
        await page.evaluate(() => showTab('tabNilai', document.querySelector('[data-tab="tabNilai"]')));
        await page.waitForSelector('.nl-mx');
        await page.waitForTimeout(400);
        check(await page.evaluate(() => document.querySelector('[data-tab="tabNilai"]').classList.contains('active') && document.getElementById('topbarTitle').textContent === 'Nilai Siswa'), `${T} menu Nilai Siswa aktif`);
        const cells = await page.$$eval('.nl-mx tbody tr:first-child td', (t) => t.map((x) => `${x.className.replace('nl-x ', '')}:${x.textContent}`));
        check(cells.join(',') === 'none:0/3,part:1/3,part:1/3,none:0/3', `${T} matriks kelas × mapel (${cells})`);
        await shot(page, `nilai-07-admin-matriks-${vp.tag}.png`);
        check(await overflow(page) <= 0, `${T} matriks tidak bergeser ke samping`);
        await page.click('.nl-mx tbody tr:first-child td:nth-child(3) button');
        await page.waitForSelector('#nlKktp');
        check(vp.tag !== '1366' || await page.isVisible('.nl-grid-head'), `${T} isi nilai tampil sebagai tabel di layar lebar`);
        await page.fill('[data-s="00000000-0000-4000-8000-000000000053"][data-f="sas"]', '77');
        await page.click('#nlSave');
        await page.waitForFunction(() => /Tersimpan/.test(document.getElementById('attToastHost')?.textContent || ''));
        check(true, `${T} admin bisa mengisi/memperbaiki nilai`);
        await shot(page, `nilai-08-admin-isi-${vp.tag}.png`);
        check(await overflow(page) <= 0, `${T} halaman isi tidak bergeser ke samping`);
        await page.click('.nl-back');
        await page.waitForSelector('.nl-mp');
        await page.click('.nl-hide summary');
        await page.uncheck('[data-hide="m-big"]');
        await page.waitForFunction(() => window.__fake.calls.some((c) => c.fn === 'set_class_subject_hidden' && c.args.p_subject_id === 'm-big' && c.args.p_hidden === true));
        await page.waitForFunction(() => document.querySelectorAll('.nl-mp').length === 3);
        check(true, `${T} matikan mapel yang tidak diajarkan (Bahasa Inggris) → hilang dari daftar`);
        await page.click('.nl-back');
        await page.waitForSelector('.nl-mx');
        check(/hid/.test(await page.getAttribute('.nl-mx tbody tr:first-child td:nth-child(5)', 'class')), `${T} matriks menandai mapel tidak diajarkan`);
        check(errors.length === 0, `${T} tidak ada error JavaScript (${errors.join(' | ').slice(0, 160)})`);
        await ctx.close();
    }
}
