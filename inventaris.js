// =============================================================================
// Inventaris — fungsi bersama Panel Admin & Portal Guru (tanpa DOM):
//   label kondisi/jenis, URL QR, membaca baris Excel jadi data barang,
//   template impor, lembar stiker QR A4, dan Excel daftar barang/riwayat.
// =============================================================================
(function (root) {
    'use strict';

    const SITE = 'https://sdnkalibaru05.sch.id';
    const KONDISI = { baik: 'Baik', rusak_ringan: 'Rusak ringan', rusak_berat: 'Rusak berat' };
    const KONDISI_BADGE = { baik: 'ok', rusak_ringan: 'warn', rusak_berat: 'bad' };
    const JENIS = { harian: 'Harian (sekali pakai)', jangka_panjang: 'Jangka panjang', tidak_dipinjam: 'Tidak dipinjam' };
    const JENIS_PENDEK = { harian: 'Harian', jangka_panjang: 'Jangka panjang', tidak_dipinjam: 'Tidak dipinjam' };
    const BULAN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Alamat yang dibuka kamera HP saat stiker di-scan. */
    const qrUrl = (token) => `${SITE}/guru#/pinjam/${encodeURIComponent(token)}`;

    /** Kode/token dari teks hasil scan (URL stiker, atau kode yang diketik). */
    function codeFromScan(text) {
        const s = String(text || '').trim();
        const m = /#\/pinjam\/([^/?#\s]+)/.exec(s);
        return m ? decodeURIComponent(m[1]) : s;
    }

    /** "17 Nov 2026" atau "17 Nov 2026 07.15" (zona Jakarta). */
    function tgl(v, withTime = false) {
        if (!v) return '';
        const s = String(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [y, m, d] = s.split('-').map(Number);
            return `${d} ${BULAN3[m - 1]} ${y}`;
        }
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return s;
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d).map((p) => [p.type, p.value]));
        const base = `${Number(parts.day)} ${BULAN3[Number(parts.month) - 1]} ${parts.year}`;
        return withTime ? `${base} ${parts.hour}.${parts.minute}` : base;
    }

    // ------------------------------------------------------------------ impor Excel
    const COLS = [
        ['kode', /^kode/],
        ['nama', /nama/],
        ['kategori', /kategori|jenis barang|golongan/],
        ['merk', /merk|merek|tipe|type|model/],
        ['nomor_seri', /seri|serial|s\/n/],
        ['lokasi', /lokasi|ruang|tempat/],
        ['kondisi', /kondisi/],
        ['jenis_pinjam', /pinjam/],
        ['tahun_perolehan', /tahun/],
        ['jumlah', /jumlah|qty|unit|banyak/],
        ['catatan', /catatan|keterangan|^ket/],
    ];
    const TEMPLATE_HEAD = ['Kode (kosongkan = otomatis)', 'Nama barang *', 'Kategori', 'Merk / Tipe', 'No. Seri', 'Lokasi',
        'Kondisi (Baik / Rusak ringan / Rusak berat)', 'Jenis pinjam (Harian / Jangka panjang / Tidak dipinjam)', 'Tahun perolehan', 'Jumlah', 'Catatan'];
    const TEMPLATE_CONTOH = [
        ['', 'Laptop Acer Aspire 3', 'Laptop', 'Acer A314', 'NXK6TSN001', 'Ruang TU', 'Baik', 'Jangka panjang', 2024, 1, 'Untuk wali kelas'],
        ['SPK', 'Speaker Aktif Portable', 'Speaker', 'Polytron', '', 'Gudang', 'Baik', 'Harian', 2023, 2, 'Jumlah 2 → SPK-01 dan SPK-02'],
        ['', 'Proyektor Epson', 'Proyektor', 'EB-X500', '', 'Ruang TU', 'Rusak ringan', 'Harian', 2022, 1, ''],
    ];

    /**
     * rows (array of array dari XlsxRead) → { items: [{baris, ...field}], errors: [teks], header: bool }
     * Baris judul dicari otomatis (baris pertama yang punya kolom "nama").
     */
    function parseImport(rows) {
        const headIdx = rows.findIndex((r) => (r || []).some((c) => /nama/i.test(String(c || ''))));
        if (headIdx < 0) return { items: [], errors: ['Kolom "Nama barang" tidak ditemukan. Pakai template impor.'] };
        const head = rows[headIdx].map((h) => String(h || '').toLowerCase().trim());
        const map = {};
        head.forEach((h, i) => {
            if (!h) return;
            const hit = COLS.find(([key, re]) => !(key in map) && re.test(h));
            if (hit) map[hit[0]] = i;
        });
        const items = [];
        const errors = [];
        for (let i = headIdx + 1; i < rows.length; i++) {
            const r = rows[i] || [];
            if (!r.some((c) => String(c ?? '').trim())) continue;
            const it = { baris: i + 1 };
            for (const [key] of COLS) if (key in map) it[key] = String(r[map[key]] ?? '').trim();
            if (!it.nama) { errors.push(`Baris ${i + 1}: nama barang kosong.`); continue; }
            if (it.jumlah && !/^\d+$/.test(it.jumlah.replace(/\.0+$/, ''))) { errors.push(`Baris ${i + 1}: jumlah "${it.jumlah}" bukan angka.`); continue; }
            if (it.jumlah) it.jumlah = Number(it.jumlah.replace(/\.0+$/, ''));
            if (it.tahun_perolehan) it.tahun_perolehan = it.tahun_perolehan.replace(/\.0+$/, '');
            items.push(it);
        }
        if (!items.length && !errors.length) errors.push('Tidak ada baris barang di bawah judul kolom.');
        return { items, errors };
    }

    function templateXlsx(buildXlsx) {
        return buildXlsx({
            sheet: 'Impor Inventaris',
            rows: [TEMPLATE_HEAD.map((v) => ({ v, s: 2 })), ...TEMPLATE_CONTOH.map((r) => r.map((v) => ({ v, s: 3 })))],
            widths: [16, 28, 14, 16, 16, 14, 18, 22, 10, 8, 28],
            landscape: true,
        });
    }

    function itemsXlsx(buildXlsx, items, logoPng) {
        const head = ['No', 'Kode', 'Nama barang', 'Kategori', 'Merk / Tipe', 'No. Seri', 'Lokasi', 'Tahun', 'Kondisi', 'Jenis pinjam', 'Status', 'Peminjam', 'Sejak', 'Catatan'];
        const rows = [
            [{ v: 'DAFTAR INVENTARIS BARANG — SDN KALIBARU 05 PAGI', s: 6 }], [], head.map((v) => ({ v, s: 2 })),
            ...items.map((it, i) => [i + 1, it.kode, it.nama, it.kategori || '', it.merk || '', it.nomor_seri || '', it.lokasi || '',
                it.tahun_perolehan || '', KONDISI[it.kondisi] || it.kondisi, JENIS_PENDEK[it.jenis_pinjam] || it.jenis_pinjam,
                !it.aktif ? 'Diarsipkan' : it.pinjaman ? (it.pinjaman.terlambat ? 'Dipinjam (terlambat)' : 'Dipinjam') : 'Tersedia',
                it.pinjaman?.peminjam || '', it.pinjaman ? tgl(it.pinjaman.sejak) : '', it.catatan || ''].map((v, ci) => ({ v, s: ci === 0 ? 4 : 3 }))),
        ];
        return buildXlsx({ sheet: 'Inventaris', rows, merges: ['A1:N1'], widths: [5, 11, 30, 14, 16, 16, 14, 7, 12, 14, 18, 24, 13, 24], landscape: true, logoPng, logoPx: 40 });
    }

    function historyXlsx(buildXlsx, loans, logoPng) {
        const head = ['No', 'Kode', 'Barang', 'Peminjam', 'Keperluan', 'Dipinjam', 'Rencana kembali', 'Dikembalikan', 'Kondisi kembali', 'Catatan'];
        const rows = [
            [{ v: 'RIWAYAT PEMINJAMAN BARANG — SDN KALIBARU 05 PAGI', s: 6 }], [], head.map((v) => ({ v, s: 2 })),
            ...loans.map((l, i) => [i + 1, l.kode, l.nama, l.peminjam, l.keperluan || '', tgl(l.sejak, true), l.sampai ? tgl(l.sampai) : '–',
                l.kembali ? tgl(l.kembali, true) : (l.terlambat ? 'BELUM (terlambat)' : 'Belum'), l.kondisi ? KONDISI[l.kondisi] : '', l.catatan || '']
                .map((v, ci) => ({ v, s: ci === 0 ? 4 : 3 }))),
        ];
        return buildXlsx({ sheet: 'Riwayat Pinjam', rows, merges: ['A1:J1'], widths: [5, 11, 28, 24, 24, 16, 14, 18, 14, 24], landscape: true, logoPng, logoPx: 40 });
    }

    // ------------------------------------------------------------------ stiker QR
    /**
     * Lembar A4 berisi stiker 3 × 8 (24 per halaman, ±70 × 37 mm).
     * qr(text) → string <svg>. Mulai dari slot ke-`skip` (untuk kertas label yang sudah terpakai sebagian).
     */
    function stickerHtml(items, { qr, skip = 0, logo = '' } = {}) {
        const PER = 24;
        const slots = [...Array(Math.max(0, Math.min(PER - 1, skip))).fill(null), ...items];
        const pages = [];
        for (let i = 0; i < slots.length; i += PER) pages.push(slots.slice(i, i + PER));
        const cell = (it) => (it ? `<div class="st">
                <div class="qr">${qr(qrUrl(it.qr_token))}</div>
                <div class="tx">
                    <div class="sk">${logo ? `<img src="${esc(logo)}" alt="">` : ''}SDN KALIBARU 05 PAGI</div>
                    <div class="nm">${esc(it.nama)}</div>
                    <div class="kd">${esc(it.kode)}</div>
                    <div class="ht">Scan untuk pinjam / kembalikan</div>
                </div></div>` : '<div class="st kosong"></div>');
        return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Stiker QR Inventaris</title>
<style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.kertas { width: 210mm; height: 297mm; padding: 4.5mm 0; display: grid; grid-template-columns: repeat(3, 70mm); grid-template-rows: repeat(8, 36mm); page-break-after: always; break-after: page; overflow: hidden; }
.kertas:last-child { page-break-after: auto; break-after: auto; }
.st { border: 0.2mm dashed #bbb; display: flex; align-items: center; gap: 2mm; padding: 2mm 2.5mm; overflow: hidden; }
.st.kosong { border-color: transparent; }
.qr { width: 30mm; height: 30mm; flex: none; }
.qr svg { width: 100%; height: 100%; display: block; }
.tx { min-width: 0; display: flex; flex-direction: column; gap: 1mm; }
.sk { font-size: 5.5pt; font-weight: 700; letter-spacing: .02em; display: flex; align-items: center; gap: 1mm; color: #333; }
.sk img { width: 3.6mm; height: 3.6mm; object-fit: contain; }
.nm { font-size: 8.5pt; font-weight: 700; line-height: 1.15; max-height: 3.5em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-word; }
.kd { font: 700 11pt/1 'Courier New', monospace; letter-spacing: .03em; }
.ht { font-size: 5.5pt; color: #444; }
@media screen { body { background: #e5e7eb; } .kertas { background: #fff; margin: 10px auto; box-shadow: 0 2px 10px rgba(0,0,0,.15); } }
</style></head><body>${pages.map((p) => `<div class="kertas">${p.map(cell).join('')}</div>`).join('')}</body></html>`;
    }

    const api = { SITE, KONDISI, KONDISI_BADGE, JENIS, JENIS_PENDEK, qrUrl, codeFromScan, tgl, parseImport, templateXlsx, itemsXlsx, historyXlsx, stickerHtml, TEMPLATE_HEAD };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Inv = api;
}(typeof window !== 'undefined' ? window : globalThis));
