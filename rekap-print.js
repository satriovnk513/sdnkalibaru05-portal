// =============================================================================
// Rekap absensi — cetak (format daftar hadir kertas SDN Kalibaru 05) dan Excel.
//   RekapPrint.monthlyHtml(recap, header, opts)   → dokumen HTML siap cetak
//   RekapPrint.semesterHtml(recap, header, opts)
//   RekapPrint.monthlyXlsx(...) / semesterXlsx(...) → Uint8Array (.xlsx asli)
//   RekapPrint.print(html) / RekapPrint.download(bytes, filename)
// Tanpa library: .xlsx ditulis langsung (zip "store" + SpreadsheetML).
// Dipakai di browser (window.RekapPrint) dan di tes Node (module.exports).
// =============================================================================
(function (root) {
    'use strict';

    const SCHOOL = 'SDN KALIBARU 05 PAGI';
    const CITY = 'Jakarta';
    // Logo kecil di pojok kiri atas dokumen cetak & Excel (file di situs sendiri).
    const LOGO = (root.location && /^https?:/.test(root.location.origin || '') ? root.location.origin : '') + '/logo-cetak.png';
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    function esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function romawi(kelas) {
        const m = String(kelas || '').match(/^([1-6])\s*([A-Z])$/);
        return m ? `${['I', 'II', 'III', 'IV', 'V', 'VI'][Number(m[1]) - 1]}.${m[2]}` : String(kelas || '');
    }

    function tglPanjang(iso) {
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        return `${d} ${BULAN[m - 1]} ${y}`;
    }

    /** "LILIS KHOLISOH, S.Pd.SD": nama kapital, gelar dipertahankan. */
    function namaTtd(nama) {
        const s = String(nama || '').trim();
        if (!s) return '';
        const i = s.indexOf(',');
        return i < 0 ? s.toUpperCase() : `${s.slice(0, i).toUpperCase()}${s.slice(i)}`;
    }

    function tpLabel(ta) {
        return String(ta || '').replace('/', ' / ');
    }

    function counts(statusMap) {
        const t = { H: 0, S: 0, I: 0, A: 0, D: 0 };
        for (const v of Object.values(statusMap || {})) if (t[v] !== undefined) t[v] += 1;
        return t;
    }

    /** % kehadiran. Dispensasi (kegiatan resmi sekolah) dihitung hadir. */
    function pct(t) {
        const hadir = (t.H || 0) + (t.D || 0);
        const base = hadir + (t.S || 0) + (t.I || 0) + (t.A || 0);
        return base ? Math.round((hadir / base) * 1000) / 10 : null;
    }

    /**
     * Tinggi baris & ukuran huruf supaya kop + tabel + tanda tangan muat di SATU
     * halaman A4 landscape (tinggi isi 194 mm), berapa pun jumlah siswanya.
     * budget = ruang (mm) untuk seluruh baris tabel. Di atas ±55 siswa dibiarkan
     * pindah halaman daripada hurufnya tidak terbaca.
     */
    function fit(rowCount, budget, maxH) {
        const h = Math.max(2.7, Math.min(maxH, budget / Math.max(rowCount, 1) - 0.3));
        const fs = Math.max(5, Math.min(8, h * 1.85));
        return `--rh:${h.toFixed(2)}mm;--fs:${fs.toFixed(2)}pt`;
    }

    /**
     * Nomor pegawai di tanda tangan: "NIP. 1978…" untuk NIP, "NUPTK. 7448…" untuk NUPTK.
     * Data staf menyimpan nomornya berawalan jenisnya ("NIP. …" / "NUPTK. …"); sebagian
     * fungsi server sudah membuang "NIP." tapi membiarkan "NUPTK.", jadi jenisnya dibaca
     * dari awalan dan bawaannya NIP. Kosong / "-" → "NIP. -".
     */
    function pisahNip(v) {
        const s = String(v ?? '').trim();
        const m = /^(NIP|NUPTK|NRK|NIK|NRPTK)\b\.?\s*:?\s*(.*)$/i.exec(s);
        const jenis = m ? m[1].toUpperCase() : 'NIP';
        const nomor = (m ? m[2] : s).trim();
        return { jenis, nomor: nomor && nomor !== '-' ? nomor : '-' };
    }
    function labelNip(v) {
        const { jenis, nomor } = pisahNip(v);
        return `${jenis}. ${nomor}`;
    }

    function pickWali(header, posisi) {
        const w = header?.wali || [];
        return w.find((x) => x.posisi === posisi) || w.find((x) => x.posisi === 1) || null;
    }

    function genderTotals(siswa) {
        let L = 0;
        let P = 0;
        for (const s of siswa || []) { if (s.jk === 'L') L += 1; else if (s.jk === 'P') P += 1; }
        return { L, P };
    }

    // ------------------------------------------------------------------ HTML cetak
    const PRINT_CSS = `
        @page { size: A4 landscape; margin: 8mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 8pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .kop { display: flex; align-items: center; gap: 3mm; margin-bottom: 1.5mm; height: 13mm; }
        .kop img { width: 12mm; height: 12mm; object-fit: contain; flex: none; }
        .kop .t { flex: 1; line-height: 1.15; }
        .kop .t div:nth-child(1), .kop .t div:nth-child(2) { font-size: 11pt; letter-spacing: .4px; }
        .kop .t div:nth-child(3) { font-size: 8pt; font-weight: bold; }
        .kop .k { font-size: 12pt; font-weight: bold; align-self: center; white-space: nowrap; }
        .sub { margin: 0 0 1mm; height: 3.5mm; line-height: 3.5mm; font-size: 7.5pt; }
        table { border-collapse: collapse; width: 100%; table-layout: fixed; }
        th, td { border: 1px solid #000; padding: 0 2px; height: var(--rh, 4.3mm); font-size: var(--fs, 8pt); line-height: 1; text-align: center; overflow: hidden; white-space: nowrap; }
        th { font-weight: bold; }
        td.nm { text-align: left; text-overflow: ellipsis; }
        .libur { background: #ff0000 !important; }
        td.h { font-weight: 700; font-family: 'Segoe UI Symbol', 'DejaVu Sans', 'Arial Unicode MS', Arial, sans-serif; }
        .ket { font-size: 6.5pt; line-height: 3mm; height: 3mm; margin-top: 0.5mm; overflow: hidden; white-space: nowrap; }
        .foot { display: flex; justify-content: space-between; margin-top: 1mm; font-size: 8pt; line-height: 3.4mm; break-inside: avoid; page-break-inside: avoid; }
        .ttd { width: 52mm; white-space: nowrap; }
        .ttd .sp { height: 11mm; }
        .ttd b { text-decoration: underline; }
        .tbar { position: fixed; top: 8px; right: 8px; display: flex; gap: 8px; }
        .tbar button { font: 600 13px Arial; padding: 8px 14px; border-radius: 8px; border: 1px solid #999; background: #fff; cursor: pointer; }
        @media screen { body { padding: 56px 16px 16px; background: #f1f5f9; overflow-x: auto; } .page { background: #fff; padding: 8mm; box-shadow: 0 2px 12px rgba(0,0,0,.15); width: 297mm; margin: 0 auto; } }
        @media print { .tbar { display: none; } html, body { width: auto; } }
    `;

    function kopHtml(title, header, right) {
        return `<div class="kop">
            <img src="${LOGO}" alt="" onerror="this.style.visibility='hidden'">
            <div class="t"><div>${esc(title)}</div><div>TAHUN PELAJARAN ${esc(tpLabel(header.tahun_ajaran))}</div><div>${SCHOOL}</div></div>
            <div class="k">${esc(right)}</div>
        </div>`;
    }

    /** Tanda hadir di daftar hadir & Excel. */
    const HADIR = '✓';

    /** Tanggal terakhir bulan itu (ISO), mis. 2026-11 → 2026-11-30, 2027-02 → 2027-02-28. */
    function akhirBulan(tahun, bulan) {
        const d = new Date(Date.UTC(Number(tahun), Number(bulan), 0)).getUTCDate();
        return `${tahun}-${String(bulan).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    /** Tanggal tanda tangan rekap semester: ganjil 31 Desember, genap 30 Juni (tahun sesuai semester). */
    function ttdSemester(recap) {
        const y = Number(String(recap.mulai).slice(0, 4));
        return recap.semester === 1 ? `${y}-12-31` : `${y}-06-30`;
    }

    function ttdHtml(header, opts, tanggal) {
        const kepsek = header.kepala_sekolah || {};
        const wali = pickWali(header, opts.wali || 1) || {};
        const nip = (v) => (opts.showNip !== false ? `<div>${esc(labelNip(v))}</div>` : '');
        return `<div class="ttd"><div>Mengetahui,</div><div>Kepala Sekolah</div><div class="sp"></div>
                <b>${esc(namaTtd(kepsek.nama) || '........................')}</b>${nip(kepsek.nip)}</div>
            <div class="ttd"><div>${CITY}, ${esc(tglPanjang(tanggal))}</div><div>Wali Kelas</div><div class="sp"></div>
                <b>${esc(namaTtd(wali.nama) || '........................')}</b>${nip(wali.nip)}</div>`;
    }

    function wrapDoc(title, body, vars = '') {
        return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=1123"><title>${esc(title)}</title>
            <style>${PRINT_CSS}</style></head><body>
            <div class="tbar"><button onclick="window.print()">Cetak / Simpan PDF</button><button onclick="window.close()">Tutup</button></div>
            <div class="page" style="${vars}">${body}</div>
            </body></html>`;
    }

    /**
     * recap: hasil get_class_month_recap; header: hasil get_class_report_header.
     * opts: { wali: 1|2, showNip: bool, blank: bool }
     */
    function monthlyHtml(recap, header, opts = {}) {
        const days = recap.hari || [];
        const blank = Boolean(opts.blank);
        const siswa = recap.siswa || [];
        const g = genderTotals(siswa);
        const head2 = days.map((d) => `<th class="${d.libur ? 'libur' : ''}">${Number(d.tanggal.slice(8))}</th>`).join('');
        const rows = siswa.map((s) => {
            const t = blank ? { S: '', I: '', A: '' } : counts(s.status);
            const cells = days.map((d) => {
                const v = blank ? '' : (s.status || {})[d.tanggal];
                return `<td class="${d.libur ? 'libur' : (v === 'H' ? 'h' : '')}">${d.libur || !v ? '' : (v === 'H' ? HADIR : v)}</td>`;
            }).join('');
            return `<tr><td>${esc(s.no)}</td><td>${esc(s.nis || '')}</td><td>${esc(s.nisn || '')}</td><td class="nm">${esc(String(s.nama || '').toUpperCase())}</td><td>${esc(s.jk || '')}</td>${cells}<td>${t.S || (blank ? '' : 0)}</td><td>${t.I || (blank ? '' : 0)}</td><td>${t.A || (blank ? '' : 0)}</td></tr>`;
        }).join('');
        const last = akhirBulan(recap.tahun, recap.bulan);
        const dayW = days.length ? `calc((100% - 92mm - 18mm) / ${days.length})` : 'auto';
        const body = `${kopHtml('DAFTAR HADIR SISWA', header, `KELAS : ${romawi(header.kelas || recap.kelas)}`)}
            <table>
                <colgroup><col style="width:8mm"><col style="width:12mm"><col style="width:17mm"><col style="width:48mm"><col style="width:7mm">${days.map(() => `<col style="width:${dayW}">`).join('')}<col style="width:6mm"><col style="width:6mm"><col style="width:6mm"></colgroup>
                <thead>
                    <tr><th colspan="3">NO</th><th rowspan="2">NAMA</th><th rowspan="2">L/P</th><th colspan="${days.length}">BULAN : ${esc(BULAN[recap.bulan - 1].toUpperCase())} ${esc(recap.tahun)}</th><th colspan="3">JUMLAH</th></tr>
                    <tr><th>ABS</th><th>NIS</th><th>NISN</th>${head2}<th>S</th><th>I</th><th>A</th></tr>
                </thead>
                <tbody>${rows || `<tr><td colspan="${days.length + 8}">Belum ada siswa.</td></tr>`}</tbody>
            </table>
            <div class="ket">${blank ? 'Isi: ✓ = hadir, S = sakit, I = izin, A = alpa, D = dispensasi. Kolom merah = Sabtu, Minggu, atau hari libur (tidak diisi).' : '✓ = hadir, S = sakit, I = izin, A = alpa, D = dispensasi. Kolom merah = Sabtu, Minggu, atau hari libur. Kolom kosong = absensi belum diisi.'}</div>
            <div class="foot"><div>Laki-laki = ${g.L}<br>Perempuan = ${g.P}</div>${ttdHtml(header, opts, last)}</div>`;
        return wrapDoc(`${blank ? 'Blanko ' : ''}Daftar Hadir ${romawi(header.kelas || recap.kelas)} ${BULAN[recap.bulan - 1]} ${recap.tahun}`, body, fit(Math.max(siswa.length, 1) + 2, 144, 4.6));
    }

    function semesterHtml(recap, header, opts = {}) {
        const siswa = recap.siswa || [];
        const g = genderTotals(siswa);
        const nama = recap.semester === 1 ? 'GANJIL' : 'GENAP';
        const rows = siswa.map((s) => {
            const p = pct(s);
            return `<tr><td>${esc(s.no)}</td><td>${esc(s.nis || '')}</td><td>${esc(s.nisn || '')}</td><td class="nm">${esc(String(s.nama || '').toUpperCase())}</td><td>${esc(s.jk || '')}</td>
                <td>${s.H}</td><td>${s.S}</td><td>${s.I}</td><td>${s.A}</td><td>${s.D}</td><td>${p === null ? '–' : `${String(p).replace('.', ',')}%`}</td><td></td></tr>`;
        }).join('');
        const tanggal = ttdSemester(recap);
        const body = `${kopHtml(`REKAP ABSENSI SEMESTER ${nama}`, header, `KELAS : ${romawi(header.kelas)}`)}
            <div class="sub">Periode ${esc(tglPanjang(recap.mulai))} s.d. ${esc(tglPanjang(recap.selesai))} · Hari efektif s.d. ${esc(tglPanjang(recap.sampai_hari_ini))}: <b>${esc(recap.hari_efektif)}</b> hari · Absensi terisi: <b>${esc(recap.hari_terisi)}</b> hari</div>
            <table>
                <colgroup><col style="width:9mm"><col style="width:16mm"><col style="width:22mm"><col><col style="width:9mm"><col style="width:15mm"><col style="width:15mm"><col style="width:15mm"><col style="width:15mm"><col style="width:20mm"><col style="width:20mm"><col style="width:40mm"></colgroup>
                <thead><tr><th>NO</th><th>NIS</th><th>NISN</th><th>NAMA</th><th>L/P</th><th>HADIR</th><th>SAKIT</th><th>IZIN</th><th>ALPA</th><th>DISPENSASI</th><th>% KEHADIRAN</th><th>KETERANGAN</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="12">Belum ada siswa.</td></tr>'}</tbody>
            </table>
            <div class="ket">% kehadiran = (hadir + dispensasi) ÷ hari yang terisi. Dispensasi (kegiatan resmi sekolah) dihitung hadir. Sumber: absensi harian wali kelas.</div>
            <div class="foot"><div>Laki-laki = ${g.L}<br>Perempuan = ${g.P}</div>${ttdHtml(header, opts, tanggal)}</div>`;
        return wrapDoc(`Rekap Semester ${nama} ${romawi(header.kelas)} ${header.tahun_ajaran}`, body, fit(Math.max(siswa.length, 1) + 1, 139, 5.2));
    }

    // ------------------------------------------------------------------ XLSX
    const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    const utf8 = (s) => enc.encode(s);

    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        let c = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    /** Zip tanpa kompresi (metode "store"). files: [{ name, data: Uint8Array }] */
    function zipStore(files) {
        const chunks = [];
        const central = [];
        let offset = 0;
        const DOS_TIME = 0;
        const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
        for (const f of files) {
            const name = utf8(f.name);
            const crc = crc32(f.data);
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
            lh.setUint16(8, 0, true); lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true);
            lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true);
            lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
            chunks.push(new Uint8Array(lh.buffer), name, f.data);
            const ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
            ch.setUint16(10, 0, true); ch.setUint16(12, DOS_TIME, true); ch.setUint16(14, DOS_DATE, true);
            ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true);
            ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
            central.push(new Uint8Array(ch.buffer), name);
            offset += 30 + name.length + f.data.length;
        }
        const cdSize = central.reduce((a, b) => a + b.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
        const all = [...chunks, ...central, new Uint8Array(end.buffer)];
        const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
        let p = 0;
        for (const c of all) { out.set(c, p); p += c.length; }
        return out;
    }

    const xmlEsc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function colName(i) {
        let s = '';
        for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        return s;
    }

    // Gaya: 0 biasa, 1 judul tebal, 2 header tebal berbingkai, 3 sel berbingkai, 4 sel berbingkai tengah, 5 libur merah berbingkai, 6 tebal garis bawah
    // Daftar hadir (meniru PDF): 7 judul besar, 8 KELAS kanan tebal, 9 header tabel, 10 sel tengah, 11 sel nama,
    // 12 libur merah, 13 header libur merah, 14 keterangan kecil miring, 15 nama sekolah tebal,
    // 16 teks kecil (tanda tangan), 17 nama penanda tangan tebal bergaris bawah
    const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="10"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="12"/><name val="Arial"/></font><font><b/><u/><sz val="10"/><name val="Arial"/></font><font><sz val="12"/><name val="Arial"/></font><font><sz val="8"/><name val="Arial"/></font><font><b/><sz val="8"/><name val="Arial"/></font><font><i/><sz val="7"/><name val="Arial"/></font><font><b/><sz val="12"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font><font><b/><u/><sz val="9"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="18">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="bottom"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="bottom"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" shrinkToFit="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="bottom"/></xf>
