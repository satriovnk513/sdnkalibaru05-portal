// =============================================================================
// Kartu Siswa — kartu pelajar ber-QR (ukuran KTP/ATM 85,6 × 54 mm) untuk absensi.
//   Kartu.dokumen(data, opts)       HTML cetak: A4 isi 10 kartu, atau 1 kartu/halaman (printer PVC)
//   Kartu.kode(token)               kode siswa tercetak & isi QR: "KB05-XXXX-XXXX"
//   Kartu.tokenDariScan(teks)       token dari hasil scan/ketikan (null kalau bukan kartu siswa)
//   Kartu.cocokkanFoto(file, siswa) siswa pemilik foto dari nama file (NISN / NIS / nama)
// Kode siswa = 8 karakter acak (alfabet Crockford: tanpa I, L, O, U) — bukan NISN/NIK,
// jadi kartu yang hilang tidak membocorkan data. Data di kartu: nama, NISN, NIS, kelas,
// TTL, jenis kelamin (tanpa alamat). Tanda tangan kepala sekolah, stempel, logo, dan foto
// latar diatur admin (Pengaturan kartu).
// Dipakai di browser (window.Kartu) dan di tes Node (module.exports).
// =============================================================================
(function (root) {
    'use strict';
    const isNode = typeof module !== 'undefined' && module.exports;
    const QR = isNode ? require('./qr.js') : root.QR;
    const RP = isNode ? require('./rekap-print.js') : root.RekapPrint;

    const PREFIX = 'KB05';
    const SEKOLAH = 'SDN KALIBARU 05 PAGI';
    const ALAMAT = 'Jl. Kalibaru Barat IV No. 60, Cilincing, Jakarta Utara';
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const PER_A4 = 10;   // 2 kolom × 5 baris
    const ALFABET = /^[0-9A-HJKMNP-TV-Z]{8}$/;

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** "7KQ29XHM" → "KB05-7KQ2-9XHM" (dicetak di kartu & isi QR). */
    const kode = (token) => `${PREFIX}-${String(token || '').slice(0, 4)}-${String(token || '').slice(4)}`;

    /** "KB05-7kq2-9xhm" / "7KQ29XHM" / salah ketik O→0, I/L→1 → "7KQ29XHM"; selain itu null. */
    function tokenDariScan(teks) {
        let v = String(teks ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (v.length === 12 && v.startsWith(PREFIX)) v = v.slice(4);
        v = v.replace(/O/g, '0').replace(/[IL]/g, '1');
        return ALFABET.test(v) ? v : null;
    }

    /** "3 B" → "III.B" */
    function romawi(kelas) {
        const m = /^([1-6])\s*([A-Z])$/.exec(String(kelas || '').trim());
        return m ? `${['I', 'II', 'III', 'IV', 'V', 'VI'][Number(m[1]) - 1]}.${m[2]}` : String(kelas || '');
    }

    function tglPanjang(iso) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return '';
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        return `${d} ${BULAN[m - 1]} ${y}`;
    }

    const judulKata = (v) => String(v || '').trim().toLowerCase().replace(/(^|[\s.-])\S/g, (c) => c.toUpperCase());

    /** "Jakarta, 12 Mei 2017" — bagian yang kosong dilewati. */
    const ttl = (s) => [judulKata(s.tempat_lahir), tglPanjang(s.tanggal_lahir)].filter(Boolean).join(', ');

    const JK = { L: 'Laki-laki', P: 'Perempuan' };

    // Hiasan kartu (gelombang merah atas & bawah), satuan 0,1 mm.
    const HIASAN = `<svg class="kt-bg" viewBox="0 0 856 540" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="ktMerah" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="#b91c1c"/><stop offset=".55" stop-color="#dc2626"/><stop offset="1" stop-color="#ef4444"/></linearGradient></defs>
        <path d="M0 0H856V112C720 150 560 104 410 128C270 150 130 172 0 150Z" fill="url(#ktMerah)"/>
        <path d="M0 150C130 172 270 150 410 128C560 104 720 150 856 112V124C720 162 560 118 410 141C270 163 130 186 0 165Z" fill="#facc15"/>
        <path d="M0 0H856V40C700 78 520 30 360 64C230 92 110 96 0 80Z" fill="#fff" opacity=".07"/>
        <path d="M0 503C190 522 410 486 600 504C720 515 800 498 856 504V540H0Z" fill="url(#ktMerah)"/>
        <path d="M0 503C190 522 410 486 600 504C720 515 800 498 856 504" fill="none" stroke="#facc15" stroke-width="6"/>
    </svg>`;

    // ------------------------------------------------------------------ kartu
    /**
     * Satu kartu.
     * s: siswa { nama, nisn, nis, jk, tempat_lahir, tanggal_lahir, token, versi }
     * a: { kelas, foto, logo, latar, ttd, stempel, tempat, tanggal, kepsek_nama, kepsek_nip }
     */
    function kartuHtml(s, a = {}) {
        const kelas = a.kelas;
        const qr = QR.svg(kode(s.token), { size: 120, quiet: 1, title: 'QR absensi' });
        const baris = [
            ['Nama', s.nama, 'kt-v-nama'],
            ['NISN', s.nisn],
            ['NIS', s.nis],
            ['Kelas', kelas ? `${romawi(kelas.nama)}${kelas.tahun_ajaran ? ` (${kelas.tahun_ajaran})` : ''}` : ''],
            ['TTL', ttl(s)],
            ['L/P', JK[s.jk] || ''],
        ];
        const nip = a.kepsek_nip ? RP.labelNip(a.kepsek_nip) : '';
        return `<div class="kt">
            ${HIASAN}
            ${a.latar ? `<img class="kt-latar" src="${esc(a.latar)}" alt="">` : ''}
            ${a.logo ? `<img class="kt-wm" src="${esc(a.logo)}" alt="">` : ''}
            <div class="kt-logo">${a.logo ? `<img src="${esc(a.logo)}" alt="">` : ''}</div>
            <div class="kt-sekolah"><b>${SEKOLAH}</b><span>${ALAMAT}</span></div>
            <div class="kt-pil">KARTU PELAJAR</div>
            <div class="kt-foto">${a.foto ? `<img src="${esc(a.foto)}" alt="">` : '<span>Tempel<br>foto<br>3 × 4</span>'}</div>
            <table class="kt-data">${baris.map(([k, v, cls]) => `<tr><th>${k}</th><td class="kt-ttk">:</td><td${cls ? ` class="${cls}"` : ''}>${v ? esc(v) : '–'}</td></tr>`).join('')}</table>
            <div class="kt-qr">${qr}</div>
            <div class="kt-kode"><small>KODE SISWA</small><b>${esc(kode(s.token))}</b><small>Scan QR untuk absen</small>${Number(s.versi) > 1 ? `<small>Kartu ke-${esc(s.versi)}</small>` : ''}</div>
            <div class="kt-ttd">
                <span>${esc(a.tempat || 'Jakarta')}, ${esc(tglPanjang(a.tanggal))}</span>
                <span>Kepala Sekolah,</span>
                <div class="kt-ttd-img">${a.stempel ? `<img class="kt-stempel" src="${esc(a.stempel)}" alt="">` : ''}${a.ttd ? `<img class="kt-ttd-gbr" src="${esc(a.ttd)}" alt="">` : ''}</div>
                <b>${esc(a.kepsek_nama || '')}</b>
                ${nip ? `<span class="kt-nip">${esc(nip)}</span>` : ''}
            </div>
            <div class="kt-kaki">Kartu ini milik ${SEKOLAH} · Jika menemukan, mohon kembalikan ke sekolah</div>
        </div>`;
    }

    const CSS_KARTU = `
.kt { position: relative; width: 85.6mm; height: 54mm; overflow: hidden; background: linear-gradient(180deg, #fff 0%, #f8fafc 60%, #eef2f7 100%);
      color: #111827; border-radius: 3mm; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.kt > * { position: absolute; }
.kt-bg { left: 0; top: 0; width: 85.6mm; height: 54mm; z-index: 0; }
.kt-latar { left: 40mm; top: 14mm; width: 45.6mm; height: 36.5mm; object-fit: cover; opacity: .22; z-index: 0;
            -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 45%); mask-image: linear-gradient(90deg, transparent 0%, #000 45%); }
.kt-wm { left: 39mm; top: 18.5mm; width: 23mm; height: 23mm; object-fit: contain; opacity: .06; z-index: 0; }
.kt-logo { left: 2.4mm; top: 1.3mm; width: 12.6mm; height: 12.6mm; border-radius: 50%; background: #fff; z-index: 2; overflow: hidden;
           box-shadow: 0 0 0 .5mm rgba(255,255,255,.55), 0 .4mm 1.2mm rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center; }
.kt-logo img { width: 9.6mm; height: 9.6mm; object-fit: contain; }
.kt-sekolah { left: 16mm; right: 2mm; top: 1.4mm; text-align: center; color: #fff; z-index: 2; line-height: 1.1; }
.kt-sekolah b { display: block; font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; font-size: 10.6pt; letter-spacing: .01em; text-shadow: 0 .25mm .5mm rgba(0,0,0,.25); }
.kt-sekolah span { display: block; font-size: 5.3pt; font-weight: 700; margin-top: .5mm; }
.kt-pil { left: 23.5mm; top: 12.6mm; width: 47mm; height: 5.6mm; border-radius: 3mm; z-index: 3; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(180deg, #2563eb, #1d4ed8); color: #fff; border: .5mm solid #fff; box-shadow: 0 .4mm 1mm rgba(0,0,0,.2);
          font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; font-size: 9.6pt; letter-spacing: .09em; }
.kt-foto { left: 3mm; top: 19.2mm; width: 18mm; height: 24mm; border: .55mm solid #18181b; border-radius: 1.3mm; overflow: hidden; z-index: 2;
           background: #f4f4f5; display: flex; align-items: center; justify-content: center; }
.kt-foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
.kt-foto span { font-size: 5.4pt; color: #a1a1aa; text-align: center; line-height: 1.25; }
.kt-data { left: 23.4mm; top: 19.4mm; right: 3mm; border-collapse: collapse; z-index: 2; table-layout: fixed; width: 59.2mm; }
.kt-data th { width: 8.6mm; text-align: left; font-size: 6.1pt; font-weight: 700; padding: .25mm 0; vertical-align: top; }
.kt-data .kt-ttk { width: 1.8mm; font-size: 6.1pt; font-weight: 700; padding: .25mm 0; vertical-align: top; }
.kt-data td { font-size: 6.1pt; font-weight: 600; padding: .25mm 0; line-height: 1.18; vertical-align: top; word-break: break-word; }
.kt-data td.kt-v-nama { font-weight: 800; font-size: 6.4pt; }
.kt-qr { left: 23.2mm; top: 40.1mm; width: 11.4mm; height: 11.4mm; background: #fff; border-radius: .8mm; padding: .3mm; z-index: 3; box-shadow: 0 0 0 .2mm #d4d4d8; }
.kt-qr svg { width: 10.8mm; height: 10.8mm; display: block; }
.kt-kode { left: 35.6mm; top: 41mm; width: 18.6mm; overflow: hidden; z-index: 3; display: flex; flex-direction: column; line-height: 1.2; }
.kt-kode small { font-size: 4.2pt; color: #4b5563; font-weight: 700; letter-spacing: .04em; white-space: nowrap; }
.kt-kode b { font-family: Consolas, 'Courier New', monospace; font-size: 6.1pt; font-weight: 800; letter-spacing: .02em; color: #111827; white-space: nowrap; }
.kt-ttd { left: 54.6mm; right: 1.8mm; top: 36.4mm; z-index: 3; text-align: center; display: flex; flex-direction: column; align-items: center; line-height: 1.16; font-size: 4.8pt; font-weight: 600; }
.kt-ttd-img { position: relative; width: 100%; height: 5.8mm; display: flex; align-items: center; justify-content: center; }
.kt-ttd-gbr { max-width: 22mm; max-height: 5.8mm; object-fit: contain; position: relative; z-index: 2; }
.kt-stempel { position: absolute; left: .2mm; top: -2.2mm; width: 10.4mm; height: 10.4mm; object-fit: contain; opacity: .85; transform: rotate(-8deg); z-index: 1; mix-blend-mode: multiply; }
.kt-ttd b { font-size: 5pt; font-weight: 800; text-decoration: underline; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.kt-nip { font-size: 4.6pt; white-space: nowrap; }
.kt-kaki { left: 0; right: 0; bottom: .35mm; text-align: center; font-size: 3.9pt; font-weight: 700; color: #fff; z-index: 3; white-space: nowrap; letter-spacing: .02em; }`;

    /**
     * HTML cetak.
     * data: hasil get_student_cards { kelas, siswa[], pengaturan }
     * opts.format     'a4' (10 kartu per A4, garis potong) | 'pvc' (1 kartu per halaman 85,6 × 54 mm)
     * opts.fotos      { student_id: URL/dataURL } foto siswa
     * opts.aset       { logo, latar, ttd, stempel } URL/dataURL gambar pengaturan
     * opts.tanggal    tanggal TTD bila pengaturan kosong (ISO; bawaan: hari ini)
     * opts.pilih      [student_id] — hanya siswa ini (bawaan: semua)
     * opts.skip       slot A4 yang dilewati di awal (kertas sisa)
     * opts.pratinjau  true = tampilan di layar (tanpa toolbar, latar transparan)
     */
    function dokumen(data, opts = {}) {
        const format = opts.format === 'pvc' ? 'pvc' : 'a4';
        const fotos = opts.fotos || {};
        const aset = opts.aset || {};
        const p = data.pengaturan || {};
        const kd = p.kepsek_default || {};
        const pakaiNamaSendiri = Boolean(p.kepsek_nama);
        const umum = {
            kelas: data.kelas,
            logo: aset.logo || opts.logoBawaan || '',
            latar: aset.latar || '',
            ttd: aset.ttd || '',
            stempel: aset.stempel || '',
            tempat: p.tempat || 'Jakarta',
            tanggal: p.tanggal_ttd || opts.tanggal || new Date().toISOString().slice(0, 10),
            kepsek_nama: pakaiNamaSendiri ? p.kepsek_nama : (kd.nama || ''),
            kepsek_nip: p.kepsek_nip || (pakaiNamaSendiri ? '' : kd.nip || ''),
        };
        const pilih = opts.pilih ? new Set(opts.pilih) : null;
        const siswa = (data.siswa || []).filter((s) => !pilih || pilih.has(s.student_id));
        const kartu = siswa.map((s) => kartuHtml(s, { ...umum, foto: fotos[s.student_id] }));
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
        const pratinjau = opts.pratinjau ? `
html, body { background: transparent !important; padding: 0 !important; overflow: hidden; }
.kertas { margin: 0 !important; box-shadow: 0 1px 6px rgba(0,0,0,.2) !important; }
.tbar { display: none !important; }` : '';
        return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(judul)}</title>
<style>* { box-sizing: border-box; }
${css}
${CSS_KARTU}
.tbar { position: fixed; top: 8px; right: 8px; display: flex; gap: 8px; z-index: 9; }
.tbar button { font: 600 13px Arial, sans-serif; padding: 8px 14px; border-radius: 8px; border: 1px solid #999; background: #fff; cursor: pointer; }
@media print { .tbar { display: none !important; } }${pratinjau}
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

    const api = { PREFIX, PER_A4, kode, qrIsi: kode, tokenDariScan, romawi, ttl, tglPanjang, dokumen, namaFile, cocokkanFoto, kartuHtml };
    if (isNode) module.exports = api;
    else root.Kartu = Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
