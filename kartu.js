// =============================================================================
// Kartu Siswa — desain kartu ber-QR (ukuran KTP/ATM 85,6 × 54 mm) untuk absensi.
//   Kartu.dokumen(data, opts)      HTML cetak: A4 isi 10 kartu, atau 1 kartu/halaman (printer PVC)
//   Kartu.qrIsi(token)             isi QR di kartu ("SDNKB05-<token>")
//   Kartu.tokenDariScan(teks)      token dari hasil scan (null kalau bukan kartu siswa)
//   Kartu.cocokkanFoto(file, siswa) siswa pemilik foto dari nama file (NISN / NIS / nama)
// QR hanya berisi token acak — bukan NISN/NIK — jadi kartu yang hilang tidak
// membocorkan data. Data siswa di kartu: nama, NISN, NIS, kelas, TTL, jenis kelamin.
// Dipakai di browser (window.Kartu) dan di tes Node (module.exports).
// =============================================================================
(function (root) {
    'use strict';
    const isNode = typeof module !== 'undefined' && module.exports;
    const QR = isNode ? require('./qr.js') : root.QR;

    const PREFIX = 'SDNKB05-';
    const SEKOLAH = 'SDN KALIBARU 05 PAGI';
    const WILAYAH = 'Kec. Cilincing · Jakarta Utara';
    const TELEPON = '(021) 44833627';
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const PER_A4 = 10;   // 2 kolom × 5 baris

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const qrIsi = (token) => `${PREFIX}${token}`;

    /** "SDNKB05-1A2B…" / "1a2b…" → "1A2B…" (16 heksa); selain itu null. */
    function tokenDariScan(teks) {
        const t = String(teks ?? '').trim().toUpperCase();
        const m = /^(?:SDNKB05-)?([0-9A-F]{16})$/.exec(t);
        return m ? m[1] : null;
    }

    /** "3 B" → "III.B" */
    function romawi(kelas) {
        const m = /^([1-6])\s*([A-Z])$/.exec(String(kelas || '').trim());
        return m ? `${['I', 'II', 'III', 'IV', 'V', 'VI'][Number(m[1]) - 1]}.${m[2]}` : String(kelas || '');
    }

    function tglPanjang(iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
        const [y, m, d] = String(iso).split('-').map(Number);
        return `${d} ${BULAN[m - 1]} ${y}`;
    }

    /** "Jakarta, 12 Mei 2017" — bagian yang kosong dilewati. */
    function ttl(s) {
        const tempat = String(s.tempat_lahir || '').trim().toLowerCase().replace(/(^|[\s.-])\S/g, (c) => c.toUpperCase());
        return [tempat, tglPanjang(s.tanggal_lahir)].filter(Boolean).join(', ');
    }

    const JK = { L: 'Laki-laki', P: 'Perempuan' };

    // ------------------------------------------------------------------ kartu
    function kartuHtml(s, kelas, foto, logo) {
        const qr = QR.svg(qrIsi(s.token), { size: 120, quiet: 2, title: 'QR absensi' });
        const baris = [
            ['NISN', s.nisn],
            ['NIS', s.nis],
            ['Kelas', kelas ? `${romawi(kelas.nama)}${kelas.tahun_ajaran ? ` · ${kelas.tahun_ajaran}` : ''}` : ''],
            ['TTL', ttl(s)],
            ['L/P', JK[s.jk] || ''],
        ];
        return `<div class="kt">
            <div class="kt-head">${logo ? `<span class="kt-logo"><img src="${esc(logo)}" alt=""></span>` : ''}
                <div class="kt-judul"><b>KARTU PELAJAR</b><span>${SEKOLAH}</span><small>${WILAYAH}</small></div></div>
            <div class="kt-foto">${foto ? `<img src="${esc(foto)}" alt="">` : '<span>Tempel<br>foto<br>3 × 4</span>'}</div>
            <div class="kt-data">
                <div class="kt-nama">${esc(String(s.nama || '').toUpperCase())}</div>
                <table>${baris.map(([k, v]) => `<tr><th>${k}</th><td>${v ? esc(v) : '–'}</td></tr>`).join('')}</table>
            </div>
            <div class="kt-qr">${qr}<small>Scan untuk absen${Number(s.versi) > 1 ? ` · v${esc(s.versi)}` : ''}</small></div>
            <div class="kt-kaki">Jika menemukan kartu ini, mohon kembalikan ke ${SEKOLAH} · Telp. ${TELEPON}</div>
        </div>`;
    }

    const CSS_KARTU = `
.kt { position: relative; width: 85.6mm; height: 54mm; overflow: hidden; background: #fff; color: #111; border-radius: 3mm;
      font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.kt-head { position: absolute; left: 0; top: 0; right: 0; height: 12.6mm; display: flex; align-items: center; gap: 2.2mm; padding: 0 3mm;
           background: linear-gradient(100deg, #9f1239 0%, #be123c 45%, #e11d48 100%); color: #fff; }
.kt-head::after { content: ''; position: absolute; left: 0; right: 0; bottom: -0.9mm; height: 0.9mm; background: #fda4af; }
.kt-logo { width: 9.2mm; height: 9.2mm; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; flex: none; }
.kt-logo img { width: 7.6mm; height: 7.6mm; object-fit: contain; }
.kt-judul { display: flex; flex-direction: column; line-height: 1.12; min-width: 0; }
.kt-judul b { font-size: 9pt; letter-spacing: .09em; }
.kt-judul span { font-size: 6.4pt; font-weight: 700; letter-spacing: .03em; }
.kt-judul small { font-size: 4.8pt; opacity: .9; }
.kt-foto { position: absolute; left: 3mm; top: 15.6mm; width: 21.6mm; height: 28.8mm; border: 0.25mm solid #d4d4d8; border-radius: 1.2mm;
           overflow: hidden; background: #f4f4f5; display: flex; align-items: center; justify-content: center; }
.kt-foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
.kt-foto span { font-size: 5.5pt; color: #a1a1aa; text-align: center; line-height: 1.25; }
.kt-data { position: absolute; left: 27.2mm; top: 15.4mm; right: 23.4mm; }
.kt-nama { font-size: 7.6pt; font-weight: 700; line-height: 1.15; color: #881337; max-height: 2.35em; overflow: hidden;
           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; margin-bottom: 1.1mm; }
.kt-data table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.kt-data th { width: 8.4mm; text-align: left; font-size: 5.5pt; font-weight: 400; color: #52525b; padding: 0.35mm 0; vertical-align: top; }
.kt-data td { font-size: 6pt; font-weight: 700; padding: 0.35mm 0; line-height: 1.15; vertical-align: top; word-break: break-word; }
.kt-qr { position: absolute; right: 2.8mm; top: 15.6mm; width: 18.6mm; text-align: center; }
.kt-qr svg { width: 18.6mm; height: 18.6mm; display: block; }
.kt-qr small { display: block; font-size: 4.4pt; color: #52525b; margin-top: 0.5mm; white-space: nowrap; }
.kt-kaki { position: absolute; left: 0; right: 0; bottom: 0; height: 4.6mm; display: flex; align-items: center; justify-content: center;
           background: #fff1f2; color: #9f1239; font-size: 4.5pt; border-top: 0.2mm solid #fecdd3; padding: 0 2mm; white-space: nowrap; }`;

    /**
     * HTML cetak.
     * data: hasil get_student_cards { kelas, siswa[] }
     * opts.format  'a4' (10 kartu per A4, garis potong) | 'pvc' (1 kartu per halaman 85,6 × 54 mm)
     * opts.fotos   { student_id: dataURL/URL } foto siswa
     * opts.pilih   [student_id] — hanya siswa ini (bawaan: semua)
     * opts.skip    slot A4 yang dilewati di awal (kertas sisa)
     * opts.logo    URL logo sekolah
     */
    function dokumen(data, opts = {}) {
        const format = opts.format === 'pvc' ? 'pvc' : 'a4';
        const fotos = opts.fotos || {};
        const pilih = opts.pilih ? new Set(opts.pilih) : null;
        const siswa = (data.siswa || []).filter((s) => !pilih || pilih.has(s.student_id));
        const kartu = siswa.map((s) => kartuHtml(s, data.kelas, fotos[s.student_id], opts.logo));
        const judul = `Kartu Pelajar ${romawi(data.kelas?.nama || '')}`.trim();
        let halaman;
        let css;
        if (format === 'pvc') {
            css = `@page { size: 85.6mm 54mm; margin: 0; }
html, body { margin: 0; background: #fff; }
.kertas { width: 85.6mm; height: 54mm; overflow: hidden; page-break-after: always; break-after: page; }
.kertas:last-child { page-break-after: auto; break-after: auto; }
.kertas .kt { border-radius: 0; }
@media screen { body { background: #e5e7eb; padding: 12px 0; } .kertas { margin: 0 auto 10px; box-shadow: 0 2px 8px rgba(0,0,0,.18); border-radius: 3mm; } .kertas .kt { border-radius: 3mm; } }`;
            halaman = kartu.map((k) => `<div class="kertas">${k}</div>`);
        } else {
            const skip = Math.max(0, Math.min(PER_A4 - 1, Number(opts.skip) || 0));
            const slot = [...Array(skip).fill(''), ...kartu];
            halaman = [];
            for (let i = 0; i < slot.length; i += PER_A4) {
                const isi = slot.slice(i, i + PER_A4);
                while (isi.length < PER_A4) isi.push('');
                halaman.push(`<div class="kertas">${isi.map((k) => `<div class="slot${k ? '' : ' kosong'}">${k}</div>`).join('')}</div>`);
            }
            css = `@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; background: #fff; }
.kertas { width: 210mm; height: 297mm; padding: 9.5mm 17.9mm; display: grid; grid-template-columns: repeat(2, 85.6mm); grid-auto-rows: 54mm;
          column-gap: 3mm; row-gap: 2mm; align-content: start; page-break-after: always; break-after: page; overflow: hidden; box-sizing: border-box; }
.kertas:last-child { page-break-after: auto; break-after: auto; }
.slot { width: 85.6mm; height: 54mm; outline: 0.2mm dashed #a1a1aa; outline-offset: 0; }
.slot .kt { border-radius: 0; }
.slot.kosong { outline-color: transparent; }
@media screen { body { background: #e5e7eb; padding: 12px 0; } .kertas { background: #fff; margin: 0 auto 12px; box-shadow: 0 2px 10px rgba(0,0,0,.15); } }`;
        }
        return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(judul)}</title>
<style>* { box-sizing: border-box; }
${css}
${CSS_KARTU}
.tbar { position: fixed; top: 8px; right: 8px; display: flex; gap: 8px; z-index: 9; }
.tbar button { font: 600 13px Arial, sans-serif; padding: 8px 14px; border-radius: 8px; border: 1px solid #999; background: #fff; cursor: pointer; }
@media print { .tbar { display: none !important; } }
</style></head><body>
<div class="tbar"><button onclick="window.print()">Cetak</button><button onclick="window.close()">Tutup</button></div>
${halaman.join('\n')}
</body></html>`;
    }

    function namaFile(data, format) {
        const k = romawi(data?.kelas?.nama || '').replace(/[^A-Za-z0-9.]+/g, '_');
        return `Kartu_Pelajar_${k || 'Kelas'}${format === 'pvc' ? '_PVC' : ''}`;
    }

    // ------------------------------------------------------------------ foto massal
    const normNama = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '');

    /**
     * Siswa pemilik foto dari nama file, untuk unggah massal:
     *   1) angka di nama file sama dengan NISN ("0123456789.jpg", "Andi 0123456789.jpg"),
     *      atau nama file diawali NIS ("1234.jpg", "1234 - Andi.jpg")
     *   2) kalau tidak ada, nama file (tanpa ekstensi & angka) sama persis dengan nama siswa.
     * Kembali siswa, atau null kalau tidak cocok / cocok ke lebih dari satu siswa.
     */
    function cocokkanFoto(namaFileFoto, siswa) {
        const dasar = String(namaFileFoto || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '');
        const angka = dasar.match(/\d{4,}/g) || [];
        // NIS (4–6 angka) hanya dari angka di AWAL nama file, supaya "IMG_1234.jpg" kamera tidak salah pasang.
        const depan = /^\s*(\d{4,})/.exec(dasar)?.[1] || '';
        const satu = (list) => (list.length === 1 ? list[0] : null);
        if (angka.length) {
            const hit = siswa.filter((s) => angka.includes(String(s.nisn || '').trim()) || (depan && depan === String(s.nis || '').trim()));
            if (hit.length) return satu(hit);
        }
        const n = normNama(dasar.replace(/\d+/g, ' '));
        if (n.length < 3) return null;
        return satu(siswa.filter((s) => normNama(s.nama) === n));
    }

    const api = { PREFIX, PER_A4, qrIsi, tokenDariScan, romawi, ttl, dokumen, namaFile, cocokkanFoto, kartuHtml };
    if (isNode) module.exports = api;
    else root.Kartu = Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
