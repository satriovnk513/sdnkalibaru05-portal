// Uji UI end-to-end modul Data Siswa (dashboard admin) — Fase 5.
//
// Opsional, dilewati bila dependensi tidak tersedia:
//   PLAYWRIGHT_MODULE_DIR=<node_modules berisi playwright-core>
//   CHROMIUM_PATH=<path executable Chrome/Chromium>
//   UI_SCREENSHOT_DIR=<folder screenshot> (opsional)
//
// Supabase dimock sepenuhnya di level jaringan browser; tidak ada request ke project asli.
// Seluruh data adalah data FIKTIF dari tests/fixtures (NIK berawalan 99). Tidak ada data pribadi.
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
const skipReason = !PW_DIR || !CHROME
    ? 'set PLAYWRIGHT_MODULE_DIR dan CHROMIUM_PATH untuk uji UI'
    : (!existsSync(CHROME) ? `CHROMIUM_PATH tidak ditemukan` : false);

const results = [];
// Sumber daya dibersihkan di finally agar kegagalan di tengah alur tidak membuat proses menggantung.
const cleanup = [];
if (!skipReason) {
    try {
        await runUi();
    } catch (e) {
        results.push([false, `alur UI berhenti: ${String(e.message).split('\n')[0]}`]);
    } finally {
        for (const fn of cleanup.reverse()) await Promise.resolve().then(fn).catch(() => {});
    }
}
if (skipReason) test('UI Data Siswa (dilewati)', { skip: skipReason }, () => {});
for (const [ok, msg] of results) test(`UI: ${msg}`, () => assert.ok(ok, msg));

async function runUi() {
const { chromium } = await import(pathToFileURL(join(PW_DIR, 'playwright-core', 'index.mjs')).href);
if (OUT) mkdirSync(OUT, { recursive: true });
const shot = (page, name, opts = {}) => (OUT ? page.screenshot({ path: join(OUT, name), ...opts }) : null);
const { makeFakeFile } = await import('./fixtures/fake-students.mjs');
const { validateAndBuild } = await import('../scripts/import-students.mjs');

// ---------- data fiktif
const doc = makeFakeFile();
doc.records[0].siswa_alamat = '=HYPERLINK("http://contoh.invalid")'; // uji formula injection
const { rows } = validateAndBuild(doc);
const DB = rows.map((r, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, ...r }));
const PII = [...new Set(DB.flatMap((r) => [r.nik, r.nama_siswa, r.nama_ibu_kandung]).filter(Boolean))];

