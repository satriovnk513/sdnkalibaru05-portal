// Uji lightbox foto Guru & Staf (guru-staff.html), fokus pada tombol tutup di layar ponsel.
//
// Latar: tombol tutup dulu berupa <span> tanpa position di dalam flex container
// yang ter-center dan overflow:hidden. Begitu tinggi konten melebihi tinggi layar,
// tombol terdorong ke atas garis layar lalu terpotong, sehingga di ponsel foto
// tidak bisa ditutup. Tes ini mengunci perilaku yang benar.
//
// Opsional, dilewati bila dependensi tidak tersedia:
//   PLAYWRIGHT_MODULE_DIR=<node_modules berisi playwright-core>
//   CHROMIUM_PATH=<path executable Chrome/Chromium>
//   UI_SCREENSHOT_DIR=<folder screenshot> (opsional)
//
// Supabase dimock di level jaringan browser; tidak ada request ke project asli
// dan tidak ada data pribadi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PW_DIR = process.env.PLAYWRIGHT_MODULE_DIR;
const CHROME = process.env.CHROMIUM_PATH;
const OUT = process.env.UI_SCREENSHOT_DIR || '';
const skipReason = !PW_DIR || !CHROME
    ? 'set PLAYWRIGHT_MODULE_DIR dan CHROMIUM_PATH untuk uji UI'
    : (!existsSync(CHROME) ? 'CHROMIUM_PATH tidak ditemukan' : false);

// Ukuran layar yang dipakai pengunjung sekolah; tinggi kecil adalah kasus yang dulu rusak.
const VIEWPORTS = [
    { nama: 'ponsel kecil 375x667', width: 375, height: 667, mobile: true },
    { nama: 'android umum 360x640', width: 360, height: 640, mobile: true },
    { nama: 'ponsel tinggi 360x740', width: 360, height: 740, mobile: true },
    { nama: 'ponsel + bilah URL 390x664', width: 390, height: 664, mobile: true },
    { nama: 'ponsel miring 844x390', width: 844, height: 390, mobile: true },
    { nama: 'desktop 1366x768', width: 1366, height: 768, mobile: false },
];

// Nama berisi markup: membuktikan keterangan dirender sebagai teks, bukan HTML.
const NAMA_JAHAT = '<img src=x onerror="window.__xss=1">Budi "Si" O\'Brien & Co';

const results = [];
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
if (skipReason) test('lightbox Guru & Staf (dilewati)', { skip: skipReason }, () => {});
for (const [ok, msg] of results) test(`lightbox: ${msg}`, () => assert.ok(ok, msg));

