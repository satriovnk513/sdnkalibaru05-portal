// =============================================================================
// Jurnal mengajar: susun daftar harian dari jadwal + catatan, unduhan bulanan
// (Excel & cetak). Data = hasil RPC get_my_journal_day / get_my_journal_month.
// Dipakai Portal Guru (jurnal-ui.js), juga dites di Node.
// =============================================================================
(function (root) {
    'use strict';

    const isNode = typeof module !== 'undefined' && module.exports;
    const RP = isNode ? require('./rekap-print.js') : root.RekapPrint;
    const XB = isNode ? require('./xlsx-book.js') : root.XlsxBook;

    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const STATUS = { terlaksana: 'Terlaksana', tidak: 'Tidak terlaksana' };
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const titik = (t) => String(t || '').replace(':', '.');
    const kelasTitik = (k) => String(k || '').replace(/\s+/, '.');

    function hariDari(iso) {
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    }
    function tglPendek(iso) {
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        return `${d} ${RP.BULAN[m - 1].slice(0, 3)} ${y}`;
    }

    /** [3,4,5,7,8] → "3–5, 7–8" */
    function rentang(nums) {
        const a = [...new Set(nums)].sort((x, y) => x - y);
        const out = [];
        for (let i = 0; i < a.length; i++) {
            let j = i;
            while (j + 1 < a.length && a[j + 1] === a[j] + 1) j += 1;
            out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`);
            i = j;
        }
        return out.join(', ');
    }

    /**
     * Daftar kartu jurnal satu hari: jadwal dikelompokkan per kelas+mapel (jam boleh terpisah),
     * dipasangkan dengan catatan tersimpan; catatan dari jadwal lama & catatan lain ikut di bawahnya.
     * → [{ key, jenis:'jadwal'|'lain', class_id, kelas, subject_id, mapel, judul, jam, waktu, catatan|null }]
     */
    function susunHari(day) {
        const groups = new Map();
        for (const r of day.jadwal || []) {
            const k = `${r.class_id}|${r.subject_id}`;
            if (!groups.has(k)) groups.set(k, { key: k, jenis: 'jadwal', class_id: r.class_id, kelas: r.kelas, subject_id: r.subject_id, mapel: r.mapel, kode: r.kode, jams: [], mulai: r.mulai, selesai: r.selesai });
            const g = groups.get(k);
            g.jams.push(r.jam);
            if (r.mulai && (!g.mulai || r.mulai < g.mulai)) g.mulai = r.mulai;
            if (r.selesai && (!g.selesai || r.selesai > g.selesai)) g.selesai = r.selesai;
        }
        const notes = [...(day.catatan || [])];
        const items = [...groups.values()].map((g) => {
            const i = notes.findIndex((n) => !n.judul && n.class_id === g.class_id && n.subject_id === g.subject_id);
            const catatan = i >= 0 ? notes.splice(i, 1)[0] : null;
            return { ...g, jam: rentang(g.jams), waktu: g.mulai && g.selesai ? `${titik(g.mulai)}–${titik(g.selesai)}` : '', catatan };
        });
        for (const n of notes.sort((a, b) => (a.judul ? 1 : 0) - (b.judul ? 1 : 0))) {
            items.push({ key: n.id, jenis: n.judul ? 'lain' : 'jadwal', class_id: n.class_id, kelas: n.kelas, subject_id: n.subject_id, mapel: n.mapel,
                judul: n.judul, jam: n.jam || '', waktu: '', catatan: n, lama: !n.judul });
        }
        return items;
    }

    function ringkas(items) {
        const jadwal = items.filter((x) => x.jenis === 'jadwal');
        return { total: jadwal.length, dicatat: jadwal.filter((x) => x.catatan).length };
    }

    const judulBaris = (c) => c.judul || c.mapel || '';

    // ------------------------------------------------------------------ unduhan bulanan
    function xlsx(month) {
        const nama = `${RP.BULAN[month.bulan - 1].toUpperCase()} ${month.tahun}`;
        const B = { border: true, valign: 'top', wrap: true };
        const C = { ...B, align: 'center' };
        const H = { border: true, bold: true, fill: 'E5E7EB', align: 'center', valign: 'center', wrap: true };
        const rows = [
            [{ v: `JURNAL MENGAJAR — ${nama}`, s: { bold: true, size: 13 } }],
            [{ v: `${month.guru?.nama || ''}${month.guru?.nip ? ` · ${RP.labelNip(month.guru.nip)}` : ''} · ${RP.SCHOOL}`, s: { color: '475569' } }],
            [],
            ['No', 'Tanggal', 'Hari', 'Kelas', 'Mapel / Catatan', 'Jam ke', 'Status', 'Materi', 'Keterangan'].map((v) => ({ v, s: H })),
        ];
        (month.catatan || []).forEach((c, i) => {
            rows.push([
                { v: i + 1, s: C }, { v: RP.tglPanjang(c.tanggal), s: C }, { v: HARI[hariDari(c.tanggal)], s: C },
                { v: c.kelas ? kelasTitik(c.kelas) : '', s: C }, { v: judulBaris(c), s: B }, { v: c.jam || '', s: C },
                { v: STATUS[c.status] || c.status, s: c.status === 'tidak' ? { ...C, color: 'B91C1C', bold: true } : C },
                { v: c.materi || '', s: B }, { v: c.keterangan || '', s: B },
            ]);
        });
        if (!(month.catatan || []).length) rows.push([{ v: 'Belum ada catatan di bulan ini.', s: { italic: true, color: '64748B' } }]);
        return XB.build({ sheets: [{
            name: `Jurnal ${RP.BULAN[month.bulan - 1]} ${month.tahun}`, rows, merges: ['A1:I1', 'A2:I2'],
            widths: [5, 18, 9, 8, 22, 8, 15, 40, 28], heights: { 1: 22, 4: 22 }, freeze: 'A5', showGrid: false, landscape: true, active: true,
        }] });
    }

    function html(month) {
        const nama = `${RP.BULAN[month.bulan - 1].toUpperCase()} ${month.tahun}`;
        const list = month.catatan || [];
        const body = list.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(tglPendek(c.tanggal))}</td><td>${esc(HARI[hariDari(c.tanggal)])}</td>
            <td>${esc(c.kelas ? kelasTitik(c.kelas) : '')}</td><td class="tl">${esc(judulBaris(c))}</td><td>${esc(c.jam || '')}</td>
            <td class="${c.status === 'tidak' ? 'mrh' : ''}">${esc(STATUS[c.status] || c.status)}</td><td class="tl">${esc(c.materi || '')}</td><td class="tl">${esc(c.keterangan || '')}</td></tr>`).join('');
        const doc = `<style>
                .jr th { background: #e5e7eb; }
                .jr td { white-space: normal; line-height: 1.2; padding: 1mm 2px; height: auto; }
                .jr td.tl { text-align: left; }
                .jr td.mrh { color: #b91c1c; font-weight: 700; }
                .who { font-size: 8.5pt; margin: 0 0 2mm; }
            </style>
            ${RP.kopHtml('JURNAL MENGAJAR', { tahun_ajaran: '' }, nama).replace(/<div>TAHUN PELAJARAN\s*<\/div>/, '<div>CATATAN HARIAN GURU</div>')}
            <div class="who">Nama: <b>${esc(month.guru?.nama || '')}</b>${month.guru?.nip ? ` · ${esc(RP.labelNip(month.guru.nip))}` : ''}</div>
            <table class="jr">
                <colgroup><col style="width:8mm"><col style="width:22mm"><col style="width:15mm"><col style="width:12mm"><col style="width:38mm"><col style="width:13mm"><col style="width:24mm"><col><col style="width:48mm"></colgroup>
                <thead><tr><th>NO</th><th>TANGGAL</th><th>HARI</th><th>KELAS</th><th>MAPEL / CATATAN</th><th>JAM KE</th><th>STATUS</th><th>MATERI</th><th>KETERANGAN</th></tr></thead>
                <tbody>${body || '<tr><td colspan="9">Belum ada catatan di bulan ini.</td></tr>'}</tbody>
            </table>`;
        return RP.wrapDoc(`Jurnal Mengajar ${nama}`, doc, '--rh:5mm;--fs:7.5pt');
    }

    const namaFile = (month) => `Jurnal_Mengajar_${RP.BULAN[month.bulan - 1]}_${month.tahun}`;

    const api = { HARI, STATUS, rentang, susunHari, ringkas, xlsx, html, namaFile, tglPendek, hariDari, titik, kelasTitik };
    if (isNode) module.exports = api;
    else root.Jurnal = Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