// ---------- static server
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/admin') p = '/admin.html';
    const f = join(REPO, p);
    if (!f.startsWith(REPO + '/') || !existsSync(f) || /^\/(tests|scripts|supabase|data-private)\//.test(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
}).listen(0);
cleanup.push(() => server.close());
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- mock Supabase
let role = 'admin';
const requests = [];
function filterRows(params) {
    let out = DB;
    const or = params.get('or');
    if (or) {
        const conds = or.slice(1, -1).match(/[a-z_]+\.ilike\."\*[^"]*\*"/g).map((c) => {
            const m = /^([a-z_]+)\.ilike\."\*([^"]*)\*"$/.exec(c);
            return [m[1], m[2].toLowerCase()];
        });
        out = out.filter((r) => conds.some(([c, t]) => (r[c] || '').toLowerCase().includes(t)));
    }
    for (const [k, v] of params) {
        if (['select', 'or', 'order', 'offset', 'limit'].includes(k)) continue;
        if (v.startsWith('eq.')) out = out.filter((r) => String(r[k] ?? '') === v.slice(3));
    }
    out = [...out].sort((a, b) => b.status_daftar.localeCompare(a.status_daftar) || (a.kelas || '~').localeCompare(b.kelas || '~') || a.nama_siswa.localeCompare(b.nama_siswa));
    return out;
}
const pick = (r, sel) => (sel === '*' ? r : Object.fromEntries(sel.split(',').map((c) => [c, r[c]])));
async function supa(route) {
    const req = route.request();
    const url = new URL(req.url());
    requests.push(`${req.method()} ${url.pathname}`);
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range', ...headers }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const p = url.pathname;
    if (p.startsWith('/storage/')) return route.continue();
    if (p === '/auth/v1/token') {
        const now = Math.floor(Date.now() / 1000);
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'admin@fiktif.test' };
        return json({ access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: user.id, role: 'authenticated', exp: now + 3600 })}.x`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user });
    }
    if (p.startsWith('/auth/v1/')) return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    const accept = req.headers()['accept'] || '';
    const single = accept.includes('vnd.pgrst.object');
    if (p === '/rest/v1/user_roles') return role === 'admin' ? json(single ? { role: 'admin' } : [{ role: 'admin' }]) : (single ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([]));
    if (p === '/rest/v1/rpc/student_summary') {
        if (role !== 'admin') return json([{ total_siswa: 0, tercantum: 0, perlu_verifikasi: 0, jumlah_rombel: 0, daftar_kelas: [] }]);
        const listed = DB.filter((r) => r.status_daftar === 'Tercantum di daftar kelas');
        const kelas = [...new Set(listed.map((r) => r.kelas))].sort();
        return json([{ total_siswa: DB.length, tercantum: listed.length, perlu_verifikasi: DB.length - listed.length, jumlah_rombel: kelas.length, daftar_kelas: kelas }]);
    }
    if (p === '/rest/v1/student_records') {
        if (role !== 'admin') return json([], 200, { 'Content-Range': '*/0' });
        const all = filterRows(url.searchParams);
        const off = Number(url.searchParams.get('offset') || 0);
        const lim = Number(url.searchParams.get('limit') || 1000);
        const page = all.slice(off, off + lim).map((r) => pick(r, url.searchParams.get('select')));
        if (single) return page.length ? json(page[0]) : json(null);
        return json(page, 200, { 'Content-Range': `${page.length ? `${off}-${off + page.length - 1}` : '*'}/${all.length}` });
    }
    return json(single ? null : [], 200, { 'Content-Range': '*/0' });
}

// ---------- run
const browser = await chromium.launch({ executablePath: CHROME });
cleanup.push(() => browser.close());
const check = (ok, msg) => { results.push([Boolean(ok), msg]); };

async function newPage(viewport = { width: 1366, height: 900 }) {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true });
    ctx.setDefaultTimeout(10000);
    await ctx.route('https://wwpbghdepykfqgzhyvmh.supabase.co/**', supa);
    await ctx.route('**/_vercel/**', (r) => r.fulfill({ status: 204 }));
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`));
    await page.goto(`${BASE}/admin`);
    return { ctx, page, logs };
}
async function login(page) {
    await page.fill('#adminEmail', 'admin@fiktif.test');
    await page.fill('#adminPassword', 'x');
    await page.click('.btn-login');
    await page.waitForSelector('#mainContent', { state: 'visible' });
}
const info = (page) => page.textContent('#stuInfo');
const waitInfo = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('stuInfo').textContent), re.source, { timeout: 5000 });
const rowCount = (page) => page.$$eval('#stuTableBody tr:not(.stu-state-row)', (t) => t.length);

// 1. tanpa login
{
    const { ctx, page } = await newPage();
    await page.waitForTimeout(1500);
    check(await page.isVisible('#loginOverlay') && !(await page.isVisible('#mainContent')), 'tanpa login: hanya form login, dashboard tersembunyi');
    check(!requests.some((r) => r.includes('student')), 'tanpa login: tidak ada request ke data siswa');
    await ctx.close();
}
// 2. non-admin
{
    role = 'guru'; requests.length = 0;
    const { ctx, page } = await newPage();
    await page.fill('#adminEmail', 'guru@fiktif.test'); await page.fill('#adminPassword', 'x'); await page.click('.btn-login');
    await page.waitForTimeout(1500);
    check(await page.isVisible('#loginError') && /Akses ditolak/.test(await page.textContent('#loginError')), 'non-admin: akses ditolak di layar login');
    check(!requests.some((r) => r.includes('student')), 'non-admin: tidak ada request ke data siswa');
    await ctx.close();
    role = 'admin';
}
// 3. admin
const { ctx, page, logs } = await newPage();
await login(page);
await page.waitForFunction(() => document.getElementById('dashStuTotal').textContent === '559');
const dash = await page.$$eval(['#dashStuTotal', '#dashStuListed', '#dashStuReview', '#dashStuRombel'].join(','), (n) => n.map((x) => x.textContent));
check(dash.join('/') === '559/535/24/17', `dashboard: kartu siswa ${dash.join('/')}`);
await shot(page, `1-dashboard-desktop.png`, { fullPage: false });

await page.click('.nav-item[data-tab="tabStudents"]');
await waitInfo(page, /1–10 dari 559/);
check((await page.textContent('#topbarTitle')) === 'Data Siswa', 'topbar: Data Siswa');
const sum = await page.$$eval(['#stuTotal', '#stuListed', '#stuReview', '#stuRombel'].join(','), (n) => n.map((x) => x.textContent));
check(sum.join('/') === '559/535/24/17', `ringkasan tab: ${sum.join('/')}`);
check(await rowCount(page) === 10, 'default 10 baris');
check((await page.$$eval('#stuKelas option', (o) => o.length)) === 18, 'dropdown kelas: 17 kelas + semua');
const nameBox = await page.$eval('.stu-name', (n) => { const r = n.getBoundingClientRect(); return { w: r.width, h: r.height }; });
const wrapOv = await page.$eval('.stu-table-wrap', (w) => w.scrollWidth - w.clientWidth);
check(wrapOv <= 1, `desktop: tabel muat tanpa scroll horizontal (selisih ${wrapOv}px)`);
check(nameBox.w > 150 && nameBox.h < 45, `nama tidak vertikal (lebar ${Math.round(nameBox.w)}px, tinggi ${Math.round(nameBox.h)}px)`);
await shot(page, `2-data-siswa-desktop.png`, { fullPage: true });

