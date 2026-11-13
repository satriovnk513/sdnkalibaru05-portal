// =============================================================================
// Panel Admin — menu Laporan: Rekap Bulanan & Rekap Semester.
// Pratinjau di layar, Cetak / PDF (format daftar hadir kertas), Export Excel.
// Data dari RPC get_class_month_recap, get_class_semester_recap,
// get_class_report_header (hak akses diperiksa di database).
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const { esc, todayJakarta, errMessage, toast, romawi, BULAN } = window.Att;
    const RP = window.RekapPrint;
    const $ = (id) => document.getElementById(id);
    let classes = [];
    let loaded = false;
    const last = { month: null, semester: null };

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }

    async function loadClasses() {
        const [c, y] = await Promise.all([
            sb.from('classes').select('id,name,grade,section,academic_year_id').order('grade').order('section'),
            sb.from('academic_years').select('id,name,start_date,end_date,is_active'),
        ]);
        if (c.error || y.error) throw (c.error || y.error);
        const active = y.data.find((x) => x.is_active);
        classes = c.data.filter((x) => !active || x.academic_year_id === active.id);
        const opts = classes.map((x) => `<option value="${esc(x.id)}">Kelas ${esc(x.name)} (${esc(romawi(x.name))})</option>`).join('');
        $('lpBlnKelas').innerHTML = opts;
        $('lpSemKelas').innerHTML = opts;
        $('lpBlnBulan').value = todayJakarta().slice(0, 7);
        $('lpSemSemester').value = Number(todayJakarta().slice(5, 7)) >= 7 ? '1' : '2';
        document.querySelectorAll('[data-lp-ta]').forEach((el) => { el.textContent = active ? active.name : '–'; });
    }

    const opts = (p) => ({ wali: Number($(`${p}Wali`).value) || 1, showNip: $(`${p}Nip`).checked, blank: p === 'lpBln' ? $('lpBlnBlank').checked : false });

    // ------------------------------------------------------------------ bulanan
    async function showMonth() {
        const classId = $('lpBlnKelas').value;
        const bulan = $('lpBlnBulan').value;
        if (!classId || !/^\d{4}-\d{2}$/.test(bulan)) { toast('Pilih kelas dan bulan.', 'err'); return null; }
        const [y, m] = bulan.split('-').map(Number);
        $('lpBlnOut').innerHTML = '<div class="att-muted">Memuat…</div>';
        try {
            const [recap, header] = await Promise.all([
                rpc('get_class_month_recap', { p_class_id: classId, p_year: y, p_month: m }),
                rpc('get_class_report_header', { p_class_id: classId }),
            ]);
            last.month = { recap, header };
            renderMonth(recap, header);
            return last.month;
        } catch (err) {
            $('lpBlnOut').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
            return null;
        }
    }

    function renderMonth(r, h) {
        const days = r.hari || [];
        const filled = days.filter((d) => d.diisi).length;
        const wali = (h.wali || []).map((w) => `${w.posisi === 2 ? 'Pendamping' : 'Wali'}: ${w.nama}`).join(' · ') || 'Wali kelas belum ditetapkan';
        const head = days.map((d) => `<th class="${d.libur ? 'libur' : ''}">${Number(d.tanggal.slice(8))}</th>`).join('');
        const body = (r.siswa || []).map((s) => {
            const t = { H: 0, S: 0, I: 0, A: 0, D: 0 };
            for (const v of Object.values(s.status || {})) t[v] += 1;
            return `<tr><td>${esc(s.no)}</td><td>${esc(s.nis || '')}</td><td class="nm">${esc(s.nama)}</td><td>${esc(s.jk || '')}</td>${days.map((d) => {
                const v = (s.status || {})[d.tanggal];
                return `<td class="${d.libur ? 'libur' : ''} ${v ? `c-${v}` : ''}">${d.libur || !v ? '' : (v === 'H' ? '•' : v)}</td>`;
            }).join('')}<td>${t.S}</td><td>${t.I}</td><td>${t.A}</td><td>${t.D}</td></tr>`;
        }).join('');
        $('lpBlnOut').innerHTML = `
            <div class="att-alert info" style="margin-bottom:12px">Kelas <b>${esc(romawi(r.kelas))}</b> · ${esc(BULAN[r.bulan - 1])} ${esc(r.tahun)} · TA ${esc(h.tahun_ajaran)} · ${esc(wali)}<br>
                Absensi harian terisi <b>${filled}</b> dari <b>${esc(r.hari_efektif)}</b> hari sekolah${r.hari_efektif > filled ? ' (sel kosong = belum diisi)' : ''}.</div>
            <div class="att-recap-wrap"><table class="att-recap">
                <thead><tr><th>No</th><th>NIS</th><th>Nama</th><th>L/P</th>${head}<th>S</th><th>I</th><th>A</th><th>D</th></tr></thead>
                <tbody>${body || `<tr><td colspan="${days.length + 8}">Belum ada siswa.</td></tr>`}</tbody></table></div>
            <p class="att-muted" style="margin:8px 0 0">• hadir · S sakit · I izin · A alpa · D dispensasi · kolom merah = Sabtu, Minggu, atau libur.</p>`;
    }

    async function ensureMonth() {
        const classId = $('lpBlnKelas').value;
        const bulan = $('lpBlnBulan').value;
        const cur = last.month;
        if (cur && cur.recap && cur.header.kelas === classes.find((c) => c.id === classId)?.name
            && `${cur.recap.tahun}-${String(cur.recap.bulan).padStart(2, '0')}` === bulan) return cur;
        return showMonth();
    }

    // ------------------------------------------------------------------ semester
    let semTable = null;

    async function showSemester() {
        const classId = $('lpSemKelas').value;
        const sem = Number($('lpSemSemester').value);
        if (!classId) { toast('Pilih kelas.', 'err'); return null; }
        $('lpSemInfo').innerHTML = '<div class="att-muted">Memuat…</div>';
        try {
            const [recap, header] = await Promise.all([
                rpc('get_class_semester_recap', { p_class_id: classId, p_semester: sem }),
                rpc('get_class_report_header', { p_class_id: classId }),
            ]);
            last.semester = { recap, header, classId, sem };
            const rows = (recap.siswa || []).map((s) => {
                const p = RP.pct(s);
                return { ...s, pctv: p === null ? -1 : p, pcts: p === null ? '–' : `${String(p).replace('.', ',')}%` };
            });
            $('lpSemInfo').innerHTML = `<div class="att-alert info" style="margin-bottom:12px">Kelas <b>${esc(romawi(header.kelas))}</b> · Semester ${sem === 1 ? 'Ganjil' : 'Genap'} TA ${esc(header.tahun_ajaran)}
                (${esc(window.Att.fmtDate(recap.mulai, false))} – ${esc(window.Att.fmtDate(recap.selesai, false))})<br>
                Hari efektif s.d. hari ini: <b>${esc(recap.hari_efektif)}</b> · Absensi harian terisi: <b>${esc(recap.hari_terisi)}</b> hari</div>`;
            const cfg = {
                storageKey: 'admin-rekap-semester',
                rows,
                searchKeys: ['nama', 'nis', 'nisn'],
                searchPlaceholder: 'Cari nama, NIS, atau NISN',
                emptyText: 'Belum ada siswa.',
                columns: [
                    { key: 'no', label: 'No', sort: true },
                    { key: 'nama', label: 'Nama', sort: true, render: (r) => `<b>${esc(r.nama)}</b>` },
                    { key: 'jk', label: 'L/P' },
                    { key: 'H', label: 'Hadir', sort: true },
                    { key: 'S', label: 'Sakit', sort: true },
                    { key: 'I', label: 'Izin', sort: true },
                    { key: 'A', label: 'Alpa', sort: true, render: (r) => (r.A ? `<span class="att-badge bad">${esc(r.A)}</span>` : '0') },
                    { key: 'D', label: 'Dispensasi' },
                    { key: 'pctv', label: '% Kehadiran', sort: true, render: (r) => esc(r.pcts) },
                ],
            };
            if (semTable && $('lpSemTable').querySelector('[data-body]')) semTable.setRows(rows);
            else semTable = new window.Att.DataTable($('lpSemTable'), cfg);
            return last.semester;
        } catch (err) {
            $('lpSemInfo').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
            return null;
        }
    }

    async function ensureSemester() {
        const cur = last.semester;
        if (cur && cur.classId === $('lpSemKelas').value && cur.sem === Number($('lpSemSemester').value)) return cur;
        return showSemester();
    }

    function doPrint(html) {
        if (!RP.print(html)) toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err');
    }

    // ------------------------------------------------------------------ events
    document.addEventListener('DOMContentLoaded', () => {
        $('lpBlnShow')?.addEventListener('click', showMonth);
        $('lpBlnPrint')?.addEventListener('click', async () => {
            const d = await ensureMonth();
            if (d) doPrint(RP.monthlyHtml(d.recap, d.header, opts('lpBln')));
        });
        $('lpBlnXlsx')?.addEventListener('click', async () => {
            const d = await ensureMonth();
            if (!d) return;
            RP.download(RP.monthlyXlsx(d.recap, d.header, opts('lpBln')), `${RP.fileName('Daftar_Hadir', d.header, `${BULAN[d.recap.bulan - 1]}_${d.recap.tahun}`)}.xlsx`);
            toast('File Excel diunduh.');
        });
        $('lpSemShow')?.addEventListener('click', showSemester);
        $('lpSemPrint')?.addEventListener('click', async () => {
            const d = await ensureSemester();
            if (d) doPrint(RP.semesterHtml(d.recap, d.header, opts('lpSem')));
        });
        $('lpSemXlsx')?.addEventListener('click', async () => {
            const d = await ensureSemester();
            if (!d) return;
            RP.download(RP.semesterXlsx(d.recap, d.header, opts('lpSem')), `${RP.fileName('Rekap_Semester', d.header, `${d.sem === 1 ? 'Ganjil' : 'Genap'}_${d.header.tahun_ajaran}`)}.xlsx`);
            toast('File Excel diunduh.');
        });
    });

    const TITLES = { tabRekapBulanan: 'Rekap Bulanan', tabRekapSemester: 'Rekap Semester' };
    const prevShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        prevShowTab(tabId, navEl);
        if (!TITLES[tabId]) return;
        $('topbarTitle').textContent = TITLES[tabId];
        (loaded ? Promise.resolve() : loadClasses().then(() => { loaded = true; }))
            .then(() => (tabId === 'tabRekapBulanan' ? (last.month ? null : showMonth()) : (last.semester ? null : showSemester())))
            .catch((err) => toast(errMessage(err), 'err'));
    };
    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { loaded = false; last.month = null; last.semester = null; semTable = null; } });
})();
