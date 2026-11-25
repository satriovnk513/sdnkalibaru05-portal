/**
 * PDF langsung unduh — tanpa dialog cetak, tanpa library luar.
 *
 *   PdfUnduh.dariHtml(html, namaFile)   → menyimpan <namaFile>.pdf ke folder Download
 *   PdfUnduh.pasangToolbar(win, opsi)   → toolbar [Cetak] [Download PDF] [Tutup] di jendela pratinjau
 *
 * Cara kerja: dokumen cetak (HTML yang sama dengan versi Cetak) dirender di iframe
 * tersembunyi selebar kertas, digambar ke kanvas lewat SVG <foreignObject>, lalu
 * dipotong per halaman dan dibungkus jadi PDF A4 (satu gambar JPEG per halaman).
 * Ukuran & orientasi kertas dibaca dari aturan @page dokumen itu.
 *
 * Halaman ditentukan dari:
 *   - .page / .kertas (satu lembar masing-masing, seperti daftar hadir & stiker QR),
 *   - pemisah .pb di dalamnya (surat/dokumen bertingkat halaman),
 *   - sisanya dipotong per tinggi kertas.
 */
(function (root) {
    'use strict';
    const MM = 96 / 25.4;                          // px per mm (CSS)
    const PT = 72 / 25.4;                          // pt per mm (PDF)
    const SKALA = 2;                               // ketajaman gambar (≈ 190 dpi)

    /** { w, h, margin:[atas,kanan,bawah,kiri] } dalam mm dari @page pertama di HTML. */
    function ukuranKertas(html) {
        const m = /@page\s*\{([^}]*)\}/i.exec(html);
        const isi = m ? m[1] : '';
        const lanskap = /size\s*:[^;]*landscape/i.test(isi);
        const w = lanskap ? 297 : 210;
        const h = lanskap ? 210 : 297;
        const mg = /margin\s*:\s*([^;]+)/i.exec(isi);
        const angka = mg ? mg[1].trim().split(/\s+/).map((v) => (/mm$/.test(v) ? parseFloat(v) : /cm$/.test(v) ? parseFloat(v) * 10 : /pt$/.test(v) ? parseFloat(v) / PT : parseFloat(v) || 0)) : [10];
        const [a, b = a, c = a, d = b] = angka;
        return { w, h, margin: [a, b, c, d] };
    }

    const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

    async function keDataUrl(src) {
        try {
            const res = await fetch(src, { credentials: 'same-origin' });
            if (!res.ok) return null;
            const blob = await res.blob();
            return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(blob); });
        } catch { return null; }
    }

    /** Render dokumen di iframe tersembunyi; kembali { doc, frame, kertas }. */
    async function siapkan(html) {
        const kertas = ukuranKertas(html);
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        // Lebar iframe = lebar kertas penuh; margin @page ditiru di bawah sebagai padding.
        frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.round(kertas.w * MM)}px;height:${Math.round(kertas.h * MM)}px;border:0;opacity:0;pointer-events:none`;
        document.body.appendChild(frame);
        await new Promise((ok) => { frame.onload = ok; frame.srcdoc = html; });
        const doc = frame.contentDocument;
        // Tampilan layar pratinjau dibuang supaya sama dengan hasil cetak.
        doc.body.classList.remove('lihat');
        const gaya = doc.createElement('style');
        gaya.textContent = `
            .tbar, .pdf-tbar { display: none !important; }
            html, body { margin: 0 !important; background: #fff !important; overflow: visible !important; }
            body { padding: 0 !important; width: ${kertas.w}mm !important; }
            .page { width: ${kertas.w}mm !important; margin: 0 !important; box-shadow: none !important; background: #fff !important; }
            body > .kertas:not([style*="height"]) { box-shadow: none !important; margin: 0 !important; }
            .pb { display: block !important; height: 0 !important; }`;
        doc.head.appendChild(gaya);
        // Lembar "alir" (surat, dokumen tanpa ukuran tetap): margin kiri/kanan @page jadi
        // padding; margin atas/bawah diterapkan saat dipotong per halaman.
        const [, kanan, , kiri] = kertas.margin;
        const tinggiKertasPx = kertas.h * MM;
        const alir = [];
        const kandidat = [...doc.querySelectorAll('body > .kertas')];
        if (!doc.querySelector('.page') && !kandidat.length) alir.push(doc.body);
        for (const k of kandidat) {
            if (Math.abs(k.getBoundingClientRect().height - tinggiKertasPx) < 4) continue;   // lembar berukuran tetap (stiker)
            alir.push(k);
        }
        for (const el of alir) {
            el.dataset.pdfAlir = '1';
            el.style.setProperty('padding', `0 ${kanan}mm 0 ${kiri}mm`, 'important');
            el.style.setProperty('box-sizing', 'border-box', 'important');
            el.style.setProperty('width', `${kertas.w}mm`, 'important');
            el.style.setProperty('max-width', 'none', 'important');
            el.style.setProperty('margin', '0', 'important');
            el.style.setProperty('box-shadow', 'none', 'important');
        }
        // Gambar ditanam sebagai data URI — SVG-sebagai-gambar tidak boleh mengambil berkas luar.
        await Promise.all([...doc.images].map(async (img) => {
            if (!img.src || img.src.startsWith('data:')) return;
            const d = await keDataUrl(img.src);
            if (d) img.src = d; else img.remove();
        }));
        await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((ok) => { img.onload = ok; img.onerror = ok; }))));
        if (doc.fonts?.ready) await doc.fonts.ready;
        await tunggu(50);
        return { doc, frame, kertas };
    }

    /** Seluruh isi body → kanvas (SKALA×). */
    async function gambarDokumen(doc) {
        const lebar = Math.ceil(doc.documentElement.scrollWidth);
        const tinggi = Math.ceil(Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight));
        const salin = doc.documentElement.cloneNode(true);
        salin.querySelectorAll('script').forEach((s) => s.remove());
        // Nilai isian form ikut (tidak tersalin otomatis oleh cloneNode).
        const asli = doc.querySelectorAll('input, textarea, select');
        salin.querySelectorAll('input, textarea, select').forEach((el, i) => {
            const a = asli[i];
            if (!a) return;
            if (el.tagName === 'TEXTAREA') el.textContent = a.value;
            else if (el.tagName === 'SELECT') [...el.options].forEach((o, j) => { if (a.options[j]?.selected) o.setAttribute('selected', ''); });
            else el.setAttribute('value', a.value);
        });
        salin.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        const xhtml = new XMLSerializer().serializeToString(salin);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lebar}" height="${tinggi}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
        const img = new Image();
        img.decoding = 'sync';
        await new Promise((ok, gagal) => {
            img.onload = ok;
            img.onerror = () => gagal(new Error('Gagal menyusun PDF di browser ini. Pakai tombol Cetak lalu pilih "Simpan sebagai PDF".'));
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
        // Batas kanvas browser (±32.000 px); dokumen sangat panjang diturunkan skalanya.
        const skala = Math.min(SKALA, 30000 / tinggi);
        const kanvas = document.createElement('canvas');
        kanvas.width = Math.ceil(lebar * skala);
        kanvas.height = Math.ceil(tinggi * skala);
        const ctx = kanvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, kanvas.width, kanvas.height);
        ctx.drawImage(img, 0, 0, kanvas.width, kanvas.height);
        return { kanvas, skala };
    }

    /**
     * Daftar potongan halaman [{ y, h, dy }] dalam px CSS: ambil isi dari y setinggi h,
     * taruh dy dari atas kertas. Lembar berukuran kertas (.page, stiker) diambil utuh;
     * isi yang mengalir dipotong setinggi area isi dan diberi margin atas, dengan titik
     * potong digeser ke batas baris terdekat supaya teks/baris tabel tidak terbelah.
     */
    function potongan(doc, kertas) {
        const sy = doc.defaultView.scrollY;
        const tinggiKertas = kertas.h * MM;
        const [mAtas, , mBawah] = kertas.margin;
        const tinggiIsi = (kertas.h - mAtas - mBawah) * MM;
        const hasil = [];
        const atasDari = (el) => el.getBoundingClientRect().top + sy;
        const bawahDari = (el) => el.getBoundingClientRect().bottom + sy;

        const lembar = (el) => {
            const y0 = atasDari(el);
            const h0 = el.getBoundingClientRect().height;
            for (let y = y0; y < y0 + h0 - 1; y += tinggiKertas) hasil.push({ y, h: Math.min(tinggiKertas, y0 + h0 - y), dy: 0 });
        };

        const alir = (el) => {
            const y0 = atasDari(el);
            const y1 = bawahDari(el);
            const bawahBaris = [...el.querySelectorAll('tr, p, li, h1, h2, h3, h4, h5, .ttd, img, td > div, .kop, table')]
                .map(bawahDari).filter((v) => v > y0).sort((a, b) => a - b);
            const pisah = [...el.querySelectorAll('.pb')].map(atasDari).filter((v) => v > y0 && v < y1);
            const batas = [y0, ...pisah, y1];
            for (let i = 0; i < batas.length - 1; i++) {
                let y = batas[i];
                const akhir = batas[i + 1];
                while (akhir - y > 2) {
                    let h = Math.min(tinggiIsi, akhir - y);
                    if (y + h < akhir) {
                        // Geser potongan ke batas baris terakhir yang masih muat (minimal separuh halaman).
                        const pas = bawahBaris.filter((v) => v <= y + h && v > y + h * 0.5).pop();
                        if (pas) h = pas - y;
                    }
                    // Sisa kosong (hanya padding) tidak dijadikan halaman sendiri.
                    const adaIsi = bawahBaris.some((v) => v > y + 1 && v <= y + h + 1) || h > 20;
                    if (adaIsi) hasil.push({ y, h, dy: mAtas * MM });
                    y += h;
                }
            }
        };

        const blok = [...doc.querySelectorAll('.page, body > .kertas')];
        if (!blok.length) alir(doc.body);
        else blok.forEach((el) => (el.dataset.pdfAlir ? alir(el) : lembar(el)));
        return hasil;
    }

    /** Potong kanvas → JPEG per halaman. */
    function keJpeg(kanvas, skala, bagian, kertas) {
        const lebarPx = kanvas.width;
        const pxPerMm = lebarPx / kertas.w;          // halaman selebar kertas
        return bagian.map(({ y, h, dy = 0 }) => {
            const c = document.createElement('canvas');
            c.width = lebarPx;
            c.height = Math.round(kertas.h * pxPerMm);
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            const sy = Math.round(y * skala);
            const sh = Math.min(Math.round(h * skala), kanvas.height - sy);
            if (sh > 0) ctx.drawImage(kanvas, 0, sy, lebarPx, sh, 0, Math.round(dy * skala), lebarPx, sh);
            const data = atob(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
            const bytes = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
            return { bytes, w: c.width, h: c.height };
        });
    }

    /** PDF minimal: satu gambar JPEG penuh per halaman. */
    function susunPdf(gambar, kertas) {
        const enc = new TextEncoder();
        const bagian = [];
        const offset = [];
        let panjang = 0;
        const tulis = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; bagian.push(b); panjang += b.length; };
        const obj = (n, isi) => { offset[n] = panjang; tulis(`${n} 0 obj\n`); isi(); tulis('\nendobj\n'); };
        const W = (kertas.w * PT).toFixed(2);
        const H = (kertas.h * PT).toFixed(2);
        const n = gambar.length;
        tulis('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
        obj(1, () => tulis('<< /Type /Catalog /Pages 2 0 R >>'));
        const kids = gambar.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
        obj(2, () => tulis(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
        gambar.forEach((g, i) => {
            const hal = 3 + i * 3;
            const isi = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
            obj(hal, () => tulis(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${hal + 2} 0 R >> >> /Contents ${hal + 1} 0 R >>`));
            obj(hal + 1, () => tulis(`<< /Length ${isi.length} >>\nstream\n${isi}\nendstream`));
            obj(hal + 2, () => {
                tulis(`<< /Type /XObject /Subtype /Image /Width ${g.w} /Height ${g.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${g.bytes.length} >>\nstream\n`);
                tulis(g.bytes);
                tulis('\nendstream');
            });
        });
        const total = 3 + n * 3;
        const xref = panjang;
        tulis(`xref\n0 ${total}\n0000000000 65535 f \n`);
        for (let i = 1; i < total; i++) tulis(`${String(offset[i]).padStart(10, '0')} 00000 n \n`);
        tulis(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
        const out = new Uint8Array(panjang);
        let p = 0;
        for (const b of bagian) { out.set(b, p); p += b.length; }
        return out;
    }

    function simpan(bytes, nama) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = /\.pdf$/i.test(nama) ? nama : `${nama}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    /** Nama file aman dari judul dokumen. */
    function namaDari(html, cadangan = 'Dokumen') {
        const t = /<title>([^<]*)<\/title>/i.exec(html)?.[1] || cadangan;
        const d = document.createElement('textarea');
        d.innerHTML = t;
        return d.value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || cadangan;
    }

    /**
     * Unduh HTML cetak sebagai PDF. namaFile opsional (tanpa .pdf); bawaan dari <title>.
     * Kembali Uint8Array isi PDF (untuk tes).
     */
    async function dariHtml(html, namaFile) {
        const { doc, frame, kertas } = await siapkan(html);
        try {
            const bagian = potongan(doc, kertas);
            const { kanvas, skala } = await gambarDokumen(doc);
            const gambar = keJpeg(kanvas, skala, bagian.length ? bagian : [{ y: 0, h: kertas.h * MM }], kertas);
            const pdf = susunPdf(gambar, kertas);
            simpan(pdf, namaFile || namaDari(html));
            return pdf;
        } finally {
            frame.remove();
        }
    }

    root.PdfUnduh = Object.freeze({ dariHtml, namaDari, ukuranKertas });
}(typeof self !== 'undefined' ? self : this));
