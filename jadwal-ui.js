// =============================================================================
// Tampilan Jadwal Pelajaran — Portal Guru (#/jadwal…) dan Panel Admin (tab Jadwal).
//   kelas : jadwal satu kelas — per hari (HP) atau tabel; wali kelas/admin bisa ubah
//   saya  : jadwal mengajar guru mapel dari semua kelas (admin: pilih guru)
// Pemakaian:
//   const ui = JadwalUI.create({ rpc, nav(view, params), setTop(title, sub), classes(), inlineHead, wide, admin });
//   ui.render(el, view, { kelas, hari, mode, guru });
// Hak akses & cek bentrok tetap di database (RPC save_schedule_entry, dll).
// =============================================================================
(function () {
    'use strict';

    const { esc, errMessage, toast } = window.Att;
    const J = window.Jadwal;
    const RP = window.RekapPrint;

    const ICON = {
        back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
        edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
        lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
        plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
        print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    };
    const today = () => window.Att.todayJakarta();

    /** Lembar bawah sederhana. Kembalikan { el, close }. */
    function sheet(html, onClose) {
        const back = document.createElement('div');
        back.className = 'att-sheet-backdrop';
        back.innerHTML = `<div class="att-sheet jd-sheet" role="dialog" aria-modal="true">${html}</div>`;
        const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(back);
        setTimeout(() => back.querySelector('select, input, button:not([data-close])')?.focus(), 30);
        return { el: back, close };
    }

    function create(ctx) {
        const state = { data: null, kelas: null, hari: null, mode: null };

        const rpc = (fn, args) => ctx.rpc(fn, args);

        function head(title, sub, backTo) {
            if (ctx.inlineHead) {
                return `<div class="nl-head">${backTo ? `<button type="button" class="att-btn att-btn-ghost nl-back" data-nv="${esc(backTo[0])}" data-p="${esc(JSON.stringify(backTo[1] || {}))}" aria-label="Kembali">${ICON.back}</button>` : ''}
                    <div><h3>${esc(title)}</h3>${sub ? `<div class="att-muted">${esc(sub)}</div>` : ''}</div></div>`;
            }
            ctx.setTop(title, sub);
            return '';
        }
        function wireNav(el) {
            el.querySelectorAll('[data-nv]').forEach((b) => b.addEventListener('click', (e) => {
                e.preventDefault();
                ctx.nav(b.dataset.nv, JSON.parse(b.dataset.p || '{}'));
            }));
        }

        // ------------------------------------------------------------ kelas
        async function viewKelas(el, p) {
            const list = await ctx.classes();
            if (!list.length) {
                el.innerHTML = `${head('Jadwal Pelajaran', '')}<div class="att-alert info">Belum ada kelas yang Anda ajar atau walikan.</div>`;
                return;
            }
            const kelas = list.some((k) => k.id === p.kelas) ? p.kelas : list[0].id;
            if (state.kelas !== kelas) state.hari = null;
            state.data = await rpc('get_class_schedule', { p_class_id: kelas });
            state.kelas = kelas;
            const hNow = J.hariDari(today());
            state.hari = Number(p.hari) || state.hari || hNow || 1;
            state.mode = p.mode || state.mode || (ctx.wide ? 'tabel' : 'hari');
            const info = list.find((k) => k.id === kelas);
            const peran = ctx.admin ? 'Admin' : (info.wali ? 'Wali kelas' : (info.mapel?.length ? `Guru ${info.mapel.join(', ')}` : 'Lihat'));
            el.innerHTML = `${head('Jadwal Pelajaran', `Kelas ${J.kelasTitik(info.nama)} · ${peran}`)}
                ${list.length > 1 ? `<div class="att-field nl-kelas"><label for="jdKelas">Kelas</label><select class="att-select" id="jdKelas">${list.map((k) =>
        `<option value="${esc(k.id)}" ${k.id === kelas ? 'selected' : ''}>Kelas ${esc(k.nama)}${!ctx.admin && k.wali ? ' · Wali kelas' : (k.mapel?.length ? ` · ${esc(k.mapel.join(', '))}` : '')}</option>`).join('')}</select></div>` : ''}
                <div class="jd-bar">
                    <div class="inv-seg jd-mode" role="tablist" aria-label="Tampilan">
                        <button type="button" role="tab" data-mode="hari" aria-selected="${state.mode === 'hari'}">Per hari</button>
                        <button type="button" role="tab" data-mode="tabel" aria-selected="${state.mode === 'tabel'}">Tabel</button>
                    </div>
                    <div class="jd-tools">
                        <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="jdXls">${ICON.down} Excel</button>
                        <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="jdPdf">${ICON.print} Cetak</button>
                        <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="jdPdfDl">${ICON.down} PDF</button>
                    </div>
                </div>
                <div id="jdBody"></div>`;
            wireNav(el);
            el.querySelector('#jdKelas')?.addEventListener('change', (e) => ctx.nav('kelas', { kelas: e.target.value }));
            el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
                state.mode = b.dataset.mode;
                el.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
                drawBody(el);
            }));
            el.querySelector('#jdXls').addEventListener('click', async () => {
                const logo = await RP.loadLogo();
                RP.download(J.xlsx(state.data, { logo }), `${J.namaFile(state.data)}.xlsx`);
            });
            el.querySelector('#jdPdf').addEventListener('click', () => {
                if (!RP.print(J.htmlTabel(state.data))) toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err');
            });
            RP.tombolPdf(el.querySelector('#jdPdfDl'), () => ({ html: J.htmlTabel(state.data), nama: J.namaFile(state.data) }), toast);
            drawBody(el);
        }

        function legend(d) {
            const k = d.kelas.tingkat <= 2 ? 'kelas 1–2' : 'kelas 3–6';
            const ist = (d.slot || []).find((s) => s.istirahat);
            return `<div class="jd-legend"><span><i class="keg"></i>Kegiatan</span><span><i class="gm"></i>Diajar guru mapel — ikut jadwal gurunya</span>
                <span><i class="ist"></i>Istirahat terkunci (${k}${ist ? `: ${esc(J.waktu(ist))}` : ''})</span></div>`;
        }

        function drawBody(el) {
            const d = state.data;
            const body = el.querySelector('#jdBody');
            const edit = Boolean(d.can_edit);
            const kosong = !(d.isi || []).some((e) => e.jenis === 'mapel');
            const note = !edit ? '<div class="att-alert info jd-note">Jadwal kelas ini diatur wali kelas. Anda bisa melihat dan mengunduhnya.</div>'
                : (kosong ? '<div class="att-alert warn jd-note">Jadwal belum diisi. Ketuk jam untuk mengisi mata pelajaran atau kegiatan. Upacara &amp; Dhuha sudah terisi sebagai contoh — boleh diubah.</div>' : '');
            if (state.mode === 'tabel') {
                const rows = J.susun(d);
                body.innerHTML = `${note}<div class="jd-wrap"><table class="jd-t">
                    <thead><tr><th>No</th><th>Waktu</th>${J.HARI.map((h, i) => `<th class="${J.hariDari(today()) === i + 1 ? 'now' : ''}">${h}</th>`).join('')}</tr></thead>
                    <tbody>${rows.map((r) => {
        if (r.istirahat) return `<tr class="ist"><td>${r.slot.no}</td><td>${esc(J.waktu(r.slot))}</td><td colspan="5">${ICON.lock} Istirahat</td></tr>`;
        return `<tr><td>${r.slot.no}</td><td class="jd-w">${esc(J.waktu(r.slot)) || '<span class="att-muted">–</span>'}</td>${r.sel.map((c) => {
            if (!c) return '';
            const e = c.e;
            const cls = e ? (e.jenis === 'kegiatan' ? 'keg' : (e.staff_id ? 'gm' : 'mp')) : 'empty';
            const inner = e ? `<b>${esc(J.teks(e))}</b>${e.guru ? `<small>${esc(e.guru)}</small>` : ''}` : (edit ? '<span class="jd-add">+</span>' : '');
            return `<td class="${cls}"${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${edit ? `<button type="button" data-h="${c.hari}" data-j="${c.jam}" aria-label="${J.HARI[c.hari - 1]} jam ke-${c.jam}">${inner}</button>` : inner}</td>`;
        }).join('')}</tr>`;
    }).join('')}</tbody></table></div>
                    ${edit ? `<button type="button" class="att-btn att-btn-ghost att-btn-block jd-addrow" id="jdAddRow">${ICON.plus} Tambah jam</button>` : ''}
                    ${legend(d)}`;
            } else {
                const blok = J.hariIni(d, state.hari);
                body.innerHTML = `${note}<div class="jd-days" role="tablist" aria-label="Pilih hari">${J.HARI.map((h, i) =>
                    `<button type="button" role="tab" data-hari="${i + 1}" aria-selected="${state.hari === i + 1}">${h.slice(0, 3)}${J.hariDari(today()) === i + 1 ? '<i>hari ini</i>' : ''}</button>`).join('')}</div>
                    <section class="jd-list">${blok.map((b) => {
        if (b.istirahat) {
            return `<div class="jd-slot ist"><span class="jd-no">–</span><span class="jd-time">${esc(J.waktu(b.dari))}</span>
                            <span class="jd-txt"><b>${ICON.lock} Istirahat</b><small>Terkunci untuk ${d.kelas.tingkat <= 2 ? 'kelas 1–2' : 'kelas 3–6'}</small></span></div>`;
        }
        const e = b.e;
        const cls = e ? (e.jenis === 'kegiatan' ? 'keg' : (e.staff_id ? 'gm' : '')) : 'empty';
        const sub = e ? (e.jenis === 'kegiatan' ? `Kegiatan${b.jumlah > 1 ? ` · ${b.jumlah} jam` : ''}` : `${e.guru ? esc(e.guru) : 'Wali kelas'}${b.jumlah > 1 ? ` · ${b.jumlah} jam` : ''}`) : (edit ? 'Ketuk untuk mengisi' : 'Kosong');
        const inner = `<span class="jd-no">${esc(J.rentangJam(b))}</span><span class="jd-time">${esc(J.rentangWaktu(b)) || '<span class="att-muted">–</span>'}</span>
                            <span class="jd-txt"><b>${e ? esc(J.teks(e)) : '<span class="att-muted">Belum diisi</span>'}</b><small>${sub}</small></span>${edit ? `<span class="jd-ed">${ICON.edit}</span>` : ''}`;
        return edit ? `<button type="button" class="jd-slot ${cls}" data-h="${state.hari}" data-j="${b.dari.no}">${inner}</button>` : `<div class="jd-slot ${cls}">${inner}</div>`;
    }).join('')}</section>
                    ${edit ? `<button type="button" class="att-btn att-btn-ghost att-btn-block jd-addrow" id="jdAddRow">${ICON.plus} Tambah jam</button>` : ''}
                    ${legend(d)}`;
                body.querySelectorAll('[data-hari]').forEach((b) => b.addEventListener('click', () => { state.hari = Number(b.dataset.hari); drawBody(el); }));
            }
            body.querySelectorAll('[data-h][data-j]').forEach((b) => b.addEventListener('click', () => editSlot(el, Number(b.dataset.h), Number(b.dataset.j))));
            body.querySelector('#jdAddRow')?.addEventListener('click', () => addRow(el));
        }

        async function apply(el, fn, args) {
            state.data = await rpc(fn, args);
            drawBody(el);
        }

        // ------------------------------------------------------------ ubah satu jam
        function editSlot(el, hari, jam) {
            const d = state.data;
            const isi = new Map((d.isi || []).map((e) => [`${e.hari}|${e.jam}`, e]));
            const e = isi.get(`${hari}|${jam}`) || null;
            const slot = d.slot.find((s) => s.no === jam);
            // jam berturut-turut sesudahnya yang isinya sama (blok) & sisa jam sebelum istirahat/akhir
            let blok = 1;
            const idx = d.slot.indexOf(slot);
            if (e) while (d.slot[idx + blok] && !d.slot[idx + blok].istirahat && JSON.stringify(isi.get(`${hari}|${d.slot[idx + blok].no}`) || null) === JSON.stringify({ ...e, jam: d.slot[idx + blok].no })) blok += 1;
            let maxN = 0;
            while (d.slot[idx + maxN] && !d.slot[idx + maxN].istirahat && maxN < 8) maxN += 1;
            const mapel = (d.mapel || []).filter((m) => !m.hidden || m.id === e?.subject_id);
            const jenis0 = e ? e.jenis : 'mapel';
            const html = `<h3>${J.HARI[hari - 1]} · Jam ke-${jam}${J.waktu(slot) ? ` <span class="att-muted">(${esc(J.waktu(slot))})</span>` : ''}</h3>
                <div class="inv-seg nl-seg jd-jenis" role="tablist" aria-label="Isi">
                    <button type="button" role="tab" data-j="mapel" aria-selected="${jenis0 === 'mapel'}">Mata pelajaran</button>
                    <button type="button" role="tab" data-j="kegiatan" aria-selected="${jenis0 === 'kegiatan'}">Kegiatan</button>
                </div>
                <div class="jd-f" data-for="mapel"><div class="att-field"><label for="jdMp">Mata pelajaran</label>
                    <select class="att-select" id="jdMp">${mapel.map((m) => `<option value="${esc(m.id)}" ${m.id === e?.subject_id ? 'selected' : ''}>${esc(m.nama)}${m.guru?.length ? ' · guru mapel' : ''}</option>`).join('')}</select></div>
                    <div class="att-field" id="jdGpWrap"><label for="jdGp">Guru pengajar <span class="att-muted">(mapel ini punya guru mapel)</span></label><select class="att-select" id="jdGp"></select></div></div>
                <div class="jd-f" data-for="kegiatan"><div class="att-field"><label for="jdKg">Nama kegiatan</label>
                    <input class="att-input" id="jdKg" maxlength="60" list="jdKgList" value="${esc(e?.kegiatan || '')}" placeholder="mis. Upacara Bendera">
                    <datalist id="jdKgList">${J.KEGIATAN.map((k) => `<option value="${esc(k)}">`).join('')}</datalist></div></div>
                <div class="att-field"><label for="jdN">Berapa jam berturut-turut?</label>
                    <select class="att-select" id="jdN">${Array.from({ length: maxN }, (_, i) => `<option value="${i + 1}" ${i + 1 === blok ? 'selected' : ''}>${i + 1} jam (jam ke-${jam}${i ? `–${d.slot[idx + i].no}` : ''})</option>`).join('')}</select></div>
                <fieldset class="jd-time-f"><legend>Waktu jam ke-${jam} <span class="att-muted">— opsional, berlaku untuk semua hari</span></legend>
                    <div class="att-row"><div class="att-field"><label for="jdM">Mulai</label><input class="att-input" id="jdM" inputmode="numeric" maxlength="5" placeholder="07:40" value="${esc(slot.mulai || '')}"></div>
                    <div class="att-field"><label for="jdS">Selesai</label><input class="att-input" id="jdS" inputmode="numeric" maxlength="5" placeholder="08:15" value="${esc(slot.selesai || '')}"></div></div></fieldset>
                <div class="att-alert err jd-err" role="alert" hidden></div>
                <div class="att-row" style="margin-top:14px">
                    ${e ? '<button type="button" class="att-btn att-btn-danger" id="jdClear" style="flex:1">Kosongkan</button>' : '<button type="button" class="att-btn att-btn-ghost" data-close style="flex:1">Batal</button>'}
                    <button type="button" class="att-btn att-btn-primary" id="jdSave" style="flex:1">Simpan</button>
                </div>
                <button type="button" class="jd-delrow" id="jdDelRow">Hapus jam ke-${jam} dari semua hari</button>`;
            const sh = sheet(html);
            const $s = (q) => sh.el.querySelector(q);
            let jenis = jenis0;
            const showJenis = () => {
                sh.el.querySelectorAll('[data-j]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.j === jenis)));
                sh.el.querySelectorAll('.jd-f').forEach((f) => { f.hidden = f.dataset.for !== jenis; });
            };
            const showGuru = () => {
                const m = mapel.find((x) => x.id === $s('#jdMp').value);
                const g = m?.guru || [];
                $s('#jdGpWrap').hidden = !g.length;
                $s('#jdGp').innerHTML = g.map((x) => `<option value="${esc(x.id)}" ${x.id === e?.staff_id ? 'selected' : ''}>${esc(x.nama)}</option>`).join('');
            };
            sh.el.querySelectorAll('.jd-jenis [data-j]').forEach((b) => b.addEventListener('click', () => { jenis = b.dataset.j; showJenis(); }));
            $s('#jdMp').addEventListener('change', showGuru);
            showJenis(); showGuru();
            const err = (msg) => { const a = $s('.jd-err'); a.textContent = msg; a.hidden = !msg; if (msg) a.scrollIntoView({ block: 'nearest' }); };
            const busy = (on) => sh.el.querySelectorAll('button').forEach((b) => { b.disabled = on; });
            const fmt = (v) => v.trim().replace('.', ':');

            $s('#jdSave').addEventListener('click', async () => {
                err('');
                const m0 = fmt($s('#jdM').value); const s0 = fmt($s('#jdS').value);
                const re = /^(\d{1,2}):(\d{2})$/;
                for (const v of [m0, s0]) {
                    const x = re.exec(v);
                    if (v && (!x || Number(x[1]) > 23 || Number(x[2]) > 59)) return err('Format jam harus HH:MM (00:00–23:59), contoh 07:40.');
                }
                if (jenis === 'kegiatan' && !$s('#jdKg').value.trim()) return err('Isi nama kegiatan.');
                if (jenis === 'mapel' && !$s('#jdMp').value) return err('Pilih mata pelajaran.');
                busy(true);
                try {
                    const pad = (v) => (v ? v.padStart(5, '0') : '');
                    if (pad(m0) !== (slot.mulai || '') || pad(s0) !== (slot.selesai || '')) {
                        state.data = await rpc('set_schedule_slot', { p_class_id: state.kelas, p_slot: jam, p_mulai: m0, p_selesai: s0 });
                    }
                    state.data = await rpc('save_schedule_entry', {
                        p_class_id: state.kelas, p_hari: hari, p_slot: jam, p_jumlah: Number($s('#jdN').value), p_jenis: jenis,
                        p_subject_id: jenis === 'mapel' ? $s('#jdMp').value : null,
                        p_kegiatan: jenis === 'kegiatan' ? $s('#jdKg').value : null,
                        p_staff_id: jenis === 'mapel' && !$s('#jdGpWrap').hidden ? $s('#jdGp').value : null,
                    });
                    sh.close();
                    drawBody(el);
                    toast('Jadwal tersimpan', 'ok');
                } catch (x) {
                    busy(false);
                    drawBody(el);
                    err(errMessage(x));
                }
            });
            $s('#jdClear')?.addEventListener('click', async () => {
                busy(true);
                try {
                    await apply(el, 'save_schedule_entry', { p_class_id: state.kelas, p_hari: hari, p_slot: jam, p_jumlah: Number($s('#jdN').value), p_jenis: 'kosong' });
                    sh.close();
                    toast('Jam dikosongkan', 'ok');
                } catch (x) { busy(false); err(errMessage(x)); }
            });
            $s('#jdDelRow').addEventListener('click', async () => {
                sh.close();
                if (!await window.Att.confirm({ title: `Hapus jam ke-${jam}?`, html: `<p class="att-muted">Baris jam ke-${jam} dan isinya di <b>semua hari</b> dihapus. Jam sesudahnya bergeser naik.</p>`, confirmText: 'Hapus', danger: true })) return;
                try { await apply(el, 'delete_schedule_slot', { p_class_id: state.kelas, p_slot: jam }); toast(`Jam ke-${jam} dihapus`, 'ok'); } catch (x) { toast(errMessage(x), 'err'); }
            });
        }

        function addRow(el) {
            const last = state.data.slot[state.data.slot.length - 1];
            const sh = sheet(`<h3>Tambah jam ke-${(last?.no || 0) + 1}</h3>
                <p class="att-muted" style="margin:0 0 10px">Baris baru muncul di semua hari. Waktu boleh dikosongkan.</p>
                <div class="att-row"><div class="att-field"><label for="jdAM">Mulai</label><input class="att-input" id="jdAM" inputmode="numeric" maxlength="5" placeholder="${esc(last?.selesai || '12:40')}" value="${esc(last?.selesai || '')}"></div>
                <div class="att-field"><label for="jdAS">Selesai</label><input class="att-input" id="jdAS" inputmode="numeric" maxlength="5" placeholder="13:15"></div></div>
                <div class="att-alert err jd-err" role="alert" hidden></div>
                <div class="att-row" style="margin-top:14px"><button type="button" class="att-btn att-btn-ghost" data-close style="flex:1">Batal</button>
                <button type="button" class="att-btn att-btn-primary" id="jdAdd" style="flex:1">Tambah</button></div>`);
            sh.el.querySelector('#jdAdd').addEventListener('click', async () => {
                try {
                    await apply(el, 'add_schedule_slot', { p_class_id: state.kelas, p_mulai: sh.el.querySelector('#jdAM').value.replace('.', ':'), p_selesai: sh.el.querySelector('#jdAS').value.replace('.', ':') });
                    sh.close();
                    toast('Jam ditambahkan', 'ok');
                } catch (x) { const a = sh.el.querySelector('.jd-err'); a.textContent = errMessage(x); a.hidden = false; }
            });
        }

        // ------------------------------------------------------------ jadwal mengajar
        async function viewSaya(el, p) {
            let guruList = null;
            if (ctx.admin) {
                guruList = await rpc('get_schedule_teachers');
                if (!guruList.length) { el.innerHTML = '<div class="att-alert info">Belum ada guru mapel yang ditugaskan.</div>'; return; }
            }
            const guru = ctx.admin ? (guruList.some((g) => g.id === p.guru) ? p.guru : guruList[0].id) : null;
            const t = await rpc('get_teaching_schedule', ctx.admin ? { p_staff_id: guru } : {});
            const hNow = J.hariDari(today());
            el.innerHTML = `${head(ctx.admin ? 'Jadwal Mengajar Guru' : 'Jadwal Mengajar Saya', t.guru?.nama || '')}
                ${ctx.admin ? `<div class="att-field nl-kelas"><label for="jdGuru">Guru</label><select class="att-select" id="jdGuru">${guruList.map((g) =>
        `<option value="${esc(g.id)}" ${g.id === guru ? 'selected' : ''}>${esc(g.nama)}${g.mapel?.length ? ` · ${esc(g.mapel.join(', '))}` : ''} (${g.jam} jam)</option>`).join('')}</select></div>` : ''}
                ${!t.isi.length ? `<div class="att-alert info">${ctx.admin ? 'Guru ini belum ada di jadwal kelas mana pun.' : 'Anda belum tercantum di jadwal kelas mana pun.'} Jadwal guru mapel terisi otomatis saat wali kelas memasukkan mapelnya ke jadwal kelas.</div>` : ''}
                <div class="jd-week">${J.HARI.map((h, i) => {
        const list = J.mengajarHari(t.isi, i + 1);
        return `<section class="jd-day ${hNow === i + 1 ? 'now' : ''}"><header>${h}${hNow === i + 1 ? ' <i>hari ini</i>' : ''}<span class="att-muted">${list.length ? `${list.reduce((a, x) => a + x.jamAkhir - x.jamAwal + 1, 0)} jam` : 'kosong'}</span></header>
                        ${list.map((x) => `<div class="jd-teach"><span class="jd-time">${x.mulai ? `${J.titik(x.mulai)}${x.selesai ? `–${J.titik(x.selesai)}` : ''}` : `Jam ke-${x.jamAwal}${x.jamAkhir > x.jamAwal ? `–${x.jamAkhir}` : ''}`}</span>
                            <span class="jd-txt"><b>Kelas ${esc(J.kelasTitik(x.kelas))}</b><small>${esc(x.mapel)} · jam ke-${x.jamAwal}${x.jamAkhir > x.jamAwal ? `–${x.jamAkhir}` : ''}</small></span></div>`).join('')}
                    </section>`;
    }).join('')}</div>`;
            wireNav(el);
            el.querySelector('#jdGuru')?.addEventListener('change', (e) => ctx.nav('saya', { guru: e.target.value }));
        }

        const VIEWS = { kelas: viewKelas, saya: viewSaya };
        async function render(el, view, params = {}) {
            el.classList.toggle('jd-wide', Boolean(ctx.wide));
            el.innerHTML = '<div class="g-loading att-muted">Memuat…</div>';
            try { await (VIEWS[view] || viewKelas)(el, params); } catch (err) { el.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; }
        }
        return { render, reset() { state.data = null; state.kelas = null; } };
    }

    window.JadwalUI = Object.freeze({ create });
}());
