// =============================================================================
// Panel Admin — tab Akun Guru dan Kelola Absensi (Fase 1).
//   Akun Guru     : daftar email/NIP, buat akun (password tampil sekali), reset,
//                   aktif/nonaktif, edit, hapus dari daftar. Lewat /api/admin/teacher-accounts.
//   Kelola Absensi: admin mengisi atau mengoreksi absensi rombel mana pun
//                   (wajib alasan untuk koreksi), arsip sesi, lihat riwayat.
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const { esc, fmtDate, todayJakarta, errMessage, toast } = window.Att;
    const $ = (id) => document.getElementById(id);
    const loaded = { accounts: false, attendance: false };

    async function token() {
        const { data: { session } } = await sb.auth.getSession();
        return session?.access_token || '';
    }

    async function api(method, body) {
        const res = await fetch('/api/admin/teacher-accounts', {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message || `Gagal (HTTP ${res.status}).`);
        return json;
    }

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw new Error(error.message);
        return data;
    }

    // ========================================================== AKUN GURU
    const STATUS_BADGE = {
        aktif: '<span class="att-badge ok">Aktif</span>',
        nonaktif: '<span class="att-badge bad">Nonaktif</span>',
        siap_dibuat: '<span class="att-badge warn">Siap dibuat</span>',
        belum_didaftarkan: '<span class="att-badge mute">Belum didaftarkan</span>',
    };
    let accTable = null;
    let accRows = [];

    function showPasswords(results, title) {
        const ok = results.filter((r) => r.ok && r.password);
        const fail = results.filter((r) => !r.ok);
        const lines = ok.map((r) => `${r.nama}\t${r.email}\t${r.login_id || '-'}\t${r.password}`).join('\n');
        const back = document.createElement('div');
        back.className = 'att-sheet-backdrop';
        back.innerHTML = `<div class="att-sheet" role="dialog" aria-modal="true" aria-labelledby="accPwTitle" style="max-width:720px">
            <h3 id="accPwTitle">${esc(title)}</h3>
            ${ok.length ? `<div class="att-alert warn" style="margin:8px 0 12px">Password hanya tampil <b>sekali ini</b>. Salin atau cetak sekarang, lalu bagikan langsung ke tiap guru. Guru bisa menggantinya sendiri di menu Akun.</div>
            <div style="overflow-x:auto"><table class="att-table"><thead><tr><th>Nama</th><th>Login (email / NIP)</th><th>Password awal</th></tr></thead><tbody>
            ${ok.map((r) => `<tr><td data-label="Nama">${esc(r.nama)}</td><td data-label="Login">${esc(r.email)}${r.login_id ? `<br><span class="att-muted">${esc(r.login_id)}</span>` : ''}</td>
                <td data-label="Password"><code style="font-size:1.05rem;letter-spacing:.5px">${esc(r.password)}</code></td></tr>`).join('')}
            </tbody></table></div>` : ''}
            ${fail.length ? `<div class="att-alert err" style="margin-top:12px"><b>${fail.length} gagal:</b><ul style="margin:6px 0 0;padding-left:18px">${fail.map((r) => `<li>${esc(r.nama || r.staff_id)} — ${esc(r.pesan)}</li>`).join('')}</ul></div>` : ''}
            <div class="att-row" style="margin-top:16px">
                ${ok.length ? '<button type="button" class="att-btn att-btn-ghost" data-act="copy" style="flex:1">Salin semua</button><button type="button" class="att-btn att-btn-ghost" data-act="print" style="flex:1">Cetak</button>' : ''}
                <button type="button" class="att-btn att-btn-primary" data-act="close" style="flex:1">Sudah saya catat</button>
            </div></div>`;
        back.addEventListener('click', async (e) => {
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'copy') {
                try { await navigator.clipboard.writeText(`Nama\tEmail\tNIP/NUPTK\tPassword\n${lines}`); toast('Disalin. Tempel ke catatan yang aman.'); } catch { toast('Tidak bisa menyalin otomatis. Catat manual.', 'err'); }
            }
            if (act === 'print') {
                const w = window.open('', '_blank', 'width=800,height=600');
                if (w) {
                    w.document.write(`<!doctype html><meta charset="utf-8"><title>Akun Guru</title><style>body{font-family:Arial;padding:24px}td,th{border:1px solid #999;padding:6px 8px;text-align:left}table{border-collapse:collapse;width:100%}</style>
                        <h2>Akun Portal Guru — SDN Kalibaru 05 Pagi</h2><p>Login di <b>sdnkalibaru05.sch.id/guru</b> memakai email atau NIP/NUPTK. Ganti password setelah login pertama (menu Akun).</p>
                        <table><tr><th>Nama</th><th>Email</th><th>NIP/NUPTK</th><th>Password awal</th></tr>${ok.map((r) => `<tr><td>${esc(r.nama)}</td><td>${esc(r.email)}</td><td>${esc(r.login_id || '-')}</td><td>${esc(r.password)}</td></tr>`).join('')}</table>`);
                    w.document.close();
                    w.print();
                }
            }
            if (act === 'close') back.remove();
        });
        document.body.appendChild(back);
    }

    function editForm(row) {
        return new Promise((resolve) => {
            const back = document.createElement('div');
            back.className = 'att-sheet-backdrop';
            back.innerHTML = `<form class="att-sheet" role="dialog" aria-modal="true" aria-labelledby="accEditTitle" novalidate>
                <h3 id="accEditTitle">${row.email ? 'Ubah' : 'Daftarkan'} akun ${esc(row.nama)}</h3>
                <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
                    <div class="att-field"><label for="accEmail">Email login</label><input class="att-input" id="accEmail" type="email" value="${esc(row.email || '')}" required autocapitalize="none"></div>
                    <div class="att-field"><label for="accNip">NIP / NUPTK (boleh kosong)</label><input class="att-input" id="accNip" inputmode="numeric" value="${esc(row.login_id || '')}"></div>
                    <label class="att-row" style="font-size:.9rem"><input type="checkbox" id="accAdmin" ${row.admin ? 'checked' : ''} ${row.status === 'aktif' || row.status === 'nonaktif' ? 'disabled' : ''}> Jadikan admin absensi</label>
                    ${row.status === 'aktif' || row.status === 'nonaktif' ? '<p class="att-muted" style="margin:0">Peran admin untuk akun yang sudah dibuat diatur di Supabase.</p>' : ''}
                </div>
                <div class="att-row" style="margin-top:16px">
                    <button type="button" class="att-btn att-btn-ghost" data-act="no" style="flex:1">Batal</button>
                    <button type="submit" class="att-btn att-btn-primary" style="flex:1">Simpan</button>
                </div></form>`;
            const done = (v) => { back.remove(); resolve(v); };
            back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-act="no"]')) done(null); });
            back.querySelector('form').addEventListener('submit', (e) => {
                e.preventDefault();
                done({
                    staff_id: row.staff_id,
                    email: $('accEmail').value,
                    login_id: $('accNip').value,
                    make_admin: $('accAdmin').checked,
                });
            });
            document.body.appendChild(back);
            $('accEmail').focus();
        });
    }

    function accActions(r) {
        const b = [];
        b.push(`<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-acc="edit" data-id="${esc(r.staff_id)}">${r.email ? 'Edit' : 'Daftarkan'}</button>`);
        if (r.status === 'siap_dibuat') {
            b.push(`<button type="button" class="att-btn att-btn-primary att-btn-sm" data-acc="create" data-id="${esc(r.staff_id)}">Buat akun</button>`);
            b.push(`<button type="button" class="att-btn att-btn-danger att-btn-sm" data-acc="delete" data-id="${esc(r.staff_id)}">Hapus</button>`);
        }
        if (r.status === 'aktif') {
            b.push(`<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-acc="reset" data-id="${esc(r.staff_id)}">Reset password</button>`);
            b.push(`<button type="button" class="att-btn att-btn-danger att-btn-sm" data-acc="off" data-id="${esc(r.staff_id)}">Nonaktifkan</button>`);
        }
        if (r.status === 'nonaktif') b.push(`<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-acc="on" data-id="${esc(r.staff_id)}">Aktifkan</button>`);
        return b.join('');
    }

    function renderAccSummary() {
        const c = { aktif: 0, nonaktif: 0, siap_dibuat: 0, belum_didaftarkan: 0 };
        for (const r of accRows) c[r.status] += 1;
        $('accSummary').innerHTML = `
            <div class="att-row" style="gap:8px;margin-bottom:12px">
                <span class="att-badge ok">${c.aktif} aktif</span><span class="att-badge warn">${c.siap_dibuat} siap dibuat</span>
                <span class="att-badge bad">${c.nonaktif} nonaktif</span><span class="att-badge mute">${c.belum_didaftarkan} belum didaftarkan</span>
            </div>
            ${c.siap_dibuat ? `<button type="button" class="att-btn att-btn-primary" id="accCreateAll">Buat semua akun yang siap (${c.siap_dibuat})</button>` : ''}`;
    }

    async function loadAccounts() {
        const host = $('accTable');
        try {
            const { rows } = await api('GET');
            accRows = rows;
            renderAccSummary();
            if (!accTable) {
                accTable = new window.Att.DataTable(host, {
                    storageKey: 'admin-akun-guru',
                    rows,
                    searchKeys: ['nama', 'jabatan', 'email', 'login_id'],
                    searchPlaceholder: 'Cari nama, email, atau NIP',
                    columns: [
                        { key: 'nama', label: 'Nama', sort: true, render: (r) => `<b>${esc(r.nama)}</b>${r.admin ? ' <span class="att-badge info">Admin</span>' : ''}` },
                        { key: 'jabatan', label: 'Jabatan', sort: true },
                        { key: 'email', label: 'Email', sort: true },
                        { key: 'login_id', label: 'NIP / NUPTK' },
                        { key: 'status', label: 'Status', sort: true, render: (r) => STATUS_BADGE[r.status] || esc(r.status) },
                        { key: 'aksi', label: 'Aksi', className: 'att-actions', render: accActions },
                    ],
                });
            } else {
                accTable.setRows(rows);
            }
        } catch (err) {
            $('accSummary').innerHTML = '';
            host.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
            accTable = null;
        }
    }

    async function onAccClick(e) {
        if (e.target.closest('#accCreateAll')) {
            const n = accRows.filter((r) => r.status === 'siap_dibuat').length;
            const ok = await window.Att.confirm({ title: `Buat ${n} akun sekarang?`, html: '<p class="att-muted">Tidak ada email yang dikirim. Password awal akan tampil sekali untuk Anda bagikan.</p>', confirmText: 'Buat akun' });
            if (!ok) return;
            const btn = $('accCreateAll');
            btn.disabled = true; btn.textContent = 'Membuat akun…';
            try {
                const { results } = await api('POST', { action: 'create' });
                showPasswords(results, 'Akun guru dibuat');
            } catch (err) { toast(errMessage(err), 'err'); }
            await loadAccounts();
            return;
        }
        const b = e.target.closest('[data-acc]');
        if (!b) return;
        const row = accRows.find((r) => r.staff_id === b.dataset.id);
        if (!row) return;
        try {
            if (b.dataset.acc === 'edit') {
                const v = await editForm(row);
                if (!v) return;
                await api('POST', { action: 'save_request', ...v });
                toast('Data akun tersimpan.');
            } else if (b.dataset.acc === 'create') {
                const { results } = await api('POST', { action: 'create', staff_ids: [row.staff_id] });
                showPasswords(results, `Akun ${row.nama}`);
            } else if (b.dataset.acc === 'reset') {
                if (!await window.Att.confirm({ title: `Reset password ${row.nama}?`, html: '<p class="att-muted">Password lama langsung tidak berlaku.</p>', confirmText: 'Reset' })) return;
                const r = await api('POST', { action: 'reset_password', staff_id: row.staff_id });
                showPasswords([{ ...r, ok: true }], `Password baru ${row.nama}`);
            } else if (b.dataset.acc === 'off' || b.dataset.acc === 'on') {
                const on = b.dataset.acc === 'on';
                if (!on && !await window.Att.confirm({ title: `Nonaktifkan akun ${row.nama}?`, html: '<p class="att-muted">Guru tidak bisa login sampai diaktifkan lagi. Data absensinya tetap aman.</p>', confirmText: 'Nonaktifkan', danger: true })) return;
                await api('POST', { action: 'set_active', staff_id: row.staff_id, active: on });
                toast(on ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.');
            } else if (b.dataset.acc === 'delete') {
                if (!await window.Att.confirm({ title: `Hapus ${row.nama} dari daftar akun?`, html: '<p class="att-muted">Akun belum dibuat, jadi tidak ada yang hilang selain email dan NIP di daftar ini.</p>', confirmText: 'Hapus', danger: true })) return;
                await api('POST', { action: 'delete_request', staff_id: row.staff_id });
                toast('Dihapus dari daftar.');
            }
        } catch (err) {
            toast(errMessage(err), 'err');
        }
        await loadAccounts();
    }

    // ========================================================== KELOLA ABSENSI
    let classes = [];
    let subjects = [];

    async function initAttendance() {
        const [c, s] = await Promise.all([
            sb.from('classes').select('id,name,grade,section,academic_years!inner(is_active)').eq('academic_years.is_active', true).order('grade').order('section'),
            sb.from('subjects').select('id,code,name').order('code'),
        ]);
        if (c.error || s.error) throw new Error((c.error || s.error).message);
        classes = c.data;
        subjects = s.data;
        $('attKelas').innerHTML = classes.map((x) => `<option value="${esc(x.id)}">Kelas ${esc(x.name)}</option>`).join('');
        $('attJenis').innerHTML = '<option value="harian">Absensi harian</option>'
            + subjects.map((x) => `<option value="${esc(x.id)}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
        $('attTanggal').value = todayJakarta();
        $('attTanggal').max = todayJakarta();
    }

    async function loadSheet() {
        const classId = $('attKelas').value;
        const date = $('attTanggal').value;
        const jenis = $('attJenis').value;
        const kind = jenis === 'harian' ? 'harian' : 'mapel';
        const subjectId = kind === 'mapel' ? jenis : null;
        const host = $('attSheet');
        if (!classId || !date) return;
        host.innerHTML = '<div class="att-muted" style="padding:16px 0">Memuat…</div>';
        $('attHistory').innerHTML = '';
        try {
            const sheet = await rpc('get_attendance_sheet', { p_class_id: classId, p_date: date, p_kind: kind, p_subject_id: subjectId });
            const label = kind === 'harian' ? 'harian' : subjects.find((x) => x.id === subjectId)?.code;
            window.Att.renderSheet(host, sheet, {
                reasonRequired: Boolean(sheet.session),
                subtitle: `Kelas ${sheet.kelas} · ${label} · ${fmtDate(date)}`,
                onSave: async (entries, reason) => {
                    await rpc('save_attendance', { p_class_id: classId, p_date: date, p_kind: kind, p_subject_id: subjectId, p_entries: entries, p_reason: reason });
                    setTimeout(loadSheet, 300);
                },
            });
            if (sheet.session) {
                host.insertAdjacentHTML('beforeend', `<div class="att-row att-noprint" style="margin-top:12px">
                    <button type="button" class="att-btn att-btn-danger att-btn-sm" id="attArchive">Arsipkan absensi ini</button>
                    <span class="att-muted">Dipakai jika salah kelas/tanggal. Bisa dipulihkan lewat SQL Editor.</span></div>`);
                await loadHistory(sheet.session.id);
            }
            $('attArchive')?.addEventListener('click', async () => {
                const reason = await window.Att.confirm({
                    title: 'Arsipkan absensi ini?', danger: true, confirmText: 'Arsipkan',
                    html: '<p class="att-muted">Absensi tidak dihitung di rekap, dan wali kelas bisa mengisi ulang.</p>',
                    input: { label: 'Alasan (wajib)', required: true, placeholder: 'Mis. salah pilih kelas' },
                });
                if (!reason) return;
                try {
                    await rpc('archive_attendance_session', { p_session_id: sheet.session.id, p_reason: reason });
                    toast('Absensi diarsipkan.');
                    loadSheet();
                } catch (err) { toast(errMessage(err), 'err'); }
            });
        } catch (err) {
            host.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
        }
    }

    const ACTION = { buat: 'Dibuat', ubah: 'Diubah', arsip: 'Diarsipkan', pulihkan: 'Dipulihkan' };

    async function loadHistory(sessionId) {
        const [{ data: changes, error }, { data: accs }] = await Promise.all([
            sb.from('attendance_changes').select('action,old_status,new_status,reason,changed_by,changed_at,student_id').eq('session_id', sessionId).order('changed_at', { ascending: false }).limit(200),
            sb.from('teacher_accounts').select('user_id,email'),
        ]);
        if (error) { $('attHistory').innerHTML = ''; return; }
        const who = new Map((accs || []).map((a) => [a.user_id, a.email]));
        const names = new Map();
        const ids = [...new Set(changes.map((c) => c.student_id).filter(Boolean))];
        if (ids.length) {
            const roster = await rpc('get_class_roster', { p_class_id: $('attKelas').value, p_date: $('attTanggal').value }).catch(() => []);
            for (const r of roster) names.set(r.student_id, r.nama);
        }
        const rows = changes.map((c) => ({
            waktu: new Date(c.changed_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }),
            aksi: ACTION[c.action] || c.action,
            siswa: c.student_id ? (names.get(c.student_id) || 'Siswa') : '–',
            perubahan: c.old_status || c.new_status ? `${c.old_status || '–'} → ${c.new_status || '–'}` : '–',
            alasan: c.reason || '–',
            oleh: who.get(c.changed_by) || 'Admin',
        }));
        $('attHistory').innerHTML = '<h3 style="margin:20px 0 10px;font-size:1rem">Riwayat absensi ini</h3><div id="attHistTable"></div>';
        new window.Att.DataTable($('attHistTable'), {
            storageKey: 'admin-riwayat-absen', rows,
            searchKeys: ['siswa', 'alasan', 'oleh', 'aksi'],
            searchPlaceholder: 'Cari siswa, alasan, atau pengubah',
            emptyText: 'Belum ada riwayat.',
            columns: [
                { key: 'waktu', label: 'Waktu' }, { key: 'aksi', label: 'Aksi', sort: true }, { key: 'siswa', label: 'Siswa', sort: true },
                { key: 'perubahan', label: 'Status' }, { key: 'alasan', label: 'Alasan' }, { key: 'oleh', label: 'Oleh', sort: true },
            ],
        });
    }

    // ========================================================== kaitkan ke showTab
    const originalShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        originalShowTab(tabId, navEl);
        const titles = { tabTeacherAccounts: 'Akun Guru', tabAttendance: 'Kelola Absensi' };
        if (titles[tabId]) $('topbarTitle').textContent = titles[tabId];
        if (tabId === 'tabTeacherAccounts' && !loaded.accounts) { loaded.accounts = true; loadAccounts(); }
        if (tabId === 'tabAttendance' && !loaded.attendance) {
            loaded.attendance = true;
            initAttendance().then(loadSheet).catch((err) => { $('attSheet').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; });
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('tabTeacherAccounts')?.addEventListener('click', onAccClick);
        $('attShow')?.addEventListener('click', loadSheet);
        $('accReload')?.addEventListener('click', loadAccounts);
    });
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { loaded.accounts = false; loaded.attendance = false; accTable = null; }
    });
})();
