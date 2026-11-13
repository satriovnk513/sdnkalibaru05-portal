// Supabase TIRUAN untuk uji UI di browser (menggantikan supabase-js dari CDN).
// Data fiktif. Logika hak akses sungguhan diuji terpisah di supabase/tests/local.
// Status uji dibaca/ditulis lewat window.__fake (diatur dari Playwright).
(function () {
    'use strict';
    const F = window.__fake = window.__fake || {};
    const store = {
        get session() { try { return JSON.parse(localStorage.getItem('fake-session') || 'null'); } catch { return null; } },
        set session(v) { if (v) localStorage.setItem('fake-session', JSON.stringify(v)); else localStorage.removeItem('fake-session'); },
    };
    F.calls = F.calls || [];
    F.failRpc = F.failRpc || {};
    const listeners = [];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    const C1A = '00000000-0000-4000-8000-0000000000c1';
    const C3A = '00000000-0000-4000-8000-0000000000c3';
    const PAI = '00000000-0000-4000-8000-0000000000e1';
    const S = (n) => `00000000-0000-4000-8000-00000000005${n}`;
    const roster = {
        [C1A]: [
            { student_id: S(1), no_urut: 1, nama: 'Siswa Fiktif Dua', jenis_kelamin: 'P', nis: '9002', nisn: '0090000002' },
            { student_id: S(2), no_urut: 2, nama: 'Siswa Fiktif Satu Dengan Nama Yang Cukup Panjang Sekali', jenis_kelamin: 'L', nis: '9001', nisn: '0090000001' },
            { student_id: S(3), no_urut: 3, nama: 'Siswa Fiktif Tiga', jenis_kelamin: 'P', nis: '9003', nisn: '0090000003' },
        ],
        [C3A]: [{ student_id: S(4), no_urut: 1, nama: 'Siswa Fiktif Empat', jenis_kelamin: 'L', nis: '9004', nisn: '0090000004' }],
    };
    F.sessions = F.sessions || {};   // key class|date|kind|subject → { id, records: {sid: {status, note}}, disimpan }

    function err(message) { return { data: null, error: { message } }; }
    const ok = (data, extra = {}) => ({ data, error: null, ...extra });

    function homeFor(user) {
        const base = { today, is_school_day: true, holiday_name: null, earliest_date: today, semua_kelas: [], is_admin: false, is_pimpinan: false };
        const sess = F.sessions[`${C1A}|${today}|harian|-`];
        if (user === 'wali') {
            return { ...base, staff_id: 'st1', nama: 'Sunarsih, S.Pd.', jabatan: 'Guru Kelas',
                mapel: [{ class_id: C3A, kelas: '3 A', subject_id: PAI, kode: 'PAI', mapel: 'Pendidikan Agama Islam', hari_ini: Boolean(F.sessions[`${C3A}|${today}|mapel|${PAI}`]) }],
                wali_kelas: [{ class_id: C1A, kelas: '1 A', posisi: 1, jumlah_siswa: 3,
                    hari_ini: sess ? { session_id: sess.id, disimpan: '07.15', terkunci: false, rekap: Object.values(sess.records).reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}) } : null }] };
        }
        if (user === 'admin') {
            return { ...base, staff_id: 'st9', nama: 'Paroji', jabatan: 'Operator', is_admin: true, wali_kelas: [], mapel: [],
                semua_kelas: [{ class_id: C1A, kelas: '1 A' }, { class_id: C3A, kelas: '3 A' }] };
        }
        return null;
    }

    function sheet(classId, date, kind, subjectId) {
        const key = `${classId}|${date}|${kind}|${subjectId || '-'}`;
        const s = F.sessions[key];
        const harian = F.sessions[`${classId}|${date}|harian|-`];
        const prefill = !s && kind === 'mapel' ? harian : null;
        return {
            kelas: classId === C1A ? '1 A' : '3 A', tanggal: date, hari_sekolah: true, libur: null,
            bisa_ubah: true, is_admin: currentUser() === 'admin',
            session: s ? { id: s.id, disimpan: `${date.split('-').reverse().join('/')} 07.15`, terlambat: false } : null,
            isian_awal_dari_harian: Boolean(prefill),
            siswa: (roster[classId] || []).map((r) => ({
                student_id: r.student_id, no: r.no_urut, nama: r.nama, jk: r.jenis_kelamin,
                status: (s || prefill)?.records[r.student_id]?.status || null,
                catatan: (s || prefill)?.records[r.student_id]?.note || null,
            })),
        };
    }

    function currentUser() { return store.session?.user?.user_metadata?.peran || null; }

    function rpc(fn, args = {}) {
        F.calls.push({ fn, args: JSON.parse(JSON.stringify(args)) });
        if (F.failRpc[fn]) return Promise.resolve(err(F.failRpc[fn]));
        const user = currentUser();
        if (!user) return Promise.resolve(err('JWT expired'));
        switch (fn) {
        case 'get_guru_home': {
            const h = homeFor(user);
            return Promise.resolve(h ? ok(h) : err('Akun belum terhubung ke data guru.'));
        }
        case 'get_attendance_sheet':
            return Promise.resolve(ok(sheet(args.p_class_id, args.p_date, args.p_kind, args.p_subject_id)));
        case 'save_attendance': {
            const key = `${args.p_class_id}|${args.p_date}|${args.p_kind}|${args.p_subject_id || '-'}`;
            if (F.sessions[key] && user === 'admin' && !args.p_reason) return Promise.resolve(err('Koreksi oleh admin wajib menyertakan alasan.'));
            const records = {};
            for (const e of args.p_entries) records[e.student_id] = { status: e.status, note: e.note };
            F.sessions[key] = { id: F.sessions[key]?.id || `sess-${Object.keys(F.sessions).length + 1}`, records };
            return Promise.resolve(ok(F.sessions[key].id));
        }
        case 'get_class_roster':
            return Promise.resolve(ok(roster[args.p_class_id] || []));
        case 'get_student_profile':
            return Promise.resolve(ok({
                id: args.p_student_id,
                identitas: { nama: 'Siswa Fiktif Dua', kelas: '1 A', nis: '9002', nisn: '0090000002', jenis_kelamin: 'P', tempat_lahir: 'Jakarta', tanggal_lahir: '2019-05-01', agama: 'Islam', anak_ke: '2' },
                orang_tua: { ayah_nama: 'Ayah Fiktif', ayah_pekerjaan: 'Wiraswasta', ibu_nama: 'Ibu Fiktif', ibu_pekerjaan: 'Mengurus Rumah Tangga' },
                kontak: ['081200000001', '081200000002'],
                alamat: { jalan: 'Jl. Fiktif No. 1', rt: '003', rw: '012', kelurahan: 'Kalibaru', kecamatan: 'Cilincing' },
                catatan: { kebutuhan_khusus: 'Tidak ada' },
            }));
        case 'get_class_month_recap': {
            const harian = Object.entries(F.sessions).filter(([k]) => k.startsWith(`${args.p_class_id}|`) && k.endsWith('|harian|-'));
            const y = args.p_year; const m = args.p_month;
            const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
            return Promise.resolve(ok({
                kelas: args.p_class_id === C1A ? '1 A' : '3 A', tahun: y, bulan: m, hari_efektif: 8,
                hari: Array.from({ length: days }, (_, i) => {
                    const d = `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                    return { tanggal: d, libur: dow === 0 || dow === 6, diisi: harian.some(([k]) => k.split('|')[1] === d) };
                }),
                siswa: (roster[args.p_class_id] || []).map((r) => ({
                    student_id: r.student_id, no: r.no_urut, nama: r.nama, jk: r.jenis_kelamin, nis: r.nis, nisn: r.nisn,
                    status: Object.fromEntries(harian.map(([k, v]) => [k.split('|')[1], v.records[r.student_id]?.status]).filter(([, v]) => v)),
                })),
            }));
        }
        case 'get_class_report_header': {
            const c = T.classes.find((x) => x.id === args.p_class_id);
            const y = T.academic_years.find((x) => x.id === c?.academic_year_id);
            const st = (id) => T.staff.find((x) => x.id === id) || {};
            const nip = (v) => (String(v || '').replace(/^NIP\.?\s*/i, '') || null);
            const ks = T.staff.find((x) => x.role.startsWith('Kepala Sekolah'));
            return Promise.resolve(ok({
                kelas: c?.name, tahun_ajaran: y?.name, ta_mulai: y?.start_date, ta_selesai: y?.end_date,
                wali: T.homeroom_assignments.filter((h) => h.class_id === args.p_class_id).sort((a, b) => a.position - b.position)
                    .map((h) => ({ posisi: h.position, nama: st(h.staff_id).name, nip: nip(st(h.staff_id).nip) })),
                kepala_sekolah: ks ? { nama: ks.name, nip: nip(ks.nip) } : null,
            }));
        }
        case 'get_class_semester_recap': {
            const harian = Object.entries(F.sessions).filter(([k]) => k.startsWith(`${args.p_class_id}|`) && k.endsWith('|harian|-'));
            return Promise.resolve(ok({
                semester: args.p_semester, mulai: args.p_semester === 1 ? '2026-07-13' : '2027-01-01', selesai: args.p_semester === 1 ? '2026-12-31' : '2027-06-30',
                sampai_hari_ini: today, hari_efektif: 85, hari_terisi: harian.length,
                siswa: (roster[args.p_class_id] || []).map((r) => {
                    const t = { H: 0, S: 0, I: 0, A: 0, D: 0 };
                    for (const [, v] of harian) { const st = v.records[r.student_id]?.status; if (st) t[st] += 1; }
                    return { student_id: r.student_id, no: r.no_urut, nama: r.nama, jk: r.jenis_kelamin, nis: r.nis, nisn: r.nisn, ...t };
                }),
            }));
        }
        case 'sync_holidays': {
            let n = 0;
            for (const c of F.catalog) if (!T.school_holidays.some((h) => h.holiday_date === c.holiday_date)) { T.school_holidays.push({ ...c }); n += 1; }
            return Promise.resolve(ok({ ditambahkan: n, katalog: F.catalog.length, sampai: '2027-12-26' }));
        }
        case 'set_homeroom': {
            if (!args.p_wali1) return Promise.resolve(err('Wali Kelas 1 wajib dipilih.'));
            if (args.p_wali2 && args.p_wali2 === args.p_wali1) return Promise.resolve(err('Wali Kelas 2 tidak boleh sama dengan Wali Kelas 1.'));
            T.homeroom_assignments = T.homeroom_assignments.filter((h) => h.class_id !== args.p_class_id);
            T.homeroom_assignments.push({ class_id: args.p_class_id, staff_id: args.p_wali1, position: 1 });
            if (args.p_wali2) T.homeroom_assignments.push({ class_id: args.p_class_id, staff_id: args.p_wali2, position: 2 });
            return Promise.resolve(ok(null));
        }
        case 'set_active_academic_year':
            for (const y of T.academic_years) y.is_active = y.id === args.p_id;
            return Promise.resolve(ok(null));
        case 'set_subject_assignments':
            T.subject_assignments = T.subject_assignments.filter((a) => !(a.subject_id === args.p_subject_id && a.staff_id === args.p_staff_id));
            for (const c of [...new Set(args.p_class_ids || [])]) T.subject_assignments.push({ subject_id: args.p_subject_id, class_id: c, staff_id: args.p_staff_id });
            return Promise.resolve(ok(new Set(args.p_class_ids || []).size));
        case 'get_my_recovery_pin':
            return Promise.resolve(ok(F.pin ? { ada: true, dibuat: '13/11/2026 15.30', terkunci: false } : { ada: false, dibuat: null, terkunci: false }));
        case 'student_summary':
            return Promise.resolve(ok([{ total_siswa: 4, tercantum: 4, perlu_verifikasi: 0, jumlah_rombel: 2, daftar_kelas: ['1 A', '3 A'], diarsipkan: 0 }]));
        case 'archive_attendance_session':
            return Promise.resolve(args.p_reason ? ok(null) : err('Alasan wajib diisi.'));
        default:
            return Promise.resolve(ok(null));
        }
    }

    // ------------------------------------------------------------------ tabel tiruan (stateful)
    const AY1 = '00000000-0000-4000-8000-0000000000a1';
    const ST = (n) => `00000000-0000-4000-8000-0000000000f${n}`;
    const T = F.tables = F.tables || {
        academic_years: [{ id: AY1, name: '2026/2027', start_date: '2026-07-13', end_date: '2027-06-30', is_active: true }],
        classes: [
            { id: C1A, name: '1 A', grade: 1, section: 'A', academic_year_id: AY1 },
            { id: C3A, name: '3 A', grade: 3, section: 'A', academic_year_id: AY1 },
        ],
        subjects: [{ id: PAI, code: 'PAI', name: 'Pendidikan Agama Islam' }],
        staff: [
            { id: ST(1), name: 'Sunarsih, S.Pd.', role: 'Guru Kelas|Guru Kelas', nip: 'NIP. 990000000000000001', order_index: 1 },
            { id: ST(2), name: 'Taripah, S.Pd.', role: 'Wakil Kepala Sekolah|Wakil Kepala Sekolah', nip: 'NIP. 990000000000000002', order_index: 2 },
            { id: ST(3), name: 'Susy Nurhayati', role: 'Guru Mata Pelajaran|Guru Pendidikan Agama Islam', nip: '', order_index: 3 },
            { id: ST(4), name: 'Guru Fiktif Pendamping, S.Pd.', role: 'Guru Kelas|Guru Kelas', nip: '', order_index: 4 },
            { id: ST(5), name: 'Kepala Fiktif, S.Pd.SD', role: 'Kepala Sekolah|Kepala Sekolah', nip: 'NIP. 990000000000000009', order_index: 0 },
        ],
        homeroom_assignments: [
            { class_id: C1A, staff_id: ST(1), position: 1 },
            { class_id: C3A, staff_id: ST(2), position: 1 },
        ],
        subject_assignments: [
            { subject_id: PAI, class_id: C1A, staff_id: ST(3) },
            { subject_id: PAI, class_id: C3A, staff_id: ST(3) },
        ],
        student_enrollments: [
            { class_id: C1A, end_date: null }, { class_id: C1A, end_date: null }, { class_id: C1A, end_date: null },
            { class_id: C3A, end_date: null },
        ],
        school_holidays: [
            { holiday_date: '2026-12-25', name: 'Kelahiran Yesus Kristus', kind: 'nasional', source: 'SKB 3 Menteri 2026' },
        ],
        attendance_changes: [{ action: 'buat', old_status: null, new_status: null, reason: null, changed_by: 'u1', changed_at: new Date().toISOString(), student_id: null }],
        teacher_accounts: [{ user_id: 'u1', email: 'sunarsih@fiktif.test' }],
    };
    F.catalog = F.catalog || [
        { holiday_date: '2026-12-24', name: 'Cuti Bersama Kelahiran Yesus Kristus', kind: 'cuti_bersama', source: 'SKB 3 Menteri 2026' },
        { holiday_date: '2026-12-25', name: 'Kelahiran Yesus Kristus', kind: 'nasional', source: 'SKB 3 Menteri 2026' },
        { holiday_date: '2027-01-01', name: 'Tahun Baru 2027 Masehi', kind: 'nasional', source: 'SKB 3 Menteri 2027' },
    ];
    let idSeq = 100;
    const newId = () => `00000000-0000-4000-8000-${String(idSeq++).padStart(12, '0')}`;

    function from(table) {
        const ops = [];
        const q = { _count: null, then(res, rej) { return Promise.resolve(resolveTable(table, ops, q)).then(res, rej); } };
        for (const m of ['select', 'eq', 'neq', 'order', 'range', 'limit', 'in', 'ilike', 'or', 'is', 'not', 'filter', 'gte', 'lte', 'gt', 'lt', 'update', 'insert', 'delete', 'upsert', 'match', 'contains']) {
            q[m] = (...a) => { ops.push([m, a]); if (m === 'select' && a[1]?.count) q._count = a[1]; return q; };
        }
        q.maybeSingle = () => { ops.push(['maybeSingle']); return q; };
        q.single = () => { ops.push(['single']); return q; };
        return q;
    }

    function matches(row, ops) {
        for (const [m, a] of ops) {
            if (typeof a?.[0] === 'string' && a[0].includes('.')) continue;   // filter relasi diabaikan
            if (m === 'eq' && String(row[a[0]]) !== String(a[1])) return false;
            if (m === 'neq' && String(row[a[0]]) === String(a[1])) return false;
            if (m === 'is' && (row[a[0]] ?? null) !== a[1]) return false;
            if (m === 'in' && !a[1].map(String).includes(String(row[a[0]]))) return false;
        }
        return true;
    }

    const fkError = { code: '23503', message: 'update or delete violates foreign key constraint' };

    function resolveTable(table, ops, q) {
        const kinds = ops.map((o) => o[0]);
        F.calls.push({ table, ops: kinds });
        const single = kinds.includes('maybeSingle') || kinds.includes('single');
        if (table === 'user_roles') {
            const rows = currentUser() === 'admin' ? [{ role: 'admin' }] : [];
            return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
        }
        if (table === 'attendance_sessions') {
            const rows = Object.keys(F.sessions).map((k) => ({ id: F.sessions[k].id, session_date: k.split('|')[1], archived_at: null }));
            const hit = rows.filter((r) => matches(r, ops));
            return { data: q._count?.head ? null : hit, error: null, count: hit.length };
        }
        const rows = T[table] || [];
        const ins = ops.find((o) => o[0] === 'insert' || o[0] === 'upsert');
        if (ins) {
            const list = Array.isArray(ins[1][0]) ? ins[1][0] : [ins[1][0]];
            if (table === 'school_holidays' && list.some((r) => rows.some((h) => h.holiday_date === r.holiday_date))) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            for (const r of list) {
                const row = { ...r };
                if (table !== 'school_holidays' && !row.id) row.id = newId();
                if (table === 'classes') row.name = `${row.grade} ${row.section}`;
                rows.push(row);
            }
            F.calls.push({ write: 'insert', table, rows: list });
            return { data: null, error: null };
        }
        const upd = ops.find((o) => o[0] === 'update');
        if (upd) {
            for (const r of rows.filter((x) => matches(x, ops))) {
                Object.assign(r, upd[1][0]);
                if (table === 'classes') r.name = `${r.grade} ${r.section}`;
            }
            F.calls.push({ write: 'update', table, values: upd[1][0] });
            return { data: null, error: null };
        }
        if (kinds.includes('delete')) {
            const victims = rows.filter((x) => matches(x, ops));
            if (table === 'classes' && victims.some((v) => T.student_enrollments.some((e) => e.class_id === v.id))) return { data: null, error: fkError };
            if (table === 'subjects' && victims.some((v) => T.subject_assignments.some((e) => e.subject_id === v.id))) return { data: null, error: fkError };
            if (table === 'academic_years' && victims.some((v) => T.classes.some((c) => c.academic_year_id === v.id))) return { data: null, error: fkError };
            T[table] = rows.filter((x) => !victims.includes(x));
            F.calls.push({ write: 'delete', table, n: victims.length });
            return { data: null, error: null };
        }
        const hit = rows.filter((r) => matches(r, ops)).map((r) => ({ ...r }));
        if (single) return { data: hit[0] ?? null, error: null };
        return { data: q._count?.head ? null : hit, error: null, count: q._count ? hit.length : null };
    }

    function emit(event, session) { for (const cb of listeners) setTimeout(() => cb(event, session), 0); }

    const auth = {
        async getSession() { return { data: { session: store.session }, error: null }; },
        async getUser() { return { data: { user: store.session?.user || null }, error: null }; },
        async setSession({ access_token }) {
            const peran = access_token === 'at-admin' ? 'admin' : access_token === 'at-orphan' ? 'orphan' : 'wali';
            store.session = { access_token, user: { id: `u-${peran}`, email: `${peran}@fiktif.test`, user_metadata: { peran } } };
            emit('SIGNED_IN', store.session);
            return { data: { session: store.session }, error: null };
        },
        async signInWithPassword({ email }) {
            if (!/admin/.test(email)) return { data: {}, error: { message: 'Invalid login credentials' } };
            store.session = { access_token: 'at-admin', user: { id: 'u-admin', email, user_metadata: { peran: 'admin' } } };
            emit('SIGNED_IN', store.session);
            return { data: { user: store.session.user, session: store.session }, error: null };
        },
        async signOut() { store.session = null; emit('SIGNED_OUT', null); return { error: null }; },
        async updateUser({ password }) { F.calls.push({ fn: 'updateUser', len: password.length }); return { data: {}, error: null }; },
        onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    };

    const storage = { from() { return { upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({ error: null }) }; } };

    window.supabase = { createClient: () => ({ auth, rpc, from, storage }) };
})();
