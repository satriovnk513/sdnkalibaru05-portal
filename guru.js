// =============================================================================
// Portal Guru (/guru) — SDN Kalibaru 05. Mobile-first, tanpa framework.
// Rute (hash):
//   #/                         beranda (tugas hari ini)
//   #/absen?kelas=&tanggal=&jenis=harian|mapel&mapel=
//   #/siswa[?kelas=]           daftar siswa rombel
//   #/siswa/<id>               profil siswa (lihat saja)
//   #/rekap[?kelas=&bulan=YYYY-MM]
//   #/akun                     ganti password, keluar
// Semua data lewat RPC yang memeriksa hak akses di database.
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const { esc, fmtDate, romawi, todayJakarta, errMessage, toast } = window.Att;
    const $ = (id) => document.getElementById(id);

    let home = null;          // hasil get_guru_home
    let userEmail = '';

    // ------------------------------------------------------------------ util
    function parseHash() {
        const raw = location.hash.replace(/^#/, '') || '/';
        const [path, qs] = raw.split('?');
        return { path, params: new URLSearchParams(qs || '') };
    }

    function go(path) { location.hash = `#${path}`; }

    function setTop(title, sub = '', back = false) {
        $('gTitle').textContent = title;
        $('gSub').textContent = sub;
        $('gBack').classList.toggle('g-hidden', !back);
        $('gTopLogo').classList.toggle('g-hidden', back);
        document.title = `${title} — Portal Guru`;
    }

    function setNav(key) {
        document.querySelectorAll('.g-nav a').forEach((a) => {
            if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
    }

    function main(html) {
        $('gMain').innerHTML = html;
        window.scrollTo(0, 0);
    }

    function loading() { main('<div class="g-loading">Memuat…</div>'); }

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw new Error(error.message);
        return data;
    }

    function shortName(nama) {
        return String(nama || '').split(',')[0].trim();
    }

    /** Semua rombel yang bisa dilihat guru ini: wali kelas, mapel, atau semua (pimpinan). */
    function myClasses() {
        const map = new Map();
        for (const w of home.wali_kelas) map.set(w.class_id, { class_id: w.class_id, kelas: w.kelas, peran: 'Wali kelas' });
        for (const m of home.mapel) if (!map.has(m.class_id)) map.set(m.class_id, { class_id: m.class_id, kelas: m.kelas, peran: m.kode });
        for (const c of home.semua_kelas) if (!map.has(c.class_id)) map.set(c.class_id, { class_id: c.class_id, kelas: c.kelas, peran: '' });
        return [...map.values()].sort((a, b) => a.kelas.localeCompare(b.kelas));
    }

    function classSelect(id, selected) {
        return `<select class="att-select" id="${id}">${myClasses().map((c) =>
            `<option value="${esc(c.class_id)}" ${c.class_id === selected ? 'selected' : ''}>Kelas ${esc(c.kelas)}${c.peran ? ` · ${esc(c.peran)}` : ''}</option>`).join('')}</select>`;
    }

    // ------------------------------------------------------------------ login
    function showLogin(message) {
        $('gApp').classList.add('g-hidden');
        $('gLogin').classList.remove('g-hidden');
        const err = $('gLoginErr');
        err.classList.toggle('g-hidden', !message);
        err.textContent = message || '';
    }

    $('gPwToggle').addEventListener('click', () => {
        const pw = $('gPw');
        const show = pw.type === 'password';
        pw.type = show ? 'text' : 'password';
        $('gPwToggle').textContent = show ? 'Sembunyi' : 'Lihat';
    });

    $('gLoginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const identifier = $('gId').value.trim();
        const password = $('gPw').value;
        if (!identifier || !password) return showLogin('Isi email atau NIP/NUPTK dan password.');
        const btn = $('gLoginBtn');
        btn.disabled = true;
        btn.textContent = 'Memeriksa…';
        try {
            const res = await fetch('/api/guru-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error?.message || 'Login gagal. Coba lagi.');
            const { error } = await sb.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
            if (error) throw new Error(error.message);
            $('gPw').value = '';
            await boot();
        } catch (err) {
            showLogin(errMessage(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Masuk';
        }
    });

    async function logout() {
        await sb.auth.signOut();
        home = null;
        location.hash = '#/';
        showLogin('');
    }

    // ------------------------------------------------------------------ beranda
    function renderHome() {
        setNav('home');
        setTop(`Halo, ${shortName(home.nama)}`, fmtDate(home.today));
        const parts = [];
        if (!home.is_school_day) {
            parts.push(`<div class="att-alert warn">Hari ini libur${home.holiday_name ? ` (${esc(home.holiday_name)})` : ''}. Absensi tidak perlu diisi.</div>`);
        }

        if (home.wali_kelas.length) {
            parts.push('<h2>Absensi harian</h2>');
            for (const w of home.wali_kelas) {
                const t = w.hari_ini;
                const rekap = t?.rekap || {};
                const absen = ['S', 'I', 'A', 'D'].filter((k) => rekap[k]).map((k) => `${rekap[k]} ${window.Att.STATUS[k].toLowerCase()}`).join(', ');
                const href = `#/absen?kelas=${w.class_id}&tanggal=${home.today}&jenis=harian`;
                parts.push(`<div class="att-card g-task ${t ? 'done' : 'todo'}">
                    <div class="g-task-head">
                        <div><b>Kelas ${esc(w.kelas)}</b><div class="att-muted">${esc(w.jumlah_siswa)} siswa${w.posisi === 2 ? ' · wali pendamping' : ''}</div></div>
                        ${t ? `<span class="att-badge ok">Sudah diisi ${esc(t.disimpan)}</span>` : (home.is_school_day ? '<span class="att-badge bad">Belum diisi</span>' : '')}
                    </div>
                    ${t ? `<div class="att-muted">${rekap.H || 0} hadir${absen ? `, ${esc(absen)}` : ''}</div>` : ''}
                    ${home.is_school_day ? `<a class="att-btn ${t ? 'att-btn-ghost' : 'att-btn-primary'} att-btn-block" href="${href}">${t ? (t.terkunci ? 'Lihat absensi' : 'Lihat / ubah') : 'Isi absensi sekarang'}</a>` : ''}
                    <a class="att-btn att-btn-ghost att-btn-sm" href="#/absen?kelas=${w.class_id}&jenis=harian&pilih=1">Isi tanggal lain</a>
                </div>`);
            }
        }

        if (home.mapel.length) {
            const bySubject = new Map();
            for (const m of home.mapel) {
                if (!bySubject.has(m.subject_id)) bySubject.set(m.subject_id, { nama: m.mapel, kode: m.kode, kelas: [] });
                bySubject.get(m.subject_id).kelas.push(m);
            }
            for (const s of bySubject.values()) {
                parts.push(`<h2>${esc(s.kode)} · ${esc(s.nama)}</h2>
                    <div class="att-card"><p class="att-muted" style="margin:0 0 10px">Pilih kelas yang Anda ajar hari ini.</p>
                    <div class="g-chips">${s.kelas.map((k) => `<a class="g-chip ${k.hari_ini ? 'done' : ''}" href="#/absen?kelas=${k.class_id}&tanggal=${home.today}&jenis=mapel&mapel=${k.subject_id}">${esc(k.kelas)}${k.hari_ini ? ' ✓' : ''}</a>`).join('')}</div></div>`);
            }
        }

        if (home.is_pimpinan && home.semua_kelas.length) {
            parts.push(`<h2>Pantau sekolah</h2><div class="att-card"><p class="att-muted" style="margin:0 0 10px">Lihat rekap absensi rombel mana pun.</p>
                <div class="g-chips">${home.semua_kelas.map((c) => `<a class="g-chip" href="#/rekap?kelas=${c.class_id}">${esc(c.kelas)}</a>`).join('')}</div></div>`);
        }

        if (!home.wali_kelas.length && !home.mapel.length && !home.is_pimpinan) {
            parts.push('<div class="att-alert info">Belum ada kelas yang ditugaskan kepada Anda. Hubungi admin sekolah.</div>');
        }
        main(parts.join(''));
    }

    // ------------------------------------------------------------------ absensi
    async function renderAbsen(params) {
        setNav('home');
        const classId = params.get('kelas');
        const kind = params.get('jenis') === 'mapel' ? 'mapel' : 'harian';
        const subjectId = kind === 'mapel' ? params.get('mapel') : null;
        const date = params.get('tanggal') || home.today;
        const kelas = myClasses().find((c) => c.class_id === classId);
        const subj = subjectId ? home.mapel.find((m) => m.subject_id === subjectId) : null;
        if (!kelas) { main('<div class="att-alert err">Rombel tidak ditemukan atau bukan tugas Anda.</div>'); return; }

        const title = kind === 'harian' ? `Absensi ${kelas.kelas}` : `${subj?.kode || 'Mapel'} ${kelas.kelas}`;
        setTop(title, fmtDate(date), true);
        document.body.classList.add('g-sheet-open');

        const picker = `<div class="g-date-row att-noprint">
            <div class="att-field"><label for="gDate">Tanggal</label>
                <input type="date" class="att-input" id="gDate" value="${esc(date)}" min="${esc(home.earliest_date)}" max="${esc(home.today)}"></div>
        </div>`;
        main(`${picker}<div id="gSheet"><div class="g-loading">Memuat daftar siswa…</div></div>`);
        $('gDate').addEventListener('change', (e) => {
            if (!e.target.value) return;
            const p = new URLSearchParams(params);
            p.set('tanggal', e.target.value);
            p.delete('pilih');
            go(`/absen?${p}`);
        });
        if (params.get('pilih')) $('gDate').focus();

        try {
            const sheet = await rpc('get_attendance_sheet', {
                p_class_id: classId, p_date: date, p_kind: kind, p_subject_id: subjectId,
            });
            const draftKey = `att-draft:${classId}:${date}:${kind}:${subjectId || '-'}`;
            window.Att.renderSheet($('gSheet'), sheet, {
                draftKey,
                subtitle: `Kelas ${romawi(kelas.kelas)} · ${fmtDate(date)}`,
                onSave: async (entries) => {
                    await rpc('save_attendance', {
                        p_class_id: classId, p_date: date, p_kind: kind, p_subject_id: subjectId, p_entries: entries, p_reason: null,
                    });
                    home = await rpc('get_guru_home');
                    setTimeout(() => renderAbsen(params), 300);
                },
            });
            if (!sheet.bisa_ubah && sheet.hari_sekolah && sheet.session) {
                $('gSheet').insertAdjacentHTML('afterbegin', '<div class="att-alert info" style="margin-bottom:12px">Absensi ini sudah terkunci. Untuk koreksi, hubungi admin.</div>');
            }
        } catch (err) {
            $('gSheet').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
        }
    }

    // ------------------------------------------------------------------ siswa
    async function renderSiswa(params) {
        setNav('siswa');
        setTop('Data siswa', 'Lihat saja');
        const classes = myClasses();
        if (!classes.length) { main('<div class="att-alert info">Belum ada kelas yang ditugaskan kepada Anda.</div>'); return; }
        const classId = params.get('kelas') || classes[0].class_id;
        main(`<div class="att-field" style="margin-bottom:12px"><label for="gKelas">Kelas</label>${classSelect('gKelas', classId)}</div>
            <div id="gSiswa"><div class="g-loading">Memuat…</div></div>`);
        $('gKelas').addEventListener('change', (e) => go(`/siswa?kelas=${e.target.value}`));
        try {
            const rows = await rpc('get_class_roster', { p_class_id: classId, p_date: null });
            new window.Att.DataTable($('gSiswa'), {
                storageKey: 'guru-siswa',
                rows: rows.map((r) => ({ ...r, jk: r.jenis_kelamin || '–' })),
                searchKeys: ['nama', 'nis', 'nisn'],
                searchPlaceholder: 'Cari nama, NIS, atau NISN',
                emptyText: 'Rombel ini belum punya siswa.',
                columns: [
                    { key: 'no_urut', label: 'No', sort: true },
                    { key: 'nama', label: 'Nama', sort: true },
                    { key: 'jk', label: 'L/P' },
                    { key: 'nis', label: 'NIS' },
                    { key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<a class="att-btn att-btn-ghost att-btn-sm" href="#/siswa/${esc(r.student_id)}">Lihat profil</a>` },
                ],
            });
        } catch (err) {
            $('gSiswa').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
        }
    }

    function waLink(phone) {
        const d = String(phone).replace(/[^0-9]/g, '');
        return `https://wa.me/${d.startsWith('0') ? `62${d.slice(1)}` : d}`;
    }

    async function renderProfil(id) {
        setNav('siswa');
        setTop('Profil siswa', 'Lihat saja', true);
        loading();
        try {
            const p = await rpc('get_student_profile', { p_student_id: id });
            const idt = p.identitas || {};
            const ot = p.orang_tua || {};
            const al = p.alamat || {};
            const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');
            const alamat = [al.jalan, al.rt || al.rw ? `RT ${al.rt || '-'}/RW ${al.rw || '-'}` : '', al.kelurahan, al.kecamatan].filter(Boolean).join(', ');
            setTop(idt.nama || 'Profil siswa', idt.kelas ? `Kelas ${idt.kelas}` : '', true);
            main(`<div class="att-card g-prof">
                <h3 style="margin-top:0">Identitas</h3>
                <dl>${row('Nama', idt.nama)}${row('Kelas', idt.kelas)}${row('NIS', idt.nis)}${row('NISN', idt.nisn)}
                    ${row('Jenis kelamin', idt.jenis_kelamin === 'L' ? 'Laki-laki' : idt.jenis_kelamin === 'P' ? 'Perempuan' : '')}
                    ${row('Tempat, tgl lahir', [idt.tempat_lahir, idt.tanggal_lahir].filter(Boolean).join(', '))}
                    ${row('Agama', idt.agama)}${row('Anak ke-', idt.anak_ke)}</dl>
                <h3>Orang tua</h3>
                <dl>${row('Ayah', ot.ayah_nama)}${row('Pekerjaan ayah', ot.ayah_pekerjaan)}${row('Ibu', ot.ibu_nama)}${row('Pekerjaan ibu', ot.ibu_pekerjaan)}</dl>
                ${p.wali ? `<h3>Wali</h3><dl>${row('Nama', p.wali.nama)}${row('Pekerjaan', p.wali.pekerjaan)}</dl>` : ''}
                <h3>Kontak</h3>
                ${(p.kontak || []).length ? p.kontak.map((n) => `<div class="g-phone"><b>${esc(n)}</b>
                    <a class="att-btn att-btn-ghost att-btn-sm" href="tel:${esc(n)}">Telepon</a>
                    <a class="att-btn att-btn-ghost att-btn-sm" href="${esc(waLink(n))}" target="_blank" rel="noopener">WhatsApp</a></div>`).join('')
                    : '<p class="att-muted">Belum ada nomor HP. Hubungi admin untuk melengkapi.</p>'}
                ${alamat ? `<h3>Alamat</h3><p style="margin:0">${esc(alamat)}</p>` : ''}
                ${p.catatan && Object.keys(p.catatan).length ? `<h3>Catatan</h3><dl>${row('Kebutuhan khusus', p.catatan.kebutuhan_khusus)}${row('Penerima KIP', p.catatan.penerima_kip)}${row('Usulan PIP', p.catatan.usulan_pip)}</dl>` : ''}
            </div>
            <p class="att-muted" style="margin-top:12px">Data salah atau kurang? Laporkan ke admin sekolah.</p>`);
        } catch (err) {
            main(`<div class="att-alert err">${esc(errMessage(err))}</div>`);
        }
    }

    // ------------------------------------------------------------------ rekap
    async function renderRekap(params) {
        setNav('rekap');
        setTop('Rekap absensi', 'Absensi harian per bulan');
        const classes = myClasses();
        if (!classes.length) { main('<div class="att-alert info">Belum ada kelas yang ditugaskan kepada Anda.</div>'); return; }
        const classId = params.get('kelas') || (home.wali_kelas[0]?.class_id) || classes[0].class_id;
        const bulan = /^\d{4}-\d{2}$/.test(params.get('bulan') || '') ? params.get('bulan') : home.today.slice(0, 7);
        main(`<div class="g-date-row">
                <div class="att-field"><label for="gRkKelas">Kelas</label>${classSelect('gRkKelas', classId)}</div>
                <div class="att-field"><label for="gRkBulan">Bulan</label><input type="month" class="att-input" id="gRkBulan" value="${esc(bulan)}" max="${esc(home.today.slice(0, 7))}"></div>
            </div><div id="gRekap"><div class="g-loading">Memuat…</div></div>`);
        const reload = () => go(`/rekap?kelas=${$('gRkKelas').value}&bulan=${$('gRkBulan').value || bulan}`);
        $('gRkKelas').addEventListener('change', reload);
        $('gRkBulan').addEventListener('change', reload);
        try {
            const [y, m] = bulan.split('-').map(Number);
            const r = await rpc('get_class_month_recap', { p_class_id: classId, p_year: y, p_month: m });
            const days = r.hari || [];
            const filled = days.filter((d) => d.diisi).length;
            const rows = (r.siswa || []).map((s) => {
                const t = { H: 0, S: 0, I: 0, A: 0, D: 0 };
                for (const v of Object.values(s.status || {})) t[v] = (t[v] || 0) + 1;
                const base = t.H + t.S + t.I + t.A;
                return { ...s, t, pct: base ? Math.round((t.H / base) * 100) : null };
            });
            const cards = rows.map((s) => `<div class="att-student-card">
                <div><b>${esc(s.no)}. ${esc(s.nama)}</b><div class="att-muted">${s.pct === null ? 'Belum ada data' : `Hadir ${s.pct}%`}</div></div>
                <div class="tot">${['S', 'I', 'A', 'D'].map((k) => (s.t[k] ? `<span class="att-badge ${k === 'A' ? 'bad' : k === 'S' ? 'warn' : k === 'I' ? 'info' : 'mute'}">${k} ${s.t[k]}</span>` : '')).join('') || (s.pct === null ? '' : '<span class="att-badge ok">Selalu hadir</span>')}</div>
            </div>`).join('');
            const head = days.map((d) => `<th class="${d.libur ? 'libur' : ''}">${Number(d.tanggal.slice(8))}</th>`).join('');
            const body = rows.map((s) => `<tr><td>${esc(s.no)}</td><td class="nm">${esc(s.nama)}</td><td>${esc(s.jk || '')}</td>${days.map((d) => {
                const v = s.status[d.tanggal];
                return `<td class="${d.libur ? 'libur' : ''} ${v ? `c-${v}` : ''}">${v && v !== 'H' ? v : (v ? '•' : '')}</td>`;
            }).join('')}<td>${s.t.S}</td><td>${s.t.I}</td><td>${s.t.A}</td></tr>`).join('');
            $('gRekap').innerHTML = `
                <div class="att-alert info" style="margin-bottom:12px">Kelas ${esc(romawi(r.kelas))} · ${esc(window.Att.BULAN[m - 1])} ${y}: absensi diisi ${filled} dari ${esc(r.hari_efektif)} hari sekolah.</div>
                <div class="att-student-cards">${cards || '<div class="att-alert info">Belum ada siswa.</div>'}</div>
                <details style="margin-top:16px"><summary class="att-btn att-btn-ghost att-btn-sm">Lihat tabel per tanggal</summary>
                    <div class="att-recap-wrap" style="margin-top:10px"><table class="att-recap">
                        <thead><tr><th>No</th><th>Nama</th><th>L/P</th>${head}<th>S</th><th>I</th><th>A</th></tr></thead>
                        <tbody>${body}</tbody></table></div>
                    <p class="att-muted">• = hadir. Kolom merah = Sabtu, Minggu, atau hari libur.</p>
                </details>
                <h2>Cetak &amp; unduh</h2>
                <div class="att-card att-stack">
                    <div class="att-row"><b style="flex:1 1 100%">Daftar hadir ${esc(window.Att.BULAN[m - 1])} ${y}</b>
                        <button type="button" class="att-btn att-btn-ghost" id="gRkPrint" style="flex:1">Cetak / PDF</button>
                        <button type="button" class="att-btn att-btn-ghost" id="gRkXlsx" style="flex:1">Excel</button></div>
                    <div class="att-field"><label for="gRkSem">Rekap semester (untuk rapor)</label>
                        <select class="att-select" id="gRkSem"><option value="1" ${m >= 7 ? 'selected' : ''}>Semester Ganjil (Jul–Des)</option><option value="2" ${m < 7 ? 'selected' : ''}>Semester Genap (Jan–Jun)</option></select></div>
                    <div class="att-row"><button type="button" class="att-btn att-btn-ghost" id="gRkSemPrint" style="flex:1">Cetak / PDF</button>
                        <button type="button" class="att-btn att-btn-ghost" id="gRkSemXlsx" style="flex:1">Excel</button></div>
                    <p class="att-muted" style="margin:0">Format sama dengan daftar hadir kertas, tanda tangan Kepala Sekolah dan wali kelas.</p>
                </div>`;
            wireRekapExports(classId, r);
        } catch (err) {
            $('gRekap').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
        }
    }

    function wireRekapExports(classId, monthRecap) {
        const RP = window.RekapPrint;
        let header = null;
        const getHeader = async () => (header ||= await rpc('get_class_report_header', { p_class_id: classId }));
        const myWali = () => {
            const w = home.wali_kelas.find((x) => x.class_id === classId);
            return w ? w.posisi : 1;
        };
        const guard = (fn) => async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await fn(); } catch (err) { toast(errMessage(err), 'err'); } finally { btn.disabled = false; }
        };
        const print = (html) => { if (!RP.print(html)) toast('Pop-up diblokir. Izinkan pop-up untuk situs ini.', 'err'); };
        $('gRkPrint').addEventListener('click', guard(async () => print(RP.monthlyHtml(monthRecap, await getHeader(), { wali: myWali() }))));
        $('gRkXlsx').addEventListener('click', guard(async () => {
            const h = await getHeader();
            RP.download(RP.monthlyXlsx(monthRecap, h, { wali: myWali() }), `${RP.fileName('Daftar_Hadir', h, `${window.Att.BULAN[monthRecap.bulan - 1]}_${monthRecap.tahun}`)}.xlsx`);
            toast('File Excel diunduh.');
        }));
        const sem = async () => {
            const s = Number($('gRkSem').value);
            const [recap, h] = await Promise.all([rpc('get_class_semester_recap', { p_class_id: classId, p_semester: s }), getHeader()]);
            return { recap, h, s };
        };
        $('gRkSemPrint').addEventListener('click', guard(async () => { const d = await sem(); print(RP.semesterHtml(d.recap, d.h, { wali: myWali() })); }));
        $('gRkSemXlsx').addEventListener('click', guard(async () => {
            const d = await sem();
            RP.download(RP.semesterXlsx(d.recap, d.h, { wali: myWali() }), `${RP.fileName('Rekap_Semester', d.h, `${d.s === 1 ? 'Ganjil' : 'Genap'}_${d.h.tahun_ajaran}`)}.xlsx`);
            toast('File Excel diunduh.');
        }));
    }

    // ------------------------------------------------------------------ akun
    function renderAkun() {
        setNav('akun');
        setTop('Akun', '');
        main(`<div class="att-card">
                <b>${esc(home.nama)}</b>
                <div class="att-muted">${esc(home.jabatan || '')}${userEmail ? ` · ${esc(userEmail)}` : ''}</div>
            </div>
            <h2>Ganti password</h2>
            <form class="att-card att-stack" id="gPwForm" novalidate>
                <div class="att-field"><label for="gPw1">Password baru</label><input class="att-input" id="gPw1" type="password" autocomplete="new-password" minlength="8"></div>
                <div class="att-field"><label for="gPw2">Ulangi password baru</label><input class="att-input" id="gPw2" type="password" autocomplete="new-password" minlength="8"></div>
                <p class="att-muted" style="margin:0">Minimal 8 karakter. Jangan pakai tanggal lahir atau NIP.</p>
                <button type="submit" class="att-btn att-btn-primary">Simpan password</button>
            </form>
            ${home.is_admin ? '<a class="att-btn att-btn-ghost att-btn-block" style="margin-top:16px" href="/admin">Buka Panel Admin</a>' : ''}
            <button type="button" class="att-btn att-btn-danger att-btn-block" id="gLogout" style="margin-top:16px">Keluar</button>`);
        $('gLogout').addEventListener('click', logout);
        $('gPwForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const a = $('gPw1').value;
            const b = $('gPw2').value;
            if (a.length < 8) return toast('Password minimal 8 karakter.', 'err');
            if (a !== b) return toast('Kedua password tidak sama.', 'err');
            const { error } = await sb.auth.updateUser({ password: a });
            if (error) return toast(errMessage(error), 'err');
            $('gPw1').value = '';
            $('gPw2').value = '';
            toast('Password berhasil diganti.');
        });
    }

    // ------------------------------------------------------------------ router
    async function route() {
        if (!home) return;
        document.body.classList.remove('g-sheet-open');
        const { path, params } = parseHash();
        if (path === '/' || path === '') return renderHome();
        if (path === '/absen') return renderAbsen(params);
        if (path === '/siswa') return renderSiswa(params);
        if (path.startsWith('/siswa/')) return renderProfil(path.slice(7));
        if (path === '/rekap') return renderRekap(params);
        if (path === '/akun') return renderAkun();
        go('/');
    }

    $('gBack').addEventListener('click', () => {
        if (history.length > 1) history.back(); else go('/');
    });
    window.addEventListener('hashchange', route);

    async function boot() {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return showLogin('');
        userEmail = session.user?.email || '';
        try {
            home = await rpc('get_guru_home');
        } catch (err) {
            await sb.auth.signOut();
            return showLogin(/terhubung/.test(err.message)
                ? 'Akun ini belum terhubung ke data guru. Hubungi admin sekolah.'
                : errMessage(err));
        }
        $('gLogin').classList.add('g-hidden');
        $('gApp').classList.remove('g-hidden');
        await route();
    }

    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { home = null; showLogin(''); }
    });

    boot();
})();
