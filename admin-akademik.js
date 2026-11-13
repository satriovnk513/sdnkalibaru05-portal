// =============================================================================
// Panel Admin — menu Akademik & Kelas:
//   Data Kelas, Wali Kelas, Mata Pelajaran, Tahun Ajaran, Hari Libur.
// Tulis ke tabel lewat RLS admin; operasi multi-baris lewat RPC atomik
// (set_homeroom, set_subject_assignments, set_active_academic_year, sync_holidays).
// Semua teks dari database di-escape sebelum masuk HTML.
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const { esc, fmtDate, todayJakarta, errMessage, toast, BULAN } = window.Att;
    const $ = (id) => document.getElementById(id);
    const KIND = { nasional: 'Libur Nasional', cuti_bersama: 'Cuti Bersama', sekolah: 'Libur Sekolah' };
    const KIND_BADGE = { nasional: 'bad', cuti_bersama: 'warn', sekolah: 'info' };

    const state = { staff: [], years: [], classes: [], subjects: [], homeroom: [], assign: [], counts: new Map(), holidays: [] };
    const tables = {};
    const loaded = {};

    // ------------------------------------------------------------------ util
    function friendly(err) {
        const msg = err?.message || String(err || '');
        if (err?.code === '23503' || /foreign key/i.test(msg)) return 'Data ini masih dipakai (siswa, absensi, atau penugasan), jadi tidak bisa dihapus.';
        if (err?.code === '23505' || /duplicate key|unique/i.test(msg)) return 'Data yang sama sudah ada.';
        return errMessage(err);
    }

    async function q(promise) {
        const { data, error, count } = await promise;
        if (error) throw error;
        return count ?? data;
    }

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }

    const activeYear = () => state.years.find((y) => y.is_active) || null;
    const staffName = (id) => state.staff.find((s) => s.id === id)?.name || '–';
    const staffNip = (id) => String(state.staff.find((s) => s.id === id)?.nip || '').replace(/^NIP\.?\s*/i, '');
    const activeClasses = () => state.classes.filter((c) => c.academic_year_id === activeYear()?.id)
        .sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section));

    /** "Kelas 1, Kelas 2, 3 A" — satu tingkat penuh diringkas. */
    function classSummary(ids) {
        const all = activeClasses();
        const set = new Set(ids);
        const parts = [];
        for (const g of [1, 2, 3, 4, 5, 6]) {
            const inGrade = all.filter((c) => c.grade === g);
            const picked = inGrade.filter((c) => set.has(c.id));
            if (!picked.length) continue;
            if (picked.length === inGrade.length) parts.push(`Kelas ${g}`);
            else parts.push(...picked.map((c) => c.name));
        }
        return parts.join(', ') || '–';
    }

    async function loadBase() {
        const [staff, years, classes, subjects, homeroom, assign, enr] = await Promise.all([
            q(sb.from('staff').select('id,name,role,nip').order('name')),
            q(sb.from('academic_years').select('id,name,start_date,end_date,is_active').order('start_date', { ascending: false })),
            q(sb.from('classes').select('id,name,grade,section,academic_year_id').order('grade').order('section')),
            q(sb.from('subjects').select('id,code,name').order('code')),
            q(sb.from('homeroom_assignments').select('class_id,staff_id,position')),
            q(sb.from('subject_assignments').select('subject_id,class_id,staff_id')),
            q(sb.from('student_enrollments').select('class_id').is('end_date', null)),
        ]);
        Object.assign(state, { staff, years, classes, subjects, homeroom, assign });
        state.counts = new Map();
        for (const e of enr) state.counts.set(e.class_id, (state.counts.get(e.class_id) || 0) + 1);
    }

    // ------------------------------------------------------------------ form sheet
    /**
     * fields: [{ id, label, type: text|date|select|checks|month, value, options:[{value,label}], required, hint, placeholder }]
     * validate(values) → pesan error atau ''
     */
    function formSheet({ title, fields, submitText = 'Simpan', validate, onChange }) {
        return new Promise((resolve) => {
            const back = document.createElement('div');
            back.className = 'att-sheet-backdrop';
            const fieldHtml = (f) => {
                const req = f.required ? ' <span style="color:var(--att-a)">*</span>' : '';
                if (f.type === 'select') {
                    return `<div class="att-field"><label for="fs_${f.id}">${esc(f.label)}${req}</label>
                        <select class="att-select" id="fs_${f.id}">${(f.options || []).map((o) =>
                            `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
                        ${f.hint ? `<span class="att-muted" style="font-size:.78rem">${esc(f.hint)}</span>` : ''}</div>`;
                }
                if (f.type === 'checks') {
                    const val = new Set(f.value || []);
                    return `<fieldset class="att-field" style="border:none;padding:0;margin:0"><legend style="font-size:.82rem;font-weight:600;color:#334155;margin-bottom:6px">${esc(f.label)}${req}</legend>
                        <div class="ak-checks" id="fs_${f.id}">${(f.options || []).map((o) =>
                            `<label class="ak-check"><input type="checkbox" value="${esc(o.value)}" ${val.has(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div></fieldset>`;
                }
                return `<div class="att-field"><label for="fs_${f.id}">${esc(f.label)}${req}</label>
                    <input class="att-input" id="fs_${f.id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.max ? `maxlength="${f.max}"` : ''}>
                    ${f.hint ? `<span class="att-muted" style="font-size:.78rem">${esc(f.hint)}</span>` : ''}</div>`;
            };
            back.innerHTML = `<form class="att-sheet" role="dialog" aria-modal="true" aria-labelledby="fsTitle" novalidate style="max-width:560px">
                <h3 id="fsTitle">${esc(title)}</h3>
                <div class="att-stack" style="margin-top:12px">${fields.map(fieldHtml).join('')}</div>
                <div class="att-alert err att-hidden" id="fsErr" role="alert" style="margin-top:12px"></div>
                <div class="att-row" style="margin-top:16px">
                    <button type="button" class="att-btn att-btn-ghost" data-act="no" style="flex:1">Batal</button>
                    <button type="submit" class="att-btn att-btn-primary" style="flex:1">${esc(submitText)}</button>
                </div></form>`;
            const read = () => Object.fromEntries(fields.map((f) => {
                const el = back.querySelector(`#fs_${f.id}`);
                if (f.type === 'checks') return [f.id, [...el.querySelectorAll('input:checked')].map((i) => i.value)];
                return [f.id, el.value.trim()];
            }));
            const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
            const onKey = (e) => { if (e.key === 'Escape') done(null); };
            back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-act="no"]')) done(null); });
            if (onChange) back.addEventListener('change', (e) => onChange(e, back));
            back.querySelector('form').addEventListener('submit', (e) => {
                e.preventDefault();
                const v = read();
                const missing = fields.find((f) => f.required && (f.type === 'checks' ? !v[f.id].length : !v[f.id]));
                const msg = missing ? `${missing.label} wajib diisi.` : (validate ? validate(v) : '');
                if (msg) {
                    const box = back.querySelector('#fsErr');
                    box.textContent = msg;
                    box.classList.remove('att-hidden');
                    return;
                }
                done(v);
            });
            document.addEventListener('keydown', onKey);
            document.body.appendChild(back);
            back.querySelector('input,select')?.focus();
        });
    }

    function makeTable(key, host, cfg) {
        if (tables[key] && tables[key].host === host && host.querySelector('[data-body]')) { tables[key].setRows(cfg.rows); return tables[key]; }
        tables[key] = new window.Att.DataTable(host, { storageKey: `admin-${key}`, ...cfg });
        return tables[key];
    }

    // ======================================================== HARI LIBUR
    let calMonth = todayJakarta().slice(0, 7);

    async function loadHolidays() {
        state.holidays = await q(sb.from('school_holidays').select('holiday_date,name,kind,source').order('holiday_date'));
    }

    function renderCalendar() {
        const [y, m] = calMonth.split('-').map(Number);
        const first = new Date(Date.UTC(y, m - 1, 1));
        const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const lead = (first.getUTCDay() + 6) % 7;
        const today = todayJakarta();
        const byDate = new Map(state.holidays.map((h) => [h.holiday_date, h]));
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push('<div class="ak-cal-cell ak-empty" aria-hidden="true"></div>');
        for (let d = 1; d <= days; d++) {
            const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
            const h = byDate.get(iso);
            const weekend = dow === 0 || dow === 6;
            const cls = ['ak-cal-cell', h ? 'ak-holiday' : '', weekend ? 'ak-weekend' : '', iso === today ? 'ak-today' : ''].filter(Boolean).join(' ');
            const label = h ? h.name : (weekend ? (dow === 6 ? 'Sabtu' : 'Minggu') : '');
            cells.push(`<button type="button" class="${cls}" data-date="${iso}" aria-label="${esc(fmtDate(iso))}${label ? `, ${esc(label)}` : ''}">
                <span class="ak-cal-num">${d}</span>${label ? `<span class="ak-cal-label">${esc(label)}</span>` : ''}</button>`);
        }
        $('akCal').innerHTML = `
            <div class="ak-cal-head">
                <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-cal="-1" aria-label="Bulan sebelumnya">‹</button>
                <b>${esc(BULAN[m - 1])} ${y}</b>
                <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-cal="1" aria-label="Bulan berikutnya">›</button>
            </div>
            <div class="ak-cal-grid">${['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'].map((d, i) => `<div class="ak-cal-dow ${i > 4 ? 'ak-red' : ''}">${d}</div>`).join('')}${cells.join('')}</div>
            <div class="ak-legend"><span><i class="ak-dot ak-today"></i>Hari ini</span><span><i class="ak-dot ak-weekend"></i>Libur mingguan</span><span><i class="ak-dot ak-holiday"></i>Hari libur</span><span><i class="ak-dot"></i>Hari aktif</span></div>`;
    }

    function renderHolidayList() {
        $('akHolCount').textContent = state.holidays.length;
        const today = todayJakarta();
        makeTable('libur', $('akHolTable'), {
            rows: state.holidays.map((h) => ({ ...h, tanggal: h.holiday_date, jenis: KIND[h.kind] || h.kind, lewat: h.holiday_date < today })),
            defaultSort: 'tanggal',
            searchKeys: ['name', 'jenis', 'tanggal', 'source'],
            searchPlaceholder: 'Cari nama libur atau tanggal (2027-03)',
            emptyText: 'Belum ada hari libur. Klik Sinkron Libur Nasional.',
            columns: [
                { key: 'tanggal', label: 'Tanggal', sort: true, render: (r) => `<span style="${r.lewat ? 'color:var(--att-muted)' : ''}">${esc(fmtDate(r.tanggal))}</span>` },
                { key: 'name', label: 'Keterangan', sort: true, render: (r) => `<b>${esc(r.name)}</b>${r.source ? `<br><span class="att-muted" style="font-size:.76rem">${esc(r.source)}</span>` : ''}` },
                { key: 'jenis', label: 'Jenis', sort: true, render: (r) => `<span class="att-badge ${KIND_BADGE[r.kind] || 'mute'}">${esc(r.jenis)}</span>` },
                { key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-hol-edit="${esc(r.tanggal)}">Edit</button>
                    <button type="button" class="att-btn att-btn-danger att-btn-sm" data-hol-del="${esc(r.tanggal)}">Hapus</button>` },
            ],
        });
    }

    async function refreshHolidays() {
        await loadHolidays();
        renderCalendar();
        renderHolidayList();
    }

    function* dateRange(from, to) {
        for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
            yield d.toISOString().slice(0, 10);
        }
    }

    async function sessionsOn(dates) {
        if (!dates.length) return 0;
        return q(sb.from('attendance_sessions').select('id', { count: 'exact', head: true }).in('session_date', dates).is('archived_at', null));
    }

    async function holidayForm(existing, presetDate) {
        const kindOpts = Object.entries(KIND).map(([value, label]) => ({ value, label }));
        const v = await formSheet({
            title: existing ? 'Ubah hari libur' : 'Tambah hari libur',
            fields: [
                { id: 'dari', label: existing ? 'Tanggal' : 'Tanggal mulai', type: 'date', value: existing?.holiday_date || presetDate || todayJakarta(), required: true },
                ...(existing ? [] : [{ id: 'sampai', label: 'Sampai tanggal (opsional)', type: 'date', value: '', hint: 'Isi untuk libur lebih dari sehari. Sabtu dan Minggu dilewati.' }]),
                { id: 'name', label: 'Keterangan', value: existing?.name || '', required: true, max: 120, placeholder: 'Mis. Libur awal Ramadan' },
                { id: 'kind', label: 'Jenis', type: 'select', options: kindOpts, value: existing?.kind || 'sekolah' },
            ],
            validate: (x) => (x.sampai && x.sampai < x.dari ? 'Tanggal selesai tidak boleh sebelum tanggal mulai.' : ''),
        });
        if (!v) return;
        try {
            let dates = existing ? [v.dari] : [...dateRange(v.dari, v.sampai || v.dari)];
            if (!existing && v.sampai) dates = dates.filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
            if (dates.length > 120) { toast('Rentang terlalu panjang (maks. 120 hari).', 'err'); return; }
            const newDates = existing ? dates.filter((d) => d !== existing.holiday_date) : dates;
            const n = await sessionsOn(newDates);
            if (n && !await window.Att.confirm({
                title: 'Sudah ada absensi di tanggal ini',
                html: `<p class="att-muted">${n} absensi sudah tersimpan di tanggal yang akan dijadikan libur. Absensinya tidak dihapus, tetapi tanggal itu tidak lagi dihitung sebagai hari sekolah.</p>`,
                confirmText: 'Tetap simpan',
            })) return;
            if (existing) {
                if (v.dari !== existing.holiday_date) {
                    await q(sb.from('school_holidays').insert({ holiday_date: v.dari, name: v.name, kind: v.kind, source: 'Admin sekolah' }));
                    await q(sb.from('school_holidays').delete().eq('holiday_date', existing.holiday_date));
                } else {
                    await q(sb.from('school_holidays').update({ name: v.name, kind: v.kind }).eq('holiday_date', existing.holiday_date));
                }
                toast('Hari libur diperbarui.');
            } else {
                const taken = new Set(state.holidays.map((h) => h.holiday_date));
                const rows = dates.filter((d) => !taken.has(d)).map((d) => ({ holiday_date: d, name: v.name, kind: v.kind, source: 'Admin sekolah' }));
                if (!rows.length) { toast('Semua tanggal itu sudah tercatat sebagai libur.', 'err'); return; }
                await q(sb.from('school_holidays').insert(rows));
                toast(`${rows.length} hari libur ditambahkan${rows.length < dates.length ? ` (${dates.length - rows.length} sudah ada, dilewati)` : ''}.`);
            }
            calMonth = v.dari.slice(0, 7);
            await refreshHolidays();
        } catch (err) { toast(friendly(err), 'err'); }
    }

    async function onHolidayClick(e) {
        const nav = e.target.closest('[data-cal]');
        if (nav) {
            const [y, m] = calMonth.split('-').map(Number);
            const d = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.cal), 1));
            calMonth = d.toISOString().slice(0, 7);
            renderCalendar();
            return;
        }
        const cell = e.target.closest('.ak-cal-cell[data-date]');
        if (cell) {
            const h = state.holidays.find((x) => x.holiday_date === cell.dataset.date);
            if (h) return holidayForm(h);
            if (cell.classList.contains('ak-weekend')) { toast('Sabtu dan Minggu sudah otomatis libur.'); return; }
            return holidayForm(null, cell.dataset.date);
        }
        if (e.target.closest('#akHolAdd')) return holidayForm(null);
        const ed = e.target.closest('[data-hol-edit]');
        if (ed) return holidayForm(state.holidays.find((x) => x.holiday_date === ed.dataset.holEdit));
        const del = e.target.closest('[data-hol-del]');
        if (del) {
            const h = state.holidays.find((x) => x.holiday_date === del.dataset.holDel);
            if (!h || !await window.Att.confirm({ title: 'Hapus hari libur?', danger: true, confirmText: 'Hapus',
                html: `<p><b>${esc(h.name)}</b><br><span class="att-muted">${esc(fmtDate(h.holiday_date))}. Tanggal ini akan kembali jadi hari sekolah${h.source && h.source !== 'Admin sekolah' ? '. Tombol Sinkron akan menambahkannya lagi' : ''}.</span></p>` })) return;
            try {
                await q(sb.from('school_holidays').delete().eq('holiday_date', h.holiday_date));
                toast('Hari libur dihapus.');
                await refreshHolidays();
            } catch (err) { toast(friendly(err), 'err'); }
            return;
        }
        if (e.target.closest('#akHolSync')) {
            if (!await window.Att.confirm({ title: 'Sinkron libur nasional?', confirmText: 'Sinkron',
                html: '<p class="att-muted">Menambahkan libur nasional, cuti bersama (SKB 3 Menteri 2026 & 2027), dan libur semester DKI 2026/2027 yang belum ada. Libur yang sudah ada tidak diubah.</p>' })) return;
            try {
                const r = await rpc('sync_holidays');
                toast(r.ditambahkan ? `${r.ditambahkan} hari libur ditambahkan (data resmi s.d. ${fmtDate(r.sampai, false)}).` : `Sudah lengkap. Data resmi tersedia s.d. ${fmtDate(r.sampai, false)}.`);
                await refreshHolidays();
            } catch (err) { toast(friendly(err), 'err'); }
        }
    }

    // ======================================================== TAHUN AJARAN
    function renderYears() {
        makeTable('tahun-ajaran', $('akYearTable'), {
            rows: state.years.map((y) => ({ ...y, periode: `${fmtDate(y.start_date, false)} – ${fmtDate(y.end_date, false)}`, kelas: state.classes.filter((c) => c.academic_year_id === y.id).length })),
            searchKeys: ['name'],
            searchPlaceholder: 'Cari tahun ajaran',
            emptyText: 'Belum ada tahun ajaran.',
            columns: [
                { key: 'name', label: 'Nama', sort: true, render: (r) => `<b>${esc(r.name)}</b>` },
                { key: 'periode', label: 'Periode' },
                { key: 'kelas', label: 'Rombel' },
                { key: 'is_active', label: 'Status', render: (r) => (r.is_active ? '<span class="att-badge ok">Aktif</span>' : '<span class="att-badge mute">Tidak aktif</span>') },
                { key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-year-edit="${esc(r.id)}">Edit</button>
                    ${r.is_active ? '<span class="att-muted" style="font-size:.8rem">Sedang digunakan</span>' : `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-year-act="${esc(r.id)}">Jadikan aktif</button>
                    <button type="button" class="att-btn att-btn-danger att-btn-sm" data-year-del="${esc(r.id)}">Hapus</button>`}` },
            ],
        });
        const ay = activeYear();
        document.querySelectorAll('[data-active-year]').forEach((el) => { el.textContent = ay ? ay.name : 'belum ada'; });
    }

    function yearFields(y) {
        return [
            { id: 'name', label: 'Nama', value: y?.name || '', required: true, placeholder: 'Contoh: 2027/2028', hint: 'Format: YYYY/YYYY' },
            { id: 'start_date', label: 'Tanggal mulai', type: 'date', value: y?.start_date || '', required: true },
            { id: 'end_date', label: 'Tanggal selesai', type: 'date', value: y?.end_date || '', required: true },
        ];
    }

    function yearValidate(v) {
        const m = v.name.match(/^(\d{4})\/(\d{4})$/);
        if (!m || Number(m[2]) !== Number(m[1]) + 1) return 'Nama harus berformat YYYY/YYYY dengan tahun berurutan, mis. 2027/2028.';
        if (v.end_date <= v.start_date) return 'Tanggal selesai harus setelah tanggal mulai.';
        return '';
    }

    async function onYearClick(e) {
        try {
            if (e.target.closest('#akYearAdd')) {
                const last = state.years[0];
                const n = last ? Number(last.name.slice(0, 4)) + 1 : Number(todayJakarta().slice(0, 4));
                const v = await formSheet({ title: 'Tambah tahun ajaran', fields: yearFields({ name: `${n}/${n + 1}`, start_date: `${n}-07-13`, end_date: `${n + 1}-06-30` }), validate: yearValidate });
                if (!v) return;
                await q(sb.from('academic_years').insert({ ...v, is_active: false }));
                toast(`Tahun ajaran ${v.name} ditambahkan. Klik "Jadikan aktif" saat tahun ajaran dimulai.`);
            }
            const ed = e.target.closest('[data-year-edit]');
            if (ed) {
                const y = state.years.find((x) => x.id === ed.dataset.yearEdit);
                const v = await formSheet({ title: `Ubah ${y.name}`, fields: yearFields(y), validate: yearValidate });
                if (!v) return;
                await q(sb.from('academic_years').update(v).eq('id', y.id));
                toast('Tahun ajaran diperbarui.');
            }
            const act = e.target.closest('[data-year-act]');
            if (act) {
                const y = state.years.find((x) => x.id === act.dataset.yearAct);
                if (!await window.Att.confirm({ title: `Aktifkan ${y.name}?`, confirmText: 'Aktifkan',
                    html: '<p class="att-muted">Portal guru, Kelola Absensi, Data Kelas, dan Wali Kelas akan memakai rombel tahun ajaran ini. Pastikan rombel dan wali kelasnya sudah dibuat.</p>' })) return;
                await rpc('set_active_academic_year', { p_id: y.id });
                toast(`${y.name} sekarang aktif.`);
            }
            const del = e.target.closest('[data-year-del]');
            if (del) {
                const y = state.years.find((x) => x.id === del.dataset.yearDel);
                if (!await window.Att.confirm({ title: `Hapus ${y.name}?`, danger: true, confirmText: 'Hapus', html: '<p class="att-muted">Hanya bisa jika belum punya rombel.</p>' })) return;
                await q(sb.from('academic_years').delete().eq('id', y.id));
                toast('Tahun ajaran dihapus.');
            }
            if (e.target.closest('#akYearAdd,[data-year-edit],[data-year-act],[data-year-del]')) { await loadBase(); renderYears(); }
        } catch (err) { toast(friendly(err), 'err'); }
    }

    // ======================================================== DATA KELAS
    function renderClasses() {
        const rows = activeClasses().map((c) => {
            const w = state.homeroom.filter((h) => h.class_id === c.id).sort((a, b) => a.position - b.position);
            return { ...c, label: `Kelas ${c.name}`, siswa: state.counts.get(c.id) || 0, wali: w.map((x) => staffName(x.staff_id)).join(' · ') || '–' };
        });
        $('akClassInfo').textContent = `${rows.length} rombel · ${rows.reduce((a, r) => a + r.siswa, 0)} siswa`;
        makeTable('kelas', $('akClassTable'), {
            rows,
            searchKeys: ['label', 'wali'],
            searchPlaceholder: 'Cari kelas atau wali kelas',
            emptyText: 'Belum ada rombel di tahun ajaran aktif.',
            columns: [
                { key: 'label', label: 'Kelas', sort: true, render: (r) => `<b>${esc(r.label)}</b>` },
                { key: 'siswa', label: 'Jumlah siswa', sort: true, render: (r) => `${esc(r.siswa)} siswa` },
                { key: 'wali', label: 'Wali kelas', sort: true },
                { key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-class-edit="${esc(r.id)}">Edit</button>
                    <button type="button" class="att-btn att-btn-danger att-btn-sm" data-class-del="${esc(r.id)}">Hapus</button>` },
            ],
        });
    }

    function classFields(c) {
        return [
            { id: 'grade', label: 'Tingkat', type: 'select', value: c?.grade || 1, options: [1, 2, 3, 4, 5, 6].map((g) => ({ value: g, label: `Kelas ${g}` })) },
            { id: 'section', label: 'Rombel', type: 'select', value: c?.section || 'A', options: 'ABCDEFGH'.split('').map((s) => ({ value: s, label: s })) },
        ];
    }

    async function onClassClick(e) {
        try {
            const ay = activeYear();
            if (e.target.closest('#akClassAdd')) {
                if (!ay) { toast('Belum ada tahun ajaran aktif.', 'err'); return; }
                const v = await formSheet({ title: `Tambah kelas (${ay.name})`, fields: classFields(null) });
                if (!v) return;
                await q(sb.from('classes').insert({ academic_year_id: ay.id, grade: Number(v.grade), section: v.section }));
                toast(`Kelas ${v.grade} ${v.section} ditambahkan. Atur wali kelasnya di menu Wali Kelas.`);
            }
            const ed = e.target.closest('[data-class-edit]');
            if (ed) {
                const c = state.classes.find((x) => x.id === ed.dataset.classEdit);
                const v = await formSheet({ title: `Ubah Kelas ${c.name}`, fields: classFields(c) });
                if (!v) return;
                await q(sb.from('classes').update({ grade: Number(v.grade), section: v.section }).eq('id', c.id));
                toast('Kelas diperbarui.');
            }
            const del = e.target.closest('[data-class-del]');
            if (del) {
                const c = state.classes.find((x) => x.id === del.dataset.classDel);
                const n = state.counts.get(c.id) || 0;
                if (n) { toast(`Kelas ${c.name} masih punya ${n} siswa. Pindahkan siswanya dulu.`, 'err'); return; }
                if (!await window.Att.confirm({ title: `Hapus Kelas ${c.name}?`, danger: true, confirmText: 'Hapus',
                    html: '<p class="att-muted">Wali kelas dan penugasan mapel di kelas ini ikut terhapus. Tidak bisa jika kelas sudah punya absensi.</p>' })) return;
                await q(sb.from('classes').delete().eq('id', c.id));
                toast('Kelas dihapus.');
            }
            if (e.target.closest('#akClassAdd,[data-class-edit],[data-class-del]')) { await loadBase(); renderClasses(); }
        } catch (err) { toast(friendly(err), 'err'); }
    }

    // ======================================================== WALI KELAS
    function staffOptions(blank) {
        const opts = state.staff.map((s) => ({ value: s.id, label: s.name }));
        return blank ? [{ value: '', label: blank }, ...opts] : opts;
    }

    function renderHomeroomForm(classId) {
        const classes = activeClasses();
        const sel = classId || '';
        const w1 = state.homeroom.find((h) => h.class_id === sel && h.position === 1)?.staff_id || '';
        const w2 = state.homeroom.find((h) => h.class_id === sel && h.position === 2)?.staff_id || '';
        const opt = (list, val) => list.map((o) => `<option value="${esc(o.value)}" ${o.value === val ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
        $('akHrForm').innerHTML = `
            <div class="att-field"><label for="akHrClass">Kelas <span style="color:var(--att-a)">*</span></label>
                <select class="att-select" id="akHrClass">${opt([{ value: '', label: '-- Pilih Kelas --' }, ...classes.map((c) => ({ value: c.id, label: `Kelas ${c.name}` }))], sel)}</select></div>
            <div class="att-field"><label for="akHrW1"><span class="att-badge info">1</span> Wali Kelas 1 (Utama) <span style="color:var(--att-a)">*</span></label>
                <select class="att-select" id="akHrW1">${opt(staffOptions('-- Pilih Wali Kelas 1 --'), w1)}</select></div>
            <div class="att-field"><label for="akHrW2"><span class="att-badge mute">2</span> Wali Kelas 2 (Pendamping, opsional)</label>
                <select class="att-select" id="akHrW2">${opt(staffOptions('-- Tidak Ada / Kosongkan --'), w2)}</select>
                <span class="att-muted" style="font-size:.78rem">Wali Kelas 2 tidak boleh sama dengan Wali Kelas 1. Keduanya bisa mengisi absensi harian.</span></div>
            <button type="button" class="att-btn att-btn-primary att-btn-block" id="akHrSave">Simpan Wali Kelas</button>`;
    }

    function renderHomeroomTable() {
        const rows = activeClasses().map((c) => {
            const w1 = state.homeroom.find((h) => h.class_id === c.id && h.position === 1)?.staff_id;
            const w2 = state.homeroom.find((h) => h.class_id === c.id && h.position === 2)?.staff_id;
            return { id: c.id, kelas: `Kelas ${c.name}`, w1, w2, w1n: w1 ? staffName(w1) : '', w2n: w2 ? staffName(w2) : '' };
        });
        $('akHrCount').textContent = `${rows.length} kelas`;
        const person = (id) => (id ? `<b>${esc(staffName(id))}</b>${staffNip(id) ? `<br><span class="att-muted" style="font-size:.76rem">NIP: ${esc(staffNip(id))}</span>` : ''}` : '<span class="att-badge mute">Tidak ada</span>');
        makeTable('wali-kelas', $('akHrTable'), {
            rows,
            searchKeys: ['kelas', 'w1n', 'w2n'],
            searchPlaceholder: 'Cari kelas / guru…',
            columns: [
                { key: 'kelas', label: 'Kelas', sort: true, render: (r) => `<span class="att-badge info">${esc(r.kelas)}</span>` },
                { key: 'w1n', label: 'Wali Kelas 1', sort: true, render: (r) => (r.w1 ? person(r.w1) : '<span class="att-badge bad">Belum ada</span>') },
                { key: 'w2n', label: 'Wali Kelas 2 (Pendamping)', render: (r) => person(r.w2) },
                { key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-hr-edit="${esc(r.id)}">Edit</button>
                    ${r.w1 ? `<button type="button" class="att-btn att-btn-danger att-btn-sm" data-hr-del="${esc(r.id)}">Hapus</button>` : ''}` },
            ],
        });
    }

    async function onHomeroomClick(e) {
        const ed = e.target.closest('[data-hr-edit]');
        if (ed) {
            renderHomeroomForm(ed.dataset.hrEdit);
            $('akHrForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
            $('akHrW1').focus({ preventScroll: true });
            return;
        }
        try {
            if (e.target.closest('#akHrSave')) {
                const cls = $('akHrClass').value;
                const w1 = $('akHrW1').value;
                const w2 = $('akHrW2').value || null;
                if (!cls) { toast('Pilih kelas dulu.', 'err'); return; }
                if (!w1) { toast('Wali Kelas 1 wajib dipilih.', 'err'); return; }
                if (w2 && w2 === w1) { toast('Wali Kelas 2 tidak boleh sama dengan Wali Kelas 1.', 'err'); return; }
                await rpc('set_homeroom', { p_class_id: cls, p_wali1: w1, p_wali2: w2 });
                toast('Wali kelas disimpan.');
                await loadBase();
                renderHomeroomForm('');
                renderHomeroomTable();
            }
            const del = e.target.closest('[data-hr-del]');
            if (del) {
                const c = state.classes.find((x) => x.id === del.dataset.hrDel);
                if (!await window.Att.confirm({ title: `Hapus wali Kelas ${c.name}?`, danger: true, confirmText: 'Hapus',
                    html: '<p class="att-muted">Kelas ini tidak bisa diabsen guru sampai wali kelas baru ditetapkan.</p>' })) return;
                await q(sb.from('homeroom_assignments').delete().eq('class_id', c.id));
                toast('Wali kelas dihapus.');
                await loadBase();
                renderHomeroomTable();
            }
        } catch (err) { toast(friendly(err), 'err'); }
    }

    // ======================================================== MATA PELAJARAN
    function renderSubjects() {
        const rows = state.subjects.map((s) => {
            const by = new Map();
            for (const a of state.assign.filter((x) => x.subject_id === s.id)) {
                if (!by.has(a.staff_id)) by.set(a.staff_id, []);
                by.get(a.staff_id).push(a.class_id);
            }
            const guru = [...by.entries()].map(([sid, cls]) => ({ sid, nama: staffName(sid), kelas: classSummary(cls) }));
            return { ...s, guru, guruText: guru.map((g) => g.nama).join(' ') };
        });
        makeTable('mapel', $('akSubTable'), {
            rows,
            searchKeys: ['code', 'name', 'guruText'],
            searchPlaceholder: 'Cari mapel atau guru',
            emptyText: 'Belum ada mata pelajaran.',
            columns: [
                { key: 'code', label: 'Kode', sort: true, render: (r) => `<span class="att-badge info">${esc(r.code)}</span>` },
                { key: 'name', label: 'Nama', sort: true, render: (r) => `<b>${esc(r.name)}</b>` },
                { key: 'guruText', label: 'Guru pengampu', render: (r) => (r.guru.length ? r.guru.map((g) => `<div>${esc(g.nama)} <span class="att-muted">· ${esc(g.kelas)}</span></div>`).join('') : '<span class="att-badge bad">Belum ada guru</span>') },
                { key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<button type="button" class="att-btn att-btn-primary att-btn-sm" data-sub-assign="${esc(r.id)}">Atur guru</button>
                    <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-sub-edit="${esc(r.id)}">Edit</button>
                    <button type="button" class="att-btn att-btn-danger att-btn-sm" data-sub-del="${esc(r.id)}">Hapus</button>` },
            ],
        });
    }

    function subjectFields(s) {
        return [
            { id: 'code', label: 'Kode', value: s?.code || '', required: true, max: 16, placeholder: 'Mis. BING', hint: 'Huruf besar/angka, 2–16 karakter.' },
            { id: 'name', label: 'Nama mata pelajaran', value: s?.name || '', required: true, max: 100, placeholder: 'Mis. Bahasa Inggris' },
        ];
    }

    const subjValidate = (v) => (/^[A-Za-z0-9_]{2,16}$/.test(v.code) ? '' : 'Kode hanya huruf/angka, 2–16 karakter.');

    async function onSubjectClick(e) {
        try {
            if (e.target.closest('#akSubAdd')) {
                const v = await formSheet({ title: 'Tambah mata pelajaran', fields: subjectFields(null), validate: subjValidate });
                if (!v) return;
                await q(sb.from('subjects').insert({ code: v.code.toUpperCase(), name: v.name }));
                toast(`${v.name} ditambahkan. Klik "Atur guru" untuk menugaskan guru.`);
            }
            const ed = e.target.closest('[data-sub-edit]');
            if (ed) {
                const s = state.subjects.find((x) => x.id === ed.dataset.subEdit);
                const v = await formSheet({ title: `Ubah ${s.code}`, fields: subjectFields(s), validate: subjValidate });
                if (!v) return;
                await q(sb.from('subjects').update({ code: v.code.toUpperCase(), name: v.name }).eq('id', s.id));
                toast('Mata pelajaran diperbarui.');
            }
            const as = e.target.closest('[data-sub-assign]');
            if (as) {
                const s = state.subjects.find((x) => x.id === as.dataset.subAssign);
                const current = state.assign.filter((x) => x.subject_id === s.id);
                const firstStaff = current[0]?.staff_id || '';
                const classOpts = activeClasses().map((c) => ({ value: c.id, label: c.name }));
                const pick = (sid) => current.filter((x) => x.staff_id === sid).map((x) => x.class_id);
                const v = await formSheet({
                    title: `Guru ${s.code} · ${s.name}`,
                    submitText: 'Simpan penugasan',
                    fields: [
                        { id: 'staff', label: 'Guru', type: 'select', value: firstStaff, options: staffOptions('-- Pilih guru --'), required: true,
                            hint: 'Pilih guru, lalu centang kelas yang ia ajar. Kosongkan semua centang untuk mencabut penugasan.' },
                        { id: 'kelas', label: 'Kelas yang diajar', type: 'checks', value: pick(firstStaff), options: classOpts },
                    ],
                    onChange: (ev, root) => {
                        if (ev.target.id !== 'fs_staff') return;
                        const set = new Set(pick(ev.target.value));
                        root.querySelectorAll('#fs_kelas input').forEach((i) => { i.checked = set.has(i.value); });
                    },
                });
                if (!v) return;
                const n = await rpc('set_subject_assignments', { p_subject_id: s.id, p_staff_id: v.staff, p_class_ids: v.kelas });
                toast(n ? `${staffName(v.staff)} mengajar ${s.code} di ${n} kelas.` : `Penugasan ${staffName(v.staff)} untuk ${s.code} dicabut.`);
            }
            const del = e.target.closest('[data-sub-del]');
            if (del) {
                const s = state.subjects.find((x) => x.id === del.dataset.subDel);
                if (state.assign.some((x) => x.subject_id === s.id)) { toast(`Cabut dulu penugasan guru ${s.code} lewat "Atur guru".`, 'err'); return; }
                if (!await window.Att.confirm({ title: `Hapus ${s.code}?`, danger: true, confirmText: 'Hapus', html: '<p class="att-muted">Tidak bisa jika sudah dipakai di absensi.</p>' })) return;
                await q(sb.from('subjects').delete().eq('id', s.id));
                toast('Mata pelajaran dihapus.');
            }
            if (e.target.closest('#akSubAdd,[data-sub-edit],[data-sub-assign],[data-sub-del]')) { await loadBase(); renderSubjects(); }
        } catch (err) { toast(friendly(err), 'err'); }
    }

    // ======================================================== kaitkan ke showTab
    const TITLES = { tabClasses: 'Data Kelas', tabHomeroom: 'Wali Kelas', tabSubjects: 'Mata Pelajaran', tabAcademicYears: 'Tahun Ajaran', tabHolidays: 'Hari Libur' };

    async function openTab(tabId) {
        const host = $(tabId);
        try {
            if (!loaded.base) { await loadBase(); loaded.base = true; } else if (!loaded[tabId]) await loadBase();
            if (tabId === 'tabHolidays') await refreshHolidays();
            if (tabId === 'tabAcademicYears') renderYears();
            if (tabId === 'tabClasses') { renderYears(); renderClasses(); }
            if (tabId === 'tabHomeroom') { renderYears(); if (!loaded[tabId]) renderHomeroomForm(''); renderHomeroomTable(); }
            if (tabId === 'tabSubjects') renderSubjects();
            loaded[tabId] = true;
        } catch (err) {
            host.querySelector('.ak-error')?.remove();
            host.insertAdjacentHTML('afterbegin', `<div class="att-alert err ak-error" style="margin-bottom:12px">${esc(friendly(err))}</div>`);
        }
    }

    const prevShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        prevShowTab(tabId, navEl);
        if (TITLES[tabId]) {
            $('topbarTitle').textContent = TITLES[tabId];
            openTab(tabId);
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('tabHolidays')?.addEventListener('click', onHolidayClick);
        $('tabAcademicYears')?.addEventListener('click', onYearClick);
        $('tabClasses')?.addEventListener('click', onClassClick);
        $('tabHomeroom')?.addEventListener('click', onHomeroomClick);
        $('tabSubjects')?.addEventListener('click', onSubjectClick);
        $('tabHomeroom')?.addEventListener('change', (e) => { if (e.target.id === 'akHrClass') renderHomeroomForm(e.target.value); });
    });
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { for (const k of Object.keys(loaded)) delete loaded[k]; }
    });
})();
