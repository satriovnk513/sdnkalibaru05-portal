// =============================================================================
// Tampilan Nilai Siswa — dipakai Portal Guru (#/nilai…) dan Panel Admin (tab Nilai).
//   kelas   : pilih kelas & semester, daftar mapel + progres pengisian
//   isi     : isi UH 1–3, STS, SAS + KKTP satu mapel, NA terhitung langsung
//   riwayat : semua perubahan nilai (lama → baru, siapa, kapan)
//   excel   : template/impor Excel, unduh Excel & PDF
// Pemakaian:
//   const ui = NilaiUI.create({ rpc, nav(view, params), setTop(title, sub), inlineHead, admin });
//   ui.render(el, view, { kelas, smt, mapel });
// Hak akses tetap diperiksa di database (RPC get_class_grades, save_grades, …).
// =============================================================================
(function () {
    'use strict';

    const { esc, errMessage, toast } = window.Att;
    const N = window.Nilai;
    const RP = window.RekapPrint;

    const ICON = {
        chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
        back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
        arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
        xls: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l4 5M12 13l-4 5"/></svg>',
        hist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
        up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
    };

    /** Semester berjalan: Juli–Desember = 1 (ganjil), Januari–Juni = 2 (genap). */
    function semesterNow() {
        const m = Number(window.Att.todayJakarta().slice(5, 7));
        return m >= 7 ? 1 : 2;
    }

    let dirty = false;
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    async function confirmLeave() {
        if (!dirty) return true;
        const ok = await window.Att.confirm({ title: 'Nilai belum disimpan', html: '<p class="att-muted">Perubahan di halaman ini akan hilang kalau kamu pindah halaman.</p>', confirmText: 'Buang perubahan', cancelText: 'Tetap di sini', danger: true });
        if (ok) dirty = false;
        return ok;
    }

    function create(ctx) {
        const cache = { kelas: null, data: new Map() };
        const key = (k, s) => `${k}|${s}`;

        async function rpc(fn, args) { return ctx.rpc(fn, args); }

        async function myClasses() {
            if (!cache.kelas) {
                if (ctx.admin) {
                    const m = await rpc('get_grades_admin_matrix', { p_semester: semesterNow() });
                    cache.kelas = (m.kelas || []).map((k) => ({ id: k.id, nama: k.nama, wali: true, mapel: [] }));
                } else {
                    cache.kelas = await rpc('get_my_grade_classes');
                }
            }
            return cache.kelas;
        }

        async function classData(kelas, smt, fresh) {
            const k = key(kelas, smt);
            if (fresh || !cache.data.has(k)) cache.data.set(k, await rpc('get_class_grades', { p_class_id: kelas, p_semester: smt }));
            return cache.data.get(k);
        }
        function invalidate(kelas, smt) { cache.data.delete(key(kelas, smt)); }

        function head(el, title, sub, backTo) {
            if (ctx.inlineHead) {
                return `<div class="nl-head">${backTo ? `<button type="button" class="att-btn att-btn-ghost nl-back" data-nv="${esc(backTo[0])}" data-p="${esc(JSON.stringify(backTo[1] || {}))}" aria-label="Kembali">${ICON.back}</button>` : ''}
                    <div><h3>${esc(title)}</h3>${sub ? `<div class="att-muted">${esc(sub)}</div>` : ''}</div></div>`;
            }
            ctx.setTop(title, sub);
            return '';
        }

        function wireNav(el) {
            el.querySelectorAll('[data-nv]').forEach((b) => b.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!await confirmLeave()) return;
                ctx.nav(b.dataset.nv, JSON.parse(b.dataset.p || '{}'));
            }));
        }

        const titik = (k) => String(k.nama || '').replace(/\s+/, '.');
        const sub = (d) => `Kelas ${titik(d.kelas)} · Semester ${N.SEM(d.semester)} ${d.kelas.tahun_ajaran || ''}`;

        function progres(d, m) {
            const n = (d.siswa || []).length;
            let lengkap = 0; let terisi = 0;
            const ids = new Set((d.siswa || []).map((s) => s.id));
            for (const v of d.nilai || []) {
                if (v.m !== m.id || !ids.has(v.s)) continue;
                const h = N.hitung(v);
                if (h.lengkap) lengkap += 1;
                if (N.FIELDS.some((f) => v[f] !== null && v[f] !== undefined)) terisi += 1;
            }
            return { n, lengkap, terisi };
        }

        // ------------------------------------------------------------ kelas
        async function viewKelas(el, p) {
            const list = await myClasses();
            if (!list.length) {
                el.innerHTML = `${head(el, 'Nilai Siswa', '')}<div class="att-alert info">Belum ada kelas yang Anda ajar atau walikan. Hubungi admin sekolah.</div>`;
                return;
            }
            const kelas = list.some((k) => k.id === p.kelas) ? p.kelas : list[0].id;
            const smt = Number(p.smt) === 2 ? 2 : (Number(p.smt) === 1 ? 1 : semesterNow());
            const info = list.find((k) => k.id === kelas);
            const d = await classData(kelas, smt);
            const peran = info.wali ? (ctx.admin ? 'Admin' : 'Wali kelas') : (info.mapel?.length ? `Guru ${info.mapel.join(', ')}` : 'Pantau');
            const canHide = Boolean(info.wali) && (ctx.admin || d.mapel.some((m) => m.can_edit));
            const tampil = d.mapel.filter((m) => !m.hidden);
            const sembunyi = d.mapel.filter((m) => m.hidden);
            const P = (extra) => esc(JSON.stringify({ kelas, smt, ...extra }));

            const row = (m) => {
                const pr = progres(d, m);
                const pct = pr.n ? Math.round((pr.lengkap / pr.n) * 100) : 0;
                let badge;
                if (!m.can_edit) badge = '<span class="att-badge info">Lihat saja</span>';
                else if (pr.n && pr.lengkap === pr.n) badge = '<span class="att-badge ok">Lengkap</span>';
                else if (!pr.terisi) badge = '<span class="att-badge mute">Belum mulai</span>';
                else badge = `<span class="att-badge warn">${pr.n - pr.lengkap} belum lengkap</span>`;
                const ket = m.guru_mapel?.length && !m.can_edit
                    ? `Diisi guru mapel: ${m.guru_mapel.join(', ')}`
                    : `${m.kktp !== null && m.kktp !== undefined ? `KKTP ${m.kktp}` : 'KKTP belum diisi'} · ${pr.lengkap}/${pr.n} lengkap${m.guru_mapel?.length ? ` · ${m.guru_mapel.join(', ')}` : ''}`;
                return `<a href="#" class="nl-mp ${m.can_edit ? '' : 'ro'}" data-nv="isi" data-p="${P({ mapel: m.id })}">
                    <div class="nl-mp-txt"><b>${esc(m.nama)}</b><small>${esc(ket)}</small>
                        <span class="nl-bar"><i style="width:${pct}%" class="${m.can_edit ? '' : 'ro'}"></i></span></div>
                    ${badge}${ICON.chev}</a>`;
            };

            el.innerHTML = `${head(el, 'Nilai Siswa', `Kelas ${titik(d.kelas)} · ${peran}`, ctx.admin ? ['matriks', { smt }] : null)}
                ${list.length > 1 ? `<div class="att-field nl-kelas"><label for="nlKelas">Kelas</label><select class="att-select" id="nlKelas">${list.map((k) =>
        `<option value="${esc(k.id)}" ${k.id === kelas ? 'selected' : ''}>Kelas ${esc(k.nama)}${k.wali && !ctx.admin ? ' · Wali kelas' : (k.mapel?.length ? ` · ${esc(k.mapel.join(', '))}` : '')}</option>`).join('')}</select></div>` : ''}
                <div class="inv-seg nl-seg" role="tablist" aria-label="Semester">
                    <button type="button" role="tab" data-smt="1" aria-selected="${smt === 1}">Semester Ganjil</button>
                    <button type="button" role="tab" data-smt="2" aria-selected="${smt === 2}">Semester Genap</button>
                </div>
                <div class="att-alert info nl-rumus"><b>Nilai Akhir</b> = 50% rata-rata UH + 25% STS + 25% SAS, dibulatkan. UH yang masih kosong tidak ikut dihitung, tapi diberi peringatan.</div>
                <div class="nl-sec"><b>Mata pelajaran</b><span class="att-muted">${d.siswa.length} siswa · ${d.kelas.tahun_ajaran || ''}</span></div>
                ${tampil.length ? `<section class="nl-list">${tampil.map(row).join('')}</section>` : '<div class="att-alert info">Belum ada mapel yang bisa Anda lihat di kelas ini.</div>'}
                <div class="nl-actions">
                    <a href="#" class="att-btn nl-btn-xls" data-nv="excel" data-p="${P({})}">${ICON.xls} Excel &amp; PDF</a>
                    <a href="#" class="att-btn att-btn-ghost" data-nv="riwayat" data-p="${P({})}">${ICON.hist} Riwayat perubahan</a>
                </div>
                ${canHide || sembunyi.length ? `<details class="nl-hide">
                    <summary>Mapel yang tidak diajarkan di kelas ini${sembunyi.length ? ` (${sembunyi.length})` : ''}</summary>
                    <p class="att-muted">${canHide ? 'Matikan mapel yang tidak ada di kelas ini (mis. Bahasa Inggris di kelas 1–2). Mapel yang dimatikan tidak muncul di daftar, template Excel, dan leger.' : 'Diatur wali kelas.'}</p>
                    <div class="nl-hide-list">${d.mapel.map((m) => `<label class="nl-hide-item"><input type="checkbox" data-hide="${esc(m.id)}" ${m.hidden ? '' : 'checked'} ${canHide ? '' : 'disabled'}> ${esc(m.nama)}</label>`).join('')}</div>
                </details>` : ''}`;
            wireNav(el);
            el.querySelector('#nlKelas')?.addEventListener('change', (e) => ctx.nav('kelas', { kelas: e.target.value, smt }));
            el.querySelectorAll('[data-smt]').forEach((b) => b.addEventListener('click', () => ctx.nav('kelas', { kelas, smt: Number(b.dataset.smt) })));
            el.querySelectorAll('[data-hide]').forEach((c) => c.addEventListener('change', async () => {
                c.disabled = true;
                try {
                    await rpc('set_class_subject_hidden', { p_class_id: kelas, p_subject_id: c.dataset.hide, p_hidden: !c.checked });
                    invalidate(kelas, 1); invalidate(kelas, 2);
                    toast(c.checked ? 'Mapel ditampilkan' : 'Mapel disembunyikan untuk kelas ini', 'ok');
                    await viewKelas(el, { kelas, smt });
                    el.querySelector('.nl-hide')?.setAttribute('open', '');
                } catch (err) { c.checked = !c.checked; c.disabled = false; toast(errMessage(err), 'err'); }
            }));
        }

        // ------------------------------------------------------------ isi
        async function viewIsi(el, p) {
            const kelas = p.kelas; const smt = Number(p.smt) || semesterNow();
            const d = await classData(kelas, smt, true);
            const m = d.mapel.find((x) => x.id === p.mapel);
            if (!m) { el.innerHTML = `${head(el, 'Nilai', '', ['kelas', { kelas, smt }])}<div class="att-alert err">Mapel tidak ditemukan atau Anda tidak punya akses.</div>`; return; }
            const edit = Boolean(m.can_edit);
            const peta = N.peta(d);
            // nilai di layar: student_id → {uh1..sas}, plus salinan asli untuk mencari yang berubah
            const asli = new Map(); const kini = new Map();
            for (const s of d.siswa) {
                const n = peta.get(`${s.id}|${m.id}`) || {};
                const o = {}; for (const f of N.FIELDS) o[f] = n[f] ?? null;
                asli.set(s.id, o); kini.set(s.id, { ...o });
            }
            const kktpAsli = m.kktp ?? null;
            let kktp = kktpAsli;
            const bad = new Set();

            const cell = (s, f) => {
                const v = kini.get(s.id)[f];
                return `<label class="nl-c"><span>${N.LABEL[f]}</span><input class="nl-in" inputmode="numeric" enterkeyhint="next" maxlength="3" autocomplete="off" placeholder="–"
                    data-s="${esc(s.id)}" data-f="${f}" value="${v ?? ''}" aria-label="${esc(N.LABEL[f])} ${esc(s.nama)}" ${edit ? '' : 'readonly tabindex="-1"'}></label>`;
            };
            el.innerHTML = `${head(el, m.nama, sub(d), ['kelas', { kelas, smt }])}
                ${!edit ? `<div class="att-alert info" style="margin-bottom:12px">${m.guru_mapel?.length ? `Mapel ini diisi guru mapel (${esc(m.guru_mapel.join(', '))}).` : 'Anda hanya bisa melihat nilai mapel ini.'}</div>` : ''}
                <section class="nl-kktp"><div><label for="nlKktp">KKTP ${esc(m.nama)} kelas ini</label><span class="att-muted">Batas tuntas, diisi guru per mapel</span></div>
                    <input id="nlKktp" class="nl-in nl-kktp-in" inputmode="numeric" maxlength="3" value="${kktp ?? ''}" ${edit ? '' : 'readonly'} aria-label="KKTP"></section>
                <div class="nl-stats" id="nlStats"></div>
                <div class="att-muted nl-hint">Isi angka bulat 0–100. <b>NA</b> = 50% rata-rata UH + 25% STS + 25% SAS (otomatis, dibulatkan).${edit ? ' Tekan Enter untuk pindah ke kotak berikutnya.' : ''}</div>
                <div class="nl-grid-head" aria-hidden="true"><span>No</span><span>Nama siswa</span>${N.FIELDS.map((f) => `<span>${N.LABEL[f]}</span>`).join('')}<span>NA</span></div>
                <div class="nl-rows">${d.siswa.map((s, i) => `<article class="nl-row" data-row="${esc(s.id)}">
                    <div class="nl-who"><span class="nl-no">${esc(s.no ?? i + 1)}</span><b>${esc(s.nama)}</b></div>
                    <div class="nl-cells">${N.FIELDS.map((f) => cell(s, f)).join('')}</div>
                    <div class="nl-na"><span>NA</span><b data-na></b></div>
                    <div class="nl-warn" data-warn hidden></div>
                </article>`).join('')}</div>
                ${!d.siswa.length ? '<div class="att-alert info">Belum ada siswa di kelas ini.</div>' : ''}
                ${edit ? `<div class="att-savebar nl-savebar"><span class="att-muted" id="nlDirty">Belum ada perubahan</span>
                    <button type="button" class="att-btn att-btn-primary" id="nlSave" disabled>Simpan</button></div>` : ''}`;
            wireNav(el);

            const changes = () => {
                let c = 0;
                for (const s of d.siswa) for (const f of N.FIELDS) if (asli.get(s.id)[f] !== kini.get(s.id)[f]) c += 1;
                return c + (kktp !== kktpAsli ? 1 : 0);
            };
            const paint = () => {
                let t = 0; let b = 0; let k = 0;
                for (const s of d.siswa) {
                    const n = kini.get(s.id);
                    const h = N.hitung(n);
                    const st = N.status(n, kktp);
                    const r = el.querySelector(`[data-row="${CSS.escape(s.id)}"]`);
                    const na = r.querySelector('[data-na]');
                    na.textContent = h.akhir ?? '–';
                    na.className = st === 'belum' ? 'bad' : (st === 'tuntas' ? 'ok' : '');
                    if (st === 'tuntas') t += 1; else if (st === 'belum') b += 1; else k += 1;
                    const kosongUh = ['uh1', 'uh2', 'uh3'].filter((f) => n[f] === null).map((f) => N.LABEL[f]);
                    const kosongAkhir = ['sts', 'sas'].filter((f) => n[f] === null).map((f) => N.LABEL[f]);
                    let warn = '';
                    const ada = N.FIELDS.some((f) => n[f] !== null);
                    if (ada && kosongAkhir.length) warn = `${kosongAkhir.join(' & ')} belum diisi — NA belum bisa dihitung`;
                    else if (ada && kosongUh.length === 3) warn = 'UH belum diisi — NA belum bisa dihitung';
                    else if (ada && kosongUh.length) warn = `${kosongUh.join(', ')} belum diisi — NA dihitung dari UH yang ada`;
                    const w = r.querySelector('[data-warn]');
                    w.textContent = warn; w.hidden = !warn;
                    r.classList.toggle('changed', N.FIELDS.some((f) => asli.get(s.id)[f] !== n[f]));
                }
                el.querySelector('#nlStats').innerHTML = `<div class="nl-stat ok"><b>${t}</b><span>Tuntas</span></div>
                    <div class="nl-stat bad"><b>${b}</b><span>Belum tuntas</span></div>
                    <div class="nl-stat warn"><b>${k}</b><span>${kktp === null && (t + b) === 0 && k ? 'Belum ada NA' : 'Nilai belum lengkap'}</span></div>`;
                if (!edit) return;
                const c = changes();
                dirty = c > 0;
                const save = el.querySelector('#nlSave');
                save.disabled = !c || bad.size > 0;
                el.querySelector('#nlDirty').textContent = bad.size ? `${bad.size} kotak tidak valid (harus 0–100)` : (c ? `${c} nilai berubah, belum disimpan` : 'Belum ada perubahan');
                el.querySelector('#nlDirty').classList.toggle('nl-err', bad.size > 0);
                save.textContent = c ? `Simpan ${c} perubahan` : 'Simpan';
            };
            const parse = (inp) => {
                const raw = inp.value.replace(/[^\d]/g, '');
                if (raw !== inp.value) inp.value = raw;
                const v = raw === '' ? null : Number(raw);
                const ok = v === null || (v >= 0 && v <= 100);
                inp.classList.toggle('err', !ok);
                inp.setAttribute('aria-invalid', String(!ok));
                return { v, ok };
            };
            if (edit) {
                const inputs = [...el.querySelectorAll('.nl-in')];
                inputs.forEach((inp, i) => {
                    inp.addEventListener('input', () => {
                        const { v, ok } = parse(inp);
                        const id = inp.id === 'nlKktp' ? 'kktp' : `${inp.dataset.s}|${inp.dataset.f}`;
                        if (ok) bad.delete(id); else bad.add(id);
                        if (inp.id === 'nlKktp') { if (ok) kktp = v; } else if (ok) kini.get(inp.dataset.s)[inp.dataset.f] = v;
                        paint();
                    });
                    inp.addEventListener('focus', () => inp.select());
                    inp.addEventListener('keydown', (e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const next = inputs[i + 1];
                        if (next) next.focus(); else el.querySelector('#nlSave')?.focus();
                    });
                });
                el.querySelector('#nlSave').addEventListener('click', async () => {
                    const btn = el.querySelector('#nlSave');
                    const entries = [];
                    for (const s of d.siswa) {
                        const e = { student_id: s.id };
                        for (const f of N.FIELDS) if (asli.get(s.id)[f] !== kini.get(s.id)[f]) e[f] = kini.get(s.id)[f];
                        if (Object.keys(e).length > 1) entries.push(e);
                    }
                    const item = { subject_id: m.id, entries };
                    if (kktp !== kktpAsli) item.kktp = kktp;
                    btn.disabled = true; btn.textContent = 'Menyimpan…';
                    try {
                        const r = await rpc('save_grades', { p_class_id: kelas, p_semester: smt, p_items: [item] });
                        dirty = false;
                        invalidate(kelas, smt);
                        const parts = [];
                        if (r.baru) parts.push(`${r.baru} baru`);
                        if (r.berubah) parts.push(`${r.berubah} diubah`);
                        if (r.dihapus) parts.push(`${r.dihapus} dihapus`);
                        if (r.kktp) parts.push('KKTP');
                        toast(`Tersimpan${parts.length ? `: ${parts.join(', ')}` : ''}`, 'ok');
                        const y = window.scrollY;
                        await viewIsi(el, p);
                        window.scrollTo(0, y);
                    } catch (err) {
                        toast(errMessage(err), 'err');
                        paint();
                    }
                });
            }
            paint();
        }

        // ------------------------------------------------------------ riwayat
        const jamFmt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
        const tglFmt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        const isoJkt = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(t));

        async function viewRiwayat(el, p) {
            const kelas = p.kelas; const smt = Number(p.smt) || semesterNow();
            const [d, h] = await Promise.all([classData(kelas, smt), rpc('get_grade_history', { p_class_id: kelas, p_semester: smt, p_limit: 1000 })]);
            const mapel = [...new Set(h.map((x) => x.mapel))].sort();
            el.innerHTML = `${head(el, 'Riwayat Perubahan', sub(d), ['kelas', { kelas, smt }])}
                <div class="nl-filter att-row">
                    <div class="att-field"><label for="nlFm">Mapel</label><select class="att-select" id="nlFm"><option value="">Semua mapel</option>${mapel.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
                    <div class="att-field"><label for="nlFs">Siswa</label><input class="att-input" id="nlFs" type="search" placeholder="Cari siswa"></div>
                </div>
                <div id="nlHist"></div>
                <p class="att-muted nl-note">Setiap nilai yang diisi, diubah, atau dihapus tercatat otomatis: siapa, kapan, nilai lama → baru. Riwayat tidak bisa dihapus.</p>`;
            wireNav(el);
            const today = window.Att.todayJakarta();
            const draw = () => {
                const fm = el.querySelector('#nlFm').value;
                const fs = el.querySelector('#nlFs').value.trim().toLowerCase();
                const rows = h.filter((x) => (!fm || x.mapel === fm) && (!fs || String(x.siswa || '').toLowerCase().includes(fs)));
                if (!rows.length) { el.querySelector('#nlHist').innerHTML = `<div class="att-alert info">${h.length ? 'Tidak ada yang cocok dengan filter.' : 'Belum ada perubahan nilai di semester ini.'}</div>`; return; }
                const groups = new Map();
                for (const x of rows) { const k = isoJkt(x.waktu); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
                el.querySelector('#nlHist').innerHTML = [...groups].map(([k, xs]) => `<div class="nl-day">${k === today ? 'HARI INI' : esc(tglFmt.format(new Date(xs[0].waktu)).toUpperCase())}</div>
                    <section class="nl-list nl-hist">${xs.map((x) => `<div class="nl-h">
                        <div class="nl-h-jam">${esc(jamFmt.format(new Date(x.waktu)))}</div>
                        <div class="nl-h-body"><div>${x.kolom === 'kktp' ? '<b>KKTP</b>' : `<b>${esc(x.siswa || '-')}</b>`} · ${esc(x.mapel)}${x.kolom === 'kktp' ? '' : ` <b>${esc(N.LABEL[x.kolom] || x.kolom)}</b>`}</div>
                            <div class="nl-h-val"><span class="old">${x.lama ?? '–'}</span>${ICON.arrow}<span class="${x.baru === null ? 'del' : 'new'}">${x.baru ?? 'dihapus'}</span></div>
                            <div class="att-muted">oleh ${esc(x.oleh || '-')}${x.sumber === 'impor' ? ' · lewat impor Excel' : (x.sumber === 'admin' ? ' · admin' : '')}</div></div>
                    </div>`).join('')}</section>`).join('');
            };
            el.querySelector('#nlFm').addEventListener('change', draw);
            el.querySelector('#nlFs').addEventListener('input', draw);
            draw();
        }

        // ------------------------------------------------------------ excel & pdf
        async function viewExcel(el, p) {
            const kelas = p.kelas; const smt = Number(p.smt) || semesterNow();
            const d = await classData(kelas, smt, true);
            const tampil = d.mapel.filter((m) => !m.hidden);
            const bisa = tampil.filter((m) => m.can_edit);
            el.innerHTML = `${head(el, 'Excel & PDF', sub(d), ['kelas', { kelas, smt }])}
                <section class="nl-card">
                    <h3>Isi nilai lewat Excel</h3>
                    <div class="nl-step"><span>1</span><div>
                        <p><b>Unduh template</b> — nama siswa sudah terisi, nilai yang sudah ada ikut terisi.</p>
                        ${bisa.length ? `<div class="att-field"><label for="nlTm">Mapel</label><select class="att-select" id="nlTm">
                            <option value="">Semua mapel saya (${bisa.length} lembar)</option>${bisa.map((m) => `<option value="${esc(m.id)}">${esc(m.nama)}</option>`).join('')}</select></div>
                        <button type="button" class="att-btn att-btn-ghost att-btn-block" id="nlTpl">${ICON.down} Unduh template Excel</button>`
        : '<div class="att-alert info">Tidak ada mapel yang bisa Anda isi di kelas ini.</div>'}
                    </div></div>
                    <div class="nl-step"><span>2</span><div><p><b>Isi di Excel</b> seperti biasa, di laptop atau HP. Rumus Nilai Akhir &amp; Tuntas sudah ada di dalamnya.</p></div></div>
                    <div class="nl-step"><span>3</span><div>
                        <p><b>Unggah kembali</b> — dicek dulu sebelum disimpan.</p>
                        <button type="button" class="att-btn att-btn-primary att-btn-block" id="nlImp" ${bisa.length ? '' : 'disabled'}>${ICON.up} Impor file Excel</button>
                        <input type="file" id="nlFile" accept=".xlsx" hidden>
                    </div></div>
                </section>
                <section class="nl-card">
                    <h3>Unduh hasil nilai</h3>
                    <button type="button" class="nl-dl" id="nlXls"><span class="x">XLSX</span><div><b>Nilai semua mapel</b><small>Satu lembar per mapel + leger</small></div></button>
                    <div class="nl-dl-row"><select class="att-select" id="nlPm" aria-label="Mapel untuk PDF">${tampil.map((m) => `<option value="${esc(m.id)}">${esc(m.nama)}</option>`).join('')}</select>
                        <button type="button" class="nl-dl" id="nlPdfM"><span class="p">PDF</span><div><b>Daftar nilai per mapel</b><small>UH, STS, SAS, NA, keterangan</small></div></button></div>
                    <button type="button" class="nl-dl" id="nlPdfL"><span class="p">PDF</span><div><b>Leger nilai akhir kelas</b><small>Semua mapel dalam satu halaman</small></div></button>
                </section>`;
            wireNav(el);

            el.querySelector('#nlTpl')?.addEventListener('click', () => {
                const id = el.querySelector('#nlTm').value;
                const ids = id ? [id] : bisa.map((m) => m.id);
                const nama = id ? bisa.find((m) => m.id === id).nama : '';
                RP.download(N.buku(d, { mapelIds: ids }), `${N.namaFile('Template Nilai', d, nama)}.xlsx`);
                toast('Template diunduh', 'ok');
            });
            el.querySelector('#nlXls').addEventListener('click', () => {
                if (!tampil.length) return toast('Belum ada mapel.', 'err');
                RP.download(N.buku(d, { leger: true }), `${N.namaFile('Nilai', d)}.xlsx`);
            });
            const print = (html) => { if (!RP.print(html)) toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err'); };
            el.querySelector('#nlPdfM').addEventListener('click', () => { const id = el.querySelector('#nlPm').value; if (id) print(N.htmlMapel(d, id)); });
            el.querySelector('#nlPdfL').addEventListener('click', () => print(N.htmlLeger(d)));

            const file = el.querySelector('#nlFile');
            el.querySelector('#nlImp').addEventListener('click', () => { file.value = ''; file.click(); });
            file.addEventListener('change', async () => {
                const f = file.files[0];
                if (!f) return;
                let hasil;
                try {
                    const book = await window.XlsxRead.readBook(await f.arrayBuffer());
                    hasil = N.bacaImpor(book, await classData(kelas, smt, true));
                } catch (err) { toast(errMessage(err), 'err'); return; }
                await previewImpor(el, p, f.name, hasil);
            });
        }

        async function previewImpor(el, p, nama, r) {
            const kelas = p.kelas; const smt = Number(p.smt) || semesterNow();
            const ok = r.lembar.filter((l) => l.status === 'ok');
            const lewat = r.lembar.filter((l) => l.status !== 'ok');
            const masalah = [];
            for (const l of ok) {
                for (const g of l.galat) masalah.push(`${l.mapel.nama} · ${g} — dilewati`);
                for (const w of l.peringatan) masalah.push(`${l.mapel.nama} · ${w}`);
            }
            for (const l of lewat) masalah.push(`Lembar ${l.nama} diabaikan — ${l.alasan}`);
            const kktp = ok.filter((l) => l.kktp);
            const jml = r.total.baru + r.total.berubah;
            const list = masalah.length ? `<ul class="nl-issues">${masalah.slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join('')}${masalah.length > 12 ? `<li>… dan ${masalah.length - 12} lainnya</li>` : ''}</ul>` : '';
            if (!r.lembar.length) {
                await window.Att.confirm({ title: 'File tidak dikenali', html: '<p class="att-muted">Tidak ada lembar nilai yang terbaca. Pakai template dari tombol “Unduh template Excel”.</p>', confirmText: 'Mengerti', cancelText: 'Tutup' });
                return;
            }
            if (!jml && !kktp.length) {
                await window.Att.confirm({ title: 'Tidak ada perubahan', html: `<p class="att-muted">${esc(nama)} · ${r.lembar.length} lembar terbaca. Semua nilai sama dengan yang sudah ada di portal.</p>${list}`, confirmText: 'Oke', cancelText: 'Tutup' });
                return;
            }
            const html = `<p class="att-muted">${esc(nama)} · ${r.lembar.length} lembar terbaca</p>
                <div class="nl-stats"><div class="nl-stat ok"><b>${r.total.baru}</b><span>nilai baru</span></div><div class="nl-stat info"><b>${r.total.berubah}</b><span>nilai berubah</span></div><div class="nl-stat warn"><b>${r.total.galat + lewat.length}</b><span>dilewati</span></div></div>
                ${kktp.length ? `<p class="att-muted" style="margin:8px 0 0">KKTP berubah: ${kktp.map((l) => `${esc(l.mapel.nama)} ${l.kktp.lama ?? '–'} → <b>${l.kktp.baru}</b>`).join(', ')}</p>` : ''}
                ${list}
                <p class="att-muted nl-note">Nilai yang berubah menimpa nilai lama dan tercatat di riwayat. Kotak kosong di Excel <b>tidak</b> menghapus nilai yang sudah ada di portal.</p>`;
            const yes = await window.Att.confirm({ title: 'Pratinjau impor', html, confirmText: jml ? `Simpan ${jml} nilai` : 'Simpan KKTP' });
            if (!yes) return;
            try {
                const res = await rpc('save_grades', { p_class_id: kelas, p_semester: smt, p_items: r.items, p_source: 'impor', p_keep_blank: true });
                invalidate(kelas, smt);
                toast(`Impor tersimpan: ${res.baru} baru, ${res.berubah} diubah${res.kktp ? `, ${res.kktp} KKTP` : ''}`, 'ok');
                ctx.nav('kelas', { kelas, smt });
            } catch (err) { toast(errMessage(err), 'err'); }
        }

        // ------------------------------------------------------------ matriks (admin)
        async function viewMatriks(el, p) {
            const smt = Number(p.smt) === 2 ? 2 : (Number(p.smt) === 1 ? 1 : semesterNow());
            const mx = await rpc('get_grades_admin_matrix', { p_semester: smt });
            cache.kelas = (mx.kelas || []).map((k) => ({ id: k.id, nama: k.nama, wali: true, mapel: [] }));
            let lengkap = 0; let total = 0; let kosong = 0;
            const cellHtml = (k, m) => {
                const c = (k.sel || {})[m.id] || {};
                if (c.hidden) return '<td class="nl-x hid" title="Tidak diajarkan">—</td>';
                const n = k.siswa || 0;
                total += 1;
                let cls = 'none';
                if (n && c.lengkap >= n) { cls = 'full'; lengkap += 1; } else if (c.terisi) cls = 'part'; else kosong += 1;
                return `<td class="nl-x ${cls}"><button type="button" data-k="${esc(k.id)}" data-m="${esc(m.id)}" title="${esc(`${k.nama} · ${m.nama}: ${c.lengkap || 0}/${n} lengkap${c.kktp != null ? ` · KKTP ${c.kktp}` : ' · KKTP belum diisi'}`)}">${c.lengkap || 0}<small>/${n}</small>${c.kktp == null ? '<i title="KKTP belum diisi"></i>' : ''}</button></td>`;
            };
            const body = (mx.kelas || []).map((k) => `<tr><th scope="row"><button type="button" class="nl-kls" data-kls="${esc(k.id)}">Kelas ${esc(k.nama)}</button><small>${k.siswa} siswa</small></th>${mx.mapel.map((m) => cellHtml(k, m)).join('')}</tr>`).join('');
            el.innerHTML = `<div class="inv-seg nl-seg" role="tablist" aria-label="Semester">
                    <button type="button" role="tab" data-smt="1" aria-selected="${smt === 1}">Semester Ganjil</button>
                    <button type="button" role="tab" data-smt="2" aria-selected="${smt === 2}">Semester Genap</button></div>
                <div class="inv-stats"><div class="inv-stat"><b>${lengkap}</b><span>mapel × kelas lengkap</span></div>
                    <div class="inv-stat warn"><b>${total - lengkap - kosong}</b><span>sebagian terisi</span></div>
                    <div class="inv-stat"><b>${kosong}</b><span>belum mulai</span></div></div>
                <p class="att-muted">Angka = siswa yang nilainya lengkap (UH 1–3, STS, SAS) / jumlah siswa. Titik kuning = KKTP belum diisi. Klik sel untuk melihat atau mengisi; klik nama kelas untuk semua mapel, riwayat, dan unduhan.</p>
                <div class="nl-mx-wrap"><table class="nl-mx"><thead><tr><th>Kelas</th>${mx.mapel.map((m) => `<th title="${esc(m.nama)}">${esc(m.kode)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
                <div class="nl-legend"><span class="full"></span>Lengkap <span class="part"></span>Sebagian <span class="none"></span>Belum <span class="hid"></span>Tidak diajarkan</div>`;
            el.querySelectorAll('[data-smt]').forEach((b) => b.addEventListener('click', () => ctx.nav('matriks', { smt: Number(b.dataset.smt) })));
            el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => ctx.nav('isi', { kelas: b.dataset.k, smt, mapel: b.dataset.m })));
            el.querySelectorAll('[data-kls]').forEach((b) => b.addEventListener('click', () => ctx.nav('kelas', { kelas: b.dataset.kls, smt })));
        }

        const VIEWS = { kelas: viewKelas, isi: viewIsi, riwayat: viewRiwayat, excel: viewExcel, matriks: viewMatriks };

        async function render(el, view, params = {}) {
            dirty = false;
            el.classList.toggle('nl-wide', Boolean(ctx.wide));
            el.innerHTML = '<div class="g-loading att-muted">Memuat…</div>';
            try {
                await (VIEWS[view] || viewKelas)(el, params);
            } catch (err) {
                el.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
            }
        }

        return { render, reset() { cache.kelas = null; cache.data.clear(); } };
    }

    window.NilaiUI = Object.freeze({ create, semesterNow, isDirty: () => dirty, confirmLeave });
}());
