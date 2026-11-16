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

    // Kop surat. Ubah di sini bila susunan kop resmi sekolah berbeda.
    const KOP = {
        baris: ['PEMERINTAH PROVINSI DAERAH KHUSUS IBUKOTA JAKARTA', 'DINAS PENDIDIKAN'],
        sekolah: 'SEKOLAH DASAR NEGERI KALIBARU 05 PAGI',
        alamat: 'Jl. Tanah Merdeka No.60 RT 003/RW 012, Kel. Kalibaru, Kec. Cilincing, Jakarta Utara 14110',
        kontak: 'Email: sdnkalibarunollima@gmail.com',
        kota: 'Jakarta',
        nama: 'SDN Kalibaru 05 Pagi',
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
    const F_SURAT = [
        { key: 'nomor', label: 'Nomor surat (boleh dikosongkan)', type: 'text', placeholder: 'Diisi TU, mis. 123/-1.851.5' },
        { key: 'tanggal', label: 'Tanggal surat', type: 'date', default: 'today' },
    ];
    const F_ACARA = [
        { key: 'hari', label: 'Hari, tanggal acara', type: 'date', default: 'today' },
        { key: 'jam', label: 'Pukul', type: 'text', default: '08.00 WIB s.d. selesai' },
        { key: 'tempat', label: 'Tempat', type: 'text', default: 'SDN Kalibaru 05 Pagi' },
    ];

    const TYPES = [
        { id: 'daftar', grup: 'Daftar', nama: 'Daftar nama siswa', ket: 'Nama siswa per kelas dengan kolom data yang Anda pilih (NIS, NISN, TTL, NIK, orang tua, dst.).',
            formats: ['print', 'word', 'xlsx'], fields: [
                { key: 'judul', label: 'Judul', type: 'text', default: 'DAFTAR NAMA SISWA' },
                { key: 'kolom', label: 'Kolom yang ditampilkan', type: 'checks', options: KOLOM.map((k) => [k.key, k.label]), default: ['nis', 'nisn', 'jk'] },
            ] },
        { id: 'blanko', grup: 'Daftar', nama: 'Blanko nilai / daftar kosong', ket: 'Nama siswa + kolom kosong untuk nilai, tugas, setoran, atau catatan lain.',
            formats: ['print', 'word', 'xlsx'], fields: [
                { key: 'judul', label: 'Judul', type: 'text', default: 'DAFTAR NILAI' },
                { key: 'sub', label: 'Keterangan di bawah judul (mapel, semester, dll.)', type: 'text', placeholder: 'Mis. Matematika · Semester Ganjil' },
                { key: 'jumlah', label: 'Jumlah kolom kosong', type: 'number', default: 10, min: 1, max: 20 },
                { key: 'label', label: 'Judul tiap kolom (pisahkan dengan koma, boleh kosong)', type: 'text', placeholder: 'Mis. PH1, PH2, PTS, PAS' },
            ] },
        { id: 'hadir', grup: 'Daftar', nama: 'Daftar hadir kegiatan / tanda terima', ket: 'Daftar bertanda tangan untuk ujian, rapat orang tua, ambil rapor, atau terima buku/seragam.',
            formats: ['print', 'word'], fields: [
                { key: 'judul', label: 'Judul', type: 'text', default: 'DAFTAR HADIR' },
                { key: 'kegiatan', label: 'Kegiatan / barang yang diterima', type: 'text', placeholder: 'Mis. Pengambilan Rapor Semester Ganjil' },
                { key: 'hari', label: 'Hari, tanggal', type: 'date', default: 'today' },
                { key: 'penanda', label: 'Yang menandatangani', type: 'select', options: [['siswa', 'Siswa'], ['ortu', 'Orang tua / wali']], default: 'siswa' },
            ] },
        { id: 'biodata', grup: 'Per siswa', nama: 'Biodata siswa', ket: 'Satu lembar per siswa: identitas, NIK, No. KK, orang tua, alamat, No. HP.',
            formats: ['print', 'word'], fields: [{ key: 'siswa', label: 'Siswa', type: 'siswa', all: true }] },
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
    const kopHtml = () => `<table class="kop" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="86" align="center" valign="middle"><img src="${ORIGIN}/logo-cetak.png" width="76" height="76" alt=""></td>
        <td align="center" valign="middle">
            ${KOP.baris.map((b) => `<div class="k1">${esc(b)}</div>`).join('')}
            <div class="k2">${esc(KOP.sekolah)}</div>
            <div class="k3">${esc(KOP.alamat)}</div>
            <div class="k3">${esc(KOP.kontak)}</div>
        </td><td width="86">&nbsp;</td></tr></table><div class="garis"></div>`;

    const judulHtml = (judul, d, sub) => `<div class="judul">${esc(judul)}</div>
        <div class="subjudul">${esc(KOP.sekolah)} · TAHUN PELAJARAN ${esc(String(d.tahun_ajaran || '').replace('/', ' / '))}</div>
        ${sub ? `<div class="subjudul">${esc(sub)}</div>` : ''}
        <table class="meta" width="100%"><tr><td>Kelas : <b>${esc(romawi(d.kelas))}</b></td>
            <td align="right">Wali Kelas : <b>${esc((d.wali || [])[0]?.nama || titik(30))}</b></td></tr></table>`;

    const nip = (p) => (p?.nip ? `NIP. ${esc(p.nip)}` : 'NIP. -');
    const orang = (p) => `<b><u>${esc(p?.nama || titik(34))}</u></b><br>${nip(p)}`;

    /** Blok tanda tangan. kiri/kanan: { atas: [..baris], orang } atau null. */
    const ttdHtml = (kiri, kanan) => `<table class="ttd" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="50%" valign="top">${kiri ? `${kiri.atas.map(esc).join('<br>')}<br><br><br><br><br>${orang(kiri.orang)}` : '&nbsp;'}</td>
        <td width="50%" valign="top">${kanan ? `${kanan.atas.map(esc).join('<br>')}<br><br><br><br><br>${orang(kanan.orang)}` : '&nbsp;'}</td></tr></table>`;

    const ttdDaftar = (d, iso) => ttdHtml(
        { atas: ['Mengetahui,', 'Kepala Sekolah'], orang: d.kepala_sekolah },
        { atas: [`${KOP.kota}, ${tgl(iso)}`, 'Wali Kelas'], orang: (d.wali || [])[0] });

    const kepalaSurat = (o, { perihal, lampiran = '-', kepada }) => `<table class="noborder" width="100%"><tr>
        <td valign="top"><table class="noborder">
            <tr><td width="70">Nomor</td><td width="10">:</td><td>${isi(o.nomor, 28)}</td></tr>
            <tr><td>Lampiran</td><td>:</td><td>${esc(lampiran)}</td></tr>
            <tr><td>Perihal</td><td>:</td><td><b>${esc(perihal)}</b></td></tr></table></td>
        <td valign="top" align="right">${esc(KOP.kota)}, ${esc(tgl(o.tanggal))}</td></tr></table>
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
            return { landscape: cols.reduce((n, k) => n + k.w, 0) > 60, title: `${o.judul || 'Daftar Nama Siswa'} ${romawi(d.kelas)}`, body: `${judulHtml(o.judul || 'DAFTAR NAMA SISWA', d)}
                <table class="grid" width="100%"><thead><tr><th width="30">No</th><th>Nama Siswa</th>${cols.map((k) => `<th>${esc(k.label)}</th>`).join('')}</tr></thead><tbody>
                ${(d.siswa || []).map((s) => `<tr><td align="center">${esc(s.no)}</td><td>${esc(s.nama)}</td>${cols.map((k) => `<td${k.key === 'jk' ? ' align="center"' : ''}>${esc(k.get(s) || '')}</td>`).join('')}</tr>`).join('')}
                </tbody></table><p class="kecil">Jumlah siswa: ${(d.siswa || []).length} (Laki-laki ${(d.siswa || []).filter((s) => s.jk === 'L').length}, Perempuan ${(d.siswa || []).filter((s) => s.jk === 'P').length})</p>
                ${ttdDaftar(d, d.tanggal)}` };
        },
        blanko(d, o) {
            const n = Math.max(1, Math.min(20, Number(o.jumlah) || 10));
            const labels = String(o.label || '').split(',').map((x) => x.trim());
            return { landscape: n > 8, title: `${o.judul || 'Daftar Nilai'} ${romawi(d.kelas)}`, body: `${judulHtml(o.judul || 'DAFTAR NILAI', d, o.sub)}
                <table class="grid" width="100%"><thead><tr><th width="30">No</th><th width="60">NIS</th><th>Nama Siswa</th><th width="26">L/P</th>
                ${Array.from({ length: n }, (_, i) => `<th class="kosong">${esc(labels[i] || '')}</th>`).join('')}</tr></thead><tbody>
                ${(d.siswa || []).map((s) => `<tr><td align="center">${esc(s.no)}</td><td align="center">${esc(s.nis || '')}</td><td>${esc(s.nama)}</td><td align="center">${esc(s.jk || '')}</td>${'<td class="kosong">&nbsp;</td>'.repeat(n)}</tr>`).join('')}
                </tbody></table>${ttdDaftar(d, d.tanggal)}` };
        },
        hadir(d, o) {
            const pakaiOrtu = o.penanda === 'ortu';
            return { landscape: false, title: `${o.judul || 'Daftar Hadir'} ${romawi(d.kelas)}`, body: `${judulHtml(o.judul || 'DAFTAR HADIR', d)}
                <table class="noborder" style="margin-bottom:6pt">
                    <tr><td width="110">Kegiatan</td><td width="10">:</td><td>${isi(o.kegiatan, 50)}</td></tr>
                    <tr><td>Hari, tanggal</td><td>:</td><td>${isi(o.hari && hariTgl(o.hari), 50)}</td></tr></table>
                <table class="grid" width="100%"><thead><tr><th width="30">No</th><th>Nama Siswa</th>${pakaiOrtu ? '<th>Nama Orang Tua / Wali</th>' : '<th width="26">L/P</th>'}<th colspan="2" width="34%">Tanda Tangan</th></tr></thead><tbody>
                ${(d.siswa || []).map((s, i) => `<tr class="tinggi"><td align="center">${esc(s.no)}</td><td>${esc(s.nama)}</td>${pakaiOrtu ? `<td>${esc(ortu(s))}</td>` : `<td align="center">${esc(s.jk || '')}</td>`}
                    <td width="17%">${i % 2 === 0 ? `${i + 1}.` : '&nbsp;'}</td><td width="17%">${i % 2 === 1 ? `${i + 1}.` : '&nbsp;'}</td></tr>`).join('')}
                </tbody></table>${ttdDaftar(d, o.hari || d.tanggal)}` };
        },
        biodata(d, o) {
            const row = (l, v) => `<tr><td width="34%">${esc(l)}</td><td width="3%">:</td><td>${v ? esc(v) : '-'}</td></tr>`;
            const satu = (s) => `${kopHtml()}<div class="judul" style="margin-top:14pt">BIODATA SISWA</div>
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
                ${ttdHtml(null, { atas: [`${KOP.kota}, ${tgl(d.tanggal)}`, 'Wali Kelas'], orang: (d.wali || [])[0] })}`;
            const list = pilihSiswa(d, o);
            return { landscape: false, title: `Biodata ${list.length === 1 ? list[0].nama : `Kelas ${romawi(d.kelas)}`}`, body: halaman(list.map(satu)) };
        },
        aktif(d, o) {
            const s = pilihSiswa(d, o)[0];
            if (!s) return null;
            const row = (l, v) => `<tr><td width="170">${esc(l)}</td><td width="10">:</td><td>${v ? esc(v) : '-'}</td></tr>`;
            const ks = d.kepala_sekolah;
            return { landscape: false, title: `Surat Keterangan Aktif ${s.nama}`, body: `${kopHtml()}
                <div class="judul" style="margin-top:14pt"><u>SURAT KETERANGAN AKTIF SEKOLAH</u></div>
                <div class="subjudul" style="margin-bottom:14pt">Nomor : ${isi(o.nomor, 36)}</div>
                <p>Yang bertanda tangan di bawah ini:</p>
                <table class="noborder indent">${row('Nama', ks?.nama)}${row('NIP', ks?.nip)}${row('Jabatan', `Kepala ${KOP.nama}`)}</table>
                <p>menerangkan dengan sebenarnya bahwa:</p>
                <table class="noborder indent">${row('Nama', s.nama)}${row('NIS / NISN', [s.nis, s.nisn].filter(Boolean).join(' / '))}${row('Tempat, tanggal lahir', ttl(s))}
                    ${row('Jenis kelamin', jkPanjang(s.jk))}${row('Kelas', romawi(d.kelas))}${row('Nama orang tua / wali', ortu(s))}${row('Alamat', s.alamat)}</table>
                <p class="j">adalah benar siswa ${esc(KOP.nama)} yang terdaftar dan masih aktif mengikuti kegiatan belajar mengajar pada Tahun Pelajaran ${esc(d.tahun_ajaran)}.</p>
                <p class="j">Surat keterangan ini dibuat untuk dipergunakan sebagai ${isi(o.keperluan, 44)}.</p>
                <p class="j">Demikian surat keterangan ini dibuat agar dapat dipergunakan sebagaimana mestinya.</p>
                ${ttdHtml(null, { atas: [`${KOP.kota}, ${tgl(o.tanggal)}`, 'Kepala Sekolah'], orang: ks })}` };
        },
        panggilan(d, o) {
            const s = pilihSiswa(d, o)[0];
            if (!s) return null;
            return { landscape: false, title: `Surat Panggilan Orang Tua ${s.nama}`, body: `${kopHtml()}
                ${kepalaSurat(o, { perihal: 'Panggilan Orang Tua / Wali Murid', kepada: [`Bapak/Ibu <b>${esc(ortu(s) || titik(30))}</b>`, `Orang Tua/Wali dari <b>${esc(s.nama)}</b> (Kelas ${esc(romawi(d.kelas))})`] })}
                <p>Dengan hormat,</p>
                <p class="j">Sehubungan dengan ${isi(o.keperluan, 50)}, kami mengharapkan kehadiran Bapak/Ibu di sekolah pada:</p>
                ${acaraHtml(o)}
                <p class="j">Mengingat pentingnya hal tersebut, kami mohon Bapak/Ibu hadir tepat waktu dan tidak diwakilkan.</p>
                <p class="j">Demikian surat ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.</p>
                ${ttdHtml({ atas: ['Mengetahui,', 'Kepala Sekolah'], orang: d.kepala_sekolah }, { atas: ['', 'Wali Kelas'], orang: (d.wali || [])[0] })}` };
        },
        undangan(d, o) {
            const satu = (s) => `${kopHtml()}
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
            return { landscape: false, title: `Surat ${o.perihal || 'Pemberitahuan'} ${romawi(d.kelas)}`, body: `${kopHtml()}
                ${kepalaSurat(o, { perihal: o.perihal || 'Pemberitahuan', kepada: [`Bapak/Ibu Orang Tua/Wali Murid Kelas <b>${esc(romawi(d.kelas))}</b>`] })}
                <p>Dengan hormat,</p>
                <p class="j">${nl2br(o.isi || titik(120))}</p>
                <p class="j">Demikian pemberitahuan ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.</p>
                ${ttdHtml({ atas: ['Mengetahui,', 'Kepala Sekolah'], orang: d.kepala_sekolah }, { atas: ['', 'Wali Kelas'], orang: (d.wali || [])[0] })}` };
        },
    };

    /** { title, body, landscape } atau null bila isian belum lengkap (mis. siswa belum dipilih). */
    function build(id, data, opts) {
        return BUILD[id] ? BUILD[id](data, opts || {}) : null;
    }

    const CSS = (landscape) => `
        @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${landscape ? '12mm' : '18mm 18mm 16mm'}; }
        body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; line-height: 1.35; }
        table { border-collapse: collapse; }
        td, th { font-family: 'Times New Roman', Times, serif; font-size: 12pt; vertical-align: top; }
        .kop .k1 { font-size: 13pt; font-weight: bold; }
        .kop .k2 { font-size: 16pt; font-weight: bold; }
        .kop .k3 { font-size: 10pt; }
        .garis { border-top: 3px solid #000; border-bottom: 1px solid #000; height: 2px; margin: 4pt 0 10pt; }
        .judul { text-align: center; font-size: 14pt; font-weight: bold; }
        .subjudul { text-align: center; font-size: 11pt; }
        .meta { margin: 8pt 0 4pt; }
        .grid th, .grid td { border: 1px solid #000; padding: 2pt 4pt; font-size: ${landscape ? '9.5pt' : '11pt'}; }
        .grid th { text-align: center; background: #eee; vertical-align: middle; }
        .grid tr.tinggi td { height: 20pt; vertical-align: middle; }
        .grid .kosong { min-width: 22pt; }
        .noborder td { border: none; padding: 1pt 2pt; }
        .indent { margin: 2pt 0 8pt 28pt; }
        .acara { margin: 2pt 0 8pt 28pt; }
        .bio td { padding: 3pt 2pt; }
        .bio .bag { font-weight: bold; padding-top: 10pt; border-bottom: 1px solid #000; }
        .ttd { margin-top: 18pt; page-break-inside: avoid; }
        .ttd td { font-size: 12pt; padding-left: 12%; }
        .yth { margin: 12pt 0; }
        p { margin: 0 0 8pt; }
        p.j { text-align: justify; text-indent: 28pt; }
        .kecil { font-size: 10pt; margin-top: 4pt; }
        .pb { page-break-after: always; break-after: page; height: 0; }
        .tbar { position: fixed; top: 0; left: 0; right: 0; background: #0f172a; color: #fff; padding: 8px 12px; font: 14px Arial, sans-serif; display: flex; gap: 12px; align-items: center; z-index: 9; }
        .tbar button { font: 600 14px Arial, sans-serif; padding: 8px 16px; border: none; border-radius: 8px; background: #e11d48; color: #fff; cursor: pointer; }
        @media screen { body.lihat { padding: 60px 16px 24px; background: #e2e8f0; } body.lihat .kertas { background: #fff; max-width: ${landscape ? '277mm' : '174mm'}; margin: 0 auto; padding: 14mm; box-shadow: 0 2px 12px rgba(0,0,0,.2); } }
        @media print { .tbar { display: none; } }`;

    /** Dokumen HTML lengkap untuk dicetak (mode: 'print'), pratinjau ('preview'), atau diunduh sebagai Word ('word'). */
    function page(doc, mode = 'print') {
        const head = `<meta charset="utf-8"><title>${esc(doc.title)}</title><style>${CSS(doc.landscape)}</style>`;
        if (mode === 'word') {
            return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head>${head}
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>@page Section1 { size: ${doc.landscape ? '841.9pt 595.3pt; mso-page-orientation: landscape' : '595.3pt 841.9pt'}; margin: ${doc.landscape ? '34pt' : '51pt 51pt 45pt'}; } div.Section1 { page: Section1; } .pb { page-break-after: always; mso-special-character: line-break; }</style>
</head><body><div class="Section1">${doc.body.replace(/<div class="pb"><\/div>/g, '<br clear="all" style="page-break-before:always">')}</div></body></html>`;
        }
        const bar = mode === 'print' ? `<div class="tbar"><button onclick="window.print()">Cetak / Simpan PDF</button><span>${esc(doc.title)}</span></div>` : '';
        return `<!doctype html><html lang="id"><head>${head}</head><body class="${mode === 'print' ? 'lihat' : ''}">${bar}<div class="kertas">${doc.body}</div></body></html>`;
    }

    /** Spesifikasi Excel (untuk RekapPrint.buildXlsx) bagi dokumen berbentuk daftar; null untuk yang lain. */
    function xlsx(id, d, o = {}) {
        const siswa = d.siswa || [];
        const kop = (judul, lebar) => [
            [null, null, null, { v: judul, s: 1 }],
            [null, null, null, { v: `${KOP.sekolah} · TAHUN PELAJARAN ${String(d.tahun_ajaran || '').replace('/', ' / ')}`, s: 1 }],
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
            return { sheet: 'Blanko', rows, merges: [1, 2, 3, 4].map((r) => `D${r}:${L(lebar)}${r}`), widths: [5, 9, 34, 5, ...Array(n).fill(8)], landscape: n > 8 };
        }
        return null;
    }

    const fileName = (doc) => String(doc.title || 'Dokumen').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80);

    return { TYPES, KOLOM, KOP, typeOf, defaults, build, page, xlsx, fileName, tgl, hariTgl, romawi };
}));