// PNG solid minimal, supaya foto punya dimensi nyata tanpa memuat aset eksternal.
function makePng(w, h) {
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
    }
    const crc = (buf) => {
        let c = 0xffffffff;
        for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const c = Buffer.alloc(4);
        c.writeUInt32BE(crc(body));
        return Buffer.concat([len, body, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor
    const raw = Buffer.alloc(h * (1 + w * 3));
    for (let y = 0; y < h; y++) {
        const off = y * (1 + w * 3);
        raw[off] = 0;
        for (let x = 0; x < w; x++) {
            raw[off + 1 + x * 3] = 90;
            raw[off + 2 + x * 3] = 120;
            raw[off + 3 + x * 3] = 180;
        }
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

async function runUi() {
    const { chromium } = await import(pathToFileURL(join(PW_DIR, 'playwright-core', 'index.mjs')).href);
    if (OUT) mkdirSync(OUT, { recursive: true });

    const FOTO = makePng(600, 900);

    // ---------- server statis untuk repo
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
    const server = createServer((req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/guru-staff') p = '/guru-staff.html';
        if (p === '/foto-uji.png') {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            return res.end(FOTO);
        }
        const f = join(REPO, p);
        if (!f.startsWith(REPO + '/') || !existsSync(f) || /^\/(tests|scripts|supabase|data-private)\//.test(p)) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
        res.end(readFileSync(f));
    }).listen(0);
    cleanup.push(() => server.close());
    const BASE = `http://127.0.0.1:${server.address().port}`;

    const STAF = [
        { name: NAMA_JAHAT, role: 'Kepala Sekolah|Kepala Sekolah', image_url: `${BASE}/foto-uji.png`, order_index: 1 },
        { name: 'Guru Kedua', role: 'Guru Kelas|Wali Kelas 1A', image_url: `${BASE}/foto-uji.png`, order_index: 2 },
    ];

    const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    cleanup.push(() => browser.close());

    const ok = (cond, msg) => results.push([!!cond, msg]);

    for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            isMobile: vp.mobile,
            hasTouch: vp.mobile,
            deviceScaleFactor: 1,
        });
        const page = await context.newPage();

        // Supabase tiruan: shim CDN, tidak ada request keluar.
        await page.route('**/cdn.jsdelivr.net/**', (route) => route.fulfill({
            status: 200,
            contentType: 'text/javascript',
            body: `window.supabase={createClient:function(){
                var data=${JSON.stringify(STAF)};
                function builder(table){
                    var b={};
                    ['select','eq','neq','order','limit','in','is','filter','range','single','maybeSingle','ilike','like','gte','lte'].forEach(function(m){
                        b[m]=function(){return b;};
                    });
                    b.then=function(res){return Promise.resolve({data:table==='staff'?data:[],error:null}).then(res);};
                    return b;
                }
                return {from:builder};
            }};`,
        }));
        // Font dan ikon eksternal tidak diperlukan untuk tes tata letak.
        await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
        await page.route('**/fonts.gstatic.com/**', (r) => r.abort());
        await page.route('**/cdnjs.cloudflare.com/**', (r) => r.abort());
        await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: FOTO }));

        await page.goto(`${BASE}/guru-staff`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.staff-img-wrapper', { timeout: 10000 });

        const label = vp.nama;

        // --- awal: modal tertutup
        ok(await page.evaluate(() => !document.getElementById('staffModal').classList.contains('is-open')),
            `${label}: modal tertutup saat halaman dimuat`);

        // --- buka lewat klik foto
        await page.locator('.staff-img-wrapper').first().click();
        await page.waitForTimeout(350);

        const buka = await page.evaluate(() => {
            const m = document.getElementById('staffModal');
            const x = document.getElementById('closeStaffModalBtn');
            const r = x.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
                terbuka: m.classList.contains('is-open'),
                ariaHidden: m.getAttribute('aria-hidden'),
                dalamLayar: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
                bisaDitekan: !!(el && (el === x || x.contains(el))),
                lebar: r.width,
                tinggi: r.height,
                scrollTerkunci: document.body.style.overflow === 'hidden',
                xssJalan: !!window.__xss,
                namaTeks: document.querySelector('.staff-modal-name').textContent,
                captionHtmlPunyaImg: document.getElementById('modalCaption').querySelector('img') !== null,
            };
        });

        ok(buka.terbuka, `${label}: modal terbuka setelah foto diklik`);
        ok(buka.ariaHidden === 'false', `${label}: aria-hidden=false saat terbuka`);
        ok(buka.dalamLayar, `${label}: tombol tutup berada sepenuhnya di dalam layar`);
        ok(buka.bisaDitekan, `${label}: tombol tutup tidak tertutup elemen lain`);
        ok(buka.lebar >= 32 && buka.tinggi >= 32, `${label}: tombol tutup cukup besar untuk jari (${Math.round(buka.lebar)}x${Math.round(buka.tinggi)})`);
        ok(buka.scrollTerkunci, `${label}: scroll halaman dikunci saat modal terbuka`);
        ok(!buka.xssJalan && !buka.captionHtmlPunyaImg && buka.namaTeks === NAMA_JAHAT,
            `${label}: nama dirender sebagai teks, markup tidak dieksekusi`);

        // Widget KaliBot tidak boleh menutupi foto (z-index-nya sama dengan modal)
        const botSaatBuka = await page.evaluate(() => {
            const w = document.getElementById('kalibot-widget-container');
            if (!w) return { ada: false };
            const r = w.getBoundingClientRect();
            return {
                ada: true,
                display: getComputedStyle(w).display,
                punyaKelas: w.classList.contains('kalibot-hidden-by-modal'),
                luas: r.width * r.height,
            };
        });
        ok(botSaatBuka.ada, `${label}: widget KaliBot ada di halaman`);
        ok(botSaatBuka.display === 'none' && botSaatBuka.punyaKelas && botSaatBuka.luas === 0,
            `${label}: KaliBot disembunyikan saat foto dibuka`);

        if (OUT) await page.screenshot({ path: join(OUT, `lightbox-${vp.width}x${vp.height}.png`) });

        // --- klik foto tidak boleh menutup
        await page.locator('#staffModalImg').click();
        await page.waitForTimeout(250);
        ok(await page.evaluate(() => document.getElementById('staffModal').classList.contains('is-open')),
            `${label}: klik foto tidak menutup modal`);

        // --- tutup lewat tombol
        await page.locator('#closeStaffModalBtn').click();
        await page.waitForTimeout(350);
        const tutup = await page.evaluate(() => ({
            tertutup: !document.getElementById('staffModal').classList.contains('is-open'),
            ariaHidden: document.getElementById('staffModal').getAttribute('aria-hidden'),
            scrollPulih: document.body.style.overflow === '',
            masihDiHalaman: location.pathname.includes('guru-staff'),
        }));
        ok(tutup.tertutup, `${label}: tombol tutup menutup modal`);
        ok(tutup.ariaHidden === 'true', `${label}: aria-hidden=true setelah ditutup`);
        ok(tutup.scrollPulih, `${label}: scroll halaman pulih setelah ditutup`);
        ok(tutup.masihDiHalaman, `${label}: tetap berada di halaman guru-staff`);

        const botSaatTutup = await page.evaluate(() => {
            const w = document.getElementById('kalibot-widget-container');
            const r = w.getBoundingClientRect();
            return {
                display: getComputedStyle(w).display,
                punyaKelas: w.classList.contains('kalibot-hidden-by-modal'),
                terlihat: r.width > 0 && r.height > 0,
            };
        });
        ok(botSaatTutup.display !== 'none' && !botSaatTutup.punyaKelas && botSaatTutup.terlihat,
            `${label}: KaliBot muncul kembali setelah foto ditutup`);

        // --- tutup lewat Escape
        await page.locator('.staff-img-wrapper').first().click();
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
        ok(await page.evaluate(() => !document.getElementById('staffModal').classList.contains('is-open')),
            `${label}: tombol Escape menutup modal`);

        // --- tutup lewat klik latar gelap
        await page.locator('.staff-img-wrapper').first().click();
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getElementById('staffModalBody').click());
        await page.waitForTimeout(350);
        ok(await page.evaluate(() => !document.getElementById('staffModal').classList.contains('is-open')),
            `${label}: klik latar gelap menutup modal`);

        // --- tutup lewat tombol kembali perangkat
        await page.locator('.staff-img-wrapper').first().click();
        await page.waitForTimeout(300);
        await page.goBack();
        await page.waitForTimeout(400);
        const kembali = await page.evaluate(() => ({
            tertutup: !document.getElementById('staffModal').classList.contains('is-open'),
            masihDiHalaman: location.pathname.includes('guru-staff'),
            scrollPulih: document.body.style.overflow === '',
        }));
        ok(kembali.tertutup, `${label}: tombol kembali perangkat menutup modal`);
        ok(kembali.masihDiHalaman, `${label}: tombol kembali tidak meninggalkan halaman guru-staff`);
        ok(kembali.scrollPulih, `${label}: scroll pulih setelah tombol kembali`);

        // --- buka-tutup berulang tidak meninggalkan sisa state
        for (let i = 0; i < 3; i++) {
            await page.locator('.staff-img-wrapper').first().click();
            await page.waitForTimeout(220);
            await page.locator('#closeStaffModalBtn').click();
            await page.waitForTimeout(220);
        }
        const sesudah = await page.evaluate(() => ({
            tertutup: !document.getElementById('staffModal').classList.contains('is-open'),
            scrollPulih: document.body.style.overflow === '',
            srcKosong: document.getElementById('staffModalImg').getAttribute('src') === '',
        }));
        ok(sesudah.tertutup && sesudah.scrollPulih && sesudah.srcKosong,
            `${label}: tiga siklus buka-tutup tidak meninggalkan sisa state`);

        await context.close();
    }
}
