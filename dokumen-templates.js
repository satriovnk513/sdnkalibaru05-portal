// =============================================================================
// Portal Guru — menu "Cetak & Dokumen": template dokumen yang biasa diminta ke
// operator, supaya guru bisa membuat sendiri lalu mencetak atau mengunduh Word /
// Excel untuk diedit.
//
// Murni pembuat HTML/baris tabel dari data get_class_document_data + isian form.
// Tata letak memakai <table> (bukan flex) supaya hasil Word sama dengan cetakan.
// Bisa dipakai di browser (window.Dok) dan di node (tes).
// =============================================================================
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Dok = api;
}(typeof self !== 'undefined' ? self : this, function (root) {
    'use strict';

    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const ORIGIN = root.location && /^https?:/.test(root.location.origin || '') ? root.location.origin : 'https://sdnkalibaru05.sch.id';

    // Kop surat resmi sekolah (sumber: KOP SURAT SEKOLAH TERBARU 2026.docx). Ubah di sini bila kop berganti.
    const KOP = {
        baris: [
            ['PEMERINTAH PROVINSI DAERAH KHUSUS IBUKOTA JAKARTA', 13],
            ['DINAS PENDIDIKAN', 12],
            ['SUKU DINAS PENDIDIKAN WILAYAH II KOTA ADMINISTRASI JAKARTA UTARA', 10.5],   // 12 pt di file asli; dikecilkan agar muat satu baris di samping logo
        ],
        sekolah: 'SEKOLAH DASAR NEGERI KALI BARU 05 PAGI',
        kecil: [
            'Jalan Kalibaru Barat IV No. 60, RT 003 RW 012, Kel. Kalibaru, Kec. Cilincing, Jakarta Utara',
            'Telepon (021) 44833627; Faksimile (021) 44833627;',
            'Website: https://sdnkalibaru05.sch.id; Email: admin@sdnkalibaru05.sch.id',   // sesuai kop resmi (gambar)
        ],
        kotaKop: 'JAKARTA',
        kodePos: 'Kode Pos  14110',
        kota: 'Jakarta',
        nama: 'SDN Kalibaru 05 Pagi',
        namaDaftar: 'SDN KALIBARU 05 PAGI',
        kodeSurat: 'PK.0101',
    };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const romawi = (k) => { const m = /^(\d+)\s*(.*)$/.exec(String(k || '')); return m ? `${['', 'I', 'II', 'III', 'IV', 'V', 'VI'][+m[1]] || m[1]}${m[2] ? `.${m[2]}` : ''}` : String(k || ''); };
    const isIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    const tgl = (iso) => { if (!isIso(iso)) return String(iso || ''); const [y, m, d] = iso.split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
    const hariTgl = (iso) => { if (!isIso(iso)) return String(iso || ''); const [y, m, d] = iso.split('-').map(Number); return `${HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${tgl(iso)}`; };
    const ttl = (s) => [s.tempat_lahir, s.tanggal_lahir ? tgl(s.tanggal_lahir) : ''].filter(Boolean).join(', ');
    const jkPanjang = (v) => (v === 'L' ? 'Laki-laki' : v === 'P' ? 'Perempuan' : '');
    const ortu = (s) => s.ayah || s.ibu || s.wali || '';
    const titik = (n = 40) => '.'.repeat(n);
    const isi = (v, n) => (String(v ?? '').trim() ? esc(v) : titik(n));
    const nl2br = (v) => esc(v).replace(/\r?\n/g, '<br>');

    // ------------------------------------------------------------------ kolom daftar siswa
    const KOLOM = [
        { key: 'nis', label: 'NIS', w: 12, get: (s) => s.nis },
        { key: 'nisn', label: 'NISN', w: 14, get: (s) => s.nisn },
        { key: 'jk', label: 'L/P', w: 5, get: (s) => s.jk },
        { key: 'ttl', label: 'Tempat, Tanggal Lahir', w: 28, get: ttl },
        { key: 'nik', label: 'NIK', w: 20, get: (s) => s.nik },
        { key: 'no_kk', label: 'No. KK', w: 20, get: (s) => s.no_kk },
        { key: 'agama', label: 'Agama', w: 12, get: (s) => s.agama },
        { key: 'ayah', label: 'Nama Ayah', w: 24, get: (s) => s.ayah },
        { key: 'ibu', label: 'Nama Ibu', w: 24, get: (s) => s.ibu },
        { key: 'hp', label: 'No. HP Orang Tua', w: 16, get: (s) => s.hp },
        { key: 'alamat', label: 'Alamat', w: 46, get: (s) => s.alamat },
    ];

    // ------------------------------------------------------------------ daftar jenis dokumen
    const F_TTD = { key: 'tanggal', label: 'Tanggal tanda tangan', type: 'date', default: 'today' };
    // Kop surat: dua versi resmi. Pilihan terakhir diingat di perangkat (lihat guru.js).
    const KOP_VERSI = {
        sudin: { label: 'Suku Dinas Pendidikan Wilayah II Jakarta Utara', file: 'kop-sudin.png', h: 154 },
        dinas: { label: 'Dinas Pendidikan', file: 'kop-dinas.png', h: 123 },
    };
    const F_KOP = { key: 'kop', label: 'Kop surat', type: 'select', options: Object.entries(KOP_VERSI).map(([k, v]) => [k, v.label]), default: 'sudin', remember: true };
    const F_SURAT = [
        F_KOP,
        { key: 'nomor', label: 'Nomor surat', type: 'nomor' },
        { key: 'kode', label: 'Kode surat', type: 'hidden', default: KOP.kodeSurat },
        { key: 'tanggal', label: 'Tanggal surat / tanda tangan', type: 'date', default: 'today' },
    ];
    const F_ACARA = [
        { key: 'hari', label: 'Hari, tanggal acara', type: 'date', default: 'today' },
        { key: 'jam', label: 'Pukul', type: 'text', default: '08.00 WIB s.d. selesai' },
        { key: 'tempat', label: 'Tempat', type: 'text', default: 'SDN Kalibaru 05 Pagi' },
    ];

    // Daftar: boleh hanya sebagian siswa (kosong = semua siswa di kelas).
    const F_PILIH = { key: 'pilih', label: 'Siswa yang dicantumkan', type: 'siswaMulti', default: [] };

    const TYPES = [
        { id: 'daftar', grup: 'Daftar', nama: 'Daftar nama siswa', ket: 'Nama siswa per kelas dengan kolom data yang Anda pilih (NIS, NISN, TTL, NIK, orang tua, dst.).',
            formats: ['print', 'word', 'xlsx'], fields: [
                { key: 'judul', label: 'Judul', type: 'text', default: 'DAFTAR NAMA SISWA' },
                { key: 'kolom', label: 'Kolom yang ditampilkan', type: 'checks', options: KOLOM.map((k) => [k.key, k.label]), default: ['nis', 'nisn', 'jk'] },
                F_PILIH, F_TTD,
            ] },
        { id: 'blanko', grup: 'Daftar', nama: 'Blanko nilai / daftar kosong', ket: 'Nama siswa + kolom kosong untuk nilai, tugas, setoran, atau catatan lain.',
            formats: ['print', 'word', 'xlsx'], fields: [
                { key: 'judul', label: 'Judul', type: 'text', default: 'DAFTAR NILAI' },
                { key: 'sub', label: 'Keterangan di bawah judul (mapel, semester, dll.)', type: 'text', placeholder: 'Mis. Matematika · Semester Ganjil' },
                { key: 'jumlah', label: 'Jumlah kolom kosong', type: 'number', default: 10, min: 1, max: 20 },
                { key: 'label', label: 'Judul tiap kolom (pisahkan dengan koma, boleh kosong)', type: 'text', placeholder: 'Mis. PH1, PH2, PTS, PAS' },
                F_PILIH, F_TTD,
            ] },
        { id: 'hadir', grup: 'Daftar', nama: 'Daftar hadir kegiatan / tanda terima', ket: 'Daftar bertanda tangan untuk ujian, rapat orang tua, ambil rapor, atau terima buku/seragam.',
            formats: ['print', 'word'], fields: [
                { key: 'judul', label: 'Judul', type: 'text', default: 'DAFTAR HADIR' },
                { key: 'kegiatan', label: 'Kegiatan / barang yang diterima', type: 'text', placeholder: 'Mis. Pengambilan Rapor Semester Ganjil' },
                { key: 'hari', label: 'Hari, tanggal', type: 'date', default: 'today' },
                { key: 'penanda', label: 'Yang menandatangani', type: 'select', options: [['siswa', 'Siswa'], ['ortu', 'Orang tua / wali']], default: 'siswa' },
                F_PILIH, F_TTD,
            ] },
        { id: 'biodata', grup: 'Per siswa', nama: 'Biodata siswa', ket: 'Satu lembar per siswa: identitas, NIK, No. KK, orang tua, alamat, No. HP.',
            formats: ['print', 'word'], fields: [{ key: 'siswa', label: 'Siswa', type: 'siswa', all: true }, F_KOP, F_TTD] },
        { id: 'aktif', grup: 'Surat', nama: 'Surat keterangan aktif sekolah', ket: 'Menerangkan siswa benar terdaftar dan aktif. Ditandatangani kepala sekolah.',
            formats: ['print', 'word'], fields: [
                { key: 'siswa', label: 'Siswa', type: 'siswa' }, ...F_SURAT,
                { key: 'keperluan', label: 'Dipergunakan untuk', type: 'text', placeholder: 'Mis. persyaratan KJP / BPJS / lomba' },
            ] },
        { id: 'panggilan', grup: 'Surat', nama: 'Surat panggilan orang tua', ket: 'Memanggil orang tua/wali seorang siswa ke sekolah pada waktu tertentu.',
            formats: ['print', 'word'], fields: [
                { key: 'siswa', label: 'Siswa', type: 'siswa' }, ...F_SURAT, ...F_ACARA,
                { key: 'keperluan', label: 'Keperluan', type: 'text', default: 'Membicarakan perkembangan belajar dan kehadiran ananda' },
            ] },
        { id: 'undangan', grup: 'Surat', nama: 'Undangan rapat orang tua', ket: 'Undangan untuk semua orang tua/wali satu kelas. Bisa dicetak satu lembar umum atau bernama per siswa.',
            formats: ['print', 'word'], fields: [
                ...F_SURAT, ...F_ACARA,
                { key: 'acara', label: 'Acara', type: 'text', default: 'Rapat orang tua/wali murid' },
                { key: 'perSiswa', label: 'Cetak per siswa (ada nama orang tua & siswa di tiap lembar)', type: 'check', default: false },
            ] },
        { id: 'pemberitahuan', grup: 'Surat', nama: 'Surat pemberitahuan', ket: 'Pemberitahuan kegiatan atau informasi ke orang tua, isi surat Anda tulis sendiri.',
            formats: ['print', 'word'], fields: [
                ...F_SURAT,
                { key: 'perihal', label: 'Perihal', type: 'text', default: 'Pemberitahuan' },
                { key: 'isi', label: 'Isi surat', type: 'textarea', default: 'Sehubungan dengan kegiatan sekolah, dengan ini kami memberitahukan kepada Bapak/Ibu Orang Tua/Wali Murid bahwa …' },
            ] },
    ];
    const typeOf = (id) => TYPES.find((t) => t.id === id);

    function defaults(type, today) {
        const o = {};
        for (const f of type.fields) {
            if (f.default === undefined) o[f.key] = f.type === 'checks' ? [] : f.type === 'check' ? false : '';
            else o[f.key] = f.default === 'today' ? today : (Array.isArray(f.default) ? [...f.default] : f.default);
        }
        return o;
    }

    // ------------------------------------------------------------------ potongan HTML bersama
    /** Nomor surat: "005/PK.0101"; bila nomor urut kosong → titik-titik untuk diisi tangan. */
    const nomorSurat = (o) => {
        const n = String(o.nomor ?? '').trim();
        const kode = String(o.kode ?? KOP.kodeSurat).trim() || KOP.kodeSurat;
        return `${/^\d{1,3}$/.test(n) ? n.padStart(3, '0') : (n ? esc(n) : '.......')}/${esc(kode)}`;
    };
    /** "Jakarta, 17 November 2026" */
    const kotaTgl = (iso) => `${KOP.kota}, ${isIso(iso) ? tgl(iso) : titik(24)}`;

    // Kop surat dipasang sebagai satu gambar (dirender 300 dpi dari file kop resmi sekolah) supaya
    // tampil persis sama di cetakan, PDF, dan Word. Lebar 680 px = lebar isi halaman A4 tegak.
    const kopHtml = (o) => {
        const v = KOP_VERSI[o?.kop] || KOP_VERSI.sudin;
        return `<div class="kop"><img src="${ORIGIN}/${v.file}" width="680" height="${v.h}" alt="Kop surat ${esc(v.label)}" style="width:100%;height:auto"></div>`;
    };

    /** Kepala dokumen daftar: logo sekolah di kiri atas, judul & keterangan di sebelahnya, kelas di kanan. */
    const judulHtml = (judul, d, sub) => `<table class="kepala" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="62" valign="middle"><img src="${ORIGIN}/logo-cetak.png" width="54" height="54" alt="Logo sekolah"></td>
            <td valign="middle"><div class="judul kiri">${esc(judul)}</div>
                <div class="subjudul kiri">TAHUN PELAJARAN ${esc(String(d.tahun_ajaran || '').replace('/', ' / '))}</div>
                <div class="subjudul kiri"><b>${esc(KOP.namaDaftar)}</b>${sub ? ` · ${esc(sub)}` : ''}</div></td>
            <td width="130" align="right" valign="middle" class="kelas">KELAS : ${esc(romawi(d.kelas))}</td></tr></table>
        <table class="meta" width="100%"><tr><td>Wali Kelas : <b>${esc((d.wali || [])[0]?.nama || titik(30))}</b></td>
            <td align="right">Jumlah siswa : <b>${(d.siswa || []).length}</b></td></tr></table>`;

    /**
     * Ukuran huruf tabel daftar supaya kepala + tabel + tanda tangan muat satu halaman
     * (sampai ±45 siswa di kertas tegak). Di bawah 8 pt dibiarkan pindah halaman.
     */
    function fitGrid(n, landscape) {
        const budget = landscape ? 320 : 545;               // pt yang tersedia untuk baris tabel
        const pitch = Math.min(19, budget / (n + 1.6));
        const fs = Math.max(8, Math.min(landscape ? 9.5 : 11, (pitch - 3.2) / 1.15));
        return { fs: Math.round(fs * 10) / 10, rowH: Math.max(13, Math.min(20, Math.floor(pitch) - 1)) };
    }
    const gridOpen = (n, landscape) => { const f = fitGrid(n, landscape); return `<table class="grid" width="100%" style="font-size:${f.fs}pt">`; };

    const nip = (p) => (p?.nip ? `NIP. ${esc(p.nip)}` : 'NIP. -');
    const orang = (p) => `<b><u>${esc(p?.nama || titik(34))}</u></b><br>${nip(p)}`;

    /** Blok tanda tangan. kiri/kanan: { atas: [..baris], orang } atau null. */
    const ttdHtml = (kiri, kanan) => `<table class="ttd" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="50%" valign="top">${kiri ? `${kiri.atas.map(esc).join('<br>')}<br><br><br><br><br>${orang(kiri.orang)}` : '&nbsp;'}</td>
        <td width="50%" valign="top">${kanan ? `${kanan.atas.map(esc).join('<br>')}<br><br><br><br><br>${orang(kanan.orang)}` : '&nbsp;'}</td></tr></table>`;

    const ttdDaftar = (d, iso) => ttdHtml(
        { atas: ['Mengetahui,', 'Kepala Sekolah'], orang: d.kepala_sekolah },
        { atas: [kotaTgl(iso), 'Wali Kelas'], orang: (d.wali || [])[0] });

    const kepalaSurat = (o, { perihal, lampiran = '-', kepada }) => `<table class="noborder" width="100%"><tr>
        <td valign="top"><table class="noborder">
            <tr><td width="70">Nomor</td><td width="10">:</td><td>${nomorSurat(o)}</td></tr>
            <tr><td>Lampiran</td><td>:</td><td>${esc(lampiran)}</td></tr>
            <tr><td>Perihal</td><td>:</td><td><b>${esc(perihal)}</b></td></tr></table></td>
        <td valign="top" align="right">${esc(kotaTgl(o.tanggal))}</td></tr></table>
        <p class="yth">Kepada Yth.<br>${kepada.join('<br>')}<br>di Tempat</p>`;

    const acaraHtml = (o) => `<table class="noborder acara">
        <tr><td width="110">Hari, tanggal</td><td width="10">:</td><td>${isi(o.hari && hariTgl(o.hari), 30)}</td></tr>
        <tr><td>Pukul</td><td>:</td><td>${isi(o.jam, 30)}</td></tr>
        <tr><td>Tempat</td><td>:</td><td>${isi(o.tempat, 30)}</td></tr></table>`;

    const pilihSiswa = (d, o) => {
        const list = d.siswa || [];
        if (o.siswa === '*') return list;
        const s = list.find((x) => x.student_id === o.siswa);
        return s ? [s] : [];
    };
    const halaman = (parts) => parts.join('<div class="pb"></div>');

    // ------------------------------------------------------------------ pembuat tiap dokumen
    const BUILD = {
        daftar(d, o) {
            const cols = KOLOM.filter((k) => (o.kolom || []).includes(k.key));
            const landscape = cols.reduce((n, k) => n + k.w, 0) > 60;
            return { landscape, title: `${o.judul || 'Daftar Nama Siswa'} ${romawi(d.kelas)}`, body: `${judulHtml(o.judul || 'DAFTAR NAMA SISWA', d)}
                ${gridOpen((d.siswa || []).length, landscape)}<thead><tr><th width="30">No</th><th>Nama Siswa</th>${cols.map((k) => `<th>${esc(k.label)}</th>`).join('')}</tr></thead><tbody>
                ${(d.siswa || []).map((s) => `<tr><td align="center">${esc(s.no)}</td><td>${esc(s.nama)}</td>${cols.map((k) => `<td${k.key === 'jk' ? ' align="center"' : ''}>${esc(k.get(s) || '')}</td>`).join('')}</tr>`).join('')}
                </tbody></table><p class="kecil">Jumlah siswa: ${(d.siswa || []).length} (Laki-laki ${(d.siswa || []).filter((s) => s.jk === 'L').length}, Perempuan ${(d.siswa || []).filter((s) => s.jk === 'P').length})</p>
                ${ttdDaftar(d, o.tanggal || d.tanggal)}` };
        },
        blanko(d, o) {
            const n = Math.max(1, Math.min(20, Number(o.jumlah) || 10));
            const labels = String(o.label || '').split(',').map((x) => x.trim());
            // Lebar kolom kosong: sisa lebar kertas setelah kolom nama (±190 pt), dibagi rata.
            const kw = Math.max(18, Math.min(60, Math.floor(((n > 10 ? 770 : 510) - 30 - 46 - 26 - 190) / n)));
            return { landscape: n > 10, title: `${o.judul || 'Daftar Nilai'} ${romawi(d.kelas)}`, body: `${judulHtml(o.judul || 'DAFTAR NILAI', d, o.sub)}
                ${gridOpen((d.siswa || []).length, n > 10).replace('style="', 'style="table-layout:fixed;')}<thead><tr><th width="30">No</th><th width="46">NIS</th><th>Nama Siswa</th><th width="26">L/P</th>
                ${Array.from({ length: n }, (_, i) => `<th class="kosong" width="${kw}">${esc(labels[i] || '')}</th>`).join('')}</tr></thead><tbody>
                ${(d.siswa || []).map((s) => `<tr><td align="center">${esc(s.no)}</td><td align="center">${esc(s.nis || '')}</td><td class="nm">${esc(s.nama)}</td><td align="center">${esc(s.jk || '')}</td>${'<td class="kosong">&nbsp;</td>'.repeat(n)}</tr>`).join('')}
                </tbody></table>${ttdDaftar(d, o.tanggal || d.tanggal)}` };
        },
        hadir(d, o) {
            const pakaiOrtu = o.penanda === 'ortu';
            return { landscape: false, title: `${o.judul || 'Daftar Hadir'} ${romawi(d.kelas)}`, body: `${judulHtml(o.judul || 'DAFTAR HADIR', d)}
                <table class="noborder" style="margin-bottom:6pt">
                    <tr><td width="110">Kegiatan</td><td width="10">:</td><td>${isi(o.kegiatan, 50)}</td></tr>
                    <tr><td>Hari, tanggal</td><td>:</td><td>${isi(o.hari && hariTgl(o.hari), 50)}</td></tr></table>
                ${gridOpen((d.siswa || []).length + 2, false)}<thead><tr><th width="30">No</th><th>Nama Siswa</th>${pakaiOrtu ? '<th>Nama Orang Tua / Wali</th>' : '<th width="26">L/P</th>'}<th colspan="2" width="34%">Tanda Tangan</th></tr></thead><tbody>
                ${(d.siswa || []).map((s, i) => `<tr class="tinggi" style="height:${fitGrid((d.siswa || []).length + 2, false).rowH}pt"><td align="center">${esc(s.no)}</td><td>${esc(s.nama)}</td>${pakaiOrtu ? `<td>${esc(ortu(s))}</td>` : `<td align="center">${esc(s.jk || '')}</td>`}
                    <td width="17%">${i % 2 === 0 ? `${i + 1}.` : '&nbsp;'}</td><td width="17%">${i % 2 === 1 ? `${i + 1}.` : '&nbsp;'}</td></tr>`).join('')}
                </tbody></table>${ttdDaftar(d, o.tanggal || o.hari || d.tanggal)}` };
        },
        biodata(d, o) {
            const row = (l, v) => `<tr><td width="34%">${esc(l)}</td><td width="3%">:</td><td>${v ? esc(v) : '-'}</td></tr>`;
            const satu = (s) => `${kopHtml(o)}<div class="judul" style="margin-top:14pt">BIODATA SISWA</div>
                <div class="subjudul" style="margin-bottom:12pt">TAHUN PELAJARAN ${esc(String(d.tahun_ajaran || '').replace('/', ' / '))}</div>
                <table class="noborder bio" width="100%">
                    <tr><td colspan="3" class="bag">A. IDENTITAS SISWA</td></tr>
                    ${row('Nama lengkap', s.nama)}${row('Kelas', romawi(d.kelas))}${row('NIS', s.nis)}${row('NISN', s.nisn)}${row('NIK', s.nik)}${row('No. Kartu Keluarga', s.no_kk)}
                    ${row('Jenis kelamin', jkPanjang(s.jk))}${row('Tempat, tanggal lahir', ttl(s))}${row('Agama', s.agama)}${row('Anak ke', s.anak_ke)}
                    <tr><td colspan="3" class="bag">B. ORANG TUA / WALI</td></tr>
                    ${row('Nama ayah', s.ayah)}${row('Nama ibu', s.ibu)}${s.wali && s.wali !== s.ayah && s.wali !== s.ibu ? row('Nama wali', s.wali) : ''}${row('No. HP', s.hp)}
                    <tr><td colspan="3" class="bag">C. ALAMAT</td></tr>
                    ${row('Alamat tempat tinggal', s.alamat)}
                </table>
                ${ttdHtml(null, { atas: [kotaTgl(o.tanggal || d.tanggal), 'Wali Kelas'], orang: (d.wali || [])[0] })}`;
            const list = pilihSiswa(d, o);
            return { landscape: false, title: `Biodata ${list.length === 1 ? list[0].nama : `Kelas ${romawi(d.kelas)}`}`, body: halaman(list.map(satu)) };
        },
        aktif(d, o) {
            const s = pilihSiswa(d, o)[0];
            if (!s) return null;
            const row = (l, v) => `<tr><td width="170">${esc(l)}</td><td width="10">:</td><td>${v ? esc(v) : '-'}</td></tr>`;
            const ks = d.kepala_sekolah;
            return { landscape: false, title: `Surat Keterangan Aktif ${s.nama}`, body: `${kopHtml(o)}
                <div class="judul" style="margin-top:14pt"><u>SURAT KETERANGAN AKTIF SEKOLAH</u></div>
                <div class="subjudul" style="margin-bottom:14pt">Nomor : ${nomorSurat(o)}</div>
                <p>Yang bertanda tangan di bawah ini:</p>
                <table class="noborder indent">${row('Nama', ks?.nama)}${row('NIP', ks?.nip)}${row('Jabatan', `Kepala ${KOP.nama}`)}</table>
                <p>menerangkan dengan sebenarnya bahwa:</p>
                <table class="noborder indent">${row('Nama', s.nama)}${row('NIS / NISN', [s.nis, s.nisn].filter(Boolean).join(' / '))}${row('Tempat, tanggal lahir', ttl(s))}
                    ${row('Jenis kelamin', jkPanjang(s.jk))}${row('Kelas', romawi(d.kelas))}${row('Nama orang tua / wali', ortu(s))}${row('Alamat', s.alamat)}</table>
                <p class="j">adalah benar siswa ${esc(KOP.nama)} yang terdaftar dan masih aktif mengikuti kegiatan belajar mengajar pada Tahun Pelajaran ${esc(d.tahun_ajaran)}.</p>
                <p class="j">Surat keterangan ini dibuat untuk dipergunakan sebagai ${isi(o.keperluan, 44)}.</p>
                <p class="j">Demikian surat keterangan ini dibuat agar dapat dipergunakan sebagaimana mestinya.</p>
                ${ttdHtml(null, { atas: [kotaTgl(o.tanggal), 'Kepala Sekolah'], orang: ks })}` };
        },
        panggilan(d, o) {
            const s = pilihSiswa(d, o)[0];
            if (!s) return null;
            return { landscape: false, title: `Surat Panggilan Orang Tua ${s.nama}`, body: `${kopHtml(o)}
                ${kepalaSurat(o, { perihal: 'Panggilan Orang Tua / Wali Murid', kepada: [`Bapak/Ibu <b>${esc(ortu(s) || titik(30))}</b>`, `Orang Tua/Wali dari <b>${esc(s.nama)}</b> (Kelas ${esc(romawi(d.kelas))})`] })}
                <p>Dengan hormat,</p>
                <p class="j">Sehubungan dengan ${isi(o.keperluan, 50)}, kami mengharapkan kehadiran Bapak/Ibu di sekolah pada:</p>
                ${acaraHtml(o)}
                <p class="j">Mengingat pentingnya hal tersebut, kami mohon Bapak/Ibu hadir tepat waktu dan tidak diwakilkan.</p>
                <p class="j">Demikian surat ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.</p>
                ${ttdHtml({ atas: ['Mengetahui,', 'Kepala Sekolah'], orang: d.kepala_sekolah }, { atas: ['', 'Wali Kelas'], orang: (d.wali || [])[0] })}` };
        },
        undangan(d, o) {
            const satu = (s) => `${kopHtml(o)}
                ${kepalaSurat(o, { perihal: 'Undangan', kepada: s
        ? [`Bapak/Ibu <b>${esc(ortu(s) || titik(30))}</b>`, `Orang Tua/Wali dari <b>${esc(s.nama)}</b> (Kelas ${esc(romawi(d.kelas))})`]
        : [`Bapak/Ibu Orang Tua/Wali Murid Kelas <b>${esc(romawi(d.kelas))}</b>`] })}
                <p>Dengan hormat,</p>
                <p class="j">Kami mengundang Bapak/Ibu untuk menghadiri <b>${isi(o.acara, 40)}</b> yang akan dilaksanakan pada:</p>
                ${acaraHtml(o)}
                <p class="j">Mengingat pentingnya acara tersebut, kami sangat mengharapkan kehadiran Bapak/Ibu tepat pada waktunya.</p>
                <p class="j">Demikian undangan ini kami sampaikan. Atas perhatian dan kehadiran Bapak/Ibu, kami ucapkan terima kasih.</p>
                ${ttdHtml({ atas: ['Mengetahui,', 'Kepala Sekolah'], orang: d.kepala_sekolah }, { atas: ['', 'Wali Kelas'], orang: (d.wali || [])[0] })}`;
            return { landscape: false, title: `Undangan Rapat Orang Tua ${romawi(d.kelas)}`, body: o.perSiswa ? halaman((d.siswa || []).map(satu)) : satu(null) };
        },
        pemberitahuan(d, o) {
            return { landscape: false, title: `Surat ${o.perihal || 'Pemberitahuan'} ${romawi(d.kelas)}`, body: `${kopHtml(o)}
                ${kepalaSurat(o, { perihal: o.perihal || 'Pemberitahuan', kepada: [`Bapak/Ibu Orang Tua/Wali Murid Kelas <b>${esc(romawi(d.kelas))}</b>`] })}
                <p>Dengan hormat,</p>
                <p class="j">${nl2br(o.isi || titik(120))}</p>
                <p class="j">Demikian pemberitahuan ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.</p>
                ${ttdHtml({ atas: ['Mengetahui,', 'Kepala Sekolah'], orang: d.kepala_sekolah }, { atas: ['', 'Wali Kelas'], orang: (d.wali || [])[0] })}` };
        },
    };

    /** { title, body, landscape } atau null bila isian belum lengkap (mis. siswa belum dipilih). */
    /** Bila hanya sebagian siswa dipilih: saring dan beri nomor urut baru 1, 2, 3, … */
    function pilihSebagian(d, o) {
        const ids = Array.isArray(o?.pilih) ? o.pilih : [];
        if (!ids.length) return d;
        const set = new Set(ids);
        return { ...d, siswa: (d.siswa || []).filter((s) => set.has(s.student_id)).map((s, i) => ({ ...s, no: i + 1 })) };
    }

    function build(id, data, opts) {
        return BUILD[id] ? BUILD[id](pilihSebagian(data, opts), opts || {}) : null;
    }

    const CSS = (landscape) => `
        @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${landscape ? '12mm' : '16mm 15mm 14mm'}; }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; line-height: 1.35; }
        table { border-collapse: collapse; }
        td, th { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; vertical-align: top; }
        .kop { margin: 0 0 12pt; }
        .kop img { display: block; }
        .judul { text-align: center; font-size: 13pt; font-weight: bold; }
        .subjudul { text-align: center; font-size: 10.5pt; }
        .kiri { text-align: left; }
        .kepala .kelas { font-size: 12pt; font-weight: bold; white-space: nowrap; }
        .meta { margin: 6pt 0 4pt; }
        .meta td { font-size: 10.5pt; }
        .grid th, .grid td { border: 1px solid #000; padding: 1pt 4pt; font-size: inherit; line-height: 1.15; }
        .grid th { text-align: center; background: #eee; vertical-align: middle; }
        .grid tr.tinggi td { vertical-align: middle; }
        .grid td.nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .noborder td { border: none; padding: 1pt 2pt; }
        .indent { margin: 2pt 0 8pt 28pt; }
        .acara { margin: 2pt 0 8pt 28pt; }
        .bio td { padding: 3pt 2pt; }
        .bio .bag { font-weight: bold; padding-top: 10pt; border-bottom: 1px solid #000; }
        .ttd { margin-top: 14pt; page-break-inside: avoid; }
        .ttd td { font-size: 11pt; padding-left: 12%; }
        .yth { margin: 12pt 0; }
        p { margin: 0 0 8pt; }
        p.j { text-align: justify; text-indent: 28pt; }
        .kecil { font-size: 10pt; margin-top: 4pt; }
        .pb { page-break-after: always; break-after: page; height: 0; }
        .tbar { position: fixed; top: 0; left: 0; right: 0; background: #0f172a; color: #fff; padding: 8px 12px; font: 14px Arial, sans-serif; display: flex; gap: 12px; align-items: center; z-index: 9; }
        .tbar button { font: 600 14px Arial, sans-serif; padding: 8px 16px; border: none; border-radius: 8px; background: #e11d48; color: #fff; cursor: pointer; }
        @media screen { body.lihat { padding: 60px 16px 24px; background: #e2e8f0; } body.lihat .kertas { background: #fff; max-width: ${landscape ? '273mm' : '180mm'}; margin: 0 auto; padding: 14mm; box-shadow: 0 2px 12px rgba(0,0,0,.2); } }
        @media print { .tbar { display: none; } }`;

    /** Dokumen HTML lengkap untuk dicetak (mode: 'print'), pratinjau ('preview'), atau diunduh sebagai Word ('word'). */
    function page(doc, mode = 'print', assets = null) {
        // Untuk cetak & pratinjau, gambar kop/logo ditanam langsung (data URI) supaya tidak bergantung
        // pada kecepatan internet saat dialog cetak muncul. Word tetap memakai alamat gambar.
        if (assets && mode !== 'word') {
            let body = doc.body;
            for (const [file, uri] of Object.entries(assets)) if (uri) body = body.split(`${ORIGIN}/${file}`).join(uri);
            doc = { ...doc, body };
        }
        const head = `<meta charset="utf-8"><title>${esc(doc.title)}</title><style>${CSS(doc.landscape)}</style>`;
        if (mode === 'word') {
            return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head>${head}
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>@page Section1 { size: ${doc.landscape ? '841.9pt 595.3pt; mso-page-orientation: landscape' : '595.3pt 841.9pt'}; margin: ${doc.landscape ? '34pt' : '45pt 42pt 40pt'}; } div.Section1 { page: Section1; } .pb { page-break-after: always; mso-special-character: line-break; }</style>
</head><body><div class="Section1">${doc.body.replace(/<div class="pb"><\/div>/g, '<br clear="all" style="page-break-before:always">')}</div></body></html>`;
        }
        const bar = mode === 'print' ? `<div class="tbar"><button onclick="window.print()">Cetak / Simpan PDF</button><span>${esc(doc.title)}</span></div>` : '';
        return `<!doctype html><html lang="id"><head>${head}</head><body class="${mode === 'print' ? 'lihat' : ''}">${bar}<div class="kertas">${doc.body}</div></body></html>`;
    }

    /** Spesifikasi Excel (untuk RekapPrint.buildXlsx) bagi dokumen berbentuk daftar; null untuk yang lain. */
    function xlsx(id, d0, o = {}) {
        const d = pilihSebagian(d0, o);
        const siswa = d.siswa || [];
        const kop = (judul, lebar) => [
            [null, null, null, { v: judul, s: 1 }],
            [null, null, null, { v: `${KOP.namaDaftar} · TAHUN PELAJARAN ${String(d.tahun_ajaran || '').replace('/', ' / ')}`, s: 1 }],
            [null, null, null, { v: `KELAS : ${romawi(d.kelas)}`, s: 1 }],
            [null, null, null, { v: `Wali Kelas : ${(d.wali || [])[0]?.nama || ''}` }],
            Array(lebar).fill(null),
        ];
        const L = (n) => { let s = ''; let x = n; while (x > 0) { s = String.fromCharCode(65 + ((x - 1) % 26)) + s; x = Math.floor((x - 1) / 26); } return s; };
        if (id === 'daftar') {
            const cols = KOLOM.filter((k) => (o.kolom || []).includes(k.key));
            const lebar = Math.max(4, 2 + cols.length);
            const rows = kop(o.judul || 'DAFTAR NAMA SISWA', lebar);
            rows.push([{ v: 'No', s: 2 }, { v: 'Nama Siswa', s: 2 }, ...cols.map((k) => ({ v: k.label, s: 2 }))]);
            for (const s of siswa) rows.push([{ v: s.no, s: 4 }, { v: s.nama, s: 3 }, ...cols.map((k) => ({ v: String(k.get(s) || ''), s: k.key === 'jk' ? 4 : 3 }))]);
            return { sheet: 'Daftar Siswa', rows, merges: [1, 2, 3, 4].map((r) => `D${r}:${L(lebar)}${r}`), widths: [5, 34, ...cols.map((k) => k.w)], landscape: lebar > 6 };
        }
        if (id === 'blanko') {
            const n = Math.max(1, Math.min(20, Number(o.jumlah) || 10));
            const labels = String(o.label || '').split(',').map((x) => x.trim());
            const lebar = 4 + n;
            const rows = kop(o.sub ? `${o.judul || 'DAFTAR NILAI'} — ${o.sub}` : (o.judul || 'DAFTAR NILAI'), lebar);
            rows.push([{ v: 'No', s: 2 }, { v: 'NIS', s: 2 }, { v: 'Nama Siswa', s: 2 }, { v: 'L/P', s: 2 }, ...Array.from({ length: n }, (_, i) => ({ v: labels[i] || '', s: 2 }))]);
            for (const s of siswa) rows.push([{ v: s.no, s: 4 }, { v: String(s.nis || ''), s: 4 }, { v: s.nama, s: 3 }, { v: s.jk || '', s: 4 }, ...Array(n).fill({ v: '', s: 4 })]);
            return { sheet: 'Blanko', rows, merges: [1, 2, 3, 4].map((r) => `D${r}:${L(lebar)}${r}`), widths: [5, 9, 34, 5, ...Array(n).fill(8)], landscape: n > 10 };
        }
        return null;
    }

    const fileName = (doc) => String(doc.title || 'Dokumen').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80);

    return { TYPES, KOLOM, KOP, typeOf, defaults, build, page, xlsx, fileName, tgl, hariTgl, romawi, nomorSurat, kotaTgl, KOP_VERSI, ASSETS: ['kop-sudin.png', 'kop-dinas.png', 'logo-cetak.png'] };
}));
