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
        const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 700, isMobile: viewport.width < 700, acceptDownloads: true });
        await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
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
        await pop.waitForFunction(() => document.querySelector('.page'));
        return pop;
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
        // Kartu Guru Mapel: pilih hari Senin–Jumat, lalu buka absen PAI
        check((await page.$$('.g-days [data-day]')).length === 5, 'kartu jadwal punya pilihan hari Senin–Jumat');
        await page.click('.g-days [data-day]:first-child');
        check(/— Senin/.test(await page.textContent('#gMain')) && await page.getAttribute('.g-days [data-day]:first-child', 'aria-selected') === 'true', 'memilih Senin mengganti jadwal ke hari Senin');
        {
            const monday = await page.getAttribute('.g-days [data-day]:first-child', 'data-day');
            const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()));
            if (monday <= today) {
                check((await page.getAttribute('.g-sched', 'href')).includes(`tanggal=${monday}`), 'tautan absen mapel memakai tanggal hari yang dipilih');
                await page.click('.g-sched');
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
        if (OUT) await page.screenshot({ path: join(OUT, 'guru-03a-absen-floating-360.png') });
        await page.click('#gFloat .att-float-toggle');
        check(await page.$eval('#gFloat', (el) => !el.classList.contains('is-floating') && getComputedStyle(el).position !== 'sticky'), 'tombol panah melepas panel (tidak menempel lagi)');
        check(await page.evaluate(() => localStorage.getItem('att-float')) === '0', 'pilihan lepas/tempel diingat');
        await page.evaluate(() => window.scrollTo(0, 0));
        check(/Dispensasi<\/b> pada absensi siswa berlaku hanya untuk/.test(await page.innerHTML('#gSheet')) && /tetap dihitung hadir/.test(await page.innerHTML('#gSheet')), 'keterangan Dispensasi tampil di lembar absensi');
        check(!/Non-Muslim/.test(await page.innerHTML('#gSheet')), 'keterangan Non-Muslim tidak tampil di absensi harian');
        check(await page.$eval('.att-btn-hadir', (b) => getComputedStyle(b).backgroundColor) === 'rgb(220, 252, 231)', 'tombol Tandai semua Hadir berwarna hijau');
        check(await page.$eval('.att-btn-reset', (b) => b.getBoundingClientRect().left > document.querySelector('.att-btn-hadir').getBoundingClientRect().right - 1 && getComputedStyle(b).backgroundColor === 'rgb(226, 232, 240)'), 'tombol Reset abu-abu di kanan Tandai semua Hadir');
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
            const v = await xlsxCells(dl, ['D1', 'D4']);
            check(!v || (v[0] === 'DAFTAR HADIR SISWA' && v[1] === 'KELAS : I.A' && v[2] === 'logo'), `guru: file Excel valid + logo tertanam (${v})`);
            const pop2 = await popupFrom(page, () => page.click('#gRkSemPrint'));
            check(/REKAP ABSENSI SEMESTER/.test(await pop2.textContent('body')), 'guru: cetak rekap semester');
            await pop2.close();
        }

        // Dashboard: kartu rekap per tanggal + peringatan alpa
        await page.evaluate(() => { window.__fake.alpha = [
            { class_id: 'c1a', kelas: '1 A', student_id: '00000000-0000-4000-8000-000000000052', nama: 'Siswa Fiktif Satu', alpa: 5, terakhir: '2026-11-10' },
            { class_id: 'c1a', kelas: '1 A', student_id: '00000000-0000-4000-8000-000000000053', nama: 'Siswa Fiktif Tiga', alpa: 4, terakhir: '2026-11-05' },
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
        check(await overflow(page) <= 0, 'dashboard dengan kartu rekap + notifikasi tidak bergeser ke samping');
        await shot(page, 'guru-02b-dashboard-rekap-360.png');

        // Statistik
        await page.click('.g-nav a[data-nav="statistik"]');
        await page.waitForSelector('#gStat .g-tiles');
        check((await page.$$('.g-nav a')).length === 5 && await overflow(page) <= 0, 'menu bawah 5 tombol (ada Statistik) muat di 360 px');
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
        if (vp.tag === '1366') {
            await pop.emulateMedia({ media: 'print' });
            await pop.setViewportSize({ width: 1123, height: 794 });
            await shot(pop, 'laporan-02-cetak-bulanan.png');
        }
        await pop.close();
        await page.check('#lpBlnBlank');
        const popB = await popupFrom(page, () => page.click('#lpBlnPrint'));
        check(!(/>•</.test(await popB.content())), `${T} blanko kosong tanpa isian`);
        await popB.close();
        await page.uncheck('#lpBlnBlank');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#lpBlnXlsx')]);
        const v = await xlsxCells(dl, ['D1', 'D4', 'D8']);
        check(!v || (v[0] === 'DAFTAR HADIR SISWA' && v[1] === 'KELAS : I.A' && v[2] === 'SISWA FIKTIF DUA' && v[3] === 'logo'), `${T} Excel bulanan valid + logo (${v})`);

        await page.evaluate(() => showTab('tabRekapSemester'));
        await page.waitForSelector('#lpSemTable .att-table');
        check(/Menampilkan 1–3 dari 3 data/.test(await page.textContent('#lpSemTable [data-info]')), `${T} rekap semester memakai tabel standar`);
        check(await overflow(page) <= 0, `${T} Rekap Semester tidak bergeser ke samping`);
        await shot(page, `laporan-03-semester-${vp.tag}.png`);
        await page.selectOption('#lpSemWali', '2');
        const popS = await popupFrom(page, () => page.click('#lpSemPrint'));
        const ts = await popS.textContent('body');
        check(/REKAP ABSENSI SEMESTER/.test(ts) && /% KEHADIRAN/.test(ts), `${T} cetak rekap semester`);
        if (vp.tag === '1366') {
            await popS.emulateMedia({ media: 'print' });
            await popS.setViewportSize({ width: 1123, height: 794 });
            await shot(popS, 'laporan-04-cetak-semester.png');
        }
        await popS.close();
        const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#lpSemXlsx')]);
        const v2 = await xlsxCells(dl2, ['D1', 'D7']);
        check(!v2 || (/REKAP ABSENSI SEMESTER/.test(v2[0]) && v2[1] === 'SISWA FIKTIF DUA'), `${T} Excel semester valid (${v2})`);
        check(errors.length === 0, `${T} tidak ada error JavaScript di Laporan (${errors.join(' | ').slice(0, 160)})`);
        await ctx.close();
    }
}
