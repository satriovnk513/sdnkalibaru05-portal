// =============================================================================
// Jadwal pelajaran: susunan tabel (sel bergabung), Excel & dokumen cetak.
// Data = hasil RPC get_class_schedule:
//   { kelas{id,nama,tingkat,rombel,tahun_ajaran}, can_edit, wali[], kepala_sekolah,
//     slot[{no,mulai,selesai,istirahat}], isi[{hari,jam,jenis,subject_id,kode,mapel,singkat,kegiatan,staff_id,guru}],
//     mapel[{id,kode,nama,singkat,hidden,guru[{id,nama}]}] }
// Dipakai Portal Guru & Panel Admin (jadwal-ui.js), juga dites di Node.
// =============================================================================
(function (root) {
    'use strict';

    const isNode = typeof module !== 'undefined' && module.exports;
    const RP = isNode ? require('./rekap-print.js') : root.RekapPrint;
    const XB = isNode ? require('./xlsx-book.js') : root.XlsxBook;

    const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
    const HARI_TABEL = ['SENIN', 'SELASA', 'RABU', 'KAMIS', "JUM'AT"];
    /** Nama mapel di tabel (huruf besar, dipendekkan seperti jadwal sekolah). */
    const LABEL = { BIN: 'BHS INDONESIA', BIG: 'BHS INGGRIS', PP: 'PEND. PANCASILA', GAQ: "GEMAR AL-QUR'AN" };
    const KEGIATAN = ['Upacara Bendera', "Dhuha & Gema Qur'an", 'Pulang', 'Senam Pagi', 'Literasi', 'Jumat Bersih', 'Ekstrakurikuler'];

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const titik = (t) => String(t || '').replace(':', '.');
    const waktu = (s) => (s && s.mulai && s.selesai ? `${titik(s.mulai)}–${titik(s.selesai)}` : (s && s.mulai ? `${titik(s.mulai)}` : ''));
    const kelasTitik = (k) => String(k?.nama || k || '').replace(/\s+/, '.');

    /** Hari ini (1 = Senin … 5 = Jumat, 0 = Sabtu/Minggu) dari tanggal ISO. */
    function hariDari(iso) {
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        return w >= 1 && w <= 5 ? w : 0;
    }

    function teks(e, besar) {
        if (!e) return '';
        if (e.jenis === 'kegiatan') return besar ? String(e.kegiatan).toUpperCase() : e.kegiatan;
        if (besar) return LABEL[e.kode] || String(e.singkat || e.mapel || e.kode).toUpperCase();
        return e.singkat || e.mapel || e.kode;
    }
    const kunci = (e) => (e ? `${e.jenis}|${e.subject_id || ''}|${e.kegiatan || ''}|${e.staff_id || ''}` : '');

    /** Peta isi: map.get(`${hari}|${jam}`) → entri. */
    function peta(data) {
        const m = new Map();
        for (const e of data.isi || []) m.set(`${e.hari}|${e.jam}`, e);
        return m;
    }

    /**
     * Susunan tabel: baris per jam; tiap sel {hari, e, rowspan} atau null (tertutup sel di atasnya).
     * Isi yang sama berturut-turut (dan tidak dipisah istirahat) digabung ke bawah.
     */
    function susun(data) {
        const slot = data.slot || [];
        const isi = peta(data);
        const rows = slot.map((s) => ({ slot: s, istirahat: s.istirahat, sel: [] }));
        for (let h = 1; h <= 5; h++) {
            let i = 0;
            while (i < rows.length) {
                if (rows[i].istirahat) { rows[i].sel[h - 1] = null; i += 1; continue; }
                const e = isi.get(`${h}|${rows[i].slot.no}`) || null;
                let span = 1;
                if (e) {
                    while (i + span < rows.length && !rows[i + span].istirahat && kunci(isi.get(`${h}|${rows[i + span].slot.no}`)) === kunci(e)) span += 1;
                }
                rows[i].sel[h - 1] = { hari: h, jam: rows[i].slot.no, e, rowspan: span };
                for (let k = 1; k < span; k++) rows[i + k].sel[h - 1] = null;
                i += span;
            }
        }
        return rows;
    }

    /** Isi satu hari sebagai daftar blok berturut-turut (untuk tampilan HP & beranda). */
    function hariIni(data, hari) {
        const out = [];
        const isi = peta(data);
        for (const s of data.slot || []) {
            const e = s.istirahat ? null : (isi.get(`${hari}|${s.no}`) || null);
            const prev = out[out.length - 1];
            if (prev && !s.istirahat && !prev.istirahat && e && kunci(prev.e) === kunci(e)) {
                prev.sampai = s; prev.jumlah += 1;
            } else {
                out.push({ dari: s, sampai: s, e, istirahat: s.istirahat, jumlah: 1 });
            }
        }
        return out;
    }
    const rentangJam = (b) => (b.jumlah > 1 ? `${b.dari.no}–${b.sampai.no}` : `${b.dari.no}`);
    const rentangWaktu = (b) => {
        const a = b.dari.mulai; const z = b.sampai.selesai;
        return a && z ? `${titik(a)}–${titik(z)}` : (a ? titik(a) : '');
    };

    /** Jadwal mengajar guru (get_teaching_schedule.isi) untuk satu hari, digabung per kelas & mapel berurutan. */
    function mengajarHari(list, hari) {
        const out = [];
        for (const x of (list || []).filter((y) => y.hari === hari)) {
            const prev = out[out.length - 1];
            if (prev && prev.class_id === x.class_id && prev.subject_id === x.subject_id && x.jam === prev.jamAkhir + 1) {
                prev.jamAkhir = x.jam; prev.selesai = x.selesai || prev.selesai;
            } else out.push({ ...x, jamAwal: x.jam, jamAkhir: x.jam });
        }
        return out;
    }

    // ------------------------------------------------------------------ cetak (PDF)
    const CSS = `
        .jt th { background: #e5e7eb; }
        .jt td { white-space: normal; line-height: 1.15; overflow: visible; }
        .jt td.ist { background: #fef9c3; font-weight: 700; letter-spacing: .3em; }
        .jt td.keg { background: #eef2ff; font-weight: 700; }
        .jt td small { display: block; font-size: 6.5pt; font-weight: 400; color: #374151; }
    `;
    function ttd(data, tanggal) {
        const ks = data.kepala_sekolah || {};
        const w = (data.wali || []).find((x) => x.posisi === 1) || (data.wali || [])[0] || {};
        const nm = (v) => esc(RP.namaTtd(v) || '........................');
        return `<div class="foot" style="margin-top:4mm">
            <div class="ttd"><div>Mengetahui,</div><div>Kepala Sekolah</div><div class="sp"></div><b>${nm(ks.nama)}</b><div>NIP. ${esc(ks.nip || '-')}</div></div>
            <div class="ttd"><div>${RP.CITY}, ${esc(RP.tglPanjang(tanggal))}</div><div>Wali Kelas</div><div class="sp"></div><b>${nm(w.nama)}</b><div>NIP. ${esc(w.nip || '-')}</div></div>
        </div>`;
    }
    function hariIniIso() {
        const d = new Date();
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function htmlTabel(data, opts = {}) {
        const rows = susun(data);
        const body = rows.map((r) => {
            if (r.istirahat) return `<tr><td>${r.slot.no}</td><td>${esc(waktu(r.slot))}</td><td colspan="5" class="ist">ISTIRAHAT</td></tr>`;
            return `<tr><td>${r.slot.no}</td><td>${esc(waktu(r.slot))}</td>${r.sel.map((c) => {
                if (!c) return '';
                const e = c.e;
                return `<td${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''} class="${e?.jenis === 'kegiatan' ? 'keg' : ''}">${esc(teks(e, true))}${e?.guru ? `<small>${esc(e.guru)}</small>` : ''}</td>`;
            }).join('')}</tr>`;
        }).join('');
        const html = `<style>${CSS}</style>${RP.kopHtml('JADWAL PELAJARAN', { tahun_ajaran: data.kelas.tahun_ajaran }, `KELAS : ${RP.romawi(`${data.kelas.tingkat}${data.kelas.rombel}`) || data.kelas.nama}`)}
            <table class="jt">
                <colgroup><col style="width:10mm"><col style="width:26mm">${HARI.map(() => '<col>').join('')}</colgroup>
                <thead><tr><th>NO.</th><th>WAKTU</th>${HARI_TABEL.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${body}</tbody>
            </table>
            ${ttd(data, opts.tanggal || hariIniIso())}`;
        return RP.wrapDoc(`Jadwal Pelajaran ${data.kelas.nama}`, html, RP.fit(rows.length, 120, 10));
    }

    // ------------------------------------------------------------------ Excel
    function xlsx(data, opts = {}) {
        const rows = susun(data);
        const B = { border: true, align: 'center', valign: 'center', wrap: true };
        const H = { ...B, bold: true, fill: 'E5E7EB' };
        const out = [
            [{ v: `JADWAL PELAJARAN KELAS ${kelasTitik(data.kelas)}`, s: { bold: true, size: 13, align: 'center' } }],
            [{ v: RP.SCHOOL, s: { bold: true, align: 'center' } }],
            [{ v: `TAHUN PELAJARAN ${RP.tpLabel(data.kelas.tahun_ajaran)}`, s: { align: 'center' } }],
            [],
            ['NO.', 'WAKTU', ...HARI_TABEL].map((v) => ({ v, s: H })),
        ];
        const merges = ['A1:G1', 'A2:G2', 'A3:G3'];
        const heights = { 1: 22, 5: 22 };
        rows.forEach((r, i) => {
            const rn = 6 + i;
            heights[rn] = 30;
            if (r.istirahat) {
                out.push([{ v: r.slot.no, s: B }, { v: waktu(r.slot), s: B }, { v: 'ISTIRAHAT', s: { ...B, bold: true, fill: 'FEF9C3' } }, { v: '', s: B }, { v: '', s: B }, { v: '', s: B }, { v: '', s: B }]);
                merges.push(`C${rn}:G${rn}`);
                return;
            }
            const line = [{ v: r.slot.no, s: B }, { v: waktu(r.slot), s: B }];
            for (let h = 0; h < 5; h++) {
                const c = r.sel[h];
                if (!c) { line.push({ v: '', s: B }); continue; }
                const e = c.e;
                line.push({ v: `${teks(e, true)}${e?.guru ? `\n${e.guru}` : ''}`, s: e?.jenis === 'kegiatan' ? { ...B, bold: true, fill: 'EEF2FF' } : B });
                if (c.rowspan > 1) merges.push(`${RP.colName(2 + h)}${rn}:${RP.colName(2 + h)}${rn + c.rowspan - 1}`);
            }
            out.push(line);
        });
        return XB.build({ sheets: [{
            name: `Jadwal ${data.kelas.nama}`, rows: out, merges, heights, widths: [6, 13, 22, 22, 22, 22, 22],
            showGrid: false, landscape: true, fitHeight: 1, active: true, logo: opts.logo ? { png: opts.logo, px: 44 } : null,
        }] });
    }

    const namaFile = (data) => `Jadwal Pelajaran Kelas ${data.kelas.nama} ${String(data.kelas.tahun_ajaran || '').replace('/', '-')}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');

    const api = { HARI, KEGIATAN, hariDari, teks, susun, hariIni, rentangJam, rentangWaktu, mengajarHari, waktu, titik, htmlTabel, xlsx, namaFile, kelasTitik };
    if (isNode) module.exports = api;
    else root.Jadwal = Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
