// =============================================================================
// Pemindai QR bersama (Portal Guru): stiker barang inventaris & kartu siswa.
//   QrScan.kamera(opts)   kamera di dalam portal; sekali scan, atau terus-menerus (opts.terus)
//   QrScan.dariFoto(opts) cadangan: ambil foto QR lalu dibaca
//   QrScan.reader()       → fungsi async (video|img) → teks QR atau null
// Pakai BarcodeDetector bawaan browser kalau ada (Chrome Android), selain itu jsQR
// (dimuat dari CDN hanya saat dibutuhkan) — jalan di semua HP termasuk iPhone.
// =============================================================================
(function () {
    'use strict';

    const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m, t) => window.Att?.toast(m, t);
    const errMessage = (e) => window.Att?.errMessage(e) || e?.message || String(e);

    let jsqrLoading = null;
    function loadJsQR() {
        const ready = window.jsQR?.default || window.jsQR;
        if (typeof ready === 'function') return Promise.resolve(ready);
        if (!jsqrLoading) {
            jsqrLoading = new Promise((resolve, reject) => {
                const sc = document.createElement('script');
                sc.src = window.__JSQR_URL || JSQR_URL;
                sc.async = true;
                sc.onload = () => { const fn = window.jsQR?.default || window.jsQR; return typeof fn === 'function' ? resolve(fn) : reject(new Error('Pemindai QR gagal dimuat.')); };
                sc.onerror = () => { jsqrLoading = null; reject(new Error('Pemindai QR gagal dimuat. Periksa koneksi internet.')); };
                document.head.appendChild(sc);
            });
        }
        return jsqrLoading;
    }

    /** → fungsi async (video|img) → teks QR atau null. */
    async function reader() {
        if ('BarcodeDetector' in window) {
            try {
                const formats = await window.BarcodeDetector.getSupportedFormats?.();
                if (!formats || formats.includes('qr_code')) {
                    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
                    return async (src) => (await det.detect(src))[0]?.rawValue || null;
                }
            } catch { /* pakai jsQR */ }
        }
        const jsQR = await loadJsQR();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        return async (src) => {
            const w = src.videoWidth || src.naturalWidth || src.width;
            const h = src.videoHeight || src.naturalHeight || src.height;
            if (!w || !h) return null;
            const k = Math.min(1, 800 / Math.max(w, h));
            canvas.width = Math.round(w * k);
            canvas.height = Math.round(h * k);
            ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            return jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })?.data || null;
        };
    }

    // Bunyi "bip" pendek + getar sebagai tanda hasil scan (tanpa file suara).
    let audio = null;
    function bunyi(jenis) {
        const salah = jenis === 'err';
        try { navigator.vibrate?.(salah ? [40, 60, 40] : 60); } catch { /* abaikan */ }
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const nada = salah ? [[330, 0, 0.12], [330, 0.17, 0.12]] : [[jenis === 'ok' ? 1320 : 880, 0, 0.09]];
            for (const [f, mulai, lama] of nada) {
                const o = audio.createOscillator();
                const g = audio.createGain();
                o.frequency.value = f;
                g.gain.value = 0.08;
                o.connect(g).connect(audio.destination);
                o.start(audio.currentTime + mulai);
                o.stop(audio.currentTime + mulai + lama);
            }
        } catch { /* browser tanpa suara */ }
    }

    /**
     * Cadangan bila kamera langsung tidak bisa dibuka: ambil foto QR lalu dibaca.
     * opts: { judul, alasan, petunjuk, tombol, onTeks(teks), gagal }
     */
    async function dariFoto(opts = {}) {
        const ok = await window.Att.confirm({
            title: opts.judul || 'Scan lewat foto',
            html: `<p class="att-muted">${esc(opts.alasan || '')}</p>${opts.petunjuk ? `<p class="att-muted">${opts.petunjuk}</p>` : ''}`,
            confirmText: opts.tombol || 'Foto QR', cancelText: 'Tutup',
        });
        if (!ok) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment');
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            try {
                const img = new Image();
                await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Foto tidak bisa dibuka.')); img.src = url; });
                const read = await reader();
                const text = await read(img);
                if (text) {
                    const r = await opts.onTeks?.(text);
                    if (r && typeof r === 'object' && r.pesan) toast(r.pesan, r.jenis === 'ok' ? 'ok' : 'err');
                } else toast(opts.gagal || 'QR belum terbaca. Coba foto lebih dekat & tidak buram.', 'err');
            } catch (err) {
                toast(errMessage(err), 'err');
            } finally { URL.revokeObjectURL(url); }
        }, { once: true });
        input.click();
    }

    /**
     * Kamera di dalam portal.
     * opts.petunjuk   teks di bawah layar ("Arahkan ke stiker QR barang")
     * opts.terus      true = kamera tetap menyala setelah QR terbaca (scan beruntun)
     * opts.onTeks(t)  dipanggil tiap QR terbaca; kembalikan 'stop' untuk menutup kamera,
     *                 atau { pesan, jenis: 'ok'|'err'|'info', sub } untuk ditampilkan (mode terus)
     * opts.onTutup()  dipanggil saat kamera ditutup
     * opts.foto       opsi dariFoto() bila kamera tidak bisa dibuka
     */
    async function kamera(opts = {}) {
        const fallback = (alasan) => { opts.onTutup?.(); return dariFoto({ ...(opts.foto || {}), alasan, onTeks: opts.onTeks }); };
        if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
            return fallback('Browser ini tidak bisa membuka kamera langsung dari portal.');
        }
        const ov = document.createElement('div');
        ov.className = 'inv-cam';
        ov.innerHTML = `<video playsinline muted autoplay></video><div class="inv-cam-frame"></div>
            <div class="inv-cam-bar">${opts.terus ? '<div class="qs-hasil" aria-live="assertive" hidden></div><div class="qs-sub"></div>' : ''}
                <b class="qs-msg" id="gCamMsg">Membuka kamera…</b><button type="button" class="att-btn ${opts.terus ? 'att-btn-primary' : 'att-btn-ghost'}">${opts.terus ? 'Selesai' : 'Batal'}</button></div>`;
        document.body.appendChild(ov);
        let stream = null;
        let done = false;
        const stop = () => {
            if (done) return;
            done = true;
            stream?.getTracks().forEach((t) => t.stop());
            ov.remove();
            opts.onTutup?.();
        };
        ov.querySelector('.inv-cam-bar > button').addEventListener('click', stop);
        let read;
        try {
            [stream, read] = await Promise.all([
                navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
                reader().catch(() => null),
            ]);
        } catch (err) {
            const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
            if (!done) { done = true; ov.remove(); }
            return fallback(denied
                ? 'Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, atau pakai foto.'
                : 'Kamera tidak bisa dibuka di HP ini.');
        }
        if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (!read) { stop(); toast('Pemindai QR gagal dimuat. Periksa koneksi internet.', 'err'); return; }
        const video = ov.querySelector('video');
        video.srcObject = stream;
        try { await video.play(); } catch { /* abaikan */ }
        ov.querySelector('.qs-msg').textContent = opts.petunjuk || 'Arahkan ke QR';
        const hasil = ov.querySelector('.qs-hasil');
        const sub = ov.querySelector('.qs-sub');
        if (sub && opts.sub) sub.textContent = opts.sub;
        let terakhir = '';
        let terakhirAt = 0;
        let sibuk = false;
        const tick = async () => {
            if (done) return;
            try {
                const text = !sibuk && video.readyState >= 2 ? await read(video) : null;
                // Kartu yang sama masih di depan kamera: jangan diproses berulang.
                if (text && (text !== terakhir || Date.now() - terakhirAt > 3000)) {
                    terakhir = text;
                    terakhirAt = Date.now();
                    if (!opts.terus) { stop(); await opts.onTeks?.(text); return; }
                    sibuk = true;
                    let r;
                    try { r = await opts.onTeks?.(text); } catch (err) { r = { pesan: errMessage(err), jenis: 'err' }; }
                    sibuk = false;
                    if (r === 'stop') { stop(); return; }
                    if (r && hasil) {
                        hasil.hidden = false;
                        hasil.className = `qs-hasil ${r.jenis || 'info'}`;
                        hasil.textContent = r.pesan || '';
                        if (r.sub !== undefined && sub) sub.textContent = r.sub;
                        bunyi(r.jenis);
                    }
                } else if (text) terakhirAt = Date.now();
            } catch { sibuk = false; /* frame belum siap */ }
            setTimeout(tick, 200);
        };
        tick();
    }

    window.QrScan = Object.freeze({ reader, kamera, dariFoto });
}());
