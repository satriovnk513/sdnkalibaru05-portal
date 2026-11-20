// =============================================================================
// Catatan Siswa: hitungan per siswa, label, dokumen cetak (rangkuman semester
// satu kelas & catatan satu siswa). Data = hasil RPC get_class_notes /
// get_student_notes. Dipakai Portal Guru & Panel Admin; dites di Node.
// =============================================================================
(function (root) {
    'use strict';

    const isNode = typeof module !== 'undefined' && module.exports;
    const RP = isNode ? require('./rekap-print.js') : root.RekapPrint;

    const JENIS = { apresiasi: 'Apresiasi', perilaku: 'Perilaku', catatan: 'Catatan' };
    const TINGKAT = { ringan: 'Ringan', perhatian: 'Perlu perhatian', serius: 'Serius' };
    const SARAN = {
        apresiasi: ['Juara lomba', 'Rajin & tepat waktu', 'Membantu teman', 'Nilai meningkat', 'Aktif di kelas'],
        perilaku: ['Bertengkar dengan teman', 'Sering terlambat', 'Tidak mengerjakan tugas', 'Bermain HP saat pelajaran', 'Berkata kasar'],
        catatan: ['Sering mengantuk', 'Kondisi kesehatan', 'Kondisi keluarga', 'Perlu bimbingan membaca', 'Pindahan sekolah lain'],
    };
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const kelasTitik = (k) => String(k?.nama || k || '').replace(/\s+/, '.');

    function label(n) {
        if (n.jenis === 'perilaku') return `Perilaku · ${TINGKAT[n.tingkat] || 'Ringan'}`;
        return JENIS[n.jenis] || n.jenis;
    }
    /** Kode singkat untuk tabel cetak: ★ apresiasi, ! R/P/S perilaku, ✎ catatan. */
    function kode(n) {
        if (n.jenis === 'apresiasi') return '★';
        if (n.jenis === 'perilaku') return `! ${({ ringan: 'R', perhatian: 'P', serius: 'S' })[n.tingkat] || 'R'}`;
        return '✎';
    }

    /** Hitungan per siswa: Map id → { apresiasi, perilaku, catatan, serius, seriusTerbuka, total }. */
    function hitung(catatan) {
        const m = new Map();
        for (const n of catatan || []) {
            if (!m.has(n.student_id)) m.set(n.student_id, { apresiasi: 0, perilaku: 0, catatan: 0, serius: 0, seriusTerbuka: 0, total: 0 });
            const h = m.get(n.student_id);
            h[n.jenis] += 1;
            h.total += 1;
            if (n.tingkat === 'serius') { h.serius += 1; if (!n.tindak_lanjut) h.seriusTerbuka += 1; }
        }
        return m;
    }
    function ringkas(catatan) {
        const r = { apresiasi: 0, perilaku: 0, catatan: 0, serius: 0, seriusTerbuka: [] };
        for (const n of catatan || []) {
            r[n.jenis] += 1;
            if (n.tingkat === 'serius') { r.serius += 1; if (!n.tindak_lanjut) r.seriusTerbuka.push(n); }
        }
        return r;
    }

    const tglPendek = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}`; };
    const tglSedang = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${RP.BULAN[m - 1].slice(0, 3)} ${y}`; };
    const SEM = (s) => (Number(s) === 2 ? 'GENAP' : 'GANJIL');

    function ttd(data, tanggal) {
        const ks = data.kepala_sekolah || {};
        const w = (data.wali || []).find((x) => x.posisi === 1) || (data.wali || [])[0] || {};
        const nm = (v) => esc(RP.namaTtd(v) || '........................');
        return `<div class="foot" style="margin-top:5mm">
            <div class="ttd"><div>Mengetahui,</div><div>Kepala Sekolah</div><div class="sp"></div><b>${nm(ks.nama)}</b><div>NIP. ${esc(ks.nip || '-')}</div></div>
            <div class="ttd"><div>${RP.CITY}, ${esc(RP.tglPanjang(tanggal))}</div><div>Wali Kelas</div><div class="sp"></div><b>${nm(w.nama)}</b><div>NIP. ${esc(w.nip || '-')}</div></div>
        </div>`;
    }
    function hariIniIso() {
        const d = new Date();
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    const CSS = `
        .cs th { background: #e5e7eb; }
        .cs td { white-space: normal; overflow: visible; vertical-align: top; line-height: 1.3; padding: 1mm 2px; height: auto; }
        .cs td.tl { text-align: left; padding-left: 4px; }
        .cs td.b { font-weight: 700; }
        .cs .ln { display: block; }
        .cs .srs { font-weight: 700; color: #b91c1c; }
        .catat { font-size: 7pt; font-style: italic; margin-top: 1.5mm; }
    `;

    /** Rangkuman semester satu kelas: satu baris per siswa. */
    function htmlKelas(data, opts = {}) {
        const per = new Map();
        for (const n of data.catatan || []) { if (!per.has(n.student_id)) per.set(n.student_id, []); per.get(n.student_id).push(n); }
        const rows = (data.siswa || []).map((s, i) => {
            const list = (per.get(s.id) || []).slice().sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
            const h = hitung(list).get(s.id) || { apresiasi: 0, perilaku: 0, catatan: 0 };
            const isi = list.length
                ? list.map((n) => `<span class="ln${n.tingkat === 'serius' ? ' srs' : ''}">${esc(kode(n))} ${esc(tglPendek(n.tanggal))} ${esc(n.judul)}${n.tindak_lanjut ? ` — ${esc(n.tindak_lanjut)}` : (n.tingkat === 'serius' ? ' — tindak lanjut belum diisi' : '')}</span>`).join('')
                : '<span class="ln" style="color:#64748b">Tidak ada catatan.</span>';
            return `<tr><td>${esc(s.no ?? i + 1)}</td><td class="tl">${esc(String(s.nama).toUpperCase())}</td>
                <td>${h.apresiasi || '–'}</td><td class="${h.perilaku ? 'b' : ''}">${h.perilaku || '–'}</td><td>${h.catatan || '–'}</td><td class="tl">${isi}</td></tr>`;
        }).join('');
        const body = `<style>${CSS}</style>
            ${RP.kopHtml('RANGKUMAN CATATAN SISWA', { tahun_ajaran: `${data.kelas.tahun_ajaran || ''} · SEMESTER ${SEM(data.semester)}` }, `KELAS : ${RP.romawi(`${data.kelas.tingkat}${data.kelas.rombel}`) || data.kelas.nama}`)}
            ${data.lihat_semua === false ? '<div style="font-size:8pt;margin:0 0 2mm"><i>Berisi catatan yang Anda tulis saja.</i></div>' : ''}
            <table class="cs">
                <colgroup><col style="width:8mm"><col style="width:52mm"><col style="width:16mm"><col style="width:16mm"><col style="width:16mm"><col></colgroup>
                <thead><tr><th>NO</th><th>NAMA</th><th>APRESIASI</th><th>PERILAKU</th><th>CATATAN</th><th>RINGKASAN (tanggal · isi · tindak lanjut)</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6">Belum ada siswa.</td></tr>'}</tbody>
            </table>
            <div class="catat">★ apresiasi · ! perilaku (R = ringan, P = perlu perhatian, S = serius) · ✎ catatan. Hanya untuk keperluan internal sekolah.</div>
            ${ttd(data, opts.tanggal || hariIniIso())}`;
        return RP.wrapDoc(`Rangkuman Catatan Siswa ${data.kelas.nama}`, body, '--rh:5mm;--fs:7.5pt');
    }

    /** Catatan satu siswa (dari get_student_notes). */
    function htmlSiswa(data, opts = {}) {
        const s = data.siswa || {};
        const list = (data.catatan || []).slice().sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
        const rows = list.map((n, i) => `<tr><td>${i + 1}</td><td>${esc(tglSedang(n.tanggal))}</td><td class="${n.tingkat === 'serius' ? 'b' : ''}">${esc(label(n))}</td>
            <td class="tl"><b>${esc(n.judul)}</b>${n.cerita ? `<span class="ln">${esc(n.cerita)}</span>` : ''}</td>
            <td class="tl">${esc(n.tindak_lanjut || (n.tingkat === 'serius' ? 'Belum diisi' : '–'))}</td><td class="tl">${esc(n.penulis || '')}</td></tr>`).join('');
        const body = `<style>${CSS}</style>
            ${RP.kopHtml('CATATAN SISWA', { tahun_ajaran: '' }, s.kelas ? `KELAS : ${kelasTitik(s.kelas)}` : '').replace(/<div>TAHUN PELAJARAN\s*<\/div>/, `<div>${esc(String(s.nama || '').toUpperCase())}${s.nis ? ` · NIS ${esc(s.nis)}` : ''}</div>`)}
            <table class="cs">
                <colgroup><col style="width:8mm"><col style="width:26mm"><col style="width:34mm"><col><col style="width:60mm"><col style="width:38mm"></colgroup>
                <thead><tr><th>NO</th><th>TANGGAL</th><th>JENIS</th><th>CATATAN</th><th>TINDAK LANJUT</th><th>PENULIS</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6">Belum ada catatan.</td></tr>'}</tbody>
            </table>
            <div class="catat">Hanya untuk keperluan internal sekolah. Dicetak ${esc(RP.tglPanjang(opts.tanggal || hariIniIso()))}.</div>`;
        return RP.wrapDoc(`Catatan ${s.nama || 'Siswa'}`, body, '--rh:6mm;--fs:8pt');
    }

    const api = { JENIS, TINGKAT, SARAN, label, kode, hitung, ringkas, htmlKelas, htmlSiswa, tglSedang, kelasTitik };
    if (isNode) module.exports = api;
    else root.Catatan = Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
