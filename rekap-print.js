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

    function ttdHtml(header, opts, tanggal) {
        const kepsek = header.kepala_sekolah || {};
        const wali = pickWali(header, opts.wali || 1) || {};
        const nip = (v) => (opts.showNip !== false ? `<div>NIP. ${esc(v || '-')}</div>` : '');
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
                return `<td class="${d.libur ? 'libur' : ''}">${d.libur || !v ? '' : (v === 'H' ? '•' : v)}</td>`;
            }).join('');
            return `<tr><td>${esc(s.no)}</td><td>${esc(s.nis || '')}</td><td>${esc(s.nisn || '')}</td><td class="nm">${esc(String(s.nama || '').toUpperCase())}</td><td>${esc(s.jk || '')}</td>${cells}<td>${t.S || (blank ? '' : 0)}</td><td>${t.I || (blank ? '' : 0)}</td><td>${t.A || (blank ? '' : 0)}</td></tr>`;
        }).join('');
        const last = days.length ? days[days.length - 1].tanggal : `${recap.tahun}-${String(recap.bulan).padStart(2, '0')}-28`;
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
            <div class="ket">${blank ? 'Kolom merah = Sabtu, Minggu, atau hari libur.' : '• = hadir, S = sakit, I = izin, A = alpa, D = dispensasi. Kolom merah = Sabtu, Minggu, atau hari libur. Kolom kosong = absensi belum diisi.'}</div>
            <div class="foot"><div>Laki-laki = ${g.L}<br>Perempuan = ${g.P}</div>${ttdHtml(header, opts, last)}</div>`;
        return wrapDoc(`Daftar Hadir ${romawi(header.kelas || recap.kelas)} ${BULAN[recap.bulan - 1]} ${recap.tahun}`, body, fit(Math.max(siswa.length, 1) + 2, 144, 4.6));
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
        const tanggal = recap.sampai_hari_ini < recap.selesai ? recap.sampai_hari_ini : recap.selesai;
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
    const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="12"/><name val="Arial"/></font><font><b/><u/><sz val="10"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    /**
     * rows: array baris; tiap sel = nilai (string/number/null) atau { v, s } (s = indeks gaya).
     * merges: ['A1:F1', ...]; widths: [lebar kolom ...]; landscape: true
     */
    function buildXlsx({ sheet = 'Rekap', rows, merges = [], widths = [], landscape = true, logoPng = null, logoPx = 64 }) {
        const hasLogo = logoPng && logoPng.length > 8 && logoPng[0] === 0x89 && logoPng[1] === 0x50;
        const emu = Math.round(logoPx * 9525);
        const sheetRows = rows.map((r, ri) => {
            const cells = r.map((cell, ci) => {
                if (cell === null || cell === undefined || cell === '') return '';
                const c = typeof cell === 'object' ? cell : { v: cell };
                const ref = `${colName(ci)}${ri + 1}`;
                const s = c.s ? ` s="${c.s}"` : '';
                if (c.v === null || c.v === undefined || c.v === '') return `<c r="${ref}"${s}/>`;
                if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
                return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
            }).join('');
            return `<row r="${ri + 1}">${cells}</row>`;
        }).join('');
        const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
        const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
        const ws = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${cols}<sheetData>${sheetRows}</sheetData>${mergeXml}<pageMargins left="0.3" right="0.3" top="0.3" bottom="0.3" header="0" footer="0"/><pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>${hasLogo ? '<drawing r:id="rId1"/>' : ''}
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
                { name: 'xl/drawings/drawing1.xml', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>57150</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:ext cx="${emu}" cy="${emu}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`) },
                { name: 'xl/drawings/_rels/drawing1.xml.rels', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`) },
                { name: 'xl/media/image1.png', data: logoPng },
            );
        }
        return zipStore(files);
    }

    function footerRows(header, opts, tanggal, g, width) {
        const kepsek = header.kepala_sekolah || {};
        const wali = pickWali(header, opts.wali || 1) || {};
        const right = Math.max(width - 8, 6);
        const row = (left, mid, r) => {
            const a = new Array(width).fill(null);
            a[0] = left; a[3] = mid; a[right] = r;
            return a;
        };
        const nip = (v) => (opts.showNip !== false ? `NIP. ${v || '-'}` : '');
        return [
            [],
            row(`Laki-laki = ${g.L}`, 'Mengetahui,', `${CITY}, ${tglPanjang(tanggal)}`),
            row(`Perempuan = ${g.P}`, 'Kepala Sekolah', 'Wali Kelas'),
            [], [],
            row(null, { v: namaTtd(kepsek.nama), s: 6 }, { v: namaTtd(wali.nama), s: 6 }),
            row(null, nip(kepsek.nip), nip(wali.nip)),
        ];
    }

    function monthlyXlsx(recap, header, opts = {}) {
        const days = recap.hari || [];
        const siswa = recap.siswa || [];
        const width = 5 + days.length + 3;
        const last = colName(width - 1);
        const B = (v) => ({ v, s: 2 });
        const rows = [
            // Judul mulai kolom D: A1:C4 dipakai logo.
            [null, null, null, { v: 'DAFTAR HADIR SISWA', s: 1 }],
            [null, null, null, { v: `TAHUN PELAJARAN ${tpLabel(header.tahun_ajaran)}`, s: 1 }],
            [null, null, null, { v: SCHOOL, s: 1 }],
            [null, null, null, { v: `KELAS : ${romawi(header.kelas || recap.kelas)}`, s: 1 }],
            [],
            [B('NO'), B(''), B(''), B('NAMA'), B('L/P'), B(`BULAN : ${BULAN[recap.bulan - 1].toUpperCase()} ${recap.tahun}`), ...days.slice(1).map(() => B('')), B('JUMLAH'), B(''), B('')],
            [B('ABS'), B('NIS'), B('NISN'), B(''), B(''), ...days.map((d) => ({ v: Number(d.tanggal.slice(8)), s: d.libur ? 5 : 2 })), B('S'), B('I'), B('A')],
        ];
        for (const s of siswa) {
            const t = counts(s.status);
            rows.push([
                { v: s.no, s: 4 }, { v: s.nis || '', s: 4 }, { v: s.nisn || '', s: 4 }, { v: String(s.nama || '').toUpperCase(), s: 3 }, { v: s.jk || '', s: 4 },
                ...days.map((d) => {
                    const v = (s.status || {})[d.tanggal];
                    return { v: d.libur || !v ? '' : (v === 'H' ? '•' : v), s: d.libur ? 5 : 4 };
                }),
                { v: t.S, s: 4 }, { v: t.I, s: 4 }, { v: t.A, s: 4 },
            ]);
        }
        rows.push([{ v: '• = hadir, S = sakit, I = izin, A = alpa, D = dispensasi. Kolom merah = Sabtu, Minggu, atau hari libur.' }]);
        const lastDay = days.length ? days[days.length - 1].tanggal : `${recap.tahun}-${String(recap.bulan).padStart(2, '0')}-28`;
        rows.push(...footerRows(header, opts, lastDay, genderTotals(siswa), width));
        const d0 = colName(5);
        const dN = colName(4 + Math.max(days.length, 1));
        return buildXlsx({
            sheet: `${romawi(header.kelas || recap.kelas)} ${BULAN[recap.bulan - 1]} ${recap.tahun}`,
            rows,
            logoPng: opts.logoPng,
            merges: [`D1:${last}1`, `D2:${last}2`, `D3:${last}3`, `D4:${last}4`, 'A6:C6', 'D6:D7', 'E6:E7',
                `${d0}6:${dN}6`, `${colName(width - 3)}6:${last}6`],
            widths: [5, 8, 12, 32, 5, ...days.map(() => 3.2), 4, 4, 4],
        });
    }

    function semesterXlsx(recap, header, opts = {}) {
        const siswa = recap.siswa || [];
        const nama = recap.semester === 1 ? 'GANJIL' : 'GENAP';
        const B = (v) => ({ v, s: 2 });
        const width = 12;
        const rows = [
            [null, null, null, { v: `REKAP ABSENSI SEMESTER ${nama}`, s: 1 }],
            [null, null, null, { v: `TAHUN PELAJARAN ${tpLabel(header.tahun_ajaran)}`, s: 1 }],
            [null, null, null, { v: SCHOOL, s: 1 }],
            [null, null, null, { v: `KELAS : ${romawi(header.kelas)}`, s: 1 }],
            [`Periode ${tglPanjang(recap.mulai)} s.d. ${tglPanjang(recap.selesai)} · Hari efektif s.d. ${tglPanjang(recap.sampai_hari_ini)}: ${recap.hari_efektif} hari · Absensi terisi: ${recap.hari_terisi} hari`],
            [B('NO'), B('NIS'), B('NISN'), B('NAMA'), B('L/P'), B('HADIR'), B('SAKIT'), B('IZIN'), B('ALPA'), B('DISPENSASI'), B('% KEHADIRAN'), B('KETERANGAN')],
        ];
        for (const s of siswa) {
            const p = pct(s);
            rows.push([{ v: s.no, s: 4 }, { v: s.nis || '', s: 4 }, { v: s.nisn || '', s: 4 }, { v: String(s.nama || '').toUpperCase(), s: 3 }, { v: s.jk || '', s: 4 },
                { v: s.H, s: 4 }, { v: s.S, s: 4 }, { v: s.I, s: 4 }, { v: s.A, s: 4 }, { v: s.D, s: 4 }, { v: p === null ? '–' : p, s: 4 }, { v: '', s: 3 }]);
        }
        rows.push(['% kehadiran = (hadir + dispensasi) ÷ hari yang terisi. Dispensasi (kegiatan resmi sekolah) dihitung hadir.']);
        const tanggal = recap.sampai_hari_ini < recap.selesai ? recap.sampai_hari_ini : recap.selesai;
        rows.push(...footerRows(header, opts, tanggal, genderTotals(siswa), width));
        return buildXlsx({
            sheet: `Semester ${nama} ${romawi(header.kelas)}`,
            rows,
            logoPng: opts.logoPng,
            merges: ['D1:L1', 'D2:L2', 'D3:L3', 'D4:L4', 'A5:L5'],
            widths: [5, 9, 13, 34, 5, 8, 8, 8, 8, 11, 13, 22],
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

    function download(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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

    const api = { monthlyHtml, semesterHtml, monthlyXlsx, semesterXlsx, buildXlsx, crc32, print: printDoc, download, loadLogo, fileName, romawi, namaTtd, pct, BULAN };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RekapPrint = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