// pagination
await page.click('.stu-page:has-text("2")');
await waitInfo(page, /11–20 dari 559/);
check(true, 'pagination: halaman 2 = 11–20');
check((await page.$$eval('.stu-page', (b) => b.map((x) => x.textContent))).includes('56'), 'pagination: halaman terakhir 56');
await page.selectOption('#stuPageSize', '50'); await waitInfo(page, /1–50 dari 559/);
check(await rowCount(page) === 50, 'pilihan 50');
await page.selectOption('#stuPageSize', 'all'); await waitInfo(page, /1–559 dari 559/);
check(await rowCount(page) === 559 && (await page.$$('.stu-page')).length === 0, 'pilihan semua: 559 baris, tanpa pagination');
await page.selectOption('#stuPageSize', '10'); await waitInfo(page, /1–10 dari 559/);

// pencarian
const target = DB[41];
const search = async (field, term, expect) => {
    await page.selectOption('#stuSearchField', field);
    await page.fill('#stuSearch', term);
    await page.waitForTimeout(450);
    await waitInfo(page, expect);
};
await search('all', target.nama_siswa, /dari 1 siswa/); check(true, 'cari nama siswa: 1 hasil');
await search('nik', target.nik.slice(0, 16), /dari 1 siswa/); check(true, 'cari NIK: 1 hasil');
const withNisn = DB.find((r) => r.nisn);
await search('nisn', withNisn.nisn, /dari 1 siswa/); check(true, 'cari NISN (dengan nol di depan): 1 hasil');
const withNipd = DB.find((r) => r.nipd);
await search('nipd', withNipd.nipd, /dari \d+ siswa/);
check((await page.textContent('#stuTableBody')).includes(withNipd.nama_siswa), 'cari NIPD: siswa ditemukan');
const withIbu = DB.find((r) => r.nama_ibu_kandung);
await search('nama_ibu_kandung', withIbu.nama_ibu_kandung, /dari \d+ siswa/);
check((await page.textContent('#stuTableBody')).includes(withIbu.nama_siswa), 'cari nama ibu: siswa ditemukan');
await search('all', 'tidak-ada-zzz', /^0 siswa$/);
check(/Tidak ada siswa yang cocok/.test(await page.textContent('#stuTableBody')), 'empty state pencarian');
await search('all', 'x(),"*%', /./);
check(!logs.some((l) => /PAGEERROR/.test(l)), 'karakter khusus di pencarian tidak memicu error');
await page.click('#stuReset'); await waitInfo(page, /1–10 dari 559/);

// filter
await page.selectOption('#stuKelas', '3A'); await waitInfo(page, /dari 32 siswa/); check(true, 'filter kelas 3A: 32');
await page.selectOption('#stuKelas', ''); await page.selectOption('#stuStatus', 'Perlu verifikasi lebih lanjut');
await waitInfo(page, /dari 24 siswa/); check(true, 'filter status perlu verifikasi: 24');
check(!(await page.textContent('#stuTableBody')).includes('Tercantum'), 'filter status: tidak ada siswa tercantum');

// CSV (status perlu verifikasi, semua halaman)
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stuExport')]);
const csv = readFileSync(await dl.path(), 'utf8');
const lines = csv.split('\r\n').filter(Boolean);
check(dl.suggestedFilename().startsWith('data-siswa_semua-kelas_perlu-verifikasi_'), `nama file CSV: ${dl.suggestedFilename()}`);
check(csv.charCodeAt(0) === 0xfeff, 'CSV UTF-8 dengan BOM');
check(lines.length === 25, `CSV: header + 24 baris (semua hasil filter, bukan hanya halaman) → ${lines.length - 1}`);
check(lines[0].startsWith('\ufeff"Nama Siswa","NIK","NIPD","NISN","Kelas","Nama Ibu Kandung"') && lines[0].includes('"Ayah: NIK"'), 'header CSV Bahasa Indonesia');
const reviewNik = DB.find((r) => r.status_daftar !== 'Tercantum di daftar kelas').nik;
check(csv.includes(`"${reviewNik}"`), 'NIK utuh 16 digit di CSV');
await page.selectOption('#stuStatus', '');
await page.fill('#stuSearch', DB[0].nama_siswa); await page.waitForTimeout(450); await waitInfo(page, /dari 1 siswa/);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#stuExport')]);
const csv2 = readFileSync(await dl2.path(), 'utf8');
check(csv2.includes(`"'=HYPERLINK(`) && !csv2.includes(',"=HYPERLINK('), 'CSV formula injection dinetralkan');
check(csv2.split('\r\n').filter(Boolean).length === 2 && dl2.suggestedFilename().includes('hasil-pencarian'), 'CSV mengikuti pencarian');
await page.click('#stuReset'); await waitInfo(page, /1–10 dari 559/);