<xf numFmtId="49" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="9" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    // ------------------------------------------------------------------ logo kop Excel
    // Excel menaruh gambar relatif ke sel, bukan ke halaman. Supaya kop Excel sama
    // dengan versi PDF (logo tepat di kiri judul, tegak di tengah blok kop, setinggi
    // blok itu), posisinya dihitung dari lebar kolom & tinggi baris lembar itu sendiri.
    const PX_PER_PT = 96 / 72;
    const LOGO_KOP = { margin: 4, gap: 8, min: 36, max: 56, ratio: 0.9 };

    /** Lebar kolom Excel (satuan karakter, font bawaan Arial 10 → 7 px per digit) → piksel. */
    function colPx(w) { return Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7); }
    /** Kebalikan colPx: lebar terkecil (2 desimal) yang paling sedikit `px` piksel. */
    function colWidthFor(px) {
        let w = Math.max(0, Math.floor((px / 7) * 100) / 100);
        while (colPx(w) < px) w = Math.round((w + 0.01) * 100) / 100;
        return w;
    }
    /** Ukuran asli PNG (dari header IHDR), untuk menjaga perbandingan logo. */
    function pngSize(png) {
        if (!png || png.length < 24) return null;
        const u = (i) => ((png[i] << 24) | (png[i + 1] << 16) | (png[i + 2] << 8) | png[i + 3]) >>> 0;
        const w = u(16); const h = u(20);
        return w && h ? { w, h } : null;
    }
    const filled = (c) => c !== null && c !== undefined && c !== ''
        && !(typeof c === 'object' && (c.v === null || c.v === undefined || c.v === '') && !c.f);

    /**
     * Tata letak logo kop untuk satu lembar. Teks kop dimulai di kolom terkiri yang
     * berisi di baris 1; blok kop = baris-baris yang mulai di kolom itu. Logo ditaruh
     * tepat di kiri teks itu (jarak 8 px), tegak di tengah blok, tingginya ±90% blok.
     * Kalau ruang di kiri teks kurang, kolom tepat sebelum teks dilebarkan.
     * Tinggi baris kop yang belum ditentukan diisi nilai bawaan lembar, supaya
     * perhitungan ini sama persis dengan yang digambar Excel/LibreOffice.
     * → { widths, heights, drawing } (drawing = isi xl/drawings/drawingN.xml)
     */
    function kopLogo({ rows, widths = [], heights = {}, png, defaultRowPt = 12.75, defaultColWidth = 8.43 }) {
        const W = widths.slice();
        const H = { ...heights };
        // Teks kop = kolom terkiri yang berisi di baris 1. Blok kop = baris berturut-turut
        // yang teksnya mulai di kolom yang sama (berhenti di baris kosong atau baris yang
        // mulai di kolom lain, mis. keterangan periode atau kepala tabel).
        const first = (r) => (rows[r] || []).findIndex(filled);
        const textCol = Math.max(0, first(0));
        let k = 1;
        while (k < Math.min(rows.length, 8) && first(k) === textCol) k++;
        for (let r = 1; r <= k; r++) if (!H[r]) H[r] = defaultRowPt;
        const rowPx = (r) => (H[r] || defaultRowPt) * PX_PER_PT;
        const cw = (i) => colPx(W[i] ?? defaultColWidth);

        let kopH = 0;
        for (let r = 1; r <= k; r++) kopH += rowPx(r);
        const side = Math.max(LOGO_KOP.min, Math.min(LOGO_KOP.max, Math.round(kopH * LOGO_KOP.ratio)));
        const dim = pngSize(png) || { w: 1, h: 1 };
        const sc = side / Math.max(dim.w, dim.h);
        const lw = Math.round(dim.w * sc);
        const lh = Math.round(dim.h * sc);

        let xText = 0;
        for (let i = 0; i < textCol; i++) xText += cw(i);
        const need = LOGO_KOP.margin + lw + LOGO_KOP.gap;
        if (textCol >= 1 && xText < need) {
            for (let i = 0; i < textCol - 1; i++) if (W[i] === undefined) W[i] = defaultColWidth;
            W[textCol - 1] = colWidthFor(cw(textCol - 1) + (need - xText));
            xText = 0;
            for (let i = 0; i < textCol; i++) xText += cw(i);
        }
        const left = textCol >= 1 ? Math.max(LOGO_KOP.margin, xText - LOGO_KOP.gap - lw) : LOGO_KOP.margin;
        const top = Math.max(0, Math.round((kopH - lh) / 2));

        let col = 0; let acc = 0;
        while (acc + cw(col) <= left && col < 200) { acc += cw(col); col++; }
        const colOff = left - acc;
        let row = 0; let racc = 0;
        while (row < k - 1 && racc + rowPx(row + 1) <= top) { racc += rowPx(row + 1); row++; }
        const rowOff = Math.round(top - racc);

        const E = (px) => Math.round(px * 9525);
        const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${E(colOff)}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${E(rowOff)}</xdr:rowOff></xdr:from><xdr:ext cx="${E(lw)}" cy="${E(lh)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${E(lw)}" cy="${E(lh)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
        return { widths: W, heights: H, drawing, box: { left, top, width: lw, height: lh, textCol, kopRows: k, kopHeight: kopH } };
    }

    /**
     * rows: array baris; tiap sel = nilai (string/number/null) atau { v, s } (s = indeks gaya).
     * merges: ['A1:F1', ...]; widths: [lebar kolom ...]; landscape: true
     */
    function buildXlsx({ sheet = 'Rekap', rows, merges = [], widths = [], landscape = true, logoPng = null, heights = {}, showGrid = true, fitHeight = 0 }) {
        const hasLogo = logoPng && logoPng.length > 8 && logoPng[0] === 0x89 && logoPng[1] === 0x50;
        const logo = hasLogo ? kopLogo({ rows, widths, heights, png: logoPng }) : null;
        if (logo) { widths = logo.widths; heights = logo.heights; }
        const sheetRows = rows.map((r, ri) => {
            const cells = r.map((cell, ci) => {
                if (cell === null || cell === undefined || cell === '') return '';
                const c = typeof cell === 'object' ? cell : { v: cell };
                const ref = `${colName(ci)}${ri + 1}`;
                const s = c.s ? ` s="${c.s}"` : '';
                if (c.f) return `<c r="${ref}"${s}><f>${xmlEsc(c.f)}</f></c>`;
                if (c.v === null || c.v === undefined || c.v === '') return `<c r="${ref}"${s}/>`;
                if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
                return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
            }).join('');
            const ht = heights[ri + 1] ? ` ht="${heights[ri + 1]}" customHeight="1"` : '';
            return `<row r="${ri + 1}"${ht}>${cells}</row>`;
        }).join('');
        const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
        const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
        const ws = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"${showGrid ? '' : ' showGridLines="0"'}/></sheetViews>
${cols}<sheetData>${sheetRows}</sheetData>${mergeXml}<pageMargins left="0.3" right="0.3" top="0.3" bottom="0.3" header="0" footer="0"/><pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="${fitHeight}"/>${hasLogo ? '<drawing r:id="rId1"/>' : ''}
</worksheet>`;
        const safeSheet = xmlEsc(String(sheet).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
        const files = [
            { name: '[Content_Types].xml', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasLogo ? '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
            { name: '_rels/.rels', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
            { name: 'xl/workbook.xml', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
            { name: 'xl/_rels/workbook.xml.rels', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
            { name: 'xl/worksheets/sheet1.xml', data: utf8(ws) },
            { name: 'xl/styles.xml', data: utf8(STYLES) },
        ];
        if (hasLogo) {
            files.push(
                { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`) },
                { name: 'xl/drawings/drawing1.xml', data: utf8(logo.drawing) },
                { name: 'xl/drawings/_rels/drawing1.xml.rels', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`) },
                { name: 'xl/media/image1.png', data: logoPng },
            );
        }
        return zipStore(files);
    }

    /** Blok tanda tangan. compact = gaya daftar hadir (huruf kecil, posisi sejajar versi PDF). */
    function footerRows(header, opts, tanggal, g, width, { mid = 3, right = Math.max(width - 8, 6), compact = false } = {}) {
        const kepsek = header.kepala_sekolah || {};
        const wali = pickWali(header, opts.wali || 1) || {};
        const t = (v) => (compact && v !== null && v !== '' && typeof v !== 'object' ? { v, s: 16 } : v);
        const row = (left, m, r) => {
            const a = new Array(width).fill(null);
            a[0] = t(left); a[mid] = t(m); a[right] = t(r);
            return a;
        };
        const nip = (v) => (opts.showNip !== false ? labelNip(v) : '');
        const nm = (v) => ({ v: namaTtd(v), s: compact ? 17 : 6 });
        return [
            [],
            row(`Laki-laki = ${g.L}`, 'Mengetahui,', `${CITY}, ${tglPanjang(tanggal)}`),
            row(`Perempuan = ${g.P}`, 'Kepala Sekolah', 'Wali Kelas'),
            [], [],
            row(null, nm(kepsek.nama), nm(wali.nama)),
            row(null, nip(kepsek.nip), nip(wali.nip)),
        ];
    }

    /**
     * opts: { wali, showNip, logoPng, blank }
     * blank = blanko kosong untuk diisi tangan / di Excel: kotak tanggal kosong,
     * dan JUMLAH S/I/A berupa rumus COUNTIF sehingga terhitung sendiri saat diisi.
     */
    function monthlyXlsx(recap, header, opts = {}) {
        // Tata letak meniru versi PDF: logo + judul kiri, KELAS kanan atas, tabel rapat
        // berhuruf kecil, kolom tanggal cukup lebar untuk 2 angka, Sabtu/Minggu/libur merah.
        const kosong = Boolean(opts.blank);
        const days = recap.hari || [];
        const siswa = recap.siswa || [];
        const width = 5 + days.length + 3;
        const last = colName(width - 1);
        const kelasCol = Math.max(width - 6, 5);
        const H = (v) => ({ v, s: 9 });
        const blank = (n) => new Array(n).fill(null);
        // Judul mulai kolom C (A–B untuk logo), KELAS di kanan sebaris dengan nama sekolah — sama seperti PDF.
        const titleRow = (v, s, extra) => { const r = [null, null, { v, s }]; if (extra) { r.length = kelasCol; r.push(extra); } return r; };
        const rows = [
            titleRow('DAFTAR HADIR SISWA', 7),
            titleRow(`TAHUN PELAJARAN ${tpLabel(header.tahun_ajaran)}`, 7),
            titleRow(SCHOOL, 15, { v: `KELAS : ${romawi(header.kelas || recap.kelas)}`, s: 8 }),
            [],
            [H('NO'), H(''), H(''), H('NAMA'), H('L/P'), H(`BULAN : ${BULAN[recap.bulan - 1].toUpperCase()} ${recap.tahun}`), ...days.slice(1).map(() => H('')), H('JUMLAH'), H(''), H('')],
            [H('ABS'), H('NIS'), H('NISN'), H(''), H(''), ...days.map((d) => ({ v: Number(d.tanggal.slice(8)), s: d.libur ? 13 : 9 })), H('S'), H('I'), H('A')],
        ];
        const hariA = colName(5);
        const hariZ = colName(4 + Math.max(days.length, 1));
        siswa.forEach((s, i) => {
            const t = counts(s.status);
            const r = 7 + i;
            // Blanko: kosong selama belum ada isinya, supaya cetakannya bersih untuk diisi tangan.
            const hitung = (k) => `COUNTIF(${hariA}${r}:${hariZ}${r},"${k}")`;
            const jumlah = (k) => (kosong ? { f: `IF(${hitung(k)}=0,"",${hitung(k)})`, s: 10 } : { v: t[k], s: 10 });
            rows.push([
                { v: s.no, s: 10 }, { v: String(s.nis || ''), s: 10 }, { v: String(s.nisn || ''), s: 10 }, { v: String(s.nama || '').toUpperCase(), s: 11 }, { v: s.jk || '', s: 10 },
                ...days.map((d) => {
                    const v = kosong ? '' : (s.status || {})[d.tanggal];
                    return { v: d.libur || !v ? '' : (v === 'H' ? HADIR : v), s: d.libur ? 12 : 10 };
                }),
                jumlah('S'), jumlah('I'), jumlah('A'),
            ]);
        });
        if (!siswa.length) rows.push([{ v: 'Belum ada siswa.', s: 10 }, ...blank(width - 1).map(() => ({ v: '', s: 10 }))]);
        const legendRow = rows.length + 1;
        rows.push([{ v: kosong
            ? 'Isi: ✓ = hadir, S = sakit, I = izin, A = alpa, D = dispensasi. Kolom merah = Sabtu, Minggu, atau hari libur (tidak diisi). Jumlah S/I/A terhitung otomatis.'
            : '✓ = hadir, S = sakit, I = izin, A = alpa, D = dispensasi. Kolom merah = Sabtu, Minggu, atau hari libur. Kolom kosong = absensi belum diisi.', s: 14 }]);
        rows.push(...footerRows(header, opts, akhirBulan(recap.tahun, recap.bulan), genderTotals(siswa), width,
            { mid: 6, right: Math.max(width - 11, 8), compact: true }));
        const d0 = hariA;
        const dN = hariZ;
        const heights = { 1: 15, 2: 15, 3: 15, 4: 4, 5: 13, 6: 13, [legendRow]: 12 };
        for (let i = 0; i < Math.max(siswa.length, 1); i++) heights[7 + i] = 13.5;
        return buildXlsx({
            sheet: `${kosong ? 'Blanko ' : ''}${romawi(header.kelas || recap.kelas)} ${BULAN[recap.bulan - 1]} ${recap.tahun}`,
            rows,
            logoPng: opts.logoPng,
            heights,
            showGrid: false,
            fitHeight: 1,
            merges: [`C1:${colName(kelasCol - 1)}1`, `C2:${colName(kelasCol - 1)}2`, `C3:${colName(kelasCol - 1)}3`, `${colName(kelasCol)}3:${last}3`,
                'A5:C5', 'D5:D6', 'E5:E6', `${d0}5:${dN}5`, `${colName(width - 3)}5:${last}5`,
                `A${legendRow}:${last}${legendRow}`, ...(siswa.length ? [] : [`A7:${last}7`])],
            widths: [4.5, 6.5, 10.5, 30, 4, ...days.map(() => 3.3), 3.3, 3.3, 3.3],
        });
    }

    function semesterXlsx(recap, header, opts = {}) {
        // Gaya sama dengan daftar hadir bulanan (meniru versi PDF).
        const siswa = recap.siswa || [];
        const nama = recap.semester === 1 ? 'GANJIL' : 'GENAP';
        const H = (v) => ({ v, s: 9 });
        const width = 12;
        const kelasCol = 9;
        const rows = [
            [null, null, { v: `REKAP ABSENSI SEMESTER ${nama}`, s: 7 }],
            [null, null, { v: `TAHUN PELAJARAN ${tpLabel(header.tahun_ajaran)}`, s: 7 }],
            [null, null, { v: SCHOOL, s: 15 }, null, null, null, null, null, null, { v: `KELAS : ${romawi(header.kelas)}`, s: 8 }],
            [{ v: `Periode ${tglPanjang(recap.mulai)} s.d. ${tglPanjang(recap.selesai)} · Hari efektif s.d. ${tglPanjang(recap.sampai_hari_ini)}: ${recap.hari_efektif} hari · Absensi terisi: ${recap.hari_terisi} hari`, s: 16 }],
            [H('NO'), H('NIS'), H('NISN'), H('NAMA'), H('L/P'), H('HADIR'), H('SAKIT'), H('IZIN'), H('ALPA'), H('DISPENSASI'), H('% KEHADIRAN'), H('KETERANGAN')],
        ];
        for (const s of siswa) {
            const p = pct(s);
            rows.push([{ v: s.no, s: 10 }, { v: String(s.nis || ''), s: 10 }, { v: String(s.nisn || ''), s: 10 }, { v: String(s.nama || '').toUpperCase(), s: 11 }, { v: s.jk || '', s: 10 },
                { v: s.H, s: 10 }, { v: s.S, s: 10 }, { v: s.I, s: 10 }, { v: s.A, s: 10 }, { v: s.D, s: 10 }, { v: p === null ? '–' : `${String(p).replace('.', ',')}%`, s: 10 }, { v: '', s: 11 }]);
        }
        const legendRow = rows.length + 1;
        rows.push([{ v: '% kehadiran = (hadir + dispensasi) ÷ hari yang terisi. Dispensasi (kegiatan resmi sekolah) dihitung hadir.', s: 14 }]);
        const tanggal = ttdSemester(recap);
        rows.push(...footerRows(header, opts, tanggal, genderTotals(siswa), width, { mid: 4, right: 10, compact: true }));
        const heights = { 1: 15, 2: 15, 3: 15, 4: 14, 5: 16, [legendRow]: 12 };
        for (let i = 0; i < siswa.length; i++) heights[6 + i] = 13.5;
        return buildXlsx({
            sheet: `Semester ${nama} ${romawi(header.kelas)}`,
            rows,
            logoPng: opts.logoPng,
            heights,
            showGrid: false,
            fitHeight: 1,
            merges: ['C1:L1', 'C2:L2', `C3:${colName(kelasCol - 1)}3`, `${colName(kelasCol)}3:L3`, 'A4:L4', `A${legendRow}:L${legendRow}`],
            widths: [4.5, 7, 11.5, 36, 4.5, 8, 8, 8, 8, 11.5, 13, 24],
        });
    }

    // ------------------------------------------------------------------ browser
    /** Buka dokumen di tab baru, tunggu logo/isi siap (maks. 3 detik), lalu buka dialog cetak. */
    function printDoc(html) {
        const w = root.open ? root.open('', '_blank') : null;
        if (!w) return false;
        w.document.open();
        w.document.write(html);
        w.document.close();
        const started = Date.now();
        const tick = () => {
            let ready = false;
            try {
                ready = w.document.readyState === 'complete' && [...w.document.images].every((i) => i.complete);
            } catch { return; }   // tab sudah ditutup
            if (ready || Date.now() - started > 3000) {
                try { w.focus(); w.print(); } catch { /* pengguna tetap bisa menekan tombol Cetak */ }
            } else {
                setTimeout(tick, 150);
            }
        };
        setTimeout(tick, 300);
        return true;
    }

    /** Logo PNG untuk Excel (diambil sekali, lalu disimpan). null jika gagal — Excel tetap dibuat tanpa logo. */
    let logoPromise = null;
    function loadLogo() {
        if (!logoPromise) {
            logoPromise = fetch(LOGO)
                .then((r) => (r.ok ? r.arrayBuffer() : null))
                .then((b) => (b ? new Uint8Array(b) : null))
                .catch(() => null);
        }
        return logoPromise;
    }

    function download(bytes, filename, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        const blob = new Blob([bytes], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function fileName(kind, header, extra) {
        return `${kind} ${romawi(header.kelas)} ${extra}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
    }

    const api = { labelNip, pisahNip, monthlyHtml, semesterHtml, monthlyXlsx, semesterXlsx, buildXlsx, crc32, print: printDoc, download, loadLogo, fileName, akhirBulan, ttdSemester, HADIR, romawi, namaTtd, pct, BULAN,
        zipStore, colName, xmlEsc, kopHtml, wrapDoc, fit, tglPanjang, tpLabel, SCHOOL, CITY, kopLogo, colPx };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RekapPrint = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
