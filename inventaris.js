// =============================================================================
// Inventaris — fungsi bersama Panel Admin & Portal Guru (tanpa DOM):
//   label kondisi/jenis, URL QR, membaca baris Excel jadi data barang,
//   template impor, lembar stiker QR A4, dan Excel daftar barang/riwayat.
// =============================================================================
(function (root) {
    'use strict';

    const SITE = 'https://sdnkalibaru05.sch.id';
    const KONDISI = { baik: 'Berfungsi', rusak: 'Rusak' };
    const KONDISI_BADGE = { baik: 'ok', rusak: 'bad' };
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
        ['keterangan_rusak', /kerusakan|ket\.? ?rusak|keterangan rusak/],
        ['kondisi', /kondisi|status/],
        ['jenis_pinjam', /pinjam/],
        ['tahun_perolehan', /tahun/],
        ['jumlah', /jumlah|qty|unit|banyak/],
        ['catatan', /catatan|keterangan|^ket/],
    ];
    const TEMPLATE_HEAD = ['Kode (kosongkan = otomatis)', 'Nama barang *', 'Kategori', 'Merk / Tipe', 'No. Seri', 'Lokasi',
        'Status (Berfungsi / Rusak)', 'Keterangan rusak', 'Jenis pinjam (Harian / Jangka panjang / Tidak dipinjam)', 'Tahun perolehan', 'Jumlah', 'Catatan'];
    const TEMPLATE_CONTOH = [
        ['', 'Laptop Acer Aspire 3', 'Laptop', 'Acer A314', 'NXK6TSN001', 'Ruang TU', 'Berfungsi', '', 'Jangka panjang', 2024, 1, 'Untuk wali kelas'],
        ['SPK', 'Speaker Aktif Portable', 'Speaker', 'Polytron', '', 'Gudang', 'Berfungsi', '', 'Harian', 2023, 2, 'Jumlah 2 → SPK-01 dan SPK-02'],
        ['', 'Proyektor Epson', 'Proyektor', 'EB-X500', '', 'Ruang TU', 'Rusak', 'Lampu proyektor mati', 'Harian', 2022, 1, ''],
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
            widths: [16, 28, 14, 16, 16, 14, 16, 24, 22, 10, 8, 28],
            landscape: true,
        });
    }

    function itemsXlsx(buildXlsx, items, logoPng) {
        const head = ['No', 'Kode', 'Nama barang', 'Kategori', 'Merk / Tipe', 'No. Seri', 'Lokasi', 'Tahun', 'Status barang', 'Keterangan rusak', 'Jenis pinjam', 'Ketersediaan', 'Peminjam', 'Sejak', 'Catatan'];
        const rows = [
            [{ v: 'DAFTAR INVENTARIS BARANG — SDN KALIBARU 05 PAGI', s: 6 }], [], head.map((v) => ({ v, s: 2 })),
            ...items.map((it, i) => [i + 1, it.kode, it.nama, it.kategori || '', it.merk || '', it.nomor_seri || '', it.lokasi || '',
                it.tahun_perolehan || '', KONDISI[it.kondisi] || it.kondisi, it.keterangan_rusak || '', JENIS_PENDEK[it.jenis_pinjam] || it.jenis_pinjam,
                !it.aktif ? 'Diarsipkan' : it.pinjaman ? (it.pinjaman.terlambat ? 'Dipinjam (terlambat)' : 'Dipinjam') : 'Tersedia',
                it.pinjaman?.peminjam || '', it.pinjaman ? tgl(it.pinjaman.sejak) : '', it.catatan || ''].map((v, ci) => ({ v, s: ci === 0 ? 4 : 3 }))),
        ];
        return buildXlsx({ sheet: 'Inventaris', rows, merges: ['A1:O1'], widths: [5, 11, 30, 14, 16, 16, 14, 7, 12, 22, 14, 18, 24, 13, 24], landscape: true, logoPng, logoPx: 40 });
    }

    function historyXlsx(buildXlsx, loans, logoPng) {
        const head = ['No', 'Kode', 'Barang', 'Peminjam', 'Keperluan', 'Dipinjam', 'Rencana kembali', 'Dikembalikan', 'Status saat kembali', 'Catatan pengembalian'];
        const rows = [
            [{ v: 'RIWAYAT PEMINJAMAN BARANG — SDN KALIBARU 05 PAGI', s: 6 }], [], head.map((v) => ({ v, s: 2 })),
            ...loans.map((l, i) => [i + 1, l.kode, l.nama, l.peminjam, l.keperluan || '', tgl(l.sejak, true), l.sampai ? tgl(l.sampai) : '–',
                l.kembali ? tgl(l.kembali, true) : (l.terlambat ? 'BELUM (terlambat)' : 'Belum'), l.kondisi ? KONDISI[l.kondisi] : '', l.catatan || '']
                .map((v, ci) => ({ v, s: ci === 0 ? 4 : 3 }))),
        ];
        return buildXlsx({ sheet: 'Riwayat Pinjam', rows, merges: ['A1:J1'], widths: [5, 11, 28, 24, 24, 16, 14, 18, 14, 24], landscape: true, logoPng, logoPx: 40 });
    }

    // ------------------------------------------------------------------ monitoring
    const dayOf = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso)) : '');
    const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

    /**
     * Ringkasan monitoring dari riwayat pinjam (inv_loan_history) untuk satu bulan.
     * month = 'YYYY-MM'. today = 'YYYY-MM-DD' (Jakarta).
     */
    function monitor(loans, items, month, today) {
        const inMonth = loans.filter((l) => dayOf(l.sejak).startsWith(month));
        const open = loans.filter((l) => !l.kembali);
        const late = open.filter((l) => l.terlambat).map((l) => ({ ...l, telat: daysBetween(l.sampai, today) }))
            .sort((a, b) => b.telat - a.telat);
        const count = (arr, key) => {
            const m = new Map();
            for (const l of arr) m.set(key(l), (m.get(key(l)) || 0) + 1);
            return [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k), 'id'));
        };
        const returned = inMonth.filter((l) => l.kembali);
        const durasi = returned.map((l) => Math.max(0, daysBetween(dayOf(l.sejak), dayOf(l.kembali))));
        const [y, m] = month.split('-').map(Number);
        const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const perHari = Array.from({ length: nDays }, (_, i) => {
            const d = `${month}-${String(i + 1).padStart(2, '0')}`;
            return { d, n: inMonth.filter((l) => dayOf(l.sejak) === d).length };
        });
        const events = [];
        for (const l of loans) {
            if (dayOf(l.sejak) === today) events.push({ t: l.sejak, jenis: 'pinjam', l });
            if (l.kembali && dayOf(l.kembali) === today) events.push({ t: l.kembali, jenis: 'kembali', l });
        }
        events.sort((a, b) => String(b.t).localeCompare(String(a.t)));
        const notes = loans.filter((l) => l.kembali && l.catatan && daysBetween(dayOf(l.kembali), today) <= 30)
            .sort((a, b) => String(b.kembali).localeCompare(String(a.kembali)));
        return {
            total: inMonth.length,
            dikembalikan: returned.length,
            sedang: open.length,
            rataHari: durasi.length ? Math.round((durasi.reduce((a, b) => a + b, 0) / durasi.length) * 10) / 10 : null,
            rusak: items.filter((i) => i.aktif && i.kondisi === 'rusak'),
            late,
            topBarang: count(inMonth, (l) => `${l.nama} (${l.kode})`).slice(0, 5),
            topPeminjam: count(inMonth, (l) => l.peminjam).slice(0, 5),
            perHari,
            events,
            notes,
        };
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

    const api = { SITE, KONDISI, KONDISI_BADGE, JENIS, JENIS_PENDEK, qrUrl, codeFromScan, tgl, dayOf, parseImport, templateXlsx, itemsXlsx, historyXlsx, stickerHtml, monitor, TEMPLATE_HEAD };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Inv = api;
}(typeof window !== 'undefined' ? window : globalThis));