// detail
await page.selectOption('#stuStatus', 'Perlu verifikasi lebih lanjut'); await waitInfo(page, /dari 24 siswa/);
await page.click('#stuTableBody tr:first-child .stu-btn-view');
await page.waitForFunction(() => document.querySelectorAll('.stu-tab').length === 7);
const tabs = await page.$$eval('.stu-tab', (t) => t.map((x) => x.textContent));
check(tabs.join('|') === 'Data Siswa|Ayah|Ibu|Wali|Kontak Darurat|Anggota Keluarga|Keterangan Lain', `tab detail: ${tabs.join(', ')}`);
check(await page.isVisible('#stuDetailBanner') && /Perlu verifikasi lebih lanjut/.test(await page.textContent('#stuDetailBanner')), 'banner perlu verifikasi');
await page.waitForTimeout(400);
await shot(page, `4-detail-desktop.png`);
let bad = [];
for (const t of tabs) {
    await page.click(`.stu-tab:has-text("${t}")`);
    const txt = await page.textContent('#stuDetailBody');
    const labels = (await page.$$eval('.stu-detail-item dt', (d) => d.map((x) => x.firstChild.textContent))).join('|');
    if (/undefined|\bnull\b|\[object|\{"/.test(txt) || /_/.test(labels)) bad.push(t);
}
check(!bad.length, `detail tanpa undefined/null/nama field teknis/JSON mentah${bad.length ? ' — ' + bad.join(',') : ''}`);
check((await page.textContent('#stuDetailBody')).includes('Sumber Data'), 'Keterangan Lain memuat sumber data');
await page.click('.stu-tab:has-text("Wali")');
check((await page.$$eval('.stu-detail-item dd', (d) => d.map((x) => x.textContent))).includes('—'), 'nilai kosong tampil —');
await shot(page, `5-detail-wali.png`);
await page.keyboard.press('Escape');
check(!(await page.isVisible('#stuDetail')), 'detail tertutup dengan Esc');
await page.click('#stuReset'); await waitInfo(page, /1–10 dari 559/);

// modul lain tetap jalan
for (const t of ['tabStaff', 'tabNews', 'tabGallery', 'tabEkskul', 'tabAIMemory', 'tabAISettings', 'tabDashboard']) {
    await page.click(`.nav-item[data-tab="${t}"]`);
    await page.waitForTimeout(200);
    if (!(await page.isVisible(`#${t}`))) check(false, `tab ${t} tampil`);
}
check(!logs.some((l) => /PAGEERROR/.test(l)), 'tidak ada error JavaScript saat berpindah semua tab');

// responsif
for (const [name, vp] of [['tablet', { width: 820, height: 1100 }], ['mobile', { width: 390, height: 844 }]]) {
    await page.setViewportSize(vp);
    await page.click('#tabDashboard') .catch(() => {});
    await page.evaluate(() => showTab('tabStudents'));
    await waitInfo(page, /dari 559/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow, `${name}: tidak ada scroll horizontal halaman`);
    const nb = await page.$eval('.stu-name', (n) => n.getBoundingClientRect().width);
    check(nb > 80, `${name}: nama siswa tidak menyempit vertikal (${Math.round(nb)}px)`);
    await shot(page, `3-data-siswa-${name}.png`, { fullPage: name === 'mobile' ? false : true });
    if (name === 'mobile') {
        await page.click('#stuTableBody tr:first-child .stu-btn-view');
        await page.waitForFunction(() => document.querySelectorAll('.stu-tab').length === 7);
        await page.waitForTimeout(400);
        await shot(page, `6-detail-mobile.png`);
        await page.keyboard.press('Escape');
    }
}

// console & jaringan
const leaked = logs.filter((l) => PII.some((v) => v && l.includes(v)));
check(!leaked.length, `console tanpa biodata (${logs.length} pesan console)`);
check(!requests.some((r) => r.includes('/api/chat')), 'tidak ada request ke /api/chat');

// logout
await page.setViewportSize({ width: 1366, height: 900 });
await page.evaluate(() => logout());
await page.waitForSelector('#loginOverlay', { state: 'visible' });
check(true, 'logout kembali ke login');

await ctx.close();
}
