// Modul Data Siswa untuk dashboard admin: lihat, tambah, ubah, arsip/pulihkan, riwayat.
// - Keamanan sebenarnya ada di RLS + trigger database (migration 20261023000001):
//   hanya admin, tanpa hapus permanen, kolom inti diturunkan dari payload, semua perubahan tercatat.
// - Semua data dirender lewat textContent/DOM API (tanpa innerHTML untuk data siswa).
// - Tidak pernah mencetak biodata ke console; error hanya mencatat kode.
// - Tidak terhubung ke KaliBot / ai-service.js / api/chat.
(function () {
    'use strict';

    const STATUS_LISTED = 'Tercantum di daftar kelas';
    const STATUS_REVIEW = 'Perlu verifikasi lebih lanjut';
    const SCHOOL_YEAR = '2026/2027';
    const LIST_COLUMNS = 'id,nik,nama_siswa,nipd,nisn,kelas,nama_ibu_kandung,status_daftar,archived_at';
    const DETAIL_COLUMNS = 'id,nik,nama_siswa,nipd,nisn,kelas,nama_ibu_kandung,status_daftar,status_dukcapil,payload,field_sources,matching_notes,source_names,archived_at,updated_at';
    const SEARCH_FIELDS = {
        all: ['nama_siswa', 'nik', 'nisn', 'nipd', 'nama_ibu_kandung'],
        nama_siswa: ['nama_siswa'], nik: ['nik'], nisn: ['nisn'], nipd: ['nipd'], nama_ibu_kandung: ['nama_ibu_kandung'],
    };
    // Field sumber yang sudah menjadi kolom inti (tidak diulang di CSV).
    const CORE_SOURCE = {
        nama_siswa: ['nama_siswa', 'Nama Siswa'], nik_siswa: ['nik', 'NIK'], siswa_nipd: ['nipd', 'NIPD'],
        siswa_nisn: ['nisn', 'NISN'], kelas: ['kelas', 'Kelas'], siswa_nama_ibu_kandung: ['nama_ibu_kandung', 'Nama Ibu Kandung'],
        status_daftar: ['status_daftar', 'Status Daftar Kelas'], status_dukcapil: ['status_dukcapil', 'Status Dukcapil'],
    };

    const state = {
        q: '', field: 'all', kelas: '', status: '', archived: false, pageSize: 10, page: 1,
        total: 0, rows: [], loaded: false, reqId: 0, summary: null,
    };
    let debounceTimer = null;

    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    };
    const logError = (where, error) => console.error(`[Data Siswa] ${where} gagal`, error && error.code ? `(kode ${error.code})` : '');

    function isEmpty(v) {
        return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
    }
    const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    function display(v) {
        if (isEmpty(v)) return '—';
        if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
        if (Array.isArray(v)) return v.filter((x) => !isEmpty(x)).map(String).join(', ') || '—';
        if (typeof v === 'object') return Object.values(v).filter((x) => !isEmpty(x)).map(String).join(', ') || '—';
        const s = String(v).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (m && +m[2] >= 1 && +m[2] <= 12) return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
        return s;
    }

    // ------------------------------------------------------------------ query
    function cleanTerm(raw) {
        return String(raw || '').replace(/[,()"\\*%:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    function applyFilters(query) {
        const term = cleanTerm(state.q);
        if (term) {
            const cols = SEARCH_FIELDS[state.field] || SEARCH_FIELDS.all;
            query = query.or(cols.map((c) => `${c}.ilike."*${term}*"`).join(','));
        }
        if (state.kelas) query = query.eq('kelas', state.kelas);
        if (state.status) query = query.eq('status_daftar', state.status);
        query = state.archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
        return query;
    }
    function ordered(query) {
        // Tercantum dulu (urut kelas lalu nama), kemudian siswa perlu verifikasi.
        return query.order('status_daftar', { ascending: false })
            .order('kelas', { ascending: true, nullsFirst: false })
            .order('nama_siswa', { ascending: true });
    }

    async function fetchAll(columns) {
        const out = [];
        for (let from = 0; ; from += 500) {
            const { data, error } = await ordered(applyFilters(supabaseClient.from('student_records').select(columns))).range(from, from + 499);
            if (error) throw error;
            out.push(...data);
            if (data.length < 500) break;
        }
        return out;
    }

    // ------------------------------------------------------------------ summary
    async function loadStudentSummary() {
        const { data, error } = await supabaseClient.rpc('student_summary');
        if (error) { logError('ringkasan', error); return null; }
        const s = Array.isArray(data) ? data[0] : data;
        state.summary = s;
        const set = (id, v) => { const n = $(id); if (n) n.textContent = v ?? 0; };
        for (const prefix of ['stu', 'dashStu']) {
            set(`${prefix}Total`, s.total_siswa);
            set(`${prefix}Listed`, s.tercantum);
            set(`${prefix}Review`, s.perlu_verifikasi);
            set(`${prefix}Rombel`, s.jumlah_rombel);
        }
        const arch = $('stuArchivedCount');
        if (arch) arch.textContent = s.diarsipkan ? ` · ${s.diarsipkan} siswa diarsipkan` : '';
        const sel = $('stuKelas');
        if (sel) {
            while (sel.options.length > 1) sel.remove(1);
            (s.daftar_kelas || []).forEach((k) => { const o = el('option', null, `Kelas ${k}`); o.value = k; sel.appendChild(o); });
            if (state.kelas) sel.value = state.kelas;
        }
        const dl = $('stuKelasList');
        if (dl) {
            dl.replaceChildren();
            (s.daftar_kelas || []).forEach((k) => { const o = el('option'); o.value = k; dl.appendChild(o); });
        }
        return s;
    }

    // ------------------------------------------------------------------ list
    function setTableMessage(text, kind, withRetry) {
        const tbody = $('stuTableBody');
        tbody.replaceChildren();
        const tr = el('tr', 'stu-state-row');
        const td = el('td');
        td.colSpan = 7;
        const box = el('div', `stu-state stu-state-${kind}`);
        box.appendChild(el('span', 'stu-state-text', text));
        if (withRetry) {
            const b = el('button', 'stu-btn stu-btn-ghost', 'Coba lagi');
            b.type = 'button';
            b.addEventListener('click', () => loadStudents());
            box.appendChild(b);
        }
        td.appendChild(box);
        tr.appendChild(td);
        tbody.appendChild(tr);
    }

    function statusBadge(status, archived) {
        if (archived) return el('span', 'stu-badge stu-badge-archived', 'Diarsipkan');
        const review = status !== STATUS_LISTED;
        return el('span', `stu-badge ${review ? 'stu-badge-review' : 'stu-badge-ok'}`, review ? STATUS_REVIEW : 'Tercantum');
    }

    function cell(label, child, cls) {
        const td = el('td', cls);
        td.dataset.label = label;
        if (typeof child === 'string') td.textContent = child; else if (child) td.appendChild(child);
        return td;
    }

    function renderRows() {
        const tbody = $('stuTableBody');
        if (!state.rows.length) {
            setTableMessage(cleanTerm(state.q) || state.kelas || state.status
                ? 'Tidak ada siswa yang cocok dengan pencarian atau filter ini.'
                : (state.archived ? 'Tidak ada siswa yang diarsipkan.' : 'Belum ada data siswa.'), 'empty');
            return;
        }
        tbody.replaceChildren();
        for (const r of state.rows) {
            const tr = el('tr');
            const name = el('div', 'stu-name', display(r.nama_siswa));
            tr.appendChild(cell('Nama siswa', name, 'stu-col-name'));
            const ids = el('div', 'stu-ids');
            ids.appendChild(el('span', null, `NIPD ${display(r.nipd)}`));
            ids.appendChild(el('span', null, `NISN ${display(r.nisn)}`));
            tr.appendChild(cell('NIPD / NISN', ids));
            tr.appendChild(cell('NIK', display(r.nik), 'stu-mono'));
            tr.appendChild(cell('Kelas', isEmpty(r.kelas) ? '—' : r.kelas));
            tr.appendChild(cell('Nama ibu kandung', display(r.nama_ibu_kandung), 'stu-col-ibu'));
            tr.appendChild(cell('Status', statusBadge(r.status_daftar, r.archived_at), 'stu-col-status'));
            const actions = el('div', 'stu-actions');
            const btn = el('button', 'stu-btn stu-btn-view', 'Lihat Detail');
            btn.type = 'button';
            btn.addEventListener('click', () => openDetail(r.id));
            actions.appendChild(btn);
            if (r.archived_at) {
                const rb = el('button', 'stu-btn stu-btn-restore', 'Pulihkan');
                rb.type = 'button';
                rb.addEventListener('click', () => confirmArchive(r, false));
                actions.appendChild(rb);
            } else {
                const eb = el('button', 'stu-btn stu-btn-edit', 'Ubah');
                eb.type = 'button';
                eb.addEventListener('click', () => openForm(r.id));
                actions.appendChild(eb);
            }
            tr.appendChild(cell('Aksi', actions, 'stu-col-action'));
            tbody.appendChild(tr);
        }
    }

    function renderInfo() {
        const info = $('stuInfo');
        if (!state.total) { info.textContent = '0 siswa'; return; }
        const size = state.pageSize === 'all' ? state.total : state.pageSize;
        const from = (state.page - 1) * size + 1;
        const to = Math.min(state.total, state.page * size);
        info.textContent = `Menampilkan ${from}–${to} dari ${state.total} siswa`;
    }

    function renderPagination() {
        const nav = $('stuPagination');
        nav.replaceChildren();
        if (state.pageSize === 'all' || state.total <= state.pageSize) return;
        const pages = Math.ceil(state.total / state.pageSize);
        const btn = (label, page, { active = false, disabled = false, aria } = {}) => {
            const b = el('button', `stu-page${active ? ' active' : ''}`, label);
            b.type = 'button';
            b.disabled = disabled;
            if (aria) b.setAttribute('aria-label', aria);
            if (active) b.setAttribute('aria-current', 'page');
            b.addEventListener('click', () => { state.page = page; loadStudents(); });
            nav.appendChild(b);
        };
        btn('‹', state.page - 1, { disabled: state.page === 1, aria: 'Halaman sebelumnya' });
        const show = new Set([1, pages, state.page - 1, state.page, state.page + 1].filter((p) => p >= 1 && p <= pages));
        let last = 0;
        [...show].sort((a, b) => a - b).forEach((p) => {
            if (p - last > 1) nav.appendChild(el('span', 'stu-page-gap', '…'));
            btn(String(p), p, { active: p === state.page });
            last = p;
        });
        btn('›', state.page + 1, { disabled: state.page === pages, aria: 'Halaman berikutnya' });
    }

    async function loadStudents() {
        const id = ++state.reqId;
        setTableMessage('Memuat data siswa…', 'loading');
        $('stuInfo').textContent = 'Memuat…';
        try {
            let query = ordered(applyFilters(supabaseClient.from('student_records').select(LIST_COLUMNS, { count: 'exact' })));
            let rows, total;
            if (state.pageSize === 'all') {
                rows = [];
                for (let from = 0; ; from += 1000) {
                    const res = await ordered(applyFilters(supabaseClient.from('student_records').select(LIST_COLUMNS, { count: 'exact' }))).range(from, from + 999);
                    if (res.error) throw res.error;
                    rows.push(...res.data);
                    total = res.count;
                    if (res.data.length < 1000) break;
                }
            } else {
                const from = (state.page - 1) * state.pageSize;
                const res = await query.range(from, from + state.pageSize - 1);
                if (res.error) throw res.error;
                rows = res.data; total = res.count;
                if (!rows.length && total > 0 && state.page > 1) { state.page = 1; return loadStudents(); }
            }
            if (id !== state.reqId) return;
            state.rows = rows; state.total = total || 0; state.loaded = true;
            renderRows(); renderInfo(); renderPagination();
        } catch (error) {
            if (id !== state.reqId) return;
            logError('memuat daftar', error);
            state.rows = []; state.total = 0;
            $('stuInfo').textContent = '';
            $('stuPagination').replaceChildren();
            setTableMessage('Data siswa gagal dimuat. Pastikan Anda masuk sebagai admin dan koneksi stabil.', 'error', true);
        }
    }

    function resetAndLoad() { state.page = 1; loadStudents(); }

    // ------------------------------------------------------------------ detail
    let detailReq = 0;
    let current = null;   // siswa yang sedang dibuka di detail
    function closeDetail() {
        current = null;
        const modal = $('stuDetail');
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        $('stuDetailBody').replaceChildren();
        $('stuDetailTabs').replaceChildren();
        document.body.classList.remove('stu-modal-open');
    }

    function renderGroup(groupId, student) {
        const F = window.StudentFields;
        const payload = student.payload || {};
        const sources = student.field_sources || {};
        const keys = F.FIELD_ORDER.filter((k) => F.groupOf(k) === groupId);
        Object.keys(payload).forEach((k) => { if (!F.FIELD_ORDER.includes(k) && F.groupOf(k) === groupId) keys.push(k); });
        const body = $('stuDetailBody');
        body.replaceChildren();
        const grid = el('dl', 'stu-detail-grid');
        let filled = 0;
        for (const k of keys) {
            const v = display(payload[k]);
            if (v !== '—') filled += 1;
            const item = el('div', 'stu-detail-item');
            const dt = el('dt', null, F.labelOf(k));
            const src = sources[k];
            if (!isEmpty(src) && typeof src === 'string') dt.appendChild(el('span', 'stu-src', src));
            item.appendChild(dt);
            item.appendChild(el('dd', v === '—' ? 'stu-empty' : null, v));
            grid.appendChild(item);
        }
        if (groupId === 'lain') {
            const srcItem = el('div', 'stu-detail-item stu-detail-wide');
            srcItem.appendChild(el('dt', null, 'Sumber Data'));
            srcItem.appendChild(el('dd', null, display(student.source_names)));
            grid.appendChild(srcItem);
            const notes = el('div', 'stu-detail-item stu-detail-wide');
            notes.appendChild(el('dt', null, 'Catatan Pencocokan Data'));
            const dd = el('dd');
            const list = Array.isArray(student.matching_notes) ? student.matching_notes.filter((x) => !isEmpty(x)) : [];
            if (list.length) { const ul = el('ul', 'stu-notes'); list.forEach((n) => ul.appendChild(el('li', null, String(n)))); dd.appendChild(ul); }
            else { dd.textContent = '—'; dd.className = 'stu-empty'; }
            notes.appendChild(dd);
            grid.appendChild(notes);
        }
        if (!filled && groupId !== 'lain') body.appendChild(el('p', 'stu-group-empty', 'Belum ada data pada bagian ini.'));
        body.appendChild(grid);
    }

    async function openDetail(id) {
        const modal = $('stuDetail');
        const req = ++detailReq;
        $('stuDetailName').textContent = 'Memuat…';
        $('stuDetailMeta').replaceChildren();
        $('stuDetailBanner').hidden = true;
        $('stuDetailTabs').replaceChildren();
        $('stuDetailActions').replaceChildren();
        $('stuDetailBody').replaceChildren(el('p', 'stu-state-text', 'Memuat detail siswa…'));
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('stu-modal-open');
        $('stuDetailClose').focus();
        const { data, error } = await supabaseClient.from('student_records').select(DETAIL_COLUMNS).eq('id', id).maybeSingle();
        if (req !== detailReq) return;
        if (error || !data) {
            logError('memuat detail', error);
            $('stuDetailName').textContent = 'Detail tidak tersedia';
            $('stuDetailBody').replaceChildren(el('p', 'stu-state-text', 'Detail siswa gagal dimuat. Coba lagi.'));
            return;
        }
        current = data;
        $('stuDetailName').textContent = display(data.nama_siswa);
        const meta = $('stuDetailMeta');
        meta.appendChild(el('span', 'stu-chip', isEmpty(data.kelas) ? 'Kelas —' : `Kelas ${data.kelas}`));
        meta.appendChild(el('span', 'stu-chip', `NISN ${display(data.nisn)}`));
        meta.appendChild(statusBadge(data.status_daftar));
        if (data.archived_at) meta.appendChild(statusBadge(null, true));
        $('stuDetailBanner').hidden = data.status_daftar === STATUS_LISTED;
        $('stuDetailArchived').hidden = !data.archived_at;
        const acts = $('stuDetailActions');
        if (data.archived_at) {
            const rb = el('button', 'stu-btn stu-btn-restore', 'Pulihkan');
            rb.type = 'button';
            rb.addEventListener('click', () => confirmArchive(data, false));
            acts.appendChild(rb);
        } else {
            const eb = el('button', 'stu-btn stu-btn-primary', 'Ubah Data');
            eb.type = 'button';
            eb.addEventListener('click', () => openForm(data.id));
            const ab = el('button', 'stu-btn stu-btn-danger-ghost', 'Arsipkan');
            ab.type = 'button';
            ab.addEventListener('click', () => confirmArchive(data, true));
            acts.append(eb, ab);
        }
        const tabs = $('stuDetailTabs');
        [...window.StudentFields.GROUPS, { id: 'riwayat', title: 'Riwayat Perubahan' }].forEach((g, i) => {
            const t = el('button', `stu-tab${i === 0 ? ' active' : ''}`, g.title);
            t.type = 'button';
            t.setAttribute('role', 'tab');
            t.addEventListener('click', () => {
                tabs.querySelectorAll('.stu-tab').forEach((x) => x.classList.remove('active'));
                t.classList.add('active');
                if (g.id === 'riwayat') renderHistory(data); else renderGroup(g.id, data);
            });
            tabs.appendChild(t);
        });
        renderGroup('siswa', data);
    }

    // ------------------------------------------------------------------ CSV
    function csvCell(v) {
        let s = isEmpty(v) ? '' : (Array.isArray(v) ? v.filter((x) => !isEmpty(x)).join('; ') : (typeof v === 'object' ? Object.values(v).join('; ') : String(v)));
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // cegah CSV formula injection
        return `"${s.replace(/"/g, '""')}"`;
    }
    function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

    async function exportCsv() {
        const btn = $('stuExport');
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Menyiapkan CSV…';
        try {
            const rows = await fetchAll('nik,nama_siswa,nipd,nisn,kelas,nama_ibu_kandung,status_daftar,status_dukcapil,payload,source_names,matching_notes');
            const F = window.StudentFields;
            const extra = new Set();
            rows.forEach((r) => Object.keys(r.payload || {}).forEach((k) => { if (!F.FIELD_ORDER.includes(k)) extra.add(k); }));
            const payloadKeys = [...F.FIELD_ORDER, ...[...extra].sort()].filter((k) => !CORE_SOURCE[k]);
            const groupTitle = Object.fromEntries(F.GROUPS.map((g) => [g.id, g.title]));
            const headers = [
                ...Object.values(CORE_SOURCE).map(([, label]) => label),
                ...payloadKeys.map((k) => { const g = F.groupOf(k); return g === 'siswa' ? F.labelOf(k) : `${groupTitle[g]}: ${F.labelOf(k)}`; }),
                'Sumber Data', 'Catatan Pencocokan Data',
            ];
            const lines = [headers.map(csvCell).join(',')];
            for (const r of rows) {
                const p = r.payload || {};
                lines.push([
                    ...Object.values(CORE_SOURCE).map(([col]) => r[col]),
                    ...payloadKeys.map((k) => p[k]),
                    r.source_names, r.matching_notes,
                ].map(csvCell).join(','));
            }
            const blob = new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
            const parts = ['data-siswa',
                state.kelas ? `kelas-${slug(state.kelas)}` : 'semua-kelas',
                state.status ? slug(state.status === STATUS_LISTED ? 'tercantum' : 'perlu-verifikasi') : 'semua-status'];
            if (state.archived) parts.push('arsip');
            if (cleanTerm(state.q)) parts.push('hasil-pencarian');
            parts.push(new Date().toISOString().slice(0, 10));
            const a = el('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${parts.join('_')}.csv`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            if (typeof showToast === 'function') showToast(`${rows.length} siswa diekspor ke CSV.`, 'success');
        } catch (error) {
            logError('ekspor CSV', error);
            if (typeof showToast === 'function') showToast('Ekspor CSV gagal. Coba lagi.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    }

    // ------------------------------------------------------------------ riwayat
    const ACTION_LABEL = { create: 'Ditambahkan', update: 'Diubah', archive: 'Diarsipkan', restore: 'Dipulihkan' };
    function formatTime(iso) {
        try {
            return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return '—'; }
    }

    async function renderHistory(student) {
        const body = $('stuDetailBody');
        body.replaceChildren(el('p', 'stu-state-text', 'Memuat riwayat…'));
        const { data, error } = await supabaseClient.from('student_record_changes')
            .select('id,action,changed_at,changed_by_email,changes')
            .eq('student_id', student.id).order('changed_at', { ascending: false }).limit(100);
        if (!current || current.id !== student.id) return;
        body.replaceChildren();
        if (error) { logError('memuat riwayat', error); body.appendChild(el('p', 'stu-state-text', 'Riwayat gagal dimuat.')); return; }
        if (!data.length) {
            body.appendChild(el('p', 'stu-group-empty', student.import_batch_id || (student.source_names || []).length
                ? 'Belum ada perubahan dari dashboard sejak data diimpor.'
                : 'Belum ada riwayat perubahan.'));
            return;
        }
        const F = window.StudentFields;
        const list = el('ol', 'stu-history');
        for (const h of data) {
            const li = el('li', 'stu-history-item');
            const head = el('div', 'stu-history-head');
            head.appendChild(el('span', `stu-badge stu-badge-${h.action}`, ACTION_LABEL[h.action] || 'Perubahan'));
            head.appendChild(el('span', 'stu-history-meta', `${formatTime(h.changed_at)} · ${h.changed_by_email || 'Admin'}`));
            li.appendChild(head);
            const changes = h.changes && typeof h.changes === 'object' ? Object.entries(h.changes) : [];
            if (h.action === 'create') {
                li.appendChild(el('p', 'stu-history-note', `${changes.length} field diisi saat siswa ditambahkan.`));
            } else if (changes.length) {
                const tbl = el('table', 'stu-history-table');
                const thead = el('tr');
                ['Field', 'Sebelum', 'Sesudah'].forEach((t) => thead.appendChild(el('th', null, t)));
                tbl.appendChild(thead);
                changes.sort(([a], [b]) => F.FIELD_ORDER.indexOf(a) - F.FIELD_ORDER.indexOf(b)).forEach(([k, v]) => {
                    const tr = el('tr');
                    tr.appendChild(el('td', null, F.labelOf(k)));
                    tr.appendChild(el('td', 'stu-old', display(v && v.lama)));
                    tr.appendChild(el('td', 'stu-new', display(v && v.baru)));
                    tbl.appendChild(tr);
                });
                li.appendChild(tbl);
            }
            list.appendChild(li);
        }
        body.appendChild(list);
    }

    // ------------------------------------------------------------------ form tambah/ubah
    const NIK16 = /(^|_)(nik|nik_wali|nik_siswa|no_kk)$/;
    const REQUIRED = ['nik_siswa', 'nama_siswa', 'status_daftar'];
    let form = null;   // { id, original, updated_at }

    function formGroupOf(k) {
        return k === 'status_daftar' ? 'siswa' : window.StudentFields.groupOf(k);
    }
    function rawString(v) {
        return v === null || v === undefined ? '' : String(v);
    }

    function friendlyError(error) {
        const msg = (error && error.message) || '';
        const code = error && error.code;
        if (code === '23505') return 'NIK tersebut sudah terdaftar pada siswa lain.';
        if (code === '23502') return 'NIK, nama siswa, dan status daftar wajib diisi.';
        if (code === '23514') {
            if (msg.includes('nik_format')) return 'NIK harus tepat 16 digit angka.';
            if (msg.includes('listed_has_kelas')) return 'Kelas wajib diisi untuk siswa yang tercantum di daftar kelas.';
            if (msg.includes('nama_siswa')) return 'Nama siswa wajib diisi.';
            if (msg.includes('status_daftar')) return 'Status daftar tidak valid.';
            return 'Data tidak memenuhi aturan validasi.';
        }
        if (code === '22023' && msg.length < 200) return msg;   // pesan validasi dari trigger (tanpa nilai pribadi)
        if (code === '42501') return 'Anda tidak memiliki izin untuk mengubah data siswa.';
        return 'Perubahan gagal disimpan. Coba lagi.';
    }

    function buildFormInput(k, value) {
        const F = window.StudentFields;
        const wrap = el('div', 'stu-form-item');
        wrap.dataset.key = k;
        const id = `stuF_${k}`;
        const label = el('label', null, F.labelOf(k));
        label.htmlFor = id;
        if (REQUIRED.includes(k)) label.appendChild(el('span', 'stu-req', ' *'));
        let input;
        if (k === 'status_daftar') {
            input = el('select', 'stu-input');
            [STATUS_LISTED, STATUS_REVIEW].forEach((v) => { const o = el('option', null, v); o.value = v; input.appendChild(o); });
            if (value && ![STATUS_LISTED, STATUS_REVIEW].includes(value)) {
                const o = el('option', null, value); o.value = value; input.appendChild(o);
            }
            input.value = value || STATUS_LISTED;
        } else {
            const long = /alamat|catatan|keterangan|alasan/.test(k);
            input = el(long ? 'textarea' : 'input', 'stu-input');
            if (!long) input.type = 'text';
            else input.rows = 2;
            input.value = rawString(value);
            input.maxLength = 1000;
            input.autocomplete = 'off';
            if (k === 'kelas') input.setAttribute('list', 'stuKelasList');
            if (NIK16.test(k) || /nisn|nipd|no_hp|no_telp|no_telepon|kode_pos|(^|_)r[tw]$/.test(k)) input.inputMode = 'numeric';
            if (/tanggal_lahir$/.test(k)) input.placeholder = 'TTTT-BB-HH, mis. 2015-07-21';
        }
        input.id = id;
        input.name = k;
        wrap.append(label, input, el('span', 'stu-field-error'));
        return wrap;
    }

    function showFormTab(groupId) {
        $('stuFormTabs').querySelectorAll('.stu-tab').forEach((t) => t.classList.toggle('active', t.dataset.group === groupId));
        $('stuFormBody').querySelectorAll('.stu-form-group').forEach((g) => { g.hidden = g.dataset.group !== groupId; });
    }

    async function openForm(id) {
        const F = window.StudentFields;
        let original = {};
        let updatedAt = null;
        let name = '';
        if (id) {
            const { data, error } = await supabaseClient.from('student_records')
                .select('id,payload,updated_at,archived_at,nama_siswa').eq('id', id).maybeSingle();
            if (error || !data) { logError('memuat form', error); if (typeof showToast === 'function') showToast('Data siswa gagal dimuat.', 'error'); return; }
            if (data.archived_at) { if (typeof showToast === 'function') showToast('Siswa diarsipkan. Pulihkan dulu sebelum mengubah.', 'error'); return; }
            original = data.payload || {};
            updatedAt = data.updated_at;
            name = data.nama_siswa;
        }
        form = { id, original, updatedAt };
        $('stuFormTitle').textContent = id ? 'Ubah Data Siswa' : 'Tambah Siswa';
        $('stuFormSubtitle').textContent = id ? display(name) : 'Isi minimal NIK, nama, status, dan kelas. Bagian lain bisa dilengkapi nanti.';
        $('stuFormError').hidden = true;
        const tabs = $('stuFormTabs');
        const body = $('stuFormBody');
        tabs.replaceChildren();
        body.replaceChildren();
        const keys = [...F.FIELD_ORDER];
        Object.keys(original).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
        const first = ['nik_siswa', 'nama_siswa', 'status_daftar', 'kelas'];
        F.GROUPS.forEach((g, i) => {
            const t = el('button', `stu-tab${i === 0 ? ' active' : ''}`, g.title);
            t.type = 'button';
            t.dataset.group = g.id;
            t.addEventListener('click', () => showFormTab(g.id));
            tabs.appendChild(t);
            const section = el('div', 'stu-form-group');
            section.dataset.group = g.id;
            section.hidden = i !== 0;
            const grid = el('div', 'stu-form-grid');
            let groupKeys = keys.filter((k) => formGroupOf(k) === g.id);
            if (g.id === 'siswa') groupKeys = [...first, ...groupKeys.filter((k) => !first.includes(k))];
            groupKeys.forEach((k) => grid.appendChild(buildFormInput(k, original[k])));
            section.appendChild(grid);
            body.appendChild(section);
        });
        const modal = $('stuForm');
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('stu-modal-open');
        $('stuF_nik_siswa').focus();
    }

    function closeForm(force) {
        const modal = $('stuForm');
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        $('stuFormBody').replaceChildren();
        $('stuFormTabs').replaceChildren();
        form = null;
        if (force || !$('stuDetail').classList.contains('active')) document.body.classList.remove('stu-modal-open');
    }

    function collectPayload() {
        const original = form.original;
        const payload = { ...original };
        const changed = [];
        $('stuFormBody').querySelectorAll('.stu-input').forEach((input) => {
            const k = input.name;
            const v = input.value.trim();
            const orig = original[k];
            if (v === rawString(orig).trim()) return;          // tidak berubah: nilai asli dipertahankan apa adanya
            changed.push(k);
            if (v === '') { delete payload[k]; return; }       // dikosongkan: key dihapus (sama seperti data sparse)
            if (typeof orig === 'number' && /^-?\d+(\.\d+)?$/.test(v)) payload[k] = Number(v);
            else if (typeof orig === 'boolean' && /^(true|false)$/.test(v)) payload[k] = v === 'true';
            else payload[k] = v;
        });
        return { payload, changed };
    }

    function validateForm(payload, changed) {
        const errors = {};
        const isNew = !form.id;
        const check = (k) => isNew || changed.includes(k);
        if (!/^\d{16}$/.test(rawString(payload.nik_siswa))) errors.nik_siswa = 'NIK wajib 16 digit angka.';
        if (!rawString(payload.nama_siswa).trim()) errors.nama_siswa = 'Nama siswa wajib diisi.';
        if (!payload.status_daftar) errors.status_daftar = 'Status daftar wajib dipilih.';
        if (payload.status_daftar === STATUS_LISTED && !rawString(payload.kelas).trim()) errors.kelas = 'Kelas wajib diisi untuk siswa yang tercantum di daftar kelas.';
        for (const [k, v] of Object.entries(payload)) {
            if (!check(k) || k === 'nik_siswa' || isEmpty(v)) continue;
            const s = rawString(v);
            if (NIK16.test(k) && !/^\d{16}$/.test(s)) errors[k] = 'Harus 16 digit angka.';
            else if (k === 'siswa_nisn' && !/^\d{10}$/.test(s)) errors[k] = 'NISN harus 10 digit angka.';
            else if (/tanggal_lahir$/.test(k) && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[k] = 'Gunakan format TTTT-BB-HH.';
        }
        return errors;
    }

    async function saveForm() {
        if (!form) return;
        const btn = $('stuFormSave');
        const errBox = $('stuFormError');
        errBox.hidden = true;
        $('stuFormBody').querySelectorAll('.stu-form-item').forEach((w) => { w.classList.remove('invalid'); w.querySelector('.stu-field-error').textContent = ''; });
        const { payload, changed } = collectPayload();
        if (form.id && !changed.length) { if (typeof showToast === 'function') showToast('Tidak ada perubahan.', 'success'); closeForm(); return; }
        const errors = validateForm(payload, changed);
        const keys = Object.keys(errors);
        if (keys.length) {
            keys.forEach((k) => {
                const w = $('stuFormBody').querySelector(`.stu-form-item[data-key="${k}"]`);
                if (w) { w.classList.add('invalid'); w.querySelector('.stu-field-error').textContent = errors[k]; }
            });
            showFormTab(formGroupOf(keys[0]));
            const first = $(`stuF_${keys[0]}`);
            if (first) first.focus();
            errBox.textContent = `Periksa ${keys.length} isian yang ditandai merah.`;
            errBox.hidden = false;
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Menyimpan…';
        try {
            let res;
            if (form.id) {
                res = await supabaseClient.from('student_records').update({ payload })
                    .eq('id', form.id).eq('updated_at', form.updatedAt).is('archived_at', null).select('id');
                if (!res.error && (!res.data || !res.data.length)) {
                    errBox.textContent = 'Data siswa ini baru saja diubah oleh admin lain atau sudah diarsipkan. Tutup form, buka ulang, lalu ulangi perubahan.';
                    errBox.hidden = false;
                    return;
                }
            } else {
                res = await supabaseClient.from('student_records').insert({ payload }).select('id');
            }
            if (res.error) {
                logError('menyimpan', res.error);
                errBox.textContent = friendlyError(res.error);
                errBox.hidden = false;
                if (res.error.code === '23505' || /nik/.test(res.error.message || '')) showFormTab('siswa');
                return;
            }
            const savedId = form.id || (res.data && res.data[0] && res.data[0].id);
            const wasNew = !form.id;
            closeForm();
            if (typeof showToast === 'function') showToast(wasNew ? 'Siswa baru berhasil ditambahkan.' : 'Perubahan data siswa tersimpan.', 'success');
            await refreshAfterWrite(savedId);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan';
        }
    }

    // ------------------------------------------------------------------ arsip/pulihkan
    function closeConfirm() {
        const m = $('stuConfirm');
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
        $('stuConfirmYes').onclick = null;
    }

    function confirmArchive(student, archive) {
        const m = $('stuConfirm');
        $('stuConfirmTitle').textContent = archive ? 'Arsipkan siswa?' : 'Pulihkan siswa?';
        $('stuConfirmText').textContent = archive
            ? `${display(student.nama_siswa)} akan disembunyikan dari daftar siswa aktif dan ringkasan. Data tidak dihapus dan bisa dipulihkan dari filter "Arsip".`
            : `${display(student.nama_siswa)} akan kembali tampil di daftar siswa aktif.`;
        const yes = $('stuConfirmYes');
        yes.textContent = archive ? 'Ya, Arsipkan' : 'Ya, Pulihkan';
        yes.className = archive ? 'stu-btn stu-btn-danger' : 'stu-btn stu-btn-primary';
        yes.disabled = false;
        yes.onclick = async () => {
            yes.disabled = true;
            let q = supabaseClient.from('student_records').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', student.id);
            q = archive ? q.is('archived_at', null) : q.not('archived_at', 'is', null);
            const { data, error } = await q.select('id');
            closeConfirm();
            if (error || !data || !data.length) {
                if (error) logError(archive ? 'mengarsipkan' : 'memulihkan', error);
                if (typeof showToast === 'function') showToast(error ? friendlyError(error) : 'Status siswa sudah berubah. Muat ulang daftar.', 'error');
                await refreshAfterWrite(null);
                return;
            }
            if (typeof showToast === 'function') showToast(archive ? 'Siswa diarsipkan.' : 'Siswa dipulihkan.', 'success');
            await refreshAfterWrite(student.id);
        };
        m.classList.add('active');
        m.setAttribute('aria-hidden', 'false');
        $('stuConfirmNo').focus();
    }

    async function refreshAfterWrite(id) {
        await loadStudentSummary();
        await loadStudents();
        if (id && $('stuDetail').classList.contains('active')) await openDetail(id);
    }

    // ------------------------------------------------------------------ init
    function resetStudents() {
        Object.assign(state, { q: '', field: 'all', kelas: '', status: '', archived: false, pageSize: 10, page: 1, total: 0, rows: [], loaded: false, summary: null });
        state.reqId += 1;
        const tbody = $('stuTableBody');
        if (tbody) tbody.replaceChildren();
        const modal = $('stuDetail');
        if (modal) closeDetail();
        if ($('stuForm')) closeForm(true);
    }

    function bind() {
        const search = $('stuSearch');
        if (!search || search.dataset.bound) return;
        search.dataset.bound = '1';
        search.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => { state.q = search.value; resetAndLoad(); }, 300);
        });
        $('stuSearchField').addEventListener('change', (e) => { state.field = e.target.value; if (cleanTerm(state.q)) resetAndLoad(); });
        $('stuKelas').addEventListener('change', (e) => { state.kelas = e.target.value; resetAndLoad(); });
        $('stuStatus').addEventListener('change', (e) => { state.status = e.target.value; resetAndLoad(); });
        $('stuArchive').addEventListener('change', (e) => { state.archived = e.target.value === 'archived'; resetAndLoad(); });
        $('stuAdd').addEventListener('click', () => openForm(null));
        $('stuFormClose').addEventListener('click', () => closeForm());
        $('stuFormCancel').addEventListener('click', () => closeForm());
        $('stuFormSave').addEventListener('click', saveForm);
        $('stuForm').addEventListener('click', (e) => { if (e.target.id === 'stuForm') closeForm(); });
        $('stuConfirmNo').addEventListener('click', () => closeConfirm());
        $('stuPageSize').addEventListener('change', (e) => { state.pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value); resetAndLoad(); });
        $('stuReset').addEventListener('click', () => {
            search.value = ''; $('stuSearchField').value = 'all'; $('stuKelas').value = ''; $('stuStatus').value = '';
            $('stuArchive').value = 'active';
            Object.assign(state, { q: '', field: 'all', kelas: '', status: '', archived: false });
            resetAndLoad();
        });
        $('stuExport').addEventListener('click', exportCsv);
        $('stuDetailClose').addEventListener('click', closeDetail);
        $('stuDetail').addEventListener('click', (e) => { if (e.target.id === 'stuDetail') closeDetail(); });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if ($('stuConfirm').classList.contains('active')) closeConfirm();
            else if ($('stuForm').classList.contains('active')) closeForm();
            else if ($('stuDetail').classList.contains('active')) closeDetail();
        });
        const year = $('stuSchoolYear');
        if (year) year.textContent = SCHOOL_YEAR;
    }

    async function loadStudentsModule() {
        bind();
        if (!state.summary) await loadStudentSummary();
        if (!state.loaded) await loadStudents();
    }

    document.addEventListener('DOMContentLoaded', () => {
        bind();
        if (window.supabaseClient) {
            supabaseClient.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') resetStudents(); });
        }
    });

    window.loadStudentsModule = loadStudentsModule;
    window.loadStudentSummary = loadStudentSummary;
})();
