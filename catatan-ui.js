// =============================================================================
// Catatan Siswa — Portal Guru (#/catatan?kelas=&smt=, #/catatan/siswa?id=).
//   kelas : daftar siswa + jumlah catatan (yang boleh dilihat), filter, ringkasan, PDF semester
//   siswa : riwayat satu anak (linimasa), tindak lanjut, ubah/hapus milik sendiri, PDF anak
//   tulis : lembar tulis/ubah catatan — 1+ siswa, jenis, tingkat, foto opsional (maks. 3)
// Hak akses tetap di database (RPC get_class_notes, save_student_note, …).
//   CatatanUI.create({ rpc, storage, uid(), nav(view, params), setTop(title, sub) })
// =============================================================================
(function () {
    'use strict';

    const { esc, errMessage, toast, todayJakarta } = window.Att;
    const C = window.Catatan;
    const RP = window.RekapPrint;
    const BUCKET = 'catatan-siswa';
    const ICON = {
        star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
        warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
        note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H8l-4 4z"/></svg>',
        chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
        cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>',
        lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
        x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    };
    const JIKON = { apresiasi: ICON.star, perilaku: ICON.warn, catatan: ICON.note };
    const semesterNow = () => (Number(todayJakarta().slice(5, 7)) >= 7 ? 1 : 2);

    /** Kecilkan foto (maks. 1280 px, JPEG) sebelum diunggah. */
    async function kecilkan(file) {
        const img = await createImageBitmap(file);
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Foto tidak bisa diproses.'))), 'image/jpeg', 0.8));
    }

    function sheet(html) {
        const back = document.createElement('div');
        back.className = 'att-sheet-backdrop';
        back.innerHTML = `<div class="att-sheet cs-sheet" role="dialog" aria-modal="true">${html}</div>`;
        const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(back);
        return { el: back, close };
    }

    function create(ctx) {
        const urlCache = new Map();
        let kelasList = null;
        let filter = 'semua';

        const rpc = (fn, args) => ctx.rpc(fn, args);
        async function classes() { return (kelasList ||= await rpc('get_note_classes')); }

        async function fotoUrl(path) {
            if (urlCache.has(path)) return urlCache.get(path);
            const { data, error } = await ctx.storage.from(BUCKET).createSignedUrl(path, 3600);
            if (error || !data?.signedUrl) return '';
            urlCache.set(path, data.signedUrl);
            return data.signedUrl;
        }
        function isiFoto(el) {
            el.querySelectorAll('img[data-foto]').forEach(async (img) => { const u = await fotoUrl(img.dataset.foto); if (u) { img.src = u; img.closest('a')?.setAttribute('href', u); } });
        }

        // ------------------------------------------------------------ kelas
        async function viewKelas(el, p) {
            const list = await classes();
            if (!list.length) { el.innerHTML = '<div class="att-alert info">Belum ada rombel di tahun ajaran aktif.</div>'; return; }
            const kelas = list.some((k) => k.id === p.kelas) ? p.kelas : list[0].id;
            const smt = Number(p.smt) === 2 ? 2 : (Number(p.smt) === 1 ? 1 : semesterNow());
            const d = await rpc('get_class_notes', { p_class_id: kelas, p_semester: smt });
            const info = list.find((k) => k.id === kelas);
            ctx.setTop('Catatan Siswa', `Kelas ${C.kelasTitik(info.nama)}${info.wali ? ' · Wali kelas' : ''} · Semester ${smt === 2 ? 'Genap' : 'Ganjil'}`);
            const r = C.ringkas(d.catatan);
            const h = C.hitung(d.catatan);
            const P = (x) => esc(JSON.stringify({ kelas, smt, ...x }));
            const draw = () => {
                const q = (el.querySelector('#csCari')?.value || '').trim().toLowerCase();
                const rows = d.siswa.filter((s) => {
                    const c = h.get(s.id);
                    if (q && !String(s.nama).toLowerCase().includes(q)) return false;
                    if (filter === 'apresiasi') return c?.apresiasi;
                    if (filter === 'perhatian') return c?.perilaku;
                    if (filter === 'kosong') return !c;
                    return true;
                });
                el.querySelector('#csList').innerHTML = rows.length ? rows.map((s) => {
                    const c = h.get(s.id) || {};
                    return `<a href="#" class="cs-row" data-nv="siswa" data-p="${P({ id: s.id })}">
                        <span class="cs-no">${esc(s.no)}</span><span class="cs-nm">${esc(s.nama)}</span>
                        ${c.apresiasi ? `<span class="cs-chip a">${ICON.star}${c.apresiasi}</span>` : ''}
                        ${c.perilaku ? `<span class="cs-chip ${c.serius ? 's' : 'p'}" title="${c.serius ? 'Ada catatan serius' : 'Perilaku'}">!${c.perilaku}</span>` : ''}
                        ${c.catatan ? `<span class="cs-chip c">${ICON.note}${c.catatan}</span>` : ''}${ICON.chev}</a>`;
                }).join('') : '<div class="att-muted" style="padding:14px">Tidak ada siswa yang cocok.</div>';
                wire(el.querySelector('#csList'));
            };
            el.innerHTML = `
                <div class="att-field nl-kelas"><label for="csKelas">Kelas</label><select class="att-select" id="csKelas">${list.map((k) =>
        `<option value="${esc(k.id)}" ${k.id === kelas ? 'selected' : ''}>Kelas ${esc(k.nama)}${k.wali ? ' · Wali kelas' : (k.ajar ? ' · Saya mengajar' : '')}</option>`).join('')}</select></div>
                <div class="inv-seg nl-seg" role="tablist" aria-label="Semester">
                    <button type="button" role="tab" data-smt="1" aria-selected="${smt === 1}">Semester Ganjil</button>
                    <button type="button" role="tab" data-smt="2" aria-selected="${smt === 2}">Semester Genap</button></div>
                <div class="cs-tiles">
                    <div class="cs-tile a">${ICON.star}<b>${r.apresiasi}</b><span>Apresiasi</span></div>
                    <div class="cs-tile p">${ICON.warn}<b>${r.perilaku}</b><span>Perilaku${r.serius ? ` · ${r.serius} serius` : ''}</span></div>
                    <div class="cs-tile c">${ICON.note}<b>${r.catatan}</b><span>Catatan</span></div>
                </div>
                ${r.seriusTerbuka.length ? `<div class="att-alert err cs-alert">${ICON.warn}<span><b>${r.seriusTerbuka.length} catatan serius belum ada tindak lanjut</b> — ${r.seriusTerbuka.slice(0, 2).map((n) => `${esc(n.siswa)}, ${esc(C.tglSedang(n.tanggal))} (${esc(n.penulis)})`).join('; ')}</span></div>` : ''}
                ${!d.lihat_semua ? '<div class="att-alert info cs-alert">Anda melihat catatan yang Anda tulis sendiri. Catatan guru lain untuk kelas ini hanya terlihat oleh wali kelas dan kepala sekolah.</div>' : ''}
                <label for="csCari" class="sr-only">Cari siswa</label>
                <input class="att-input cs-cari" id="csCari" type="search" placeholder="Cari nama siswa">
                <div class="cs-filters" role="group" aria-label="Saring">${[['semua', 'Semua'], ['apresiasi', 'Ada apresiasi'], ['perhatian', 'Ada catatan perilaku'], ['kosong', 'Belum ada catatan']].map(([k, t]) =>
        `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${t}</button>`).join('')}</div>
                <section class="cs-list" id="csList"></section>
                <p class="att-muted cs-priv">${ICON.lock} Catatan hanya terlihat oleh penulisnya, wali kelas, kepala sekolah, dan operator sekolah.</p>
                <div class="cs-act">
                    <button type="button" class="att-btn att-btn-primary att-btn-block" id="csTulis">+ Tulis catatan</button>
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" id="csPdf">Cetak rangkuman semester</button>
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" id="csPdfDl">Download PDF rangkuman</button>
                </div>`;
            el.querySelector('#csKelas').addEventListener('change', (e) => ctx.nav('kelas', { kelas: e.target.value, smt }));
            el.querySelectorAll('[data-smt]').forEach((b) => b.addEventListener('click', () => ctx.nav('kelas', { kelas, smt: Number(b.dataset.smt) })));
            el.querySelector('#csCari').addEventListener('input', draw);
            el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
                filter = b.dataset.f;
                el.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
                draw();
            }));
            el.querySelector('#csTulis').addEventListener('click', () => tulis({ kelas, siswa: d.siswa, pilih: [], onDone: () => viewKelas(el, { kelas, smt }) }));
            el.querySelector('#csPdf').addEventListener('click', () => { if (!RP.print(C.htmlKelas(d))) toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err'); });
            RP.tombolPdf(el.querySelector('#csPdfDl'), () => ({ html: C.htmlKelas(d), nama: `Rangkuman_Catatan_${String(d.kelas?.nama || 'Kelas').replace(/\s+/g, '_')}_Smt${d.semester || ''}` }), toast);
            draw();
        }

        function wire(root) {
            root.querySelectorAll('[data-nv]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); ctx.nav(b.dataset.nv, JSON.parse(b.dataset.p || '{}')); }));
        }

        // ------------------------------------------------------------ siswa
        async function viewSiswa(el, p) {
            const semua = p.semua === '1' || p.semua === true;
            const d = await rpc('get_student_notes', { p_student_id: p.id, p_semua: semua });
            const s = d.siswa || {};
            ctx.setTop(s.nama || 'Catatan siswa', `${s.kelas ? `Kelas ${C.kelasTitik(s.kelas)}` : ''}${s.nis ? ` · NIS ${s.nis}` : ''}${s.jk ? ` · ${s.jk === 'L' ? 'Laki-laki' : 'Perempuan'}` : ''}`);
            const r = C.ringkas(d.catatan);
            const card = (n) => `<li class="cs-tl ${n.jenis} ${n.tingkat || ''}">
                <article>
                    <div class="cs-tl-head"><span class="cs-tag ${n.jenis} ${n.tingkat || ''}">${JIKON[n.jenis]}${esc(C.label(n).toUpperCase())}</span><span class="att-muted">${esc(C.tglSedang(n.tanggal))}</span></div>
                    <div class="cs-tl-body">
                        ${n.fotos?.length ? `<div class="cs-fotos">${n.fotos.map((f) => `<a href="#" target="_blank" rel="noopener"><img data-foto="${esc(f)}" alt="Foto catatan" loading="lazy"></a>`).join('')}</div>` : ''}
                        <b>${esc(n.judul)}</b>
                        ${n.cerita ? `<p>${esc(n.cerita)}</p>` : ''}
                        ${n.tindak_lanjut ? `<div class="cs-tl-ok">Tindak lanjut: ${esc(n.tindak_lanjut)}${n.tindak_lanjut_oleh ? ` <span class="att-muted">— ${esc(n.tindak_lanjut_oleh)}</span>` : ''}</div>`
        : (n.jenis === 'perilaku' ? `<div class="cs-tl-todo">Tindak lanjut: <b>belum diisi</b></div>` : '')}
                        <div class="cs-tl-foot"><span class="att-muted">oleh ${esc(n.penulis)}${n.penulis_peran ? ` (${esc(n.penulis_peran)})` : ''}${n.dirapikan_oleh ? ` · dirapikan ${esc(n.dirapikan_oleh)}` : ''}</span>
                            ${n.bisa_tindak_lanjut ? `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-tl="${esc(n.id)}">${n.tindak_lanjut ? 'Ubah tindak lanjut' : '+ Tindak lanjut'}</button>` : ''}
                            ${n.milik_saya ? `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-ubah="${esc(n.id)}">Ubah</button><button type="button" class="att-btn att-btn-danger att-btn-sm" data-hapus="${esc(n.id)}">Hapus</button>` : ''}</div>
                    </div>
                </article></li>`;
            el.innerHTML = `
                <div class="cs-chips"><span class="cs-chip a big">${ICON.star}${r.apresiasi} apresiasi</span><span class="cs-chip p big">!${r.perilaku} perilaku</span><span class="cs-chip c big">${ICON.note}${r.catatan} catatan</span></div>
                <div class="inv-seg nl-seg" role="tablist" aria-label="Rentang">
                    <button type="button" role="tab" data-semua="0" aria-selected="${!semua}">Semester ini</button>
                    <button type="button" role="tab" data-semua="1" aria-selected="${semua}">Semua (sejak kelas 1)</button></div>
                ${d.catatan.length ? `<ol class="cs-tlist">${d.catatan.map(card).join('')}</ol>` : `<div class="att-alert info">Belum ada catatan ${semua ? '' : 'di semester ini '}yang bisa Anda lihat.</div>`}
                <div class="cs-act">
                    ${s.class_id ? `<button type="button" class="att-btn att-btn-primary att-btn-block" id="csTulis">+ Tulis catatan untuk ${esc(String(s.nama || '').split(' ')[0])}</button>` : ''}
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" id="csPdf">Cetak catatan ${esc(String(s.nama || '').split(' ')[0])}</button>
                    <button type="button" class="att-btn att-btn-ghost att-btn-block" id="csPdfDl">Download PDF catatan</button>
                </div>`;
            isiFoto(el);
            el.querySelectorAll('[data-semua]').forEach((b) => b.addEventListener('click', () => ctx.nav('siswa', { ...p, semua: b.dataset.semua })));
            el.querySelector('#csPdf').addEventListener('click', () => { if (!RP.print(C.htmlSiswa(d))) toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err'); });
            RP.tombolPdf(el.querySelector('#csPdfDl'), () => ({ html: C.htmlSiswa(d), nama: `Catatan_${String(s.nama || 'Siswa').replace(/\s+/g, '_')}` }), toast);
            const ulang = () => viewSiswa(el, p);
            el.querySelector('#csTulis')?.addEventListener('click', () => tulis({ kelas: s.class_id, siswa: [{ id: s.id, nama: s.nama }], pilih: [s.id], kunciSiswa: true, onDone: ulang }));
            el.querySelectorAll('[data-tl]').forEach((b) => b.addEventListener('click', () => tindakLanjut(d.catatan.find((n) => n.id === b.dataset.tl), ulang)));
            el.querySelectorAll('[data-ubah]').forEach((b) => b.addEventListener('click', () => {
                const n = d.catatan.find((x) => x.id === b.dataset.ubah);
                tulis({ kelas: n.class_id, siswa: [{ id: n.student_id, nama: n.siswa }], pilih: [n.student_id], kunciSiswa: true, edit: n, onDone: ulang });
            }));
            el.querySelectorAll('[data-hapus]').forEach((b) => b.addEventListener('click', async () => {
                if (!await window.Att.confirm({ title: 'Hapus catatan ini?', html: '<p class="att-muted">Catatan dan fotonya dihapus permanen.</p>', confirmText: 'Hapus', danger: true })) return;
                try {
                    const res = await rpc('delete_student_note', { p_id: b.dataset.hapus });
                    if (res?.fotos?.length) await ctx.storage.from(BUCKET).remove(res.fotos);
                    toast('Catatan dihapus', 'ok');
                    ulang();
                } catch (err) { toast(errMessage(err), 'err'); }
            }));
        }

        function tindakLanjut(n, done) {
            const sh = sheet(`<h3>Tindak lanjut</h3><p class="att-muted" style="margin:0 0 10px">${esc(n.siswa)} — ${esc(n.judul)}</p>
                <label for="csTlIn" class="cs-l">Apa yang sudah dilakukan?</label>
                <textarea class="att-textarea" id="csTlIn" rows="3" maxlength="500" placeholder="Mis. orang tua dipanggil 20 Nov, sudah dinasihati">${esc(n.tindak_lanjut || '')}</textarea>
                <div class="att-row" style="margin-top:14px"><button type="button" class="att-btn att-btn-ghost" data-close style="flex:1">Batal</button>
                <button type="button" class="att-btn att-btn-primary" id="csTlSave" style="flex:1">Simpan</button></div>`);
            sh.el.querySelector('#csTlIn').focus();
            sh.el.querySelector('#csTlSave').addEventListener('click', async () => {
                try { await rpc('set_note_followup', { p_id: n.id, p_text: sh.el.querySelector('#csTlIn').value }); sh.close(); toast('Tindak lanjut tersimpan', 'ok'); done(); } catch (err) { toast(errMessage(err), 'err'); }
            });
        }

        // ------------------------------------------------------------ tulis / ubah
        function tulis(o) {
            const e = o.edit || null;
            const st = { jenis: e?.jenis || 'apresiasi', tingkat: e?.tingkat || 'ringan', pilih: new Set(o.pilih || []), fotos: [...(e?.fotos || [])], baru: [] };
            const sh = sheet(`<div class="cs-sheet-head"><h3>${e ? 'Ubah catatan' : 'Tulis catatan'}</h3><button type="button" class="att-btn att-btn-ghost cs-x" data-close aria-label="Tutup">${ICON.x}</button></div>
                <div class="cs-f"><div class="cs-l">Siswa ${o.kunciSiswa ? '' : '<span class="att-muted">(boleh lebih dari 1, mis. lomba tim)</span>'}</div>
                    <div class="cs-pick" id="csPick"></div>
                    ${o.kunciSiswa ? '' : `<label for="csCariS" class="sr-only">Cari siswa</label><input class="att-input" id="csCariS" type="search" placeholder="Cari &amp; ketuk nama siswa…"><div class="cs-opts" id="csOpts"></div>`}</div>
                <div class="cs-f"><div class="cs-l">Jenis catatan</div>
                    <div class="cs-jenis">${['apresiasi', 'perilaku', 'catatan'].map((j) => `<button type="button" data-j="${j}" class="${j}" aria-pressed="${st.jenis === j}">${JIKON[j]}${C.JENIS[j]}</button>`).join('')}</div></div>
                <div class="cs-f" id="csTingkat"><div class="cs-l">Tingkat</div>
                    <div class="cs-ting">${Object.entries(C.TINGKAT).map(([k, t]) => `<button type="button" data-t="${k}" class="${k}" aria-pressed="${st.tingkat === k}">${t}</button>`).join('')}</div></div>
                <div class="cs-f"><label for="csTgl" class="cs-l">Tanggal</label><input class="att-input" type="date" id="csTgl" value="${esc(e?.tanggal || todayJakarta())}" max="${esc(todayJakarta())}"></div>
                <div class="cs-f"><label for="csJudul" class="cs-l">Judul singkat</label><input class="att-input" id="csJudul" maxlength="120" value="${esc(e?.judul || '')}" placeholder="Mis. Juara 2 lomba mewarnai">
                    <div class="cs-saran" id="csSaran"></div></div>
                <div class="cs-f"><label for="csCerita" class="cs-l">Cerita <span class="att-muted">(opsional)</span></label><textarea class="att-textarea" id="csCerita" rows="3" maxlength="1000">${esc(e?.cerita || '')}</textarea></div>
                <div class="cs-f"><label for="csTl" class="cs-l">Tindak lanjut <span class="att-muted">(opsional, mis. "orang tua sudah dihubungi")</span></label><input class="att-input" id="csTl" maxlength="500" value="${esc(e?.tindak_lanjut || '')}"></div>
                <div class="cs-f"><div class="cs-l">Foto <span class="att-muted">(opsional, maks. 3 — sertifikat, piala, kegiatan)</span></div>
                    <div class="cs-fotos edit" id="csFotos"></div>
                    <input type="file" id="csFile" accept="image/*" hidden></div>
                <div class="cs-priv">${ICON.lock}<span>Terlihat oleh Anda, wali kelas, kepala sekolah, dan operator sekolah.</span></div>
                <div class="att-alert err" id="csErr" role="alert" hidden></div>
                <button type="button" class="att-btn att-btn-primary att-btn-block" id="csSave"></button>`);
            const $ = (q) => sh.el.querySelector(q);
            const nama = new Map(o.siswa.map((s) => [s.id, s.nama]));
            const err = (m) => { $('#csErr').textContent = m; $('#csErr').hidden = !m; };
            const drawPick = () => {
                $('#csPick').innerHTML = st.pilih.size ? [...st.pilih].map((id) => `<span class="cs-pill">${esc(nama.get(id) || '')}${o.kunciSiswa ? '' : `<button type="button" data-rm="${esc(id)}" aria-label="Hapus ${esc(nama.get(id) || '')}">×</button>`}</span>`).join('') : '<span class="att-muted">Belum ada siswa dipilih</span>';
                $('#csPick').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { st.pilih.delete(b.dataset.rm); drawPick(); drawOpts(); }));
                $('#csSave').textContent = e ? 'Simpan perubahan' : (st.pilih.size > 1 ? `Simpan untuk ${st.pilih.size} siswa` : 'Simpan');
            };
            const drawOpts = () => {
                if (o.kunciSiswa) return;
                const q = $('#csCariS').value.trim().toLowerCase();
                const list = o.siswa.filter((s) => !st.pilih.has(s.id) && (!q || String(s.nama).toLowerCase().includes(q))).slice(0, q ? 12 : 6);
                $('#csOpts').innerHTML = list.map((s) => `<button type="button" data-add="${esc(s.id)}">+ ${esc(s.nama)}</button>`).join('');
                $('#csOpts').querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { st.pilih.add(b.dataset.add); $('#csCariS').value = ''; drawPick(); drawOpts(); }));
            };
            const drawJenis = () => {
                sh.el.querySelectorAll('[data-j]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.j === st.jenis)));
                sh.el.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === st.tingkat)));
                $('#csTingkat').hidden = st.jenis !== 'perilaku';
                $('#csSaran').innerHTML = C.SARAN[st.jenis].map((t) => `<button type="button" data-s="${esc(t)}">${esc(t)}</button>`).join('');
                $('#csSaran').querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { $('#csJudul').value = b.dataset.s; $('#csJudul').focus(); }));
            };
            const drawFotos = () => {
                const semua = [...st.fotos.map((f) => ({ path: f })), ...st.baru.map((b) => ({ url: b.url }))];
                $('#csFotos').innerHTML = `${semua.map((f, i) => `<span class="cs-thumb"><img ${f.path ? `data-foto="${esc(f.path)}"` : `src="${esc(f.url)}"`} alt="Foto ${i + 1}"><button type="button" data-rmf="${i}" aria-label="Hapus foto ${i + 1}">×</button></span>`).join('')}
                    ${semua.length < 3 ? `<button type="button" class="cs-add-foto" id="csAddFoto">${ICON.cam}<span>Foto</span></button>` : ''}`;
                isiFoto($('#csFotos'));
                $('#csAddFoto')?.addEventListener('click', () => { $('#csFile').value = ''; $('#csFile').click(); });
                $('#csFotos').querySelectorAll('[data-rmf]').forEach((b) => b.addEventListener('click', () => {
                    const i = Number(b.dataset.rmf);
                    if (i < st.fotos.length) st.fotos.splice(i, 1); else st.baru.splice(i - st.fotos.length, 1);
                    drawFotos();
                }));
            };
            $('#csFile').addEventListener('change', async () => {
                const f = $('#csFile').files[0];
                if (!f) return;
                try { const blob = await kecilkan(f); st.baru.push({ blob, url: URL.createObjectURL(blob) }); drawFotos(); } catch (x) { err(errMessage(x)); }
            });
            sh.el.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('click', () => { st.jenis = b.dataset.j; drawJenis(); }));
            sh.el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { st.tingkat = b.dataset.t; drawJenis(); }));
            $('#csCariS')?.addEventListener('input', drawOpts);
            drawPick(); drawOpts(); drawJenis(); drawFotos();

            $('#csSave').addEventListener('click', async () => {
                err('');
                if (!st.pilih.size) return err('Pilih minimal satu siswa.');
                if (!$('#csJudul').value.trim()) { $('#csJudul').focus(); return err('Isi judul singkat.'); }
                const btn = $('#csSave');
                btn.disabled = true; btn.textContent = 'Menyimpan…';
                try {
                    const up = [];
                    for (const b of st.baru) {
                        const path = `${ctx.uid()}/${crypto.randomUUID()}.jpg`;
                        const { error } = await ctx.storage.from(BUCKET).upload(path, b.blob, { contentType: 'image/jpeg' });
                        if (error) throw new Error(`Foto gagal diunggah: ${error.message || error}`);
                        up.push(path);
                    }
                    await rpc('save_student_note', {
                        p_jenis: st.jenis, p_judul: $('#csJudul').value, p_tanggal: $('#csTgl').value || todayJakarta(),
                        p_student_ids: e ? null : [...st.pilih], p_class_id: e ? null : o.kelas,
                        p_tingkat: st.jenis === 'perilaku' ? st.tingkat : null, p_cerita: $('#csCerita').value,
                        p_tindak_lanjut: $('#csTl').value, p_fotos: [...st.fotos, ...up], p_id: e?.id || null,
                    });
                    sh.close();
                    toast(e ? 'Catatan diperbarui' : `Catatan tersimpan${st.pilih.size > 1 ? ` untuk ${st.pilih.size} siswa` : ''}`, 'ok');
                    o.onDone?.();
                } catch (x) {
                    btn.disabled = false; drawPick();
                    err(errMessage(x));
                }
            });
        }

        const VIEWS = { kelas: viewKelas, siswa: viewSiswa };
        async function render(el, view, params = {}) {
            el.innerHTML = '<div class="g-loading att-muted">Memuat…</div>';
            try { await (VIEWS[view] || viewKelas)(el, params); } catch (err) { el.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; }
        }
        return { render, fotoUrl, reset() { kelasList = null; urlCache.clear(); } };
    }

    window.CatatanUI = Object.freeze({ create, kecilkan, BUCKET });
}());
