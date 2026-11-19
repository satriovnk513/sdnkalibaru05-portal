// =============================================================================
// Jurnal Mengajar (Portal Guru #/jurnal?tanggal=YYYY-MM-DD) — catatan harian pribadi.
// Daftar hari itu terisi dari jadwal pelajaran; guru menandai Terlaksana / Tidak
// terlaksana, materi & keterangan opsional; bisa menambah catatan lain; unduh
// sebulan sebagai Excel atau PDF. Hanya pemiliknya yang bisa melihat.
//   JurnalUI.create({ rpc, nav(tanggal), setTop }).render(el, tanggal)
// =============================================================================
(function () {
    'use strict';

    const { esc, errMessage, toast, todayJakarta } = window.Att;
    const JR = window.Jurnal;
    const RP = window.RekapPrint;
    const ICON = {
        left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
        right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
        check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
        x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
        plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
        print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    };
    const addDay = (iso, n) => {
        const [y, m, d] = iso.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    };
    const tglPanjang = (iso) => `${JR.HARI[JR.hariDari(iso)]}, ${JR.tglPendek(iso)}`;

    function create(ctx) {
        let day = null;
        let open = new Set();       // kartu yang sedang dibuka formnya
        let addOpen = false;

        async function render(el, tanggal) {
            const today = todayJakarta();
            const tgl = /^\d{4}-\d{2}-\d{2}$/.test(tanggal || '') && tanggal <= today ? tanggal : today;
            el.innerHTML = '<div class="g-loading att-muted">Memuat…</div>';
            try {
                day = await ctx.rpc('get_my_journal_day', { p_tanggal: tgl });
            } catch (err) {
                el.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
                return;
            }
            open = new Set();
            addOpen = false;
            draw(el);
        }

        function card(it, i) {
            const c = it.catatan;
            const edit = open.has(it.key) || !c;
            const title = it.jenis === 'lain' ? it.judul : it.mapel;
            const sub = [it.kelas ? `Kelas ${JR.kelasTitik(it.kelas)}` : '', it.jam ? `Jam ke-${it.jam}` : '', it.waktu].filter(Boolean).join(' · ');
            const badge = c ? (c.status === 'terlaksana' ? '<span class="att-badge ok">Terlaksana</span>' : '<span class="att-badge bad">Tidak terlaksana</span>')
                : '<span class="att-badge mute">Belum</span>';
            const st = c?.status || '';
            return `<article class="jr-card ${c ? `saved ${c.status}` : ''}" data-i="${i}">
                <header><div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${it.lama ? '<small class="att-muted">Sudah tidak ada di jadwal</small>' : ''}${it.jenis === 'lain' ? '<small class="jr-tag">Catatan lain</small>' : ''}</div>${badge}</header>
                ${edit ? `<div class="jr-form">
                    <div class="jr-st" role="radiogroup" aria-label="Status">
                        <button type="button" role="radio" data-st="terlaksana" aria-checked="${st === 'terlaksana'}">${ICON.check} Terlaksana</button>
                        <button type="button" role="radio" data-st="tidak" aria-checked="${st === 'tidak'}">${ICON.x} Tidak terlaksana</button>
                    </div>
                    <label class="jr-l" for="jrM${i}">Materi <span class="att-muted">(opsional)</span></label>
                    <textarea class="att-textarea" id="jrM${i}" rows="2" maxlength="500" placeholder="Mis. ${esc(it.mapel === 'Matematika' ? 'Penjumlahan bilangan 1–20' : 'Bab 3 — membaca teks cerita')}">${esc(c?.materi || '')}</textarea>
                    <label class="jr-l" for="jrK${i}">Keterangan <span class="att-muted">(opsional)</span></label>
                    <input class="att-input" id="jrK${i}" maxlength="300" placeholder="Mis. diganti ulangan harian / guru rapat" value="${esc(c?.keterangan || '')}">
                    <div class="jr-act">${c ? '<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-batal>Batal</button>' : ''}
                        ${it.jenis === 'lain' && c ? '<button type="button" class="att-btn att-btn-danger att-btn-sm" data-hapus>Hapus</button>' : ''}
                        <button type="button" class="att-btn att-btn-primary" data-simpan ${st ? '' : 'disabled'}>Simpan</button></div>
                </div>` : `<div class="jr-view">${c.materi ? `<p><span class="att-muted">Materi:</span> ${esc(c.materi)}</p>` : '<p class="att-muted">Tanpa catatan materi</p>'}
                    ${c.keterangan ? `<p><span class="att-muted">Keterangan:</span> ${esc(c.keterangan)}</p>` : ''}
                    <button type="button" class="jr-ubah" data-ubah>Ubah</button></div>`}
            </article>`;
        }

        function draw(el) {
            const today = todayJakarta();
            const tgl = day.tanggal;
            const items = JR.susunHari(day);
            const r = JR.ringkas(items);
            const dow = JR.hariDari(tgl);
            let info;
            if (day.libur) info = `<div class="att-alert warn jr-note">Hari libur: ${esc(day.libur)}. Tidak ada jadwal — catatan lain tetap bisa ditambahkan.</div>`;
            else if (dow === 0 || dow === 6) info = `<div class="att-alert info jr-note">${JR.HARI[dow]} — tidak ada jadwal pelajaran.</div>`;
            else if (!r.total) info = '<div class="att-alert info jr-note">Belum ada jadwal mengajar Anda di hari ini. Isi jadwal kelas dulu di menu Jadwal (wali kelas), atau tambah catatan lain.</div>';
            else info = '<div class="att-alert info jr-note">Terisi otomatis dari jadwal hari ini. Cukup tandai terlaksana; materi boleh dikosongkan.</div>';
            el.innerHTML = `
                <div class="jr-date">
                    <button type="button" class="att-btn att-btn-ghost" id="jrPrev" aria-label="Hari sebelumnya">${ICON.left}</button>
                    <label class="jr-date-mid"><b>${esc(tglPanjang(tgl))}</b><small>${r.total ? `${r.dicatat} dari ${r.total} sudah dicatat` : (tgl === today ? 'Hari ini' : '&nbsp;')}</small>
                        <input type="date" id="jrTgl" value="${esc(tgl)}" max="${esc(today)}" aria-label="Pilih tanggal"></label>
                    <button type="button" class="att-btn att-btn-ghost" id="jrNext" aria-label="Hari berikutnya" ${tgl >= today ? 'disabled' : ''}>${ICON.right}</button>
                </div>
                ${r.total ? `<div class="jr-prog" aria-hidden="true"><i style="width:${Math.round((r.dicatat / r.total) * 100)}%"></i></div>` : ''}
                ${info}
                <div class="jr-list">${items.map(card).join('')}</div>
                ${addOpen ? `<article class="jr-card jr-add">
                    <header><div><b>Catatan lain</b><small>Mis. rapat, kegiatan, pengganti jam, remedial</small></div></header>
                    <div class="jr-form">
                        <label class="jr-l" for="jrJ">Judul</label><input class="att-input" id="jrJ" maxlength="80" placeholder="Mis. Rapat orang tua murid">
                        ${day.kelas.length ? `<label class="jr-l" for="jrKls">Kelas <span class="att-muted">(opsional)</span></label><select class="att-select" id="jrKls"><option value="">—</option>${day.kelas.map((k) => `<option value="${esc(k.id)}">Kelas ${esc(JR.kelasTitik(k.nama))}</option>`).join('')}</select>` : ''}
                        <div class="jr-st" role="radiogroup" aria-label="Status">
                            <button type="button" role="radio" data-st="terlaksana" aria-checked="true">${ICON.check} Terlaksana</button>
                            <button type="button" role="radio" data-st="tidak" aria-checked="false">${ICON.x} Tidak terlaksana</button>
                        </div>
                        <label class="jr-l" for="jrAM">Isi / materi <span class="att-muted">(opsional)</span></label><textarea class="att-textarea" id="jrAM" rows="2" maxlength="500"></textarea>
                        <div class="jr-act"><button type="button" class="att-btn att-btn-ghost att-btn-sm" id="jrAddCancel">Batal</button><button type="button" class="att-btn att-btn-primary" id="jrAddSave">Simpan</button></div>
                    </div></article>` : ''}
                <div class="jr-foot">
                    ${addOpen ? '' : `<button type="button" class="att-btn att-btn-ghost" id="jrAdd">${ICON.plus} Catatan lain</button>`}
                    <div class="jr-dl"><span class="att-muted">Unduh jurnal ${esc(RP.BULAN[Number(tgl.slice(5, 7)) - 1])} ${tgl.slice(0, 4)}:</span>
                        <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="jrXls">${ICON.down} Excel</button>
                        <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="jrPdf">${ICON.print} PDF</button></div>
                </div>
                <p class="att-muted jr-priv">Jurnal ini catatan pribadi Anda — tidak dilihat kepala sekolah atau admin.</p>`;

            el.querySelector('#jrPrev').addEventListener('click', () => ctx.nav(addDay(tgl, -1)));
            el.querySelector('#jrNext').addEventListener('click', () => ctx.nav(addDay(tgl, 1)));
            el.querySelector('#jrTgl').addEventListener('change', (e) => { if (e.target.value) ctx.nav(e.target.value > today ? today : e.target.value); });

            el.querySelectorAll('.jr-card[data-i]').forEach((art) => {
                const it = items[Number(art.dataset.i)];
                let st = it.catatan?.status || '';
                art.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => {
                    st = b.dataset.st;
                    art.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
                    art.querySelector('[data-simpan]').disabled = false;
                }));
                art.querySelector('[data-ubah]')?.addEventListener('click', () => { open.add(it.key); draw(el); el.querySelector(`.jr-card[data-i="${art.dataset.i}"] textarea`)?.focus(); });
                art.querySelector('[data-batal]')?.addEventListener('click', () => { open.delete(it.key); draw(el); });
                art.querySelector('[data-hapus]')?.addEventListener('click', async () => {
                    if (!await window.Att.confirm({ title: 'Hapus catatan ini?', confirmText: 'Hapus', danger: true })) return;
                    try { day = await ctx.rpc('delete_journal_entry', { p_id: it.catatan.id }); open.delete(it.key); draw(el); toast('Catatan dihapus', 'ok'); } catch (err) { toast(errMessage(err), 'err'); }
                });
                art.querySelector('[data-simpan]')?.addEventListener('click', async (ev) => {
                    const btn = ev.currentTarget;
                    btn.disabled = true; btn.textContent = 'Menyimpan…';
                    try {
                        day = await ctx.rpc('save_journal_entry', {
                            p_tanggal: tgl, p_status: st, p_id: it.catatan?.id || null,
                            p_class_id: it.class_id || null, p_subject_id: it.jenis === 'jadwal' ? it.subject_id : null,
                            p_judul: it.jenis === 'lain' ? it.judul : null, p_jam: it.jam || null,
                            p_materi: art.querySelector('textarea').value, p_keterangan: art.querySelector('input.att-input').value,
                        });
                        open.delete(it.key);
                        draw(el);
                        toast('Jurnal tersimpan', 'ok');
                    } catch (err) { btn.disabled = false; btn.textContent = 'Simpan'; toast(errMessage(err), 'err'); }
                });
            });

            el.querySelector('#jrAdd')?.addEventListener('click', () => { addOpen = true; draw(el); el.querySelector('#jrJ').focus(); });
            if (addOpen) {
                const art = el.querySelector('.jr-add');
                let st = 'terlaksana';
                art.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => {
                    st = b.dataset.st;
                    art.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
                }));
                el.querySelector('#jrAddCancel').addEventListener('click', () => { addOpen = false; draw(el); });
                el.querySelector('#jrAddSave').addEventListener('click', async () => {
                    const judul = el.querySelector('#jrJ').value.trim();
                    if (!judul) { el.querySelector('#jrJ').focus(); toast('Isi judul catatan.', 'err'); return; }
                    try {
                        day = await ctx.rpc('save_journal_entry', { p_tanggal: tgl, p_status: st, p_class_id: el.querySelector('#jrKls')?.value || null, p_judul: judul, p_materi: el.querySelector('#jrAM').value });
                        addOpen = false;
                        draw(el);
                        toast('Catatan ditambahkan', 'ok');
                    } catch (err) { toast(errMessage(err), 'err'); }
                });
            }

            const month = async () => ctx.rpc('get_my_journal_month', { p_tahun: Number(tgl.slice(0, 4)), p_bulan: Number(tgl.slice(5, 7)) });
            el.querySelector('#jrXls').addEventListener('click', async () => {
                try { const m = await month(); RP.download(JR.xlsx(m), `${JR.namaFile(m)}.xlsx`); } catch (err) { toast(errMessage(err), 'err'); }
            });
            el.querySelector('#jrPdf').addEventListener('click', async () => {
                const w = window.open('', '_blank');   // buka dulu supaya tidak diblokir pop-up
                try {
                    const m = await month();
                    if (!w) { toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err'); return; }
                    w.document.open(); w.document.write(JR.html(m)); w.document.close();
                    setTimeout(() => { try { w.focus(); w.print(); } catch { /* tombol cetak tetap ada */ } }, 400);
                } catch (err) { w?.close(); toast(errMessage(err), 'err'); }
            });
        }

        return { render };
    }

    window.JurnalUI = Object.freeze({ create });
}());
