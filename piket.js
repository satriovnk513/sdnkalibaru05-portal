// =============================================================================
// Jadwal piket siswa: kelompok per hari, label periode, Excel & cetak.
// Data = hasil RPC get_class_piket:
//   { kelas{id,nama,tingkat,rombel,tahun_ajaran}, can_edit, mode, periode, tanggal, semester,
//     wali[], kepala_sekolah, siswa[{id,no,nama,jk,hari}] }
// Dipakai Portal Guru & Panel Admin (piket-ui.js), juga dites di Node.
// =============================================================================
(function (root) {
    'use strict';

    const isNode = typeof module !== 'undefined' && module.exports;
    const RP = isNode ? require('./rekap-print.js') : root.RekapPrint;
    const XB = isNode ? require('./xlsx-book.js') : root.XlsxBook;

    const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const kelasTitik = (k) => String(k?.nama || k || '').replace(/\s+/, '.');

    /** [[siswa Senin], …, [siswa Jumat]] urut nomor absen. */
    function perHari(data) {
        const out = [[], [], [], [], []];
        for (const s of data.siswa || []) if (s.hari >= 1 && s.hari <= 5) out[s.hari - 1].push(s);
        for (const l of out) l.sort((a, b) => (a.no ?? 0) - (b.no ?? 0) || String(a.nama).localeCompare(String(b.nama)));
        return out;
    }

    /** "November 2026" (bulanan) / "Semester Ganjil 2026/2027" (semester). */
    function labelPeriode(data) {
        if (data.mode === 'semester') return `Semester ${Number(data.semester) === 2 ? 'Genap' : 'Ganjil'} ${data.kelas.tahun_ajaran || ''}`.trim();
        const [y, m] = String(data.tanggal).split('-').map(Number);
        return `${RP.BULAN[m - 1]} ${y}`;
    }

    const hitung = (list) => ({ L: list.filter((s) => s.jk === 'L').length, P: list.filter((s) => s.jk === 'P').length });

    // ------------------------------------------------------------------ cetak
    function ttd(data, tanggal) {
        const ks = data.kepala_sekolah || {};
        const w = (data.wali || []).find((x) => x.posisi === 1) || (data.wali || [])[0] || {};
        const nm = (v) => esc(RP.namaTtd(v) || '........................');
        return `<div class="foot" style="margin-top:5mm">
            <div class="ttd"><div>Mengetahui,</div><div>Kepala Sekolah</div><div class="sp"></div><b>${nm(ks.nama)}</b><div>${esc(RP.labelNip(ks.nip))}</div></div>
            <div class="ttd"><div>${RP.CITY}, ${esc(RP.tglPanjang(tanggal))}</div><div>Wali Kelas</div><div class="sp"></div><b>${nm(w.nama)}</b><div>${esc(RP.labelNip(w.nip))}</div></div>
        </div>`;
    }
    function hariIniIso() {
        const d = new Date();
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function html(data, opts = {}) {
        const hari = perHari(data);
        const n = Math.max(1, ...hari.map((l) => l.length));
        const rows = Array.from({ length: n }, (_, i) => `<tr>${hari.map((l) => (l[i]
            ? `<td class="no">${i + 1}</td><td class="nm">${esc(String(l[i].nama).toUpperCase())}</td><td class="jk">${esc(l[i].jk || '')}</td>`
            : '<td class="no"></td><td class="nm"></td><td class="jk"></td>')).join('')}</tr>`).join('');
        const body = `<style>
                .pk th { background: #e5e7eb; }
                .pk td.no { width: 6mm; } .pk td.jk { width: 6mm; }
                .pk td.nm { text-align: left; padding-left: 3px; white-space: normal; overflow: visible; line-height: 1.1; }
                .pk tfoot td { font-style: italic; font-size: 7pt; background: #f8fafc; }
            </style>
            ${RP.kopHtml('JADWAL PIKET KELAS', { tahun_ajaran: data.kelas.tahun_ajaran }, `KELAS : ${RP.romawi(`${data.kelas.tingkat}${data.kelas.rombel}`) || data.kelas.nama}`)}
            <div style="font-size:9pt;margin:0 0 2mm">Periode: <b>${esc(labelPeriode(data))}</b></div>
            <table class="pk">
                <colgroup>${HARI.map(() => '<col style="width:6mm"><col><col style="width:7mm">').join('')}</colgroup>
                <thead><tr>${HARI.map((h) => `<th colspan="3">${h.toUpperCase()}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr>${hari.map((l) => { const c = hitung(l); return `<td colspan="3">${l.length} siswa · ${c.L} L, ${c.P} P</td>`; }).join('')}</tr></tfoot>
            </table>
            ${ttd(data, opts.tanggal || hariIniIso())}`;
        return RP.wrapDoc(`Jadwal Piket ${data.kelas.nama}`, body, RP.fit(n + 2, 110, 7));
    }

    function xlsx(data) {
        const hari = perHari(data);
        const n = Math.max(1, ...hari.map((l) => l.length));
        const B = { border: true, valign: 'center' };
        const C = { ...B, align: 'center' };
        const H = { ...C, bold: true, fill: 'E5E7EB' };
        const rows = [
            [{ v: `JADWAL PIKET KELAS ${kelasTitik(data.kelas)}`, s: { bold: true, size: 13, align: 'center' } }],
            [{ v: `${RP.SCHOOL} · ${labelPeriode(data)}`, s: { align: 'center', color: '475569' } }],
            [],
            HARI.flatMap((h) => [{ v: h.toUpperCase(), s: H }, { v: '', s: H }, { v: '', s: H }]),
            HARI.flatMap(() => [{ v: 'No', s: H }, { v: 'Nama', s: H }, { v: 'L/P', s: H }]),
        ];
        for (let i = 0; i < n; i++) {
            rows.push(hari.flatMap((l) => (l[i]
                ? [{ v: i + 1, s: C }, { v: String(l[i].nama).toUpperCase(), s: B }, { v: l[i].jk || '', s: C }]
                : [{ v: '', s: B }, { v: '', s: B }, { v: '', s: B }])));
        }
        rows.push(hari.flatMap((l) => { const c = hitung(l); return [{ v: `${l.length} siswa · ${c.L} L, ${c.P} P`, s: { ...B, italic: true, fill: 'F8FAFC' } }, { v: '', s: B }, { v: '', s: B }]; }));
        const last = rows.length;
        const merges = ['A1:O1', 'A2:O2'];
        for (let h = 0; h < 5; h++) {
            const a = RP.colName(h * 3); const z = RP.colName(h * 3 + 2);
            merges.push(`${a}4:${z}4`, `${a}${last}:${z}${last}`);
        }
        return XB.build({ sheets: [{
            name: `Piket ${data.kelas.nama}`, rows, merges, widths: HARI.flatMap(() => [4, 24, 4]), heights: { 1: 22 },
            showGrid: false, landscape: true, fitHeight: 1, active: true,
        }] });
    }

    const namaFile = (data) => `Jadwal Piket Kelas ${data.kelas.nama} ${labelPeriode(data)}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');

    const api = { HARI, perHari, labelPeriode, hitung, html, xlsx, namaFile, kelasTitik };
    if (isNode) module.exports = api;
    else root.Piket = Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
