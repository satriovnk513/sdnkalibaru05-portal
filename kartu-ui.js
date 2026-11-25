// =============================================================================
// Kartu Siswa — tampilan bersama Panel Admin & Portal Guru (wali kelas).
//   KartuUI.create(ctx).render(host, classId)   foto siswa + cetak kartu (A4 / PVC)
//   KartuUI.scanAbsen(opts)                     scan kartu di lembar absensi → Hadir
// ctx: { rpc(fn, args), storage, kelas: async () => [{ id, label }], onKelas?(id) }
// Foto disimpan di bucket privat "foto-siswa" (<student_id>/<file>.jpg), dipotong 3:4.
// Hak akses diperiksa di database (get_student_cards, set_student_photo, policy storage).
// =============================================================================
(function () {
    'use strict';
    const K = window.Kartu;
    const RP = window.RekapPrint;
    const BUCKET = 'foto-siswa';
    const { esc, toast, errMessage } = window.Att;
    const STATUS = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa', D: 'Dispensasi' };
    const LOGO = `${location.origin}/logo-cetak.png`;

    const ICON = {
        print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
        cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
        user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    };

    /** Foto apa pun → JPEG 3:4 (450 × 600), dipotong di tengah, sedikit ke atas (wajah). */
    async function olahFoto(file) {
        if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) throw new Error(`${file.name || 'File'} bukan foto.`);
        let img;
        try { img = await createImageBitmap(file); } catch { throw new Error(`${file.name || 'Foto'} tidak bisa dibuka. Pakai foto JPG atau PNG.`); }
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
        return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Foto tidak bisa diproses.'))), 'image/jpeg', 0.86));
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

    // ================================================================ halaman kartu
    function create(ctx) {
        const urlCache = new Map();       // path → signed URL
        const dataCache = new Map();      // path → data URL (untuk cetak)
        const st = { classId: null, data: null, pilih: new Set(), format: 'a4', skip: 0 };
        try { st.format = localStorage.getItem('kartu-format') === 'pvc' ? 'pvc' : 'a4'; } catch { /* abaikan */ }
        let host = null;
        const rpc = (fn, args) => ctx.rpc(fn, args);
        const $ = (sel) => host.querySelector(sel);

        async function urlFoto(paths) {
            const perlu = paths.filter((p) => p && !urlCache.has(p));
            if (perlu.length) {
                const b = ctx.storage.from(BUCKET);
                if (b.createSignedUrls) {
                    const { data } = await b.createSignedUrls(perlu, 3600);
                    for (const r of data || []) if (r.signedUrl) urlCache.set(r.path, r.signedUrl);
                } else {
                    await Promise.all(perlu.map(async (p) => { const { data } = await b.createSignedUrl(p, 3600); if (data?.signedUrl) urlCache.set(p, data.signedUrl); }));
                }
            }
        }

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
                await urlFoto(st.data.siswa.map((s) => s.foto).filter(Boolean)).catch(() => {});
                gambar();
            } catch (err) { body.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; }
        }

        function thumb(s) {
            const u = s.foto ? urlCache.get(s.foto) : '';
            return `<span class="kt-thumb${u ? '' : ' kosong'}">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : ICON.user}</span>`;
        }

        function gambar() {
            const d = st.data;
            const kelola = Boolean(d.bisa_kelola);
            const adaFoto = d.siswa.filter((s) => s.foto).length;
            const n = st.pilih.size;
            $('#ktBody').innerHTML = `
                <p class="kt-ring"><b>${d.siswa.length}</b> siswa · <b>${adaFoto}</b> sudah ada foto${d.siswa.length - adaFoto ? ` · <b class="kt-kurang">${d.siswa.length - adaFoto}</b> belum` : ''}</p>
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
                    <p class="att-muted kt-hint">${n === d.siswa.length ? 'Semua siswa dipilih.' : `${n} dari ${d.siswa.length} siswa dipilih.`} Atur pilihan lewat kotak centang di daftar.</p>
                </section>
                ${kelola ? `<section class="kt-box">
                    <h3>Foto siswa</h3>
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" id="ktMassal">${ICON.cam}Upload foto massal</button>
                    <p class="att-muted kt-hint">Pilih banyak foto sekaligus. Beri nama file dengan <b>NISN</b> atau <b>NIS</b> siswa (mis. <code>0123456789.jpg</code>) — foto langsung dipasang ke siswanya. Satu per satu: ketuk foto di daftar.</p>
                </section>` : ''}
                <div class="kt-listhead">
                    <label class="kt-cek"><input type="checkbox" id="ktSemua" ${n === d.siswa.length ? 'checked' : ''}> Pilih semua</label>
                    ${adaFoto < d.siswa.length ? '<button type="button" class="att-btn att-btn-ghost att-btn-sm" id="ktTanpaFoto">Pilih yang belum ada foto</button>' : ''}
                </div>
                <ul class="kt-list">${d.siswa.map((s, i) => `<li class="kt-item" data-id="${esc(s.student_id)}">
                    <input type="checkbox" class="kt-pick" aria-label="Pilih ${esc(s.nama)}" ${st.pilih.has(s.student_id) ? 'checked' : ''}>
                    ${kelola ? `<button type="button" class="kt-foto-btn" data-foto title="Ganti foto">${thumb(s)}</button>` : thumb(s)}
                    <div class="kt-info"><b>${i + 1}. ${esc(s.nama)}</b>
                        <small>NISN ${esc(s.nisn || '–')}${s.jk ? ` · ${esc(s.jk)}` : ''}</small>
                        <span class="kt-badges">${s.foto ? '' : '<span class="att-badge warn">Belum ada foto</span>'}${Number(s.versi) > 1 ? `<span class="att-badge info">Kartu ke-${esc(s.versi)}</span>` : ''}</span></div>
                    ${kelola ? `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-atur>Atur</button>` : ''}
                </li>`).join('')}</ul>
                <p class="att-muted kt-hint">QR di kartu berisi kode acak, bukan NISN/NIK. Kartu hilang? Ketuk <b>Atur → Kartu hilang</b>: kode lama langsung tidak berlaku untuk absen, lalu cetak kartu barunya.</p>`;
            pasang();
        }

        function hitungUlang() {
            const n = st.pilih.size;
            const total = st.data.siswa.length;
            $('#ktCetak').innerHTML = `${ICON.print}Cetak (${n})`;
            $('#ktCetak').disabled = !n;
            $('#ktPdf').disabled = !n;
            $('#ktSemua').checked = n === total;
            $('.kt-box .kt-hint').textContent = `${n === total ? 'Semua siswa dipilih.' : `${n} dari ${total} siswa dipilih.`} Atur pilihan lewat kotak centang di daftar.`;
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
            $('#ktCetak').addEventListener('click', cetak);
            RP.tombolPdf($('#ktPdf'), async () => { const r = await siapkan(); return { html: r.html, nama: r.nama }; }, toast);
        }

        async function pasangFoto(s, file) {
            const blob = await olahFoto(file);
            const path = `${s.student_id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
            const { error } = await ctx.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
            if (error) throw new Error(`Foto gagal diunggah: ${error.message || error}`);
            const lama = await rpc('set_student_photo', { p_student_id: s.student_id, p_path: path });
            if (lama) { try { await ctx.storage.from(BUCKET).remove([lama]); } catch { /* sisa file tidak mengganggu */ } }
            s.foto = path;
            urlCache.set(path, URL.createObjectURL(blob));
            dataCache.delete(lama);
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
                    if (!await window.Att.confirm({ title: 'Hapus foto?', html: `<p class="att-muted">Foto ${esc(s.nama)} dihapus. Kartu yang dicetak berikutnya memakai kotak tempel foto.</p>`, confirmText: 'Hapus', danger: true })) return;
                    try {
                        const lama = await rpc('set_student_photo', { p_student_id: s.student_id, p_path: null });
                        if (lama) { try { await ctx.storage.from(BUCKET).remove([lama]); } catch { /* abaikan */ } }
                        s.foto = null; gambar(); toast('Foto dihapus.');
                    } catch (err) { toast(errMessage(err), 'err'); }
                    return;
                }
                if (a === 'hilang') {
                    if (!await window.Att.confirm({
                        title: 'Terbitkan ulang kartu?',
                        html: `<p class="att-muted">QR di kartu lama ${esc(s.nama)} <b>langsung tidak berlaku</b> untuk absen. Setelah ini cetak kartu barunya.</p>`,
                        confirmText: 'Terbitkan ulang', danger: true,
                    })) return;
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

        /** HTML cetak dengan foto ditanam (data URL) supaya tidak tergantung tautan sementara. */
        async function siapkan() {
            const d = st.data;
            const pilih = d.siswa.filter((s) => st.pilih.has(s.student_id));
            if (!pilih.length) throw new Error('Pilih minimal satu siswa.');
            await urlFoto(pilih.map((s) => s.foto).filter(Boolean)).catch(() => {});
            const fotos = {};
            await Promise.all(pilih.filter((s) => s.foto).map(async (s) => {
                if (!dataCache.has(s.foto)) dataCache.set(s.foto, await keDataUrl(urlCache.get(s.foto)));
                if (dataCache.get(s.foto)) fotos[s.student_id] = dataCache.get(s.foto);
            }));
            return {
                html: K.dokumen(d, { format: st.format, fotos, pilih: pilih.map((s) => s.student_id), skip: st.format === 'a4' ? st.skip : 0, logo: LOGO }),
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
        const awal = (() => { const h = sheet.siswa.filter((s) => s.status === 'H').length; return ringkas({ hadir: h, total: sheet.siswa.length, kosong: sheet.siswa.filter((s) => !s.status).length }); })();
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

    window.KartuUI = Object.freeze({ create, scanAbsen, olahFoto });
}());
