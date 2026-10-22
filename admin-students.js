// Modul Data Siswa (read-only) untuk dashboard admin.
// - Hanya membaca student_records / student_summary(); keamanan sebenarnya ada di RLS.
// - Semua data dirender lewat textContent/DOM API (tanpa innerHTML untuk data siswa).
// - Tidak pernah mencetak biodata ke console; error hanya mencatat kode.
// - Tidak terhubung ke KaliBot / ai-service.js / api/chat.
(function () {
    'use strict';

    const STATUS_LISTED = 'Tercantum di daftar kelas';
    const STATUS_REVIEW = 'Perlu verifikasi lebih lanjut';
    const SCHOOL_YEAR = '2026/2027';
    const LIST_COLUMNS = 'id,nik,nama_siswa,nipd,nisn,kelas,nama_ibu_kandung,status_daftar';
    const DETAIL_COLUMNS = 'id,nik,nama_siswa,nipd,nisn,kelas,nama_ibu_kandung,status_daftar,status_dukcapil,payload,field_sources,matching_notes,source_names';
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
        q: '', field: 'all', kelas: '', status: '', pageSize: 10, page: 1,
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
        const sel = $('stuKelas');
        if (sel && sel.options.length <= 1) {
            (s.daftar_kelas || []).forEach((k) => { const o = el('option', null, `Kelas ${k}`); o.value = k; sel.appendChild(o); });
            if (state.kelas) sel.value = state.kelas;
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

    function statusBadge(status) {
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
                : 'Belum ada data siswa.', 'empty');
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
            tr.appendChild(cell('Status', statusBadge(r.status_daftar), 'stu-col-status'));
            const btn = el('button', 'stu-btn stu-btn-view', 'Lihat Detail');
            btn.type = 'button';
            btn.addEventListener('click', () => openDetail(r.id));
            tr.appendChild(cell('Aksi', btn, 'stu-col-action'));
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
    function closeDetail() {
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
        $('stuDetailName').textContent = display(data.nama_siswa);
        const meta = $('stuDetailMeta');
        meta.appendChild(el('span', 'stu-chip', isEmpty(data.kelas) ? 'Kelas —' : `Kelas ${data.kelas}`));
        meta.appendChild(el('span', 'stu-chip', `NISN ${display(data.nisn)}`));
        meta.appendChild(statusBadge(data.status_daftar));
        $('stuDetailBanner').hidden = data.status_daftar === STATUS_LISTED;
        const tabs = $('stuDetailTabs');
        window.StudentFields.GROUPS.forEach((g, i) => {
            const t = el('button', `stu-tab${i === 0 ? ' active' : ''}`, g.title);
            t.type = 'button';
            t.setAttribute('role', 'tab');
            t.addEventListener('click', () => {
                tabs.querySelectorAll('.stu-tab').forEach((x) => x.classList.remove('active'));
                t.classList.add('active');
                renderGroup(g.id, data);
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

    // ------------------------------------------------------------------ init
    function resetStudents() {
        Object.assign(state, { q: '', field: 'all', kelas: '', status: '', pageSize: 10, page: 1, total: 0, rows: [], loaded: false, summary: null });
        state.reqId += 1;
        const tbody = $('stuTableBody');
        if (tbody) tbody.replaceChildren();
        const modal = $('stuDetail');
        if (modal) closeDetail();
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
        $('stuPageSize').addEventListener('change', (e) => { state.pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value); resetAndLoad(); });
        $('stuReset').addEventListener('click', () => {
            search.value = ''; $('stuSearchField').value = 'all'; $('stuKelas').value = ''; $('stuStatus').value = '';
            Object.assign(state, { q: '', field: 'all', kelas: '', status: '' });
            resetAndLoad();
        });
        $('stuExport').addEventListener('click', exportCsv);
        $('stuDetailClose').addEventListener('click', closeDetail);
        $('stuDetail').addEventListener('click', (e) => { if (e.target.id === 'stuDetail') closeDetail(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('stuDetail').classList.contains('active')) closeDetail(); });
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
