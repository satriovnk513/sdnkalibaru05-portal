// =============================================================================
// Kartu Siswa — tampilan bersama Panel Admin & Portal Guru (wali kelas).
//   KartuUI.create(ctx).render(host, classId)   foto siswa + pratinjau + cetak kartu (A4 / PVC)
//                                               + Pengaturan kartu (admin: TTD, stempel, logo, latar)
//   KartuUI.fotoSiswa(opts)                     foto siswa di Data Siswa / profil siswa
//   KartuUI.scanAbsen(opts)                     scan kartu di lembar absensi → Hadir
// ctx: { rpc(fn, args), storage, kelas: async () => [{ id, label }], onKelas?(id) }
// Foto siswa: bucket privat "foto-siswa" (<student_id>/<file>.jpg), dipotong 3:4.
// Aset kartu: bucket privat "kartu-aset" (ttd/, stempel/, logo/, latar/).
// Hak akses diperiksa di database (RPC kartu + policy storage).
// =============================================================================
(function () {
    'use strict';
    const K = window.Kartu;
    const RP = window.RekapPrint;
    const BUCKET = 'foto-siswa';
    const ASET = 'kartu-aset';
    const { esc, toast, errMessage } = window.Att;
    const STATUS = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa', D: 'Dispensasi' };
    const LOGO = `${location.origin}/logo-cetak.png`;
    const JENIS_ASET = [
        { k: 'ttd', label: 'Tanda tangan kepala sekolah', hint: 'Foto/scan TTD di kertas putih — latar putih dihapus otomatis.', putih: true, maks: 900 },
        { k: 'stempel', label: 'Cap / stempel sekolah', hint: 'Ditumpuk di atas TTD. Latar putih dihapus otomatis.', putih: true, maks: 600 },
        { k: 'logo', label: 'Logo kiri atas', hint: 'Mis. Tut Wuri Handayani. Kosong = logo sekolah.', putih: false, maks: 500 },
        { k: 'latar', label: 'Foto gedung sekolah (latar)', hint: 'Dibuat pudar di belakang data siswa.', putih: false, maks: 1400, jpg: true },
    ];

    const ICON = {
        print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
        cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
        user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
        gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    };

    const hariIni = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const acak = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    async function bukaGambar(file) {
        if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) throw new Error(`${file.name || 'File'} bukan gambar.`);
        try { return await createImageBitmap(file); } catch { throw new Error(`${file.name || 'Gambar'} tidak bisa dibuka. Pakai JPG atau PNG.`); }
    }
    const keBlob = (cv, type, q) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Gambar tidak bisa diproses.'))), type, q));

    /** Foto apa pun → JPEG 3:4 (450 × 600), dipotong di tengah, sedikit ke atas (wajah). */
    async function olahFoto(file) {
        const img = await bukaGambar(file);
        const W = 450;
        const H = 600;
        let sw = img.width;
        let sh = img.height;
        let sx = 0;
        let sy = 0;
        if (sw / sh > 3 / 4) { const w = sh * 3 / 4; sx = (sw - w) / 2; sw = w; } else { const h = sw * 4 / 3; sy = (sh - h) * 0.25; sh = h; }
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const g = cv.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, W, H);
        g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        img.close?.();
        return keBlob(cv, 'image/jpeg', 0.86);
    }

    /** Gambar pengaturan (TTD/stempel/logo/latar): diperkecil; TTD & stempel latar putihnya dibuat transparan. */
    async function olahAset(file, jenis) {
        const img = await bukaGambar(file);
        const k = Math.min(1, jenis.maks / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k));
        cv.height = Math.max(1, Math.round(img.height * k));
        const g = cv.getContext('2d', { willReadFrequently: jenis.putih });
        if (jenis.jpg) { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); }
        g.drawImage(img, 0, 0, cv.width, cv.height);
        img.close?.();
        if (jenis.putih) {
            const d = g.getImageData(0, 0, cv.width, cv.height);
            const px = d.data;
            for (let i = 0; i < px.length; i += 4) {
                const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                if (lum >= 225) px[i + 3] = 0;
                else if (lum > 160) px[i + 3] = Math.min(px[i + 3], Math.round(((225 - lum) / 65) * 255));
            }
            g.putImageData(d, 0, 0);
        }
        return jenis.jpg ? keBlob(cv, 'image/jpeg', 0.82) : keBlob(cv, 'image/png');
    }

    async function keDataUrl(url) {
        if (!url || url.startsWith('data:')) return url || '';
        try {
            const r = await fetch(url);
            if (!r.ok) return '';
            const b = await r.blob();
            return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(''); fr.readAsDataURL(b); });
        } catch { return ''; }
    }

    /** Tautan sementara (1 jam) untuk file di bucket privat; disimpan per bucket+path. */
    const urlCache = new Map();
    async function tandaTangani(storage, bucket, paths) {
        const perlu = [...new Set(paths.filter((p) => p && !urlCache.has(`${bucket}:${p}`)))];
        if (perlu.length) {
            const b = storage.from(bucket);
            if (b.createSignedUrls) {
                const { data } = await b.createSignedUrls(perlu, 3600);
                for (const r of data || []) if (r.signedUrl) urlCache.set(`${bucket}:${r.path}`, r.signedUrl);
            } else {
                await Promise.all(perlu.map(async (p) => { const { data } = await b.createSignedUrl(p, 3600); if (data?.signedUrl) urlCache.set(`${bucket}:${p}`, data.signedUrl); }));
            }
        }
    }
    const urlDari = (bucket, path) => (path ? urlCache.get(`${bucket}:${path}`) || '' : '');

    /** Unggah foto siswa + pasang di kartunya; foto lama dihapus. Kembali path baru. */
    async function unggahFotoSiswa({ rpc, storage }, studentId, file) {
        const blob = await olahFoto(file);
        const path = `${studentId}/${acak()}.jpg`;
        const { error } = await storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw new Error(`Foto gagal diunggah: ${error.message || error}`);
        const lama = await rpc('set_student_photo', { p_student_id: studentId, p_path: path });
        if (lama) { try { await storage.from(BUCKET).remove([lama]); } catch { /* sisa file tidak mengganggu */ } }
        urlCache.set(`${BUCKET}:${path}`, URL.createObjectURL(blob));
        return path;
    }

    async function hapusFotoSiswa({ rpc, storage }, studentId) {
        const lama = await rpc('set_student_photo', { p_student_id: studentId, p_path: null });
        if (lama) { try { await storage.from(BUCKET).remove([lama]); } catch { /* abaikan */ } }
    }

    function lembar(html) {
        const back = document.createElement('div');
        back.className = 'att-sheet-backdrop';
        back.innerHTML = `<div class="att-sheet kt-sheet" role="dialog" aria-modal="true">${html}</div>`;
        const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(back);
        return { el: back.querySelector('.att-sheet'), close };
    }

    function pilihFile({ banyak = false } = {}) {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = banyak;
            input.style.display = 'none';
            input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); }, { once: true });
            document.body.appendChild(input);
            input.click();
        });
    }

    const tanya = (title, html, confirmText, danger) => window.Att.confirm({ title, html, confirmText, danger });

    // ================================================================ halaman kartu
    function create(ctx) {
        const dataCache = new Map();      // URL → data URL (untuk cetak)
        const st = { classId: null, data: null, pilih: new Set(), format: 'a4', skip: 0 };
        try { st.format = localStorage.getItem('kartu-format') === 'pvc' ? 'pvc' : 'a4'; } catch { /* abaikan */ }
        let host = null;
        const rpc = (fn, args) => ctx.rpc(fn, args);
        const $ = (sel) => host.querySelector(sel);
        const aturan = () => st.data?.pengaturan || {};

        async function render(el, classId) {
            host = el;
            const list = await ctx.kelas();
            if (!list.length) { el.innerHTML = '<div class="att-alert info">Belum ada kelas yang bisa Anda kelola kartunya.</div>'; return; }
            st.classId = list.some((k) => k.id === classId) ? classId : (list.some((k) => k.id === st.classId) ? st.classId : list[0].id);
            el.innerHTML = `<div class="kt-ui">
                ${list.length > 1 ? `<div class="att-field"><label for="ktKelas">Kelas</label><select class="att-select" id="ktKelas">${list.map((k) =>
                    `<option value="${esc(k.id)}" ${k.id === st.classId ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></div>` : ''}
                <div id="ktBody"><div class="att-muted">Memuat…</div></div></div>`;
            $('#ktKelas')?.addEventListener('change', (e) => { st.classId = e.target.value; ctx.onKelas?.(st.classId); muat(); });
            await muat();
        }

        async function muat() {
            const body = $('#ktBody');
            body.innerHTML = '<div class="att-muted">Memuat…</div>';
            try {
                st.data = await rpc('get_student_cards', { p_class_id: st.classId });
                st.pilih = new Set(st.data.siswa.map((s) => s.student_id));
                await muatTautan();
                gambar();
            } catch (err) { body.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; }
        }

        async function muatTautan() {
            const p = aturan();
            await Promise.all([
                tandaTangani(ctx.storage, BUCKET, st.data.siswa.map((s) => s.foto).filter(Boolean)).catch(() => {}),
                tandaTangani(ctx.storage, ASET, JENIS_ASET.map((j) => p[j.k]).filter(Boolean)).catch(() => {}),
            ]);
        }

        const asetUrl = () => Object.fromEntries(JENIS_ASET.map((j) => [j.k, urlDari(ASET, aturan()[j.k])]));

        function thumb(s) {
            const u = urlDari(BUCKET, s.foto);
            return `<span class="kt-thumb${u ? '' : ' kosong'}">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : ICON.user}</span>`;
        }

        function ringkasPengaturan() {
            const p = aturan();
            const kd = p.kepsek_default || {};
            const tgl = p.tanggal_ttd ? K.tglPanjang(p.tanggal_ttd) : 'tanggal saat dicetak';
            return `${esc(p.tempat || 'Jakarta')}, ${esc(tgl)} · ${esc(p.kepsek_nama || kd.nama || 'nama kepsek belum ada')}
                · TTD ${p.ttd ? '<b class="kt-ok">✓</b>' : '<b class="kt-kurang">belum</b>'} · stempel ${p.stempel ? '<b class="kt-ok">✓</b>' : '–'}`;
        }

        function gambar() {
            const d = st.data;
            const kelola = Boolean(d.bisa_kelola);
            const adaFoto = d.siswa.filter((s) => s.foto).length;
            const n = st.pilih.size;
            const p = aturan();
            $('#ktBody').innerHTML = `
                <p class="kt-ring"><b>${d.siswa.length}</b> siswa · <b>${adaFoto}</b> sudah ada foto${d.siswa.length - adaFoto ? ` · <b class="kt-kurang">${d.siswa.length - adaFoto}</b> belum` : ''}</p>
                <section class="kt-box kt-pratinjau-box">
                    <h3>Pratinjau</h3>
                    <div class="kt-pratinjau"><iframe id="ktPrev" title="Pratinjau kartu" tabindex="-1"></iframe></div>
                    <p class="att-muted kt-hint kt-atur-ringkas">${ringkasPengaturan()}</p>
                    ${d.admin ? `<button type="button" class="att-btn att-btn-ghost att-btn-block" id="ktAtur">${ICON.gear}Pengaturan kartu (TTD, tanggal, stempel, logo, latar)</button>`
                        : (!p.ttd ? '<p class="att-muted kt-hint">Tanda tangan kepala sekolah belum di-upload. Minta admin mengisinya di Pengaturan kartu.</p>' : '')}
                </section>
                <section class="kt-box">
                    <h3>Cetak kartu</h3>
                    <div class="kt-seg" role="radiogroup" aria-label="Format cetak">
                        <button type="button" data-format="a4" aria-pressed="${st.format === 'a4'}"><b>Kertas A4</b><small>10 kartu/lembar · potong & laminating</small></button>
                        <button type="button" data-format="pvc" aria-pressed="${st.format === 'pvc'}"><b>Printer kartu PVC</b><small>1 kartu/halaman · 85,6 × 54 mm</small></button>
                    </div>
                    ${st.format === 'a4' ? `<div class="att-field"><label for="ktSkip">Kertas sisa</label><select class="att-select" id="ktSkip">${Array.from({ length: K.PER_A4 }, (_, i) =>
                        `<option value="${i}" ${i === st.skip ? 'selected' : ''}>${i ? `${i} slot pertama sudah terpakai` : 'Mulai dari slot pertama'}</option>`).join('')}</select></div>` : ''}
                    <div class="att-row kt-aksi">
                        <button type="button" class="att-btn att-btn-primary" id="ktCetak" ${n ? '' : 'disabled'}>${ICON.print}Cetak (${n})</button>
                        <button type="button" class="att-btn att-btn-ghost" id="ktPdf" ${n ? '' : 'disabled'}>${ICON.down}Download PDF</button>
                    </div>
                    <p class="att-muted kt-hint kt-pilih-info">${n === d.siswa.length ? 'Semua siswa dipilih.' : `${n} dari ${d.siswa.length} siswa dipilih.`} Atur pilihan lewat kotak centang di daftar.</p>
                </section>
                ${kelola ? `<section class="kt-box">
                    <h3>Foto siswa</h3>
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" id="ktMassal">${ICON.cam}Upload foto massal</button>
                    <p class="att-muted kt-hint">Pilih banyak foto sekaligus. Beri nama file dengan <b>NISN</b> atau <b>NIS</b> siswa (mis. <code>0123456789.jpg</code>) — foto langsung dipasang ke siswanya. Satu per satu: ketuk foto di daftar. Foto juga tampil di Data Siswa.</p>
                </section>` : ''}
                <div class="kt-listhead">
                    <label class="kt-cek"><input type="checkbox" id="ktSemua" ${n === d.siswa.length ? 'checked' : ''}> Pilih semua</label>
                    ${adaFoto < d.siswa.length ? '<button type="button" class="att-btn att-btn-ghost att-btn-sm" id="ktTanpaFoto">Pilih yang belum ada foto</button>' : ''}
                </div>
                <ul class="kt-list">${d.siswa.map((s, i) => `<li class="kt-item" data-id="${esc(s.student_id)}">
                    <input type="checkbox" class="kt-pick" aria-label="Pilih ${esc(s.nama)}" ${st.pilih.has(s.student_id) ? 'checked' : ''}>
                    ${kelola ? `<button type="button" class="kt-foto-btn" data-foto title="Ganti foto">${thumb(s)}</button>` : thumb(s)}
                    <div class="kt-info"><b>${i + 1}. ${esc(s.nama)}</b>
                        <small>NISN ${esc(s.nisn || '–')}${s.jk ? ` · ${esc(s.jk)}` : ''} · <span class="kt-kode-txt">${esc(K.kode(s.token))}</span></small>
                        <span class="kt-badges">${s.foto ? '' : '<span class="att-badge warn">Belum ada foto</span>'}${Number(s.versi) > 1 ? `<span class="att-badge info">Kartu ke-${esc(s.versi)}</span>` : ''}</span></div>
                    ${kelola ? `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-atur>Atur</button>` : ''}
                </li>`).join('')}</ul>
                <p class="att-muted kt-hint">QR & kode siswa di kartu berupa kode acak, bukan NISN/NIK. Kartu hilang? Ketuk <b>Atur → Kartu hilang</b>: kode lama langsung tidak berlaku untuk absen, lalu cetak kartu barunya.</p>`;
            pasang();
            pratinjau();
        }

        /** Kartu siswa pertama yang dipilih, digambar seukuran kotak pratinjau. */
        function pratinjau() {
            const fr = $('#ktPrev');
            if (!fr) return;
            const d = st.data;
            const s = d.siswa.find((x) => st.pilih.has(x.student_id)) || d.siswa[0];
            if (!s) { fr.closest('.kt-pratinjau-box').hidden = true; return; }
            const html = K.dokumen(d, { format: 'pvc', pilih: [s.student_id], fotos: { [s.student_id]: urlDari(BUCKET, s.foto) }, aset: asetUrl(), logoBawaan: LOGO, tanggal: hariIni(), pratinjau: true });
            const ukur = () => {
                try {
                    const lebar = fr.clientWidth || 320;
                    const z = lebar / 323.5;   // 85,6 mm ≈ 323,5 px CSS
                    fr.contentDocument.body.style.zoom = String(z);
                    fr.style.height = `${Math.ceil(204.1 * z) + 2}px`;
                } catch { /* abaikan */ }
            };
            fr.onload = ukur;
            fr.srcdoc = html;
        }

        function hitungUlang() {
            const n = st.pilih.size;
            const total = st.data.siswa.length;
            $('#ktCetak').innerHTML = `${ICON.print}Cetak (${n})`;
            $('#ktCetak').disabled = !n;
            $('#ktPdf').disabled = !n;
            $('#ktSemua').checked = n === total;
            $('.kt-pilih-info').textContent = `${n === total ? 'Semua siswa dipilih.' : `${n} dari ${total} siswa dipilih.`} Atur pilihan lewat kotak centang di daftar.`;
            pratinjau();
        }

        function pasang() {
            host.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', () => {
                st.format = b.dataset.format;
                try { localStorage.setItem('kartu-format', st.format); } catch { /* abaikan */ }
                gambar();
            }));
            $('#ktSkip')?.addEventListener('change', (e) => { st.skip = Number(e.target.value) || 0; });
            $('#ktSemua').addEventListener('change', (e) => {
                st.pilih = new Set(e.target.checked ? st.data.siswa.map((s) => s.student_id) : []);
                host.querySelectorAll('.kt-pick').forEach((c) => { c.checked = e.target.checked; });
                hitungUlang();
            });
            $('#ktTanpaFoto')?.addEventListener('click', () => {
                st.pilih = new Set(st.data.siswa.filter((s) => !s.foto).map((s) => s.student_id));
                host.querySelectorAll('.kt-item').forEach((li) => { li.querySelector('.kt-pick').checked = st.pilih.has(li.dataset.id); });
                hitungUlang();
            });
            host.querySelectorAll('.kt-pick').forEach((c) => c.addEventListener('change', () => {
                const id = c.closest('.kt-item').dataset.id;
                if (c.checked) st.pilih.add(id); else st.pilih.delete(id);
                hitungUlang();
            }));
            const siswaDari = (el) => st.data.siswa.find((s) => s.student_id === el.closest('.kt-item').dataset.id);
            host.querySelectorAll('[data-foto]').forEach((b) => b.addEventListener('click', () => gantiFoto(siswaDari(b))));
            host.querySelectorAll('[data-atur]').forEach((b) => b.addEventListener('click', () => atur(siswaDari(b))));
            $('#ktMassal')?.addEventListener('click', massal);
            $('#ktAtur')?.addEventListener('click', bukaPengaturan);
            $('#ktCetak').addEventListener('click', cetak);
            RP.tombolPdf($('#ktPdf'), async () => { const r = await siapkan(); return { html: r.html, nama: r.nama }; }, toast);
        }

        async function pasangFoto(s, file) {
            s.foto = await unggahFotoSiswa(ctx, s.student_id, file);
        }

        async function gantiFoto(s) {
            const [file] = await pilihFile();
            if (!file) return;
            const li = host.querySelector(`.kt-item[data-id="${s.student_id}"]`);
            li?.classList.add('kt-sibuk');
            try { await pasangFoto(s, file); toast(`Foto ${s.nama} tersimpan.`); gambar(); } catch (err) { li?.classList.remove('kt-sibuk'); toast(errMessage(err), 'err'); }
        }

        function atur(s) {
            const sh = lembar(`<div class="kt-sheet-head"><h3>${esc(s.nama)}</h3><button type="button" class="att-btn att-btn-ghost kt-x" data-close aria-label="Tutup">×</button></div>
                <div class="att-stack">
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" data-a="foto">${ICON.cam}${s.foto ? 'Ganti foto' : 'Upload foto'}</button>
                    ${s.foto ? '<button type="button" class="att-btn att-btn-ghost att-btn-block" data-a="hapus">Hapus foto</button>' : ''}
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" data-a="satu">${ICON.print}Cetak kartu ${esc(String(s.nama).split(' ')[0])} saja</button>
                    <button type="button" class="att-btn att-btn-danger att-btn-block" data-a="hilang">Kartu hilang / rusak — terbitkan ulang</button>
                </div>`);
            sh.el.addEventListener('click', async (e) => {
                const a = e.target.closest('[data-a]')?.dataset.a;
                if (!a) return;
                sh.close();
                if (a === 'foto') return gantiFoto(s);
                if (a === 'satu') { st.pilih = new Set([s.student_id]); gambar(); toast(`Hanya kartu ${s.nama} yang dipilih. Tekan Cetak atau Download PDF.`); return; }
                if (a === 'hapus') {
                    if (!await tanya('Hapus foto?', `<p class="att-muted">Foto ${esc(s.nama)} dihapus. Kartu yang dicetak berikutnya memakai kotak tempel foto.</p>`, 'Hapus', true)) return;
                    try { await hapusFotoSiswa(ctx, s.student_id); s.foto = null; gambar(); toast('Foto dihapus.'); } catch (err) { toast(errMessage(err), 'err'); }
                    return;
                }
                if (a === 'hilang') {
                    if (!await tanya('Terbitkan ulang kartu?', `<p class="att-muted">QR & kode di kartu lama ${esc(s.nama)} <b>langsung tidak berlaku</b> untuk absen. Setelah ini cetak kartu barunya.</p>`, 'Terbitkan ulang', true)) return;
                    try {
                        const r = await rpc('reissue_student_card', { p_student_id: s.student_id });
                        s.token = r.token; s.versi = r.versi;
                        st.pilih = new Set([s.student_id]);
                        gambar();
                        toast(`Kartu baru ${s.nama} siap dicetak (kartu ke-${r.versi}).`);
                    } catch (err) { toast(errMessage(err), 'err'); }
                }
            });
        }

        async function massal() {
            const files = await pilihFile({ banyak: true });
            if (!files.length) return;
            const cocok = new Map();
            const gagal = [];
            for (const f of files) {
                const s = K.cocokkanFoto(f.name, st.data.siswa);
                if (s) cocok.set(s.student_id, { s, f }); else gagal.push(f.name);
            }
            if (!cocok.size) {
                toast(`Tidak ada foto yang cocok dengan siswa ${K.romawi(st.data.kelas.nama)}. Beri nama file dengan NISN atau NIS siswa.`, 'err');
                return;
            }
            const sh = lembar(`<div class="kt-sheet-head"><h3>Upload foto massal</h3></div>
                <p id="ktProg" aria-live="polite">Mengunggah 0 dari ${cocok.size} foto…</p><div class="kt-bar"><i id="ktBar"></i></div><div id="ktHasil"></div>`);
            let ok = 0;
            const err = [];
            for (const { s, f } of cocok.values()) {
                try { await pasangFoto(s, f); ok += 1; } catch (x) { err.push(`${f.name}: ${errMessage(x)}`); }
                const done = ok + err.length;
                sh.el.querySelector('#ktProg').textContent = `Mengunggah ${done} dari ${cocok.size} foto…`;
                sh.el.querySelector('#ktBar').style.width = `${Math.round((done / cocok.size) * 100)}%`;
            }
            sh.el.querySelector('#ktProg').innerHTML = `<b>${ok} foto terpasang.</b>`;
            sh.el.querySelector('#ktHasil').innerHTML = `
                ${gagal.length ? `<div class="att-alert warn">${gagal.length} file tidak cocok dengan siswa kelas ini (nama file harus NISN/NIS):<ul>${gagal.slice(0, 20).map((g) => `<li>${esc(g)}</li>`).join('')}${gagal.length > 20 ? `<li>… ${gagal.length - 20} lagi</li>` : ''}</ul></div>` : ''}
                ${err.length ? `<div class="att-alert err">Gagal:<ul>${err.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
                <button type="button" class="att-btn att-btn-primary att-btn-block" data-close>Selesai</button>`;
            gambar();
        }

        // ------------------------------------------------------------ pengaturan (admin)
        function bukaPengaturan() {
            const p = aturan();
            const kd = p.kepsek_default || {};
            const baru = {};        // k → Blob (gambar baru, belum diunggah)
            const hapus = new Set(); // k yang dikosongkan
            const sh = lembar(`<div class="kt-sheet-head"><h3>Pengaturan kartu</h3><button type="button" class="att-btn att-btn-ghost kt-x" data-close aria-label="Tutup">×</button></div>
                <form class="att-stack kt-set" novalidate>
                    <div class="att-row">
                        <div class="att-field"><label for="ktSetTempat">Tempat TTD</label><input class="att-input" id="ktSetTempat" maxlength="60" value="${esc(p.tempat || 'Jakarta')}"></div>
                        <div class="att-field"><label for="ktSetTgl">Tanggal TTD</label><input class="att-input" id="ktSetTgl" type="date" value="${esc(p.tanggal_ttd || '')}"></div>
                    </div>
                    <p class="att-muted kt-hint">Tanggal kosong = memakai tanggal saat kartu dicetak.</p>
                    <div class="att-field"><label for="ktSetNama">Nama kepala sekolah</label><input class="att-input" id="ktSetNama" maxlength="120" value="${esc(p.kepsek_nama || '')}" placeholder="${esc(kd.nama || 'Nama lengkap + gelar')}"></div>
                    <div class="att-field"><label for="ktSetNip">NIP kepala sekolah</label><input class="att-input" id="ktSetNip" maxlength="40" inputmode="numeric" value="${esc(p.kepsek_nip || '')}" placeholder="${esc(kd.nip || '')}"></div>
                    <p class="att-muted kt-hint">Nama & NIP kosong = diambil dari data Guru &amp; Staf (jabatan Kepala Sekolah)${kd.nama ? `: <b>${esc(kd.nama)}</b>` : ''}.</p>
                    ${JENIS_ASET.map((j) => `<div class="kt-aset" data-k="${j.k}">
                        <span class="kt-aset-img${j.k === 'latar' ? ' lebar' : ''}"></span>
                        <div class="kt-aset-info"><b>${esc(j.label)}</b><small class="att-muted">${esc(j.hint)}</small>
                            <span class="kt-aset-btn"><button type="button" class="att-btn att-btn-ghost att-btn-sm" data-up>Upload</button>
                            <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-del>Hapus</button></span></div>
                    </div>`).join('')}
                    <div class="att-alert err" id="ktSetErr" role="alert" hidden></div>
                    <button type="submit" class="att-btn att-btn-primary att-btn-block" id="ktSetSimpan">Simpan pengaturan</button>
                </form>`);
            const el = sh.el;
            const gambarAset = () => {
                for (const j of JENIS_ASET) {
                    const box = el.querySelector(`.kt-aset[data-k="${j.k}"]`);
                    const src = baru[j.k] ? URL.createObjectURL(baru[j.k]) : (!hapus.has(j.k) && p[j.k] ? urlDari(ASET, p[j.k]) : (j.k === 'logo' ? LOGO : ''));
                    box.querySelector('.kt-aset-img').innerHTML = src ? `<img src="${esc(src)}" alt="">` : '<em>Belum ada</em>';
                    const ada = Boolean(baru[j.k] || (!hapus.has(j.k) && p[j.k]));
                    box.querySelector('[data-up]').textContent = ada ? 'Ganti' : 'Upload';
                    box.querySelector('[data-del]').style.display = ada ? '' : 'none';
                }
            };
            gambarAset();
            el.addEventListener('click', async (e) => {
                const box = e.target.closest('.kt-aset');
                if (!box) return;
                const j = JENIS_ASET.find((x) => x.k === box.dataset.k);
                if (e.target.closest('[data-del]')) { delete baru[j.k]; hapus.add(j.k); gambarAset(); return; }
                if (e.target.closest('[data-up]')) {
                    const [file] = await pilihFile();
                    if (!file) return;
                    try { baru[j.k] = await olahAset(file, j); hapus.delete(j.k); gambarAset(); } catch (err) { toast(errMessage(err), 'err'); }
                }
            });
            el.querySelector('form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const errBox = el.querySelector('#ktSetErr');
                errBox.hidden = true;
                const tempat = el.querySelector('#ktSetTempat').value.trim();
                if (!tempat) { errBox.textContent = 'Tempat TTD wajib diisi.'; errBox.hidden = false; return; }
                const btn = el.querySelector('#ktSetSimpan');
                btn.disabled = true; btn.textContent = 'Menyimpan…';
                const kirim = {
                    tempat,
                    tanggal_ttd: el.querySelector('#ktSetTgl').value || '',
                    kepsek_nama: el.querySelector('#ktSetNama').value.trim(),
                    kepsek_nip: el.querySelector('#ktSetNip').value.trim(),
                };
                const diunggah = [];
                try {
                    for (const j of JENIS_ASET) {
                        if (baru[j.k]) {
                            const path = `${j.k}/${acak()}.${j.jpg ? 'jpg' : 'png'}`;
                            const { error } = await ctx.storage.from(ASET).upload(path, baru[j.k], { contentType: j.jpg ? 'image/jpeg' : 'image/png', upsert: false });
                            if (error) throw new Error(`${j.label} gagal diunggah: ${error.message || error}`);
                            diunggah.push(path);
                            urlCache.set(`${ASET}:${path}`, URL.createObjectURL(baru[j.k]));
                            kirim[j.k] = path;
                        } else if (hapus.has(j.k)) kirim[j.k] = '';
                    }
                    const r = await rpc('set_card_settings', { p: kirim });
                    if (r?.hapus?.length) { try { await ctx.storage.from(ASET).remove(r.hapus); } catch { /* abaikan */ } }
                    st.data.pengaturan = r.pengaturan;
                    sh.close();
                    toast('Pengaturan kartu tersimpan.');
                    gambar();
                } catch (err) {
                    if (diunggah.length) { try { await ctx.storage.from(ASET).remove(diunggah); } catch { /* abaikan */ } }
                    errBox.textContent = errMessage(err);
                    errBox.hidden = false;
                    btn.disabled = false; btn.textContent = 'Simpan pengaturan';
                }
            });
        }

        // ------------------------------------------------------------ cetak
        /** HTML cetak dengan foto & aset ditanam (data URL) supaya tidak tergantung tautan sementara. */
        async function siapkan() {
            const d = st.data;
            const pilih = d.siswa.filter((s) => st.pilih.has(s.student_id));
            if (!pilih.length) throw new Error('Pilih minimal satu siswa.');
            await muatTautan();
            const tanam = async (url) => {
                if (!url) return '';
                if (!dataCache.has(url)) dataCache.set(url, await keDataUrl(url));
                return dataCache.get(url);
            };
            const fotos = {};
            await Promise.all(pilih.filter((s) => s.foto).map(async (s) => {
                const du = await tanam(urlDari(BUCKET, s.foto));
                if (du) fotos[s.student_id] = du;
            }));
            const aset = {};
            await Promise.all(Object.entries(asetUrl()).map(async ([k, u]) => { aset[k] = await tanam(u); }));
            return {
                html: K.dokumen(d, { format: st.format, fotos, aset, logoBawaan: LOGO, tanggal: hariIni(), pilih: pilih.map((s) => s.student_id), skip: st.format === 'a4' ? st.skip : 0 }),
                nama: K.namaFile(d, st.format),
            };
        }

        async function cetak() {
            const w = window.open('', '_blank');   // dibuka dulu supaya tidak diblokir pop-up
            if (!w) { toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err'); return; }
            try { w.document.write('<p style="font:16px Arial;padding:24px">Menyiapkan kartu…</p>'); } catch { /* abaikan */ }
            try {
                const { html, nama } = await siapkan();
                w.document.open(); w.document.write(html); w.document.close();
                try { RP.pasangToolbar(w, html, nama); } catch { /* toolbar bawaan tetap ada */ }
                const mulai = Date.now();
                const tick = () => {
                    let siap = false;
                    try { siap = w.document.readyState === 'complete' && [...w.document.images].every((i) => i.complete); } catch { return; }
                    if (siap || Date.now() - mulai > 4000) { try { w.focus(); w.print(); } catch { /* tombol Cetak tetap ada */ } } else setTimeout(tick, 150);
                };
                setTimeout(tick, 150);
            } catch (err) { w.close(); toast(errMessage(err), 'err'); }
        }

        return { render, reload: muat };
    }

    // ================================================================ foto di Data Siswa / profil
    /**
     * Foto siswa + tombol Upload/Ganti/Hapus (kalau boleh mengelola).
     * opts: { host, rpc, storage, studentId, nama, onUbah?(path) }
     */
    async function fotoSiswa(opts) {
        const { studentId } = opts;
        const host = document.createElement('div');   // wadah baru tiap dipanggil (listener tidak menumpuk)
        opts.host.replaceChildren(host);
        let info;
        try { info = await opts.rpc('get_student_photo', { p_student_id: studentId }); } catch { host.innerHTML = ''; return; }
        const gambar = async () => {
            if (info.foto) await tandaTangani(opts.storage, BUCKET, [info.foto]).catch(() => {});
            const u = urlDari(BUCKET, info.foto);
            host.innerHTML = `<div class="kt-fs">
                <span class="kt-fs-img${u ? '' : ' kosong'}">${u ? `<img src="${esc(u)}" alt="Foto ${esc(opts.nama || 'siswa')}">` : ICON.user}</span>
                ${info.bisa_kelola ? `<span class="kt-fs-btn">
                    <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-fs="up">${ICON.cam}${info.foto ? 'Ganti foto' : 'Upload foto'}</button>
                    ${info.foto ? '<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-fs="del">Hapus</button>' : ''}</span>` : ''}
            </div>`;
        };
        await gambar();
        host.addEventListener('click', async (e) => {
            const a = e.target.closest('[data-fs]')?.dataset.fs;
            if (!a) return;
            try {
                if (a === 'up') {
                    const [file] = await pilihFile();
                    if (!file) return;
                    host.querySelector('.kt-fs')?.classList.add('kt-sibuk');
                    info.foto = await unggahFotoSiswa(opts, studentId, file);
                    toast('Foto tersimpan. Foto ini juga dipakai di kartu pelajar.');
                } else {
                    if (!await tanya('Hapus foto?', `<p class="att-muted">Foto ${esc(opts.nama || 'siswa')} dihapus dari data siswa dan kartu pelajar.</p>`, 'Hapus', true)) return;
                    await hapusFotoSiswa(opts, studentId);
                    info.foto = null;
                    toast('Foto dihapus.');
                }
                opts.onUbah?.(info.foto);
            } catch (err) { toast(errMessage(err), 'err'); }
            await gambar();
        });
    }

    // ================================================================ scan absensi
    /**
     * Scan kartu di lembar absensi. sheet: kendali dari Att.renderSheet (onScan):
     * { siswa, tandaiHadir(id), selesai() }.
     */
    async function scanAbsen({ rpc, classId, sheet }) {
        let list;
        try { list = await rpc('get_class_card_tokens', { p_class_id: classId }); } catch (err) { toast(errMessage(err), 'err'); return; }
        if (!list?.length) {
            toast('Kartu siswa kelas ini belum dibuat. Wali kelas atau admin bisa mencetaknya di menu Kartu Siswa.', 'err');
            return;
        }
        const peta = new Map(list.map((x) => [x.token, x.student_id]));
        let baru = 0;
        const ringkas = (r) => `Hadir ${r.hadir} dari ${r.total} · belum diabsen ${r.kosong}`;
        const awal = ringkas({ hadir: sheet.siswa.filter((s) => s.status === 'H').length, total: sheet.siswa.length, kosong: sheet.siswa.filter((s) => !s.status).length });
        await window.QrScan.kamera({
            terus: true,
            petunjuk: 'Arahkan ke QR di kartu siswa',
            sub: awal,
            onTeks: async (teks) => {
                const token = K.tokenDariScan(teks);
                if (!token) return { pesan: 'Ini bukan QR kartu siswa.', jenis: 'err' };
                const id = peta.get(token);
                const r = id ? sheet.tandaiHadir(id) : null;
                if (r) {
                    if (r.sebelum === 'H') return { pesan: `${r.nama} sudah Hadir.`, jenis: 'info', sub: ringkas(r) };
                    baru += 1;
                    return { pesan: `✓ ${r.nama} — Hadir${r.sebelum ? ` (tadinya ${STATUS[r.sebelum] || r.sebelum})` : ''}`, jenis: 'ok', sub: ringkas(r) };
                }
                let info = null;
                try { info = await rpc('resolve_student_card', { p_token: token }); } catch { /* anggap tidak dikenal */ }
                if (info && !info.aktif) return { pesan: `${info.nama} sudah tidak terdaftar sebagai siswa aktif.`, jenis: 'err' };
                if (info) return { pesan: `${info.nama} terdaftar di Kelas ${K.romawi(info.kelas || '')}, bukan kelas ini.`, jenis: 'err' };
                return { pesan: 'Kartu tidak dikenal — mungkin kartu lama yang sudah diganti.', jenis: 'err' };
            },
            onTutup: () => {
                sheet.selesai();
                if (baru) toast(`${baru} siswa ditandai Hadir lewat kartu. Lengkapi yang lain, lalu tekan Simpan.`);
            },
            foto: {
                judul: 'Scan kartu lewat foto',
                petunjuk: 'Ketuk <b>Foto kartu</b> lalu foto QR di kartu siswa. Ulangi untuk siswa berikutnya.',
                tombol: 'Foto kartu',
                gagal: 'QR kartu belum terbaca. Coba foto lebih dekat & tidak buram.',
            },
        });
    }

    window.KartuUI = Object.freeze({ create, fotoSiswa, scanAbsen, olahFoto });
}());
