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
    let forceChange = false;  // password masih password awal → wajib ganti dulu
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

    /** Panel filter/ringkasan yang menempel di bawah header saat digulir. */
    function floatBar(el) { return window.Att.floatBar(el, document.querySelector('.g-top')); }

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
        showReset(false);
        const err = $('gLoginErr');
        err.className = 'att-alert err';
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
        $('gLoginErr').classList.add('g-hidden');
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

    // ------------------------------------------------------------------ ganti password
    async function changePassword(password) {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch('/api/guru-change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
            body: JSON.stringify({ password }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error?.message || 'Gagal mengganti password.');
    }

    /** Password masih password awal (NIP/NUPTK)? Guru harus membuat password baru dulu. */
    async function mustChangePassword() {
        try {
            const { data: { session } } = await sb.auth.getSession();
            if (!session?.user?.id) return false;
            const { data } = await sb.from('teacher_accounts').select('must_change_password').eq('user_id', session.user.id).maybeSingle();
            return Boolean(data?.must_change_password);
        } catch { return false; }
    }

    function renderForceChange() {
        document.body.classList.add('g-sheet-open');   // sembunyikan menu bawah
        setTop('Buat password baru', '');
        main(`<div class="att-alert warn" style="margin-bottom:12px"><b>Password Anda masih password awal (NIP/NUPTK).</b> Demi keamanan data siswa, buat password baru dulu sebelum lanjut.</div>
            <form class="att-card att-stack" id="gForceForm" novalidate>
                <div class="att-field"><label for="gF1">Password baru</label><input class="att-input" id="gF1" type="password" autocomplete="new-password" minlength="8"></div>
                <div class="att-field"><label for="gF2">Ulangi password baru</label><input class="att-input" id="gF2" type="password" autocomplete="new-password" minlength="8"></div>
                <p class="att-muted" style="margin:0">Minimal 8 karakter, tidak boleh sama dengan NIP/NUPTK. Setelah ini buat juga PIN pemulihan di menu Akun supaya bisa reset sendiri kalau lupa.</p>
                <div class="att-alert err g-hidden" id="gForceErr" role="alert"></div>
                <button type="submit" class="att-btn att-btn-primary" id="gForceBtn">Simpan &amp; lanjut</button>
            </form>
            <button type="button" class="att-btn att-btn-ghost att-btn-block" id="gForceOut" style="margin-top:12px">Keluar</button>`);
        $('gForceOut').addEventListener('click', logout);
        $('gForceForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fail = (m) => { const el = $('gForceErr'); el.textContent = m; el.classList.remove('g-hidden'); };
            const a = $('gF1').value;
            if (a.length < 8) return fail('Password baru minimal 8 karakter.');
            if (a !== $('gF2').value) return fail('Kedua password tidak sama.');
            const btn = $('gForceBtn');
            btn.disabled = true; btn.textContent = 'Menyimpan…';
            try {
                await changePassword(a);
                forceChange = false;
                toast('Password baru tersimpan.');
                location.hash = '#/';
                route();
            } catch (err) {
                fail(errMessage(err));
                btn.disabled = false; btn.textContent = 'Simpan & lanjut';
            }
        });
    }

    // ------------------------------------------------------------------ lupa password (PIN)
    function showReset(on) {
        $('gLoginBox').classList.toggle('g-hidden', on);
        $('gResetBox').classList.toggle('g-hidden', !on);
        $('gResetErr').classList.add('g-hidden');
        if (on) {
            if (!$('gRId').value) $('gRId').value = $('gId').value.trim();
            ($('gRId').value ? $('gRPin') : $('gRId')).focus();
        }
    }
    $('gForgot').addEventListener('click', () => showReset(true));
    $('gResetBack').addEventListener('click', () => { showReset(false); $('gId').focus(); });
    $('gRPin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6); });

    $('gResetForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fail = (m) => { const el = $('gResetErr'); el.textContent = m; el.classList.remove('g-hidden'); };
        const identifier = $('gRId').value.trim();
        const pin = $('gRPin').value.trim();
        const a = $('gRPw1').value;
        const b = $('gRPw2').value;
        if (!identifier) return fail('Isi email atau NIP/NUPTK.');
        if (!/^[0-9]{6}$/.test(pin)) return fail('PIN harus 6 angka.');
        if (a.length < 8) return fail('Password baru minimal 8 karakter.');
        if (a !== b) return fail('Kedua password baru tidak sama.');
        const btn = $('gResetBtn');
        btn.disabled = true;
        btn.textContent = 'Memeriksa…';
        try {
            const res = await fetch('/api/guru-reset-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, pin, password: a }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error?.message || 'Gagal mengganti password. Coba lagi.');
            $('gRPin').value = ''; $('gRPw1').value = ''; $('gRPw2').value = '';
            $('gId').value = identifier;
            showReset(false);
            const ok = $('gLoginErr');
            ok.className = 'att-alert ok';
            ok.textContent = 'Password berhasil diganti. Silakan masuk dengan password baru.';
            $('gPw').focus();
        } catch (err) {
            fail(errMessage(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Ganti password';
        }
    });

    async function logout() {
        await sb.auth.signOut();
        home = null;
        staffExtra = null;
        forceChange = false;
        pinStatus = null;
        homeDay = null;
        location.hash = '#/';
        showLogin('');
    }

    // ------------------------------------------------------------------ beranda
    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const ICON = {
        home: '<svg viewBox="0 0 24 24"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
        clip: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/></svg>',
        user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
        book: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
        board: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
        clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        cal: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
        chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    };
    let staffExtra = null;      // { image_url, nip } dari data Guru & Staf di website
    let pinStatus = null;       // { ada, dibuat, terkunci } — PIN pemulihan milik sendiri

    async function loadPinStatus(force = false) {
        if (pinStatus && !force) return pinStatus;
        try { pinStatus = (await rpc('get_my_recovery_pin')) || { ada: false }; } catch { pinStatus = null; }
        return pinStatus;
    }
    let homeDay = null;         // tanggal (ISO) yang dipilih di kartu "Jadwal"

    const kelasTitik = (k) => String(k || '').replace(/\s+/, '.');
    const isoAdd = (iso, n) => {
        const [y, m, d] = iso.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    };
    const dow = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
    const initials = (nama) => shortName(nama).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');

    /** Foto & NIP guru diambil dari data Guru & Staf yang sudah tampil di website (data publik). */
    async function loadStaffExtra() {
        if (staffExtra || !home?.staff_id) return;
        try {
            const { data } = await sb.from('staff').select('image_url, nip').eq('id', home.staff_id).maybeSingle();
            staffExtra = { image_url: safeUrl(data?.image_url), nip: String(data?.nip || '').replace(/^\s*NIP\.?\s*/i, '') };
        } catch { staffExtra = { image_url: '', nip: '' }; }
        await loadPinStatus();
        if (parseHash().path === '/' && home) renderHome();
    }

    function renderHome() {
        setNav('home');
        setTop('Dashboard Guru', fmtDate(home.today));
        loadStaffExtra();
        const today = home.today;
        const monday = isoAdd(today, -((dow(today) + 6) % 7));
        const week = [0, 1, 2, 3, 4].map((i) => isoAdd(monday, i));
        if (!homeDay || !week.includes(homeDay)) homeDay = week.includes(today) ? today : week[4];
        const parts = [];

        parts.push(`<div class="g-welcome"><b>${ICON.home} Dashboard Guru</b>
            <span class="att-muted">Selamat datang, <b>${esc(home.nama)}</b>${staffExtra?.nip ? ` (${esc(staffExtra.nip)})` : ''}</span></div>`);

        // Kartu utama: tugas absensi terdekat
        const wali0 = home.wali_kelas[0];
        const mapel0 = home.mapel.find((m) => !m.hari_ini) || home.mapel[0];
        const target = wali0
            ? { kelas: wali0.kelas, label: wali0.posisi === 2 ? 'Wali Pendamping' : 'Wali Kelas', href: `#/absen?kelas=${wali0.class_id}&tanggal=${today}&jenis=harian`, done: Boolean(wali0.hari_ini) }
            : mapel0 ? { kelas: mapel0.kelas, label: mapel0.kode, href: `#/absen?kelas=${mapel0.class_id}&tanggal=${today}&jenis=mapel&mapel=${mapel0.subject_id}`, done: Boolean(mapel0.hari_ini) } : null;
        const avatar = staffExtra?.image_url
            ? `<img src="${esc(staffExtra.image_url)}" alt="Foto ${esc(shortName(home.nama))}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc(initials(home.nama))}'}))">`
            : `<span>${esc(initials(home.nama))}</span>`;
        parts.push(`<section class="g-hero" aria-label="Jadwal mengajar terdekat">
            <div class="g-hero-ava">${avatar}</div>
            <div class="g-hero-body">
                <small>JADWAL MENGAJAR TERDEKAT</small>
                <strong>${target ? `KELAS ${esc(kelasTitik(target.kelas))} — <i>${esc(target.label)}</i>` : esc(home.jabatan || 'Belum ada kelas')}</strong>
                <div class="g-hero-meta"><span class="g-hero-day">Hari ${HARI[dow(today)]}</span><span>Jam pelajaran: <b>segera hadir</b></span></div>
            </div>
            ${target && home.is_school_day ? `<a class="g-hero-btn" href="${target.href}">${ICON.clip}${target.done ? 'Lihat Absensi' : 'Mulai Absensi'}</a>` : ''}
        </section>`);

        if (pinStatus && !pinStatus.ada) {
            parts.push(`<div class="att-alert warn g-pin-nudge" style="margin-bottom:12px"><b>Buat PIN pemulihan</b> supaya kalau lupa password bisa reset sendiri tanpa admin.
                <a href="#/akun" style="font-weight:700">Buat sekarang →</a></div>`);
        }
        if (!home.is_school_day) {
            parts.push(`<div class="att-alert warn" style="margin-bottom:12px">Hari ini libur${home.holiday_name ? ` (${esc(home.holiday_name)})` : ''}. Absensi tidak perlu diisi.</div>`);
        }

        for (const w of home.wali_kelas) {
            const t = w.hari_ini;
            const rekap = t?.rekap || {};
            const absen = ['S', 'I', 'A', 'D'].filter((k) => rekap[k]).map((k) => `${rekap[k]} ${window.Att.STATUS[k].toLowerCase()}`).join(', ');
            const href = `#/absen?kelas=${w.class_id}&tanggal=${today}&jenis=harian`;
            parts.push(`<section class="g-box g-task ${t ? 'done' : 'todo'}">
                <header class="g-box-head"><span class="g-tag wali">${ICON.user}${w.posisi === 2 ? 'WALI PENDAMPING' : 'WALI KELAS'}</span><b>KELAS ${esc(kelasTitik(w.kelas))}</b>
                    ${t ? `<span class="att-badge ok">Sudah diisi ${esc(t.disimpan)}</span>` : (home.is_school_day ? '<span class="att-badge bad">Belum diisi</span>' : '')}</header>
                <div class="g-box-body">
                    <p class="att-muted" style="margin:0 0 12px">Anda bisa mengisi absensi harian untuk seluruh siswa di kelas ini (${esc(w.jumlah_siswa)} siswa).${t ? ` Hari ini: ${rekap.H || 0} hadir${absen ? `, ${esc(absen)}` : ''}.` : ''}</p>
                    <a class="att-btn att-btn-blue att-btn-block g-task-go" href="${href}">${ICON.clip}${t ? (t.terkunci ? `Lihat Absensi KELAS ${esc(kelasTitik(w.kelas))}` : `Lihat / Ubah Absensi KELAS ${esc(kelasTitik(w.kelas))}`) : `Absensi KELAS ${esc(kelasTitik(w.kelas))} Hari Ini`}</a>
                    <p class="att-muted" style="margin:8px 0 0">Tanggal lain bisa dipilih di dalam halaman absensi.</p>
                </div>
            </section>`);
        }

        if (home.mapel.length) {
            const future = homeDay > today;
            const rows = home.mapel.map((m) => {
                const done = homeDay === today && m.hari_ini;
                const inner = `<span class="g-sched-ico">${ICON.board}</span>
                    <span class="g-sched-txt"><b>KELAS ${esc(kelasTitik(m.kelas))}${done ? ' ✓' : ''}</b>
                        <span>${ICON.book}${esc(m.mapel)}</span>
                        <span class="g-time">${ICON.clock}Jam: segera hadir</span></span>${ICON.chev}`;
                return future
                    ? `<div class="g-sched off" aria-disabled="true">${inner}</div>`
                    : `<a class="g-sched g-chip ${done ? 'done' : ''}" href="#/absen?kelas=${m.class_id}&tanggal=${homeDay}&jenis=mapel&mapel=${m.subject_id}">${inner}</a>`;
            }).join('');
            parts.push(`<section class="g-box">
                <header class="g-box-head"><span class="g-tag mapel">${ICON.book}GURU MAPEL</span><b>Jadwal ${homeDay === today ? 'Hari Ini' : ''} — ${HARI[dow(homeDay)]}</b>
                    <span class="att-badge mute">${home.mapel.length} kelas</span></header>
                <div class="g-box-body">
                    <div class="g-days" role="tablist" aria-label="Pilih hari">${week.map((d) => `<button type="button" role="tab" data-day="${d}" aria-selected="${d === homeDay}">${HARI[dow(d)].slice(0, 3)}<small>${Number(d.slice(8))}</small></button>`).join('')}</div>
                    ${future ? '<div class="att-alert info" style="margin-bottom:10px">Tanggal ini belum tiba, absensi belum bisa diisi.</div>' : ''}
                    <div class="g-sched-list">${rows}</div>
                    <p class="att-muted" style="margin:10px 0 0">Jam pelajaran per hari menyusul di fitur Jadwal Kelas. Untuk sekarang semua kelas yang Anda ajar ditampilkan.</p>
                </div>
            </section>`);
        }

        parts.push(`<section class="g-box g-soon">
            <header class="g-box-head"><span class="g-tag soon">${ICON.cal}JADWAL KELAS</span><b>Jadwal pelajaran</b><span class="att-badge warn">Segera hadir</span></header>
            <div class="g-box-body"><p class="att-muted" style="margin:0">Jadwal pelajaran per kelas lengkap dengan jam mengajar akan tampil di sini.</p></div>
        </section>`);

        if (home.is_pimpinan && home.semua_kelas.length) {
            parts.push(`<section class="g-box"><header class="g-box-head"><span class="g-tag soon">${ICON.board}PANTAU SEKOLAH</span><b>Rekap semua kelas</b></header>
                <div class="g-box-body"><div class="g-chips">${home.semua_kelas.map((c) => `<a class="g-chip" href="#/rekap?kelas=${c.class_id}">${esc(c.kelas)}</a>`).join('')}</div></div></section>`);
        }

        if (!home.wali_kelas.length && !home.mapel.length && !home.is_pimpinan) {
            parts.push('<div class="att-alert info">Belum ada kelas yang ditugaskan kepada Anda. Hubungi admin sekolah.</div>');
        }
        const keepY = window.scrollY;
        main(parts.join(''));
        $('gMain').querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
            homeDay = b.dataset.day;
            const y = window.scrollY;
            renderHome();
            window.scrollTo(0, y);
        }));
        if (keepY && staffExtra) window.scrollTo(0, keepY);
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
        main(`<div id="gFloat">${picker}<div id="gSheetHead"></div></div><div id="gSheet"><div class="g-loading">Memuat daftar siswa…</div></div>`);
        floatBar($('gFloat'));
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
                headHost: $('gSheetHead'),
                notes: subj && /^PAI/i.test(subj.kode || '') ? ['Bagi yang beragama <b>Non-Muslim</b>, mohon diberi status <b>Dispensasi</b>.'] : [],
                back: { href: '#/', label: 'Kembali ke Menu Utama' },
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
        main(`<div id="gFloat"><div class="att-field" style="margin-bottom:8px"><label for="gKelas">Kelas</label>${classSelect('gKelas', classId)}</div><div id="gSiswaTools"></div></div>
            <div id="gSiswa"><div class="g-loading">Memuat…</div></div>`);
        floatBar($('gFloat'));
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
            // Kolom Cari & Tampilkan ikut ke panel yang menempel di atas.
            const tools = $('gSiswa').querySelector('.att-table-tools');
            if (tools && $('gSiswaTools')) $('gSiswaTools').appendChild(tools);
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
        main(`<div id="gFloat"><div class="g-date-row">
                <div class="att-field"><label for="gRkKelas">Kelas</label>${classSelect('gRkKelas', classId)}</div>
                <div class="att-field"><label for="gRkBulan">Bulan</label><input type="month" class="att-input" id="gRkBulan" value="${esc(bulan)}" max="${esc(home.today.slice(0, 7))}"></div>
            </div><div id="gRkInfo"></div></div><div id="gRekap"><div class="g-loading">Memuat…</div></div>`);
        floatBar($('gFloat'));
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
                const base = t.H + t.S + t.I + t.A + t.D;   // dispensasi dihitung hadir
                return { ...s, t, pct: base ? Math.round(((t.H + t.D) / base) * 100) : null };
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
            $('gRkInfo').innerHTML = `<div class="att-alert info">Kelas ${esc(romawi(r.kelas))} · ${esc(window.Att.BULAN[m - 1])} ${y}: absensi diisi ${filled} dari ${esc(r.hari_efektif)} hari sekolah.</div>`;
            $('gRekap').innerHTML = `
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
            RP.download(RP.monthlyXlsx(monthRecap, h, { wali: myWali(), logoPng: await RP.loadLogo() }), `${RP.fileName('Daftar_Hadir', h, `${window.Att.BULAN[monthRecap.bulan - 1]}_${monthRecap.tahun}`)}.xlsx`);
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
            RP.download(RP.semesterXlsx(d.recap, d.h, { wali: myWali(), logoPng: await RP.loadLogo() }), `${RP.fileName('Rekap_Semester', d.h, `${d.s === 1 ? 'Ganjil' : 'Genap'}_${d.h.tahun_ajaran}`)}.xlsx`);
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
            <h2 id="gPinTitle">PIN pemulihan</h2>
            <div class="att-card att-stack g-pin-card" id="gPinCard"><div class="att-muted">Memuat…</div></div>
            ${home.is_admin ? '<a class="att-btn att-btn-ghost att-btn-block" style="margin-top:16px" href="/admin">Buka Panel Admin</a>' : ''}
            <button type="button" class="att-btn att-btn-danger att-btn-block" id="gLogout" style="margin-top:16px">Keluar</button>`);
        $('gLogout').addEventListener('click', logout);
        $('gPwForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const a = $('gPw1').value;
            const b = $('gPw2').value;
            if (a.length < 8) return toast('Password minimal 8 karakter.', 'err');
            if (a !== b) return toast('Kedua password tidak sama.', 'err');
            try { await changePassword(a); } catch (err) { return toast(errMessage(err), 'err'); }
            $('gPw1').value = '';
            $('gPw2').value = '';
            toast('Password berhasil diganti.');
        });
        renderPinCard();
    }

    async function renderPinCard() {
        const st = await loadPinStatus(true);
        const card = $('gPinCard');
        if (!card) return;
        const status = !st ? '<span class="att-badge mute">Status tidak terbaca</span>'
            : st.ada ? `<span class="att-badge ok">Sudah dibuat${st.dibuat ? ` · ${esc(st.dibuat)}` : ''}</span>`
                : '<span class="att-badge warn">Belum dibuat</span>';
        card.innerHTML = `
            <div class="att-row"><b>Status</b>${status}</div>
            <p class="att-muted" style="margin:0">PIN 6 angka dipakai di halaman masuk (<i>Lupa password?</i>) untuk mengganti password sendiri tanpa admin. Simpan baik-baik, jangan dibagikan, dan jangan pakai tanggal lahir atau 123456.</p>
            <form class="att-stack" id="gPinForm" novalidate>
                <div class="att-field"><label for="gPinPw">Password saat ini</label><input class="att-input" id="gPinPw" type="password" autocomplete="current-password"></div>
                <div class="att-field"><label for="gPin1">${st?.ada ? 'PIN baru' : 'PIN'} (6 angka)</label><input class="att-input g-pin" id="gPin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></div>
                <div class="att-field"><label for="gPin2">Ulangi PIN</label><input class="att-input g-pin" id="gPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></div>
                <button type="submit" class="att-btn att-btn-primary" id="gPinBtn">${st?.ada ? 'Ganti PIN' : 'Simpan PIN'}</button>
            </form>`;
        for (const id of ['gPin1', 'gPin2']) $(id).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6); });
        $('gPinForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = $('gPinPw').value;
            const pin = $('gPin1').value;
            if (!password) return toast('Isi password Anda saat ini.', 'err');
            if (!/^[0-9]{6}$/.test(pin)) return toast('PIN harus 6 angka.', 'err');
            if (pin !== $('gPin2').value) return toast('Kedua PIN tidak sama.', 'err');
            const btn = $('gPinBtn');
            btn.disabled = true;
            btn.textContent = 'Menyimpan…';
            try {
                const { data: { session } } = await sb.auth.getSession();
                const res = await fetch('/api/guru-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
                    body: JSON.stringify({ password, pin }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body?.error?.message || 'Gagal menyimpan PIN.');
                toast('PIN pemulihan tersimpan.');
                await renderPinCard();
            } catch (err) {
                toast(errMessage(err), 'err');
                btn.disabled = false;
                btn.textContent = 'Simpan PIN';
            }
        });
    }

    // ------------------------------------------------------------------ router
    async function route() {
        if (!home) return;
        document.body.classList.remove('g-sheet-open');
        if (forceChange) return renderForceChange();
        const { path, params } = parseHash();
        if (path === '/' || path === '') return renderHome();
        if (path === '/absen') return renderAbsen(params);
        if (path === '/siswa') return renderSiswa(params);
        if (path.startsWith('/siswa/')) return renderProfil(path.slice(7));
        if (path === '/rekap') return renderRekap(params);
        if (path === '/akun') return renderAkun();
        go('/');
    }

    $('gTopOut').addEventListener('click', async () => {
        if (await window.Att.confirm({ title: 'Keluar dari Portal Guru?', confirmText: 'Keluar', danger: true })) logout();
    });

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
        forceChange = await mustChangePassword();
        $('gLogin').classList.add('g-hidden');
        $('gApp').classList.remove('g-hidden');
        await route();
    }

    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { home = null; showLogin(''); }
    });

    boot();
})();
