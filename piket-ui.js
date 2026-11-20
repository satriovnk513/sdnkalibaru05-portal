// =============================================================================
// Tampilan Jadwal Piket — Portal Guru (#/piket?kelas=&bulan=YYYY-MM) dan Panel Admin.
// Wali kelas/admin: pilih mode (ganti tiap bulan / tetap satu semester), acak ulang,
// pindahkan siswa ke hari lain. Guru lain kelas itu & kepala sekolah: lihat & unduh.
//   PiketUI.create({ rpc, classes(), nav(params), setTop, inlineHead, wide, admin }).render(el, { kelas, bulan })
// =============================================================================
(function () {
    'use strict';

    const { esc, errMessage, toast, todayJakarta } = window.Att;
    const P = window.Piket;
    const RP = window.RekapPrint;
    const ICON = {
        left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
        right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
        shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
        print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    };
    const geserBulan = (iso, n) => {
        const [y, m] = iso.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 + n, 1));
        return d.toISOString().slice(0, 7);
    };
    const hariIni = () => {
        const [y, m, d] = todayJakarta().split('-').map(Number);
        const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        return w >= 1 && w <= 5 ? w : 0;
    };

    function create(ctx) {
        let data = null;
        let kelas = null;

        async function render(el, p = {}) {
            el.classList.toggle('jd-wide', Boolean(ctx.wide));
            el.innerHTML = '<div class="g-loading att-muted">Memuat…</div>';
            try {
                const list = await ctx.classes();
                if (!list.length) { el.innerHTML = '<div class="att-alert info">Belum ada kelas yang Anda walikan atau ajar.</div>'; return; }
                kelas = list.some((k) => k.id === p.kelas) ? p.kelas : (list.find((k) => k.wali) || list[0]).id;
                const bulan = /^\d{4}-\d{2}$/.test(p.bulan || '') ? p.bulan : todayJakarta().slice(0, 7);
                const tgl = bulan === todayJakarta().slice(0, 7) ? todayJakarta() : `${bulan}-01`;
                data = await ctx.rpc('get_class_piket', { p_class_id: kelas, p_tanggal: tgl });
                draw(el, list);
            } catch (err) {
                el.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
            }
        }

        function draw(el, list) {
            const info = list.find((k) => k.id === kelas);
            const edit = Boolean(data.can_edit);
            const hari = P.perHari(data);
            const now = data.tanggal === todayJakarta() ? hariIni() : 0;
            const bulan = String(data.tanggal).slice(0, 7);
            const head = ctx.inlineHead ? '' : (ctx.setTop('Jadwal Piket', `Kelas ${P.kelasTitik(info.nama)}`), '');
            el.innerHTML = `${head}
                ${list.length > 1 ? `<div class="att-field nl-kelas"><label for="pkKelas">Kelas</label><select class="att-select" id="pkKelas">${list.map((k) =>
        `<option value="${esc(k.id)}" ${k.id === kelas ? 'selected' : ''}>Kelas ${esc(k.nama)}${!ctx.admin && k.wali ? ' · Wali kelas' : ''}</option>`).join('')}</select></div>` : ''}
                <div class="pk-periode">
                    ${data.mode === 'bulanan' ? `<button type="button" class="att-btn att-btn-ghost" id="pkPrev" aria-label="Bulan sebelumnya">${ICON.left}</button>` : ''}
                    <div><b>${esc(P.labelPeriode(data))}</b><small>${data.siswa.length} siswa · ${data.mode === 'bulanan' ? 'diacak ulang tiap bulan' : 'tetap satu semester'}</small></div>
                    ${data.mode === 'bulanan' ? `<button type="button" class="att-btn att-btn-ghost" id="pkNext" aria-label="Bulan berikutnya">${ICON.right}</button>` : ''}
                </div>
                ${edit ? `<div class="inv-seg nl-seg pk-mode" role="radiogroup" aria-label="Pembagian piket">
                    <button type="button" role="radio" data-mode="bulanan" aria-checked="${data.mode === 'bulanan'}" aria-selected="${data.mode === 'bulanan'}">Ganti tiap bulan</button>
                    <button type="button" role="radio" data-mode="semester" aria-checked="${data.mode === 'semester'}" aria-selected="${data.mode === 'semester'}">Tetap satu semester</button>
                </div>
                <p class="att-muted pk-help">Siswa dibagi rata Senin–Jumat, laki-laki &amp; perempuan juga rata. Ketuk nama siswa untuk memindahkan ke hari lain.</p>`
        : '<div class="att-alert info pk-help">Jadwal piket diatur wali kelas. Anda bisa melihat dan mengunduhnya.</div>'}
                ${!data.siswa.length ? '<div class="att-alert info">Belum ada siswa di kelas ini.</div>' : ''}
                <div class="pk-days">${hari.map((l, i) => {
        const c = P.hitung(l);
        return `<section class="pk-day ${now === i + 1 ? 'now' : ''}"><header><b>${P.HARI[i]}</b>${now === i + 1 ? '<i>hari ini</i>' : ''}<span>${l.length} siswa · ${c.L} L ${c.P} P</span></header>
                        <ol>${l.map((s) => `<li>${edit ? `<button type="button" data-s="${esc(s.id)}">` : '<span>'}<span class="pk-nm">${esc(s.nama)}</span><span class="pk-jk ${s.jk === 'L' ? 'l' : 'p'}">${esc(s.jk || '-')}</span>${edit ? '</button>' : '</span>'}</li>`).join('')}</ol></section>`;
    }).join('')}</div>
                <div class="pk-act">
                    ${edit ? `<button type="button" class="att-btn att-btn-ghost" id="pkAcak">${ICON.shuffle} Acak ulang</button>` : ''}
                    <button type="button" class="att-btn att-btn-ghost" id="pkXls">${ICON.down} Excel</button>
                    <button type="button" class="att-btn att-btn-ghost" id="pkPdf">${ICON.print} Cetak / PDF</button>
                </div>`;

            el.querySelector('#pkKelas')?.addEventListener('change', (e) => ctx.nav({ kelas: e.target.value }));
            el.querySelector('#pkPrev')?.addEventListener('click', () => ctx.nav({ kelas, bulan: geserBulan(bulan, -1) }));
            el.querySelector('#pkNext')?.addEventListener('click', () => ctx.nav({ kelas, bulan: geserBulan(bulan, 1) }));
            el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
                if (b.dataset.mode === data.mode) return;
                try {
                    data = await ctx.rpc('set_piket_mode', { p_class_id: kelas, p_mode: b.dataset.mode, p_tanggal: data.tanggal });
                    draw(el, list);
                    toast(data.mode === 'bulanan' ? 'Piket diacak ulang otomatis tiap bulan' : 'Piket tetap selama satu semester', 'ok');
                } catch (err) { toast(errMessage(err), 'err'); }
            }));
            el.querySelector('#pkAcak')?.addEventListener('click', async () => {
                if (!await window.Att.confirm({ title: 'Acak ulang piket?', html: `<p class="att-muted">Pembagian ${esc(P.labelPeriode(data))} diganti dengan pembagian acak baru (tetap rata).</p>`, confirmText: 'Acak ulang' })) return;
                try { data = await ctx.rpc('shuffle_piket', { p_class_id: kelas, p_tanggal: data.tanggal }); draw(el, list); toast('Piket diacak ulang', 'ok'); } catch (err) { toast(errMessage(err), 'err'); }
            });
            el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => pindah(el, list, data.siswa.find((s) => s.id === b.dataset.s))));
            el.querySelector('#pkXls').addEventListener('click', () => RP.download(P.xlsx(data), `${P.namaFile(data)}.xlsx`));
            el.querySelector('#pkPdf').addEventListener('click', () => { if (!RP.print(P.html(data))) toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err'); });
        }

        function pindah(el, list, s) {
            const back = document.createElement('div');
            back.className = 'att-sheet-backdrop';
            back.innerHTML = `<div class="att-sheet pk-sheet" role="dialog" aria-modal="true"><h3>Pindahkan ${esc(s.nama)}</h3>
                <p class="att-muted" style="margin:0 0 10px">Sekarang piket hari ${P.HARI[s.hari - 1]}. Pilih hari baru:</p>
                <div class="pk-pick">${P.HARI.map((h, i) => { const n = data.siswa.filter((x) => x.hari === i + 1).length; return `<button type="button" data-h="${i + 1}" ${s.hari === i + 1 ? 'disabled' : ''}><b>${h}</b><small>${n} siswa</small></button>`; }).join('')}</div>
                <button type="button" class="att-btn att-btn-ghost att-btn-block" data-close style="margin-top:12px">Batal</button></div>`;
            const close = () => back.remove();
            back.addEventListener('click', async (e) => {
                if (e.target === back || e.target.closest('[data-close]')) return close();
                const b = e.target.closest('[data-h]');
                if (!b) return;
                try {
                    data = await ctx.rpc('set_piket_day', { p_class_id: kelas, p_student_id: s.id, p_hari: Number(b.dataset.h), p_tanggal: data.tanggal });
                    close();
                    draw(el, list);
                    toast(`${s.nama} → ${P.HARI[Number(b.dataset.h) - 1]}`, 'ok');
                } catch (err) { toast(errMessage(err), 'err'); }
            });
            document.body.appendChild(back);
            back.querySelector('[data-h]:not([disabled])')?.focus();
        }

        return { render, reset() { data = null; kelas = null; } };
    }

    window.PiketUI = Object.freeze({ create });
}());
