// =============================================================================
// Absensi — komponen bersama untuk /guru dan /admin (tanpa framework).
//   Att.renderSheet()  lembar absensi (H/S/I/A/D, catatan, simpan, draf offline)
//   Att.DataTable      tabel standar: cari, urut, "Tampilkan 10/25/50/100", halaman
//   Att.confirm()      panel konfirmasi dari bawah layar
//   Att.toast()        notifikasi singkat
// Semua teks dari database di-escape sebelum masuk ke HTML.
// =============================================================================
(function () {
    'use strict';

    const STATUS = Object.freeze({ H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa', D: 'Dispensasi' });
    const ORDER = ['H', 'S', 'I', 'A', 'D'];
    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    function esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function parseDate(iso) {
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    }

    function fmtDate(iso, withDay = true) {
        const d = parseDate(iso);
        const s = `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        return withDay ? `${HARI[d.getUTCDay()]}, ${s}` : s;
    }

    function romawi(kelas) {
        const m = String(kelas || '').match(/^([1-6])\s*([A-Z])$/);
        if (!m) return kelas || '';
        return `${['I', 'II', 'III', 'IV', 'V', 'VI'][Number(m[1]) - 1]}.${m[2]}`;
    }

    function todayJakarta() {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    }

    function errMessage(err) {
        const msg = err?.message || String(err || '');
        if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Koneksi terputus. Periksa internet lalu coba lagi.';
        if (/JWT|expired|token/i.test(msg)) return 'Sesi habis. Silakan login ulang.';
        return msg || 'Terjadi kesalahan. Coba lagi.';
    }

    // ------------------------------------------------------------------ toast
    function toast(message, type = 'ok') {
        let host = document.getElementById('attToastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'attToastHost';
            host.setAttribute('aria-live', 'polite');
            host.style.cssText = 'position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:2000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';
            document.body.appendChild(host);
        }
        const el = document.createElement('div');
        el.className = `att-alert ${type}`;
        el.style.cssText = 'max-width:520px;width:100%;box-shadow:0 10px 30px rgba(15,23,42,.18);pointer-events:auto;';
        el.textContent = message;
        host.appendChild(el);
        setTimeout(() => el.remove(), type === 'err' ? 6000 : 3200);
    }

    // ------------------------------------------------------------------ panel konfirmasi
    function confirmSheet({ title, html = '', confirmText = 'Ya, lanjutkan', cancelText = 'Batal', danger = false, input = null }) {
        return new Promise((resolve) => {
            const back = document.createElement('div');
            back.className = 'att-sheet-backdrop';
            back.innerHTML = `
                <div class="att-sheet" role="dialog" aria-modal="true" aria-labelledby="attSheetTitle">
                    <h3 id="attSheetTitle">${esc(title)}</h3>
                    <div class="att-sheet-body">${html}</div>
                    ${input ? `<div class="att-field" style="margin-top:12px"><label for="attSheetInput">${esc(input.label)}</label>
                        <textarea id="attSheetInput" class="att-textarea" maxlength="${input.max || 300}" placeholder="${esc(input.placeholder || '')}"></textarea></div>` : ''}
                    <div class="att-row" style="margin-top:16px">
                        <button type="button" class="att-btn att-btn-ghost" data-act="no" style="flex:1">${esc(cancelText)}</button>
                        <button type="button" class="att-btn ${danger ? 'att-btn-danger' : 'att-btn-primary'}" data-act="yes" style="flex:1">${esc(confirmText)}</button>
                    </div>
                </div>`;
            const done = (val) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
            const onKey = (e) => { if (e.key === 'Escape') done(input ? null : false); };
            back.addEventListener('click', (e) => {
                if (e.target === back) return done(input ? null : false);
                const act = e.target.closest('[data-act]')?.dataset.act;
                if (act === 'no') done(input ? null : false);
                if (act === 'yes') {
                    if (input) {
                        const v = back.querySelector('#attSheetInput').value.trim();
                        if (input.required && !v) { back.querySelector('#attSheetInput').focus(); return; }
                        done(v);
                    } else done(true);
                }
            });
            document.addEventListener('keydown', onKey);
            document.body.appendChild(back);
            (back.querySelector('#attSheetInput') || back.querySelector('[data-act="yes"]')).focus();
        });
    }

    // ------------------------------------------------------------------ draf lokal
    function draftGet(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
    }
    function draftSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* penyimpanan penuh/diblokir */ }
    }
    function draftDel(key) {
        try { localStorage.removeItem(key); } catch { /* abaikan */ }
    }

    // ------------------------------------------------------------------ lembar absensi
    /**
     * sheet: hasil RPC get_attendance_sheet.
     * opts.onSave(entries, reason) → Promise (lempar Error jika gagal)
     * opts.draftKey: kunci localStorage untuk isian yang belum terkirim
     * opts.reasonRequired: admin mengoreksi sesi yang sudah ada
     * opts.subtitle: teks di bawah judul
     */
    function renderSheet(container, sheet, opts = {}) {
        const editable = Boolean(sheet.bisa_ubah);
        const students = (sheet.siswa || []).map((s) => ({ ...s, status: ORDER.includes(s.status) ? s.status : null, catatan: s.catatan || '' }));
        const draft = opts.draftKey ? draftGet(opts.draftKey) : null;
        let usingDraft = false;
        if (editable && draft && Array.isArray(draft.entries)) {
            const byId = new Map(draft.entries.map((e) => [e.student_id, e]));
            if (students.every((s) => byId.has(s.student_id)) && byId.size === students.length) {
                for (const s of students) { const v = byId.get(s.student_id).status; s.status = ORDER.includes(v) ? v : null; s.catatan = byId.get(s.student_id).note || ''; }
                usingDraft = true;
            }
        }
        const openNotes = new Set();
        let showMissing = false;   // tandai baris kosong setelah guru menekan Simpan

        const counts = () => {
            const c = { H: 0, S: 0, I: 0, A: 0, D: 0, kosong: 0 };
            for (const s of students) { if (s.status) c[s.status] += 1; else c.kosong += 1; }
            return c;
        };

        function headerHtml() {
            const bits = [];
            if (sheet.session) {
                bits.push(`<span class="att-badge ok">Tersimpan ${esc(sheet.session.disimpan)}</span>`);
                if (sheet.session.terlambat) bits.push('<span class="att-badge warn">Diisi terlambat</span>');
            } else {
                bits.push('<span class="att-badge mute">Belum disimpan</span>');
            }
            if (!editable && sheet.hari_sekolah) bits.push('<span class="att-badge bad">Terkunci</span>');
            if (usingDraft) bits.push('<span class="att-badge warn">Ada isian belum terkirim</span>');
            return `<div class="att-row" style="margin:6px 0 12px">${bits.join('')}</div>`;
        }

        function countsHtml() {
            const c = counts();
            return `<div id="attCounts"><div class="att-counts">${ORDER.map((k) =>
                `<div class="att-count ${k}"><b>${c[k]}</b><span>${STATUS[k]}</span></div>`).join('')}</div>
                ${editable ? `<p class="att-progress ${c.kosong ? 'todo' : 'done'}" aria-live="polite">${c.kosong
                    ? `<b>${c.kosong}</b> dari ${students.length} siswa belum diabsen`
                    : `Semua ${students.length} siswa sudah diabsen`}</p>` : ''}</div>`;
        }

        function itemHtml(s, i) {
            const showNote = openNotes.has(s.student_id) || (s.catatan && editable);
            const missing = showMissing && editable && !s.status;
            return `<li class="att-item${missing ? ' att-missing' : ''}" data-i="${i}">
                <div class="att-item-top">
                    <span class="att-no">${esc(s.no)}</span>
                    <span class="att-name">${esc(s.nama)}${s.jk ? ` <span class="att-muted">(${esc(s.jk)})</span>` : ''}</span>
                    ${editable && !showNote ? `<button type="button" class="att-note-btn" data-note="${i}">+ catatan</button>` : ''}
                </div>
                <div class="att-status" role="group" aria-label="Status ${esc(s.nama)}">
                    ${ORDER.map((k) => `<button type="button" class="${k}" data-st="${k}" data-i="${i}" aria-pressed="${s.status === k}" title="${STATUS[k]}" ${editable ? '' : 'disabled'}>${k}</button>`).join('')}
                </div>
                ${editable && showNote ? `<input class="att-input att-note-input" data-note-input="${i}" maxlength="200" placeholder="Catatan (mis. surat sakit)" value="${esc(s.catatan)}" aria-label="Catatan ${esc(s.nama)}">` : ''}
                ${!editable && s.catatan ? `<p class="att-note-text">Catatan: ${esc(s.catatan)}</p>` : ''}
            </li>`;
        }

        function render() {
            if (!sheet.hari_sekolah) {
                container.innerHTML = `<div class="att-alert warn">${esc(fmtDate(sheet.tanggal))} hari libur${sheet.libur ? ` (${esc(sheet.libur)})` : ''}. Absensi tidak perlu diisi.</div>`;
                return;
            }
            if (!students.length) {
                container.innerHTML = '<div class="att-alert warn">Rombel ini belum punya siswa. Hubungi admin.</div>';
                return;
            }
            container.innerHTML = `
                ${opts.subtitle ? `<p class="att-muted" style="margin:0">${esc(opts.subtitle)}</p>` : ''}
                ${headerHtml()}
                ${sheet.isian_awal_dari_harian && !sheet.session ? '<div class="att-alert info" style="margin-bottom:12px">Status sudah diisi awal dari absensi harian wali kelas. Sesuaikan jika perlu.</div>' : ''}
                ${countsHtml()}
                ${editable ? '<div class="att-row" style="margin:12px 0 4px"><button type="button" class="att-btn att-btn-ghost att-btn-sm" data-all="H">Tandai semua Hadir</button><span class="att-muted">Ketuk status tiap siswa. Ketuk lagi untuk mengosongkan.</span></div>' : ''}
                <div class="att-alert err att-hidden" id="attMissing" role="alert" style="margin:8px 0"></div>
                <ul class="att-list">${students.map(itemHtml).join('')}</ul>
                ${editable ? `<div class="att-savebar att-noprint">
                    <button type="button" class="att-btn att-btn-primary" id="attSave">${sheet.session ? 'Simpan perubahan' : 'Simpan absensi'}</button>
                </div>` : ''}`;
        }

        function saveDraft() {
            if (!opts.draftKey || !editable) return;
            draftSet(opts.draftKey, { ts: Date.now(), entries: students.map((s) => ({ student_id: s.student_id, status: s.status, note: s.catatan })) });
        }

        /** Kotak daftar siswa yang belum diabsen (muncul setelah menekan Simpan). */
        function updateMissing() {
            const box = container.querySelector('#attMissing');
            if (!box || !showMissing) return;
            const empty = students.filter((s) => !s.status);
            if (!empty.length) {
                box.className = 'att-alert ok';
                box.textContent = 'Semua siswa sudah diabsen. Tekan Simpan lagi.';
                return;
            }
            box.className = 'att-alert err';
            box.innerHTML = `<b>${empty.length} siswa belum diabsen.</b> Pilih status untuk:
                <ul style="margin:6px 0 0;padding-left:18px">${empty.map((s) => `<li>${esc(s.no)}. ${esc(s.nama)}</li>`).join('')}</ul>`;
        }

        function updateCounts() {
            const el = container.querySelector('#attCounts');
            if (el) el.outerHTML = countsHtml();
        }

        container.onclick = async (e) => {
            const st = e.target.closest('[data-st]');
            if (st && editable) {
                const i = Number(st.dataset.i);
                // Ketuk status yang sudah terpilih = kosongkan lagi.
                students[i].status = students[i].status === st.dataset.st ? null : st.dataset.st;
                st.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.st === students[i].status)));
                st.closest('.att-item')?.classList.toggle('att-missing', showMissing && !students[i].status);
                updateCounts();
                updateMissing();
                saveDraft();
                return;
            }
            const nb = e.target.closest('[data-note]');
            if (nb) {
                openNotes.add(students[Number(nb.dataset.note)].student_id);
                render();
                container.querySelector(`[data-note-input="${nb.dataset.note}"]`)?.focus();
                return;
            }
            if (e.target.closest('[data-all]')) {
                const changed = students.filter((s) => s.status && s.status !== 'H').length;
                const ok = !changed || await confirmSheet({
                    title: 'Tandai semua Hadir?',
                    html: `<p class="att-muted">${changed} siswa yang sudah ditandai Sakit, Izin, Alpa, atau Dispensasi akan diubah menjadi Hadir.</p>`,
                    confirmText: 'Ya, semua Hadir',
                });
                if (!ok) return;
                for (const s of students) s.status = 'H';
                render();
                saveDraft();
                return;
            }
            if (e.target.closest('#attSave')) await doSave(e.target.closest('#attSave'));
        };

        container.oninput = (e) => {
            const ni = e.target.closest('[data-note-input]');
            if (ni) { students[Number(ni.dataset.noteInput)].catatan = ni.value; saveDraft(); }
        };

        async function doSave(btn) {
            const empty = students.filter((s) => !s.status);
            if (empty.length) {
                showMissing = true;
                render();
                updateMissing();
                const first = container.querySelector('.att-missing');
                if (first) {
                    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    first.querySelector('[data-st]')?.focus({ preventScroll: true });
                }
                return;
            }
            const absent = students.filter((s) => s.status !== 'H');
            const c = counts();
            const list = absent.length
                ? `<ul style="margin:10px 0 0;padding-left:18px">${absent.map((s) => `<li>${esc(s.nama)} — <b>${STATUS[s.status]}</b>${s.catatan ? ` <span class="att-muted">(${esc(s.catatan)})</span>` : ''}</li>`).join('')}</ul>`
                : '<p class="att-muted" style="margin-top:8px">Semua siswa hadir.</p>';
            const summary = `<p style="margin:0">${ORDER.filter((k) => c[k]).map((k) => `${c[k]} ${STATUS[k].toLowerCase()}`).join(', ')}</p>${list}`;
            const result = await confirmSheet({
                title: `Simpan absensi ${sheet.kelas ? `kelas ${sheet.kelas}` : ''}?`,
                html: summary,
                confirmText: 'Simpan',
                cancelText: 'Periksa lagi',
                input: opts.reasonRequired ? { label: 'Alasan koreksi (wajib)', required: true, placeholder: 'Mis. surat sakit menyusul' } : null,
            });
            if (result === false || result === null) return;
            const reason = typeof result === 'string' ? result : null;
            btn.disabled = true;
            btn.textContent = 'Menyimpan…';
            saveDraft();
            try {
                await opts.onSave(students.map((s) => ({ student_id: s.student_id, status: s.status, note: s.catatan || null })), reason);
                if (opts.draftKey) draftDel(opts.draftKey);
                toast('Absensi tersimpan.');
            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'Coba kirim lagi';
                toast(`${errMessage(err)} Isian tetap tersimpan di HP ini.`, 'err');
            }
        }

        render();
        return { students, rerender: render };
    }

    // ------------------------------------------------------------------ tabel standar
    /**
     * new Att.DataTable(host, { columns, rows, searchKeys, storageKey, emptyText, rowKey })
     * columns: [{ key, label, sort?: true, render?: (row) => html, className? }]
     */
    class DataTable {
        constructor(host, cfg) {
            this.host = host;
            this.cfg = cfg;
            this.rows = cfg.rows || [];
            this.q = '';
            this.page = 1;
            this.sortKey = cfg.defaultSort || null;
            this.sortDir = 1;
            let size = 10;
            try { size = Number(localStorage.getItem(`att-size:${cfg.storageKey}`)) || 10; } catch { /* abaikan */ }
            this.size = [10, 25, 50, 100].includes(size) ? size : 10;
            this.host.innerHTML = `
                <div class="att-table-tools">
                    <div class="att-field" style="flex:2 1 220px"><label>Cari</label>
                        <input type="search" class="att-input" data-q placeholder="${esc(cfg.searchPlaceholder || 'Cari…')}"></div>
                    <div class="att-field" style="flex:0 1 150px"><label>Tampilkan</label>
                        <select class="att-select" data-size>${[10, 25, 50, 100].map((n) => `<option value="${n}" ${n === this.size ? 'selected' : ''}>${n} data</option>`).join('')}</select></div>
                    ${cfg.toolsHtml || ''}
                </div>
                <div data-body></div>
                <div class="att-pager"><span class="att-muted" data-info></span><div class="att-pager-nav" data-nav></div></div>`;
            this.host.querySelector('[data-q]').addEventListener('input', (e) => { this.q = e.target.value.trim().toLowerCase(); this.page = 1; this.draw(); });
            this.host.querySelector('[data-size]').addEventListener('change', (e) => {
                this.size = Number(e.target.value); this.page = 1;
                try { localStorage.setItem(`att-size:${cfg.storageKey}`, String(this.size)); } catch { /* abaikan */ }
                this.draw();
            });
            this.host.querySelector('[data-nav]').addEventListener('click', (e) => {
                const p = e.target.closest('[data-p]');
                if (p) { this.page = Number(p.dataset.p); this.draw(); }
            });
            this.host.querySelector('[data-body]').addEventListener('click', (e) => {
                const th = e.target.closest('th[data-sort]');
                if (!th) return;
                if (this.sortKey === th.dataset.sort) this.sortDir *= -1; else { this.sortKey = th.dataset.sort; this.sortDir = 1; }
                this.draw();
            });
            this.draw();
        }

        setRows(rows) { this.rows = rows; this.draw(); }

        filtered() {
            const keys = this.cfg.searchKeys || this.cfg.columns.map((c) => c.key);
            let rows = this.rows;
            if (this.q) rows = rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(this.q)));
            if (this.sortKey) {
                const k = this.sortKey;
                rows = [...rows].sort((a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'id', { numeric: true }) * this.sortDir);
            }
            return rows;
        }

        draw() {
            const rows = this.filtered();
            const total = rows.length;
            const pages = Math.max(1, Math.ceil(total / this.size));
            this.page = Math.min(this.page, pages);
            const start = (this.page - 1) * this.size;
            const slice = rows.slice(start, start + this.size);
            const cols = this.cfg.columns;
            this.host.querySelector('[data-body]').innerHTML = total === 0
                ? `<div class="att-alert info">${esc(this.q ? 'Tidak ada data yang cocok dengan pencarian.' : (this.cfg.emptyText || 'Belum ada data.'))}</div>`
                : `<div style="overflow-x:auto"><table class="att-table"><thead><tr>${cols.map((c) =>
                    `<th ${c.sort ? `data-sort="${c.key}"` : ''}>${esc(c.label)}${this.sortKey === c.key ? (this.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
                    <tbody>${slice.map((r) => `<tr>${cols.map((c) =>
                        `<td data-label="${esc(c.label)}" class="${c.className || ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '–')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
            this.host.querySelector('[data-info]').textContent = total
                ? `Menampilkan ${start + 1}–${start + slice.length} dari ${total} data`
                : 'Menampilkan 0 data';
            const nav = [];
            if (pages > 1) {
                nav.push(`<button type="button" data-p="${Math.max(1, this.page - 1)}" aria-label="Sebelumnya" ${this.page === 1 ? 'disabled' : ''}>‹</button>`);
                for (let p = 1; p <= pages; p++) {
                    if (p === 1 || p === pages || Math.abs(p - this.page) <= 1) {
                        nav.push(`<button type="button" data-p="${p}" ${p === this.page ? 'aria-current="page"' : ''}>${p}</button>`);
                    } else if (Math.abs(p - this.page) === 2) {
                        nav.push('<span class="att-muted" style="align-self:center">…</span>');
                    }
                }
                nav.push(`<button type="button" data-p="${Math.min(pages, this.page + 1)}" aria-label="Berikutnya" ${this.page === pages ? 'disabled' : ''}>›</button>`);
            }
            this.host.querySelector('[data-nav]').innerHTML = nav.join('');
        }
    }

    window.Att = Object.freeze({
        STATUS, ORDER, BULAN, esc, fmtDate, romawi, todayJakarta, errMessage,
        toast, confirm: confirmSheet, renderSheet, DataTable, draftDel,
    });
})();
