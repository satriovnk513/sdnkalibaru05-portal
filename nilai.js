// =============================================================================
// Nilai rapor: rumus, Excel (template, unduh, impor) & dokumen cetak (PDF).
// Dipakai Portal Guru dan Panel Admin. Data = hasil RPC get_class_grades:
//   { kelas{id,nama,tingkat,rombel,tahun_ajaran}, semester, wali[], kepala_sekolah,
//     mapel[{id,kode,nama,singkat,kktp,hidden,jumlah_uh,guru_mapel[],can_edit}],
//     siswa[{id,no,nama,jk,nis,nisn}], nilai[{s,m,uh1..uh10,sts,sas}] }
// Jumlah kolom UH berbeda-beda tiap kelas+mapel+semester (1–10, bawaan 3);
// semua yang di bawah ini membacanya dari mapel.jumlah_uh.
// Nilai Akhir = ROUND(50% × rata-rata UH yang terisi + 25% STS + 25% SAS).
// =============================================================================
(function (root) {
    'use strict';

    const isNode = typeof module !== 'undefined' && module.exports;
    const RP = isNode ? require('./rekap-print.js') : root.RekapPrint;
    const XB = isNode ? require('./xlsx-book.js') : root.XlsxBook;

    const UH_MIN = 1;
    const UH_MAX = 10;
    const UH_BAWAAN = 3;
    /** Jumlah kolom UH mapel ini; 3 kalau belum pernah diatur. */
    const uhCount = (m) => {
        const n = Number(m && m.jumlah_uh);
        return Number.isFinite(n) && n >= UH_MIN && n <= UH_MAX ? Math.trunc(n) : UH_BAWAAN;
    };
    /** ['uh1', …, 'uh<n>'] */
    const uhKeys = (m) => Array.from({ length: uhCount(m) }, (_, i) => `uh${i + 1}`);
    /** Kolom yang diisi untuk mapel ini: UH sebanyak jumlahnya, lalu STS & SAS. */
    const fieldsOf = (m) => [...uhKeys(m), 'sts', 'sas'];
    const FIELDS = fieldsOf(null);
    /** Semua nama kolom yang mungkin muncul di file Excel (UH 1–10 + STS + SAS). */
    const SEMUA_FIELD = [...Array.from({ length: UH_MAX }, (_, i) => `uh${i + 1}`), 'sts', 'sas'];
    const LABEL = { sts: 'STS', sas: 'SAS', kktp: 'KKTP', jumlah_uh: 'Jumlah UH' };
    for (let i = 1; i <= UH_MAX; i++) LABEL[`uh${i}`] = `UH ${i}`;
    const SEM = (s) => (Number(s) === 2 ? 'Genap' : 'Ganjil');

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const has = (v) => v !== null && v !== undefined && v !== '';
    /** Pembulatan biasa (0,5 ke atas) — sama dengan ROUND di Excel untuk angka positif. */
    const round = (x, d = 0) => { const f = 10 ** d; return Math.round((x + Number.EPSILON) * f) / f; };

    /**
     * { rataUh, akhir, uhKurang, lengkap } dari satu baris nilai.
     * m = mapelnya (untuk tahu berapa kolom UH); tanpa m dianggap 3 kolom.
     */
    function hitung(n = {}, m = null) {
        const keys = uhKeys(m);
        const uh = keys.map((k) => n[k]).filter(has).map(Number);
        const rataUh = uh.length ? round(uh.reduce((a, b) => a + b, 0) / uh.length, 1) : null;
        const akhir = uh.length && has(n.sts) && has(n.sas)
            ? round((uh.reduce((a, b) => a + b, 0) / uh.length) * 0.5 + Number(n.sts) * 0.25 + Number(n.sas) * 0.25)
            : null;
        return { rataUh, akhir, uhKurang: keys.length - uh.length, lengkap: fieldsOf(m).every((k) => has(n[k])) };
    }

    /** 'tuntas' | 'belum' | 'kktp' (KKTP belum diisi) | 'kosong' (NA belum bisa dihitung) | '' (belum ada nilai sama sekali). */
    function status(n, kktp, m = null) {
        const h = hitung(n, m);
        if (h.akhir === null) return fieldsOf(m).some((k) => has(n?.[k])) ? 'kosong' : '';
        if (!has(kktp)) return 'kktp';
        return h.akhir >= Number(kktp) ? 'tuntas' : 'belum';
    }

    /** Peta nilai: map.get(studentId + '|' + subjectId) → baris nilai. */
    function peta(data) {
        const m = new Map();
        for (const n of data.nilai || []) m.set(`${n.s}|${n.m}`, n);
        return m;
    }

    function kelasLabel(k) { return RP.romawi(`${k.tingkat}${k.rombel}`) || k.nama; }
    function namaFile(jenis, data, extra = '') {
        return `${jenis} Kelas ${data.kelas.nama} Smt ${data.semester} ${String(data.kelas.tahun_ajaran || '').replace('/', '-')}${extra ? ` ${extra}` : ''}`
            .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
    }

    // ------------------------------------------------------------------ Excel
    const S = {
        title: { bold: true, size: 13 },
        sub: { color: '475569' },
        kktpLbl: { bold: true, align: 'right' },
        kktp: { bold: true, size: 12, fill: 'FEF3C7', border: true, align: 'center', locked: false },
        hint: { italic: true, size: 9, color: '64748B' },
        code: { size: 8, color: '94A3B8' },
        head: { bold: true, fill: 'E2E8F0', border: true, align: 'center', wrap: true },
        cell: { border: true, align: 'center' },
        txt: { border: true, align: 'center', text: true },
        name: { border: true, align: 'left' },
        input: { border: true, align: 'center', locked: false },
        calc: { border: true, align: 'center', fill: 'F1F5F9' },
        calcB: { border: true, align: 'center', fill: 'F1F5F9', bold: true },
        ro: { border: true, align: 'center', fill: 'F8FAFC', color: '475569' },
    };
    const kodeBaris = (m, data) => `#NILAI|MAPEL:${m.kode}|KELAS:${data.kelas.id}|SEM:${data.semester} (jangan diubah)`;

    function lembarMapel(data, m, nilai, isi) {
        const siswa = data.siswa || [];
        const edit = Boolean(m.can_edit);
        const pengisi = m.guru_mapel?.length ? `Guru mapel: ${m.guru_mapel.join(', ')}` : 'Diisi wali kelas';
        const keys = fieldsOf(m);
        const n_uh = uhCount(m);
        // Kolom: A No, B NIS, C NISN, D Nama, lalu UH sebanyak n_uh, STS, SAS, Rata UH, Nilai Akhir, Keterangan.
        const C = (i) => RP.colName(i - 1);             // 1 → A
        const uhA = C(5); const uhZ = C(4 + n_uh);      // rentang UH
        const cSts = C(5 + n_uh); const cSas = C(6 + n_uh);
        const cRata = C(7 + n_uh); const cNa = C(8 + n_uh); const cKet = C(9 + n_uh);
        const akhir = cKet;                             // kolom terakhir
        const isiA = uhA; const isiZ = cSas;            // semua kotak yang diisi guru
        const rows = [
            [{ v: `NILAI RAPOR — ${String(m.nama).toUpperCase()}${edit ? '' : ' (hanya lihat)'}`, s: S.title }],
            [{ v: `Kelas ${kelasLabel(data.kelas)} · Semester ${SEM(data.semester)} ${data.kelas.tahun_ajaran || ''} · ${RP.SCHOOL} · ${pengisi}`, s: S.sub }],
            [null, null, { v: 'KKTP', s: S.kktpLbl }, { v: has(m.kktp) ? Number(m.kktp) : null, s: edit ? S.kktp : { ...S.kktp, locked: true } }, { v: edit ? '← isi batas tuntas mapel ini' : '', s: S.hint }],
            [{ v: kodeBaris(m, data), s: S.code }],
            [],
            ['No', 'NIS', 'NISN', 'Nama Siswa',
                ...Array.from({ length: n_uh }, (_, i) => `UH ${i + 1}`),
                'STS', 'SAS', 'Rata UH', 'Nilai Akhir', 'Keterangan'].map((v) => ({ v, s: S.head })),
        ];
        siswa.forEach((st, i) => {
            const r = 7 + i;
            const n = isi ? (nilai.get(`${st.id}|${m.id}`) || {}) : {};
            const uhR = `${uhA}${r}:${uhZ}${r}`;        // kotak UH baris ini
            const isiR = `${isiA}${r}:${isiZ}${r}`;     // UH + STS + SAS baris ini
            rows.push([
                { v: st.no ?? i + 1, s: S.cell },
                { v: st.nis || '', s: S.txt },
                { v: st.nisn || '', s: S.txt },
                { v: String(st.nama || '').toUpperCase(), s: S.name },
                ...keys.map((k) => ({ v: has(n[k]) ? Number(n[k]) : null, s: edit ? S.input : S.ro })),
                { f: `IF(COUNT(${uhR})=0,"",ROUND(AVERAGE(${uhR}),1))`, s: S.calc },
                { f: `IF(OR(COUNT(${uhR})=0,${cSts}${r}="",${cSas}${r}=""),"",ROUND(AVERAGE(${uhR})*0.5+${cSts}${r}*0.25+${cSas}${r}*0.25,0))`, s: S.calcB },
                { f: `IF(${cNa}${r}="",IF(COUNTBLANK(${isiR})>0,IF(COUNTBLANK(${isiR})=${n_uh + 2},"","Belum lengkap"),""),IF($D$3="","KKTP kosong",IF(${cNa}${r}>=$D$3,"Tuntas","Belum tuntas"))&IF(COUNTBLANK(${uhR})>0," · UH belum lengkap",""))`, s: S.calc },
            ]);
        });
        const last = 6 + Math.max(siswa.length, 1);
        const kotak = `${isiA}7:${isiZ}${last}`;
        return {
            name: m.nama,
            rows,
            merges: [1, 2, 4].map((r) => `A${r}:${akhir}${r}`),
            widths: [5, 8, 13, 32, ...Array(n_uh + 2).fill(7), 9, 10, 30],
            heights: { 1: 22, 6: 30 },
            freeze: 'E7',
            protect: true,
            showGrid: false,
            landscape: true,
            validations: edit ? [
                { sqref: kotak, min: 0, max: 100, error: 'Isi angka bulat 0 sampai 100.' },
                { sqref: 'D3', min: 0, max: 100, error: 'KKTP berupa angka bulat 0 sampai 100.' },
            ] : [],
            conditional: [
                ...(edit ? [{ sqref: kotak, formula: `ISBLANK(${isiA}7)`, style: { fill: 'FEF3C7' } }] : []),
                { sqref: `${cNa}7:${cNa}${last}`, formula: `AND(${cNa}7<>"",$D$3<>"",${cNa}7<$D$3)`, style: { color: 'B91C1C', bold: true } },
                { sqref: `${cKet}7:${cKet}${last}`, formula: `LEFT(${cKet}7,6)="Tuntas"`, style: { fill: 'DCFCE7', color: '166534' } },
                { sqref: `${cKet}7:${cKet}${last}`, formula: `LEFT(${cKet}7,12)="Belum tuntas"`, style: { fill: 'FEE2E2', color: '991B1B' } },
            ],
        };
    }

    function lembarPetunjuk(data, mapel, isi) {
        const t = (v, s) => [null, { v, s: { wrap: true, valign: 'top', ...(s || {}) } }];
        const rows = [
            t(`${isi ? 'NILAI RAPOR' : 'TEMPLATE NILAI RAPOR'} — KELAS ${kelasLabel(data.kelas)}`, { bold: true, size: 14 }),
            t(`${RP.SCHOOL} · Semester ${SEM(data.semester)} ${data.kelas.tahun_ajaran || ''}`, { size: 11, color: '475569' }),
            [],
            t('Cara mengisi', { bold: true, size: 12 }),
            t('1.  Satu lembar (sheet) = satu mata pelajaran. Pindah mapel lewat tab di bawah.'),
            t('2.  Isi KKTP di kotak kuning bagian atas tiap lembar.'),
            t('3.  Isi semua kolom UH, lalu STS dan SAS, dengan angka bulat 0–100. Kotak kuning = belum dinilai.'),
            t('     Jumlah kolom UH tiap mapel bisa berbeda; ikuti saja kolom yang ada di lembarnya. Untuk menambah atau mengurangi kolom UH, ubah dari Portal Guru (Nilai → mapel → Atur jumlah UH), bukan dari file ini.'),
            t('4.  Rata-rata UH, Nilai Akhir, dan Keterangan terhitung otomatis.'),
            t('5.  Jangan ubah kolom NIS / nama dan baris kode abu-abu di atas tabel — dipakai portal untuk mencocokkan siswa.'),
            t('6.  Simpan, lalu di Portal Guru: Nilai → Impor Excel → pilih file ini. Portal menampilkan pratinjau dulu sebelum menyimpan.'),
            t('7.  Kotak yang dikosongkan tidak menghapus nilai yang sudah ada di portal.'),
            [],
            t('Rumus Nilai Akhir = ROUND( 50% × rata-rata UH yang terisi + 25% × STS + 25% × SAS ). Nilai Akhir kosong bila STS atau SAS belum diisi.', { italic: true, color: '475569' }),
            [],
            t(`Mapel di file ini: ${mapel.map((m) => m.nama + (m.can_edit ? '' : ' (hanya lihat)')).join(', ') || '-'}`, { color: '475569' }),
        ];
        const heights = {};
        for (let i = 5; i <= 12; i++) heights[i] = 20;
        heights[6] = 34;
        heights[14] = 30;
        heights[16] = 30;
        return { name: 'Petunjuk', rows, widths: [3, 100], heights, showGrid: false, landscape: false };
    }

    function lembarLeger(data, mapel, nilai) {
        const siswa = data.siswa || [];
        const H = (v) => ({ v, s: S.head });
        const rows = [
            [{ v: `LEGER NILAI AKHIR — KELAS ${kelasLabel(data.kelas)}`, s: S.title }],
            [{ v: `Semester ${SEM(data.semester)} ${data.kelas.tahun_ajaran || ''} · ${RP.SCHOOL}`, s: S.sub }],
            [],
            [H('No'), H('NIS'), H('Nama Siswa'), H('L/P'), ...mapel.map((m) => H(m.kode)), H('Jumlah'), H('Rata-rata')],
            [{ v: 'KKTP', s: { ...S.calc, italic: true, align: 'right' } }, { v: '', s: S.calc }, { v: '', s: S.calc }, { v: '', s: S.calc },
                ...mapel.map((m) => ({ v: has(m.kktp) ? Number(m.kktp) : '', s: { ...S.calc, italic: true } })), { v: '', s: S.calc }, { v: '', s: S.calc }],
        ];
        siswa.forEach((st, i) => {
            const na = mapel.map((m) => hitung(nilai.get(`${st.id}|${m.id}`), m).akhir);
            const ada = na.filter((x) => x !== null);
            const jml = ada.reduce((a, b) => a + b, 0);
            rows.push([
                { v: st.no ?? i + 1, s: S.cell }, { v: st.nis || '', s: S.txt }, { v: String(st.nama || '').toUpperCase(), s: S.name }, { v: st.jk || '', s: S.cell },
                ...na.map((v, j) => ({ v: v === null ? '–' : v, s: v !== null && has(mapel[j].kktp) && v < Number(mapel[j].kktp) ? { ...S.cell, color: 'C00000', bold: true } : S.cell })),
                { v: ada.length ? jml : '', s: { ...S.cell, bold: true } },
                { v: ada.length ? round(jml / ada.length, 1) : '', s: { ...S.cell, bold: true } },
            ]);
        });
        const w = 4 + mapel.length + 2;
        return {
            name: 'Leger',
            rows,
            merges: [`A1:${RP.colName(w - 1)}1`, `A2:${RP.colName(w - 1)}2`],
            widths: [5, 8, 30, 5, ...mapel.map(() => 7), 8, 9],
            heights: { 1: 22, 4: 30 },
            freeze: 'E6',
            showGrid: false,
            landscape: true,
            fitHeight: 1,
        };
    }

    /**
     * Buku Excel nilai. opts.mapelIds: daftar id mapel (default semua yang tampil);
     * opts.isi: true = berisi nilai saat ini (unduhan), false = template kosong;
     * opts.leger: tambahkan lembar Leger (unduhan).
     */
    function buku(data, opts = {}) {
        const pilih = new Set(opts.mapelIds || []);
        const mapel = (data.mapel || []).filter((m) => !m.hidden && (!pilih.size || pilih.has(m.id)));
        const nilai = peta(data);
        const isi = opts.isi !== false;
        const sheets = [lembarPetunjuk(data, mapel, isi)];
        for (const m of mapel) sheets.push(lembarMapel(data, m, nilai, isi));
        if (opts.leger && mapel.length) sheets.push(lembarLeger(data, mapel, nilai));
        if (sheets[1]) sheets[1].active = true;
        return XB.build({ sheets });
    }

    // ------------------------------------------------------------------ Impor
    const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const idnum = (s) => String(s ?? '').trim().replace(/\.0+$/, '').replace(/^'+/, '');

    function kolomHeader(row) {
        const map = {};
        (row || []).forEach((v, i) => {
            const t = norm(v).replace(/\s+/g, '');
            if (t === 'NIS' && map.nis === undefined) map.nis = i;
            else if (t === 'NISN') map.nisn = i;
            else if (t.startsWith('NAMA') && map.nama === undefined) map.nama = i;
            else if (/^UH(10|[1-9])$/.test(t)) map[`uh${t.slice(2)}`] = i;
            else if (t === 'STS' || t === 'PTS') map.sts = i;
            else if (t === 'SAS' || t === 'PAS') map.sas = i;
        });
        return map;
    }

    /** Angka bulat 0–100 dari teks sel; null kalau kosong; { galat } kalau tidak sah. */
    function angka(raw) {
        const s = String(raw ?? '').trim().replace(',', '.');
        if (!s) return null;
        if (!/^-?\d+(\.\d+)?$/.test(s)) return { galat: `"${raw}" bukan angka` };
        const n = Number(s);
        if (!Number.isInteger(round(n, 6))) return { galat: `${s.replace('.', ',')} bukan bilangan bulat` };
        if (n < 0 || n > 100) return { galat: `${n} di luar 0–100` };
        return round(n);
    }

    /**
     * Baca buku Excel (hasil XlsxRead.readBook) terhadap data kelas saat ini.
     * Kotak kosong diabaikan (tidak menghapus). Hasil:
     *  { lembar:[{ nama, mapel, status:'ok'|'lewati', alasan, kktp:{lama,baru}|null,
     *              perubahan:[{siswa,field,lama,baru}], galat:[], peringatan:[] }],
     *    items (untuk save_grades), total:{ baru, berubah, galat, mapel } }
     */
    function bacaImpor(book, data) {
        const nilai = peta(data);
        const siswa = data.siswa || [];
        const byNis = new Map(); const byNisn = new Map(); const byNama = new Map();
        for (const s of siswa) {
            if (s.nis) byNis.set(idnum(s.nis), s);
            if (s.nisn) byNisn.set(idnum(s.nisn), s);
            byNama.set(norm(s.nama), s);
        }
        const mapelByKode = new Map((data.mapel || []).map((m) => [String(m.kode).toUpperCase(), m]));
        const mapelByNama = new Map();
        for (const m of data.mapel || []) for (const k of [m.nama, m.singkat, m.kode]) if (k) mapelByNama.set(norm(k), m);

        const lembar = [];
        const items = [];
        const sudah = new Set();
        const total = { baru: 0, berubah: 0, galat: 0, mapel: 0 };

        for (const sh of book || []) {
            const rows = sh.rows || [];
            let headerIdx = -1;
            for (let i = 0; i < Math.min(rows.length, 30); i++) {
                const h = kolomHeader(rows[i]);
                if (h.nama !== undefined && SEMUA_FIELD.some((k) => h[k] !== undefined)) { headerIdx = i; break; }
            }
            if (headerIdx < 0) continue;   // Petunjuk, Leger, lembar lain → diam-diam dilewati
            const hasil = { nama: sh.name, mapel: null, status: 'lewati', alasan: '', kktp: null, perubahan: [], galat: [], peringatan: [] };
            lembar.push(hasil);

            let kode = null; let kelasId = null; let sem = null; let kktpRaw;
            for (let i = 0; i < headerIdx; i++) {
                const r = rows[i] || [];
                for (let j = 0; j < r.length; j++) {
                    const v = String(r[j] ?? '');
                    const m = /^#(?:NILAI|KODE)\b(.*)$/i.exec(v.trim());
                    if (m) {
                        kode = /MAPEL:([A-Z0-9_-]+)/i.exec(v)?.[1] || /#KODE:([A-Z0-9_-]+)/i.exec(v)?.[1] || null;
                        kelasId = /KELAS:([0-9a-f-]{36})/i.exec(v)?.[1] || null;
                        sem = /SEM:(\d)\b/.exec(v)?.[1] || null;
                    }
                    if (norm(v) === 'KKTP' && kktpRaw === undefined) {
                        kktpRaw = r[j + 1] ?? '';
                    }
                }
            }
            const m = (kode && mapelByKode.get(kode.toUpperCase())) || mapelByNama.get(norm(sh.name)) || null;
            hasil.mapel = m;
            if (!m) { hasil.alasan = 'Mapel tidak dikenali dari nama lembar.'; continue; }
            if (kelasId && kelasId !== data.kelas.id) { hasil.alasan = 'File ini untuk kelas lain.'; continue; }
            if (sem && Number(sem) !== Number(data.semester)) { hasil.alasan = `File ini untuk semester ${SEM(sem).toLowerCase()}.`; continue; }
            if (m.hidden) { hasil.alasan = 'Mapel disembunyikan di kelas ini.'; continue; }
            if (!m.can_edit) {
                hasil.alasan = m.guru_mapel?.length ? `Diisi guru mapel (${m.guru_mapel.join(', ')}).` : 'Kamu tidak berhak mengubah mapel ini.';
                continue;
            }
            if (sudah.has(m.id)) { hasil.alasan = 'Mapel ini sudah dibaca dari lembar lain.'; continue; }
            sudah.add(m.id);
            hasil.status = 'ok';

            const item = { subject_id: m.id, entries: [] };
            if (kktpRaw !== undefined) {
                const k = angka(kktpRaw);
                if (k && typeof k === 'object') hasil.galat.push(`KKTP: ${k.galat}`);
                else if (k !== null && Number(k) !== (has(m.kktp) ? Number(m.kktp) : null)) {
                    item.kktp = k;
                    hasil.kktp = { lama: has(m.kktp) ? Number(m.kktp) : null, baru: k };
                }
            }

            const col = kolomHeader(rows[headerIdx]);
            const keys = fieldsOf(m);
            // Kolom UH di luar jumlah UH mapel ini akan ditolak server, jadi diperingatkan di sini.
            for (let k = uhCount(m) + 1; k <= UH_MAX; k++) {
                if (col[`uh${k}`] !== undefined) {
                    hasil.peringatan.push(`Kolom UH ${k} diabaikan — mapel ini hanya punya ${uhCount(m)} kolom UH.`);
                }
            }
            const dipakai = new Set();
            for (let i = headerIdx + 1; i < rows.length; i++) {
                const r = rows[i] || [];
                const nama = String(r[col.nama] ?? '').trim();
                const nis = col.nis !== undefined ? idnum(r[col.nis]) : '';
                const nisn = col.nisn !== undefined ? idnum(r[col.nisn]) : '';
                const vals = keys.map((k) => (col[k] !== undefined ? r[col[k]] : ''));
                if (!nama && !nis && !nisn) continue;
                if (vals.every((v) => !String(v ?? '').trim())) continue;
                const st = (nis && byNis.get(nis)) || (nisn && byNisn.get(nisn)) || byNama.get(norm(nama));
                const baris = `Baris ${i + 1}`;
                if (!st) { hasil.peringatan.push(`${baris}: ${nama || nis || nisn} tidak ada di daftar kelas — dilewati.`); continue; }
                if (dipakai.has(st.id)) { hasil.peringatan.push(`${baris}: ${st.nama} muncul dua kali — baris ini dilewati.`); continue; }
                dipakai.add(st.id);
                const lama = nilai.get(`${st.id}|${m.id}`) || {};
                const entry = { student_id: st.id };
                keys.forEach((k, j) => {
                    if (col[k] === undefined) return;
                    const v = angka(vals[j]);
                    if (v === null) return;
                    if (typeof v === 'object') { hasil.galat.push(`${baris} ${LABEL[k]} (${st.nama}): ${v.galat}`); return; }
                    const old = has(lama[k]) ? Number(lama[k]) : null;
                    if (old === v) return;
                    entry[k] = v;
                    hasil.perubahan.push({ siswa: st, field: k, lama: old, baru: v });
                    if (old === null) total.baru += 1; else total.berubah += 1;
                });
                if (Object.keys(entry).length > 1) item.entries.push(entry);
            }
            total.galat += hasil.galat.length;
            if (item.entries.length || item.kktp !== undefined) { items.push(item); total.mapel += 1; }
        }
        return { lembar, items, total };
    }

    // ------------------------------------------------------------------ Cetak (PDF)
    const CSS = `
        .sub2 { display: flex; gap: 6mm; font-size: 8pt; margin: 0 0 1.5mm; }
        .lg th { background: #e5e7eb; }
        .lg tr.kk td { background: #f8fafc; font-style: italic; }
        td.mrh { color: #c00000; font-weight: 700; }
        td.b { font-weight: 700; }
        td.tl { text-align: left; }
        .catat { font-size: 6.5pt; font-style: italic; margin-top: 1mm; }
    `;

    function hariIni() {
        const d = new Date();
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function ttd(data, kananJudul, kananNama, kananNip, tanggal) {
        const ks = data.kepala_sekolah || {};
        const nm = (v) => esc(RP.namaTtd(v) || '........................');
        return `<div class="foot" style="margin-top:4mm">
            <div class="ttd"><div>Mengetahui,</div><div>Kepala Sekolah</div><div class="sp"></div><b>${nm(ks.nama)}</b><div>NIP. ${esc(ks.nip || '-')}</div></div>
            <div class="ttd"><div>${RP.CITY}, ${esc(RP.tglPanjang(tanggal))}</div><div>${esc(kananJudul)}</div><div class="sp"></div><b>${nm(kananNama)}</b><div>NIP. ${esc(kananNip || '-')}</div></div>
        </div>`;
    }
    const wali1 = (data) => (data.wali || []).find((w) => w.posisi === 1) || (data.wali || [])[0] || {};
    const kop = (judul, data) => `<style>${CSS}</style>${RP.kopHtml(judul, { tahun_ajaran: `${data.kelas.tahun_ajaran || ''} · SEMESTER ${SEM(data.semester).toUpperCase()}` }, `KELAS : ${kelasLabel(data.kelas)}`)}`;

    /** Daftar nilai satu mapel (UH, STS, SAS, NA, keterangan). */
    function htmlMapel(data, subjectId, opts = {}) {
        const m = (data.mapel || []).find((x) => x.id === subjectId);
        if (!m) throw new Error('Mapel tidak ditemukan.');
        const nilai = peta(data);
        const siswa = data.siswa || [];
        const KET = { tuntas: 'Tuntas', belum: 'Belum tuntas', kktp: 'KKTP kosong', kosong: 'Belum lengkap', '': '' };
        const rows = siswa.map((st, i) => {
            const n = nilai.get(`${st.id}|${m.id}`) || {};
            const h = hitung(n, m);
            const stt = status(n, m.kktp, m);
            return `<tr><td>${esc(st.no ?? i + 1)}</td><td>${esc(st.nis || '')}</td><td class="nm">${esc(String(st.nama || '').toUpperCase())}</td><td>${esc(st.jk || '')}</td>
                ${uhKeys(m).map((k) => `<td>${has(n[k]) ? n[k] : ''}</td>`).join('')}
                <td>${h.rataUh === null ? '' : String(h.rataUh).replace('.', ',')}</td><td>${has(n.sts) ? n.sts : ''}</td><td>${has(n.sas) ? n.sas : ''}</td>
                <td class="b${stt === 'belum' ? ' mrh' : ''}">${h.akhir === null ? '' : h.akhir}</td><td class="tl">${KET[stt]}${h.akhir !== null && h.uhKurang ? ' · UH belum lengkap' : ''}</td></tr>`;
        }).join('');
        const guru = m.guru_mapel?.length ? m.guru_mapel.join(', ') : (wali1(data).nama || '-');
        const body = `${kop(`DAFTAR NILAI ${String(m.nama).toUpperCase()}`, data)}
            <div class="sub2"><span>Mata pelajaran: <b>${esc(m.nama)}</b></span><span>KKTP: <b>${has(m.kktp) ? esc(m.kktp) : '-'}</b></span><span>Guru: ${esc(guru)}</span></div>
            <table class="lg">
                <colgroup><col style="width:8mm"><col style="width:14mm"><col><col style="width:8mm">${'<col style="width:14mm">'.repeat(6)}<col style="width:19mm"><col style="width:52mm"></colgroup>
                <thead><tr><th>NO</th><th>NIS</th><th>NAMA</th><th>L/P</th>${uhKeys(m).map((_, i) => `<th>UH ${i + 1}</th>`).join('')}<th>RATA UH</th><th>STS</th><th>SAS</th><th>NILAI AKHIR</th><th>KETERANGAN</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="catat">Nilai Akhir = 50% rata-rata UH + 25% STS + 25% SAS (dibulatkan). Angka merah = di bawah KKTP.</div>
            ${m.guru_mapel?.length
        ? ttd(data, 'Guru Mata Pelajaran', m.guru_mapel[0], '', opts.tanggal || hariIni())
        : ttd(data, 'Wali Kelas', wali1(data).nama, wali1(data).nip, opts.tanggal || hariIni())}`;
        return RP.wrapDoc(`Daftar Nilai ${m.nama} ${data.kelas.nama}`, body, RP.fit(siswa.length, 128, 6));
    }

    /** Leger nilai akhir semua mapel yang tampil. */
    function htmlLeger(data, opts = {}) {
        const mapel = (data.mapel || []).filter((m) => !m.hidden);
        const nilai = peta(data);
        const siswa = data.siswa || [];
        const rows = siswa.map((st, i) => {
            const na = mapel.map((m) => hitung(nilai.get(`${st.id}|${m.id}`), m).akhir);
            const ada = na.filter((x) => x !== null);
            const jml = ada.reduce((a, b) => a + b, 0);
            return `<tr><td>${esc(st.no ?? i + 1)}</td><td>${esc(st.nis || '')}</td><td class="nm">${esc(String(st.nama || '').toUpperCase())}</td><td>${esc(st.jk || '')}</td>
                ${na.map((v, j) => `<td class="${v !== null && has(mapel[j].kktp) && v < Number(mapel[j].kktp) ? 'mrh' : ''}">${v === null ? '–' : v}</td>`).join('')}
                <td class="b">${ada.length ? jml : ''}</td><td class="b">${ada.length ? String(round(jml / ada.length, 1)).replace('.', ',') : ''}</td></tr>`;
        }).join('');
        const w = mapel.length ? `calc((100% - 80mm - 32mm) / ${mapel.length})` : 'auto';
        const body = `${kop('LEGER NILAI AKHIR SISWA', data)}
            <table class="lg">
                <colgroup><col style="width:8mm"><col style="width:12mm"><col style="width:52mm"><col style="width:8mm">${mapel.map(() => `<col style="width:${w}">`).join('')}<col style="width:14mm"><col style="width:18mm"></colgroup>
                <thead>
                    <tr><th rowspan="2">NO</th><th rowspan="2">NIS</th><th rowspan="2">NAMA</th><th rowspan="2">L/P</th><th colspan="${Math.max(mapel.length, 1)}">NILAI AKHIR MATA PELAJARAN</th><th rowspan="2">JUMLAH</th><th rowspan="2">RATA-RATA</th></tr>
                    <tr>${mapel.map((m) => `<th>${esc(m.kode)}</th>`).join('')}</tr>
                    <tr class="kk"><td colspan="4" style="text-align:right">KKTP</td>${mapel.map((m) => `<td>${has(m.kktp) ? esc(m.kktp) : ''}</td>`).join('')}<td></td><td></td></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="catat">${mapel.map((m) => `${esc(m.kode)} = ${esc(m.nama)}`).join(' · ')}. Angka merah = di bawah KKTP. “–” = belum lengkap.</div>
            ${ttd(data, 'Wali Kelas', wali1(data).nama, wali1(data).nip, opts.tanggal || hariIni())}`;
        return RP.wrapDoc(`Leger Nilai ${data.kelas.nama}`, body, RP.fit(siswa.length + 1, 120, 6));
    }

    const api = { FIELDS, SEMUA_FIELD, LABEL, SEM, UH_MIN, UH_MAX, UH_BAWAAN, uhCount, uhKeys, fieldsOf,
        hitung, status, peta, buku, bacaImpor, angka, htmlMapel, htmlLeger, namaFile, kelasLabel };
    if (isNode) module.exports = api;
    else root.Nilai = Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
