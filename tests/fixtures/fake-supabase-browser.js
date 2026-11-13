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
            return { ...base, staff_id: 'st1', nama: 'Sunarsih, S.Pd.', jabatan: 'Guru Kelas', mapel: [],
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
        case 'student_summary':
            return Promise.resolve(ok([{ total_siswa: 4, tercantum: 4, perlu_verifikasi: 0, jumlah_rombel: 2, daftar_kelas: ['1 A', '3 A'], diarsipkan: 0 }]));
        case 'archive_attendance_session':
            return Promise.resolve(args.p_reason ? ok(null) : err('Alasan wajib diisi.'));
        default:
            return Promise.resolve(ok(null));
        }
    }

    // Query builder generik: cukup untuk panel admin (data lain kosong).
    function from(table) {
        const ops = [];
        const q = {
            _count: null,
            then(res, rej) { return Promise.resolve(resolveTable(table, ops, q)).then(res, rej); },
        };
        for (const m of ['select', 'eq', 'neq', 'order', 'range', 'limit', 'in', 'ilike', 'or', 'is', 'not', 'filter', 'gte', 'lte', 'gt', 'lt', 'update', 'insert', 'delete', 'upsert', 'match', 'contains']) {
            q[m] = (...a) => { ops.push([m, a]); if (m === 'select' && a[1]?.count) q._count = a[1]; return q; };
        }
        q.maybeSingle = () => { ops.push(['maybeSingle']); return q; };
        q.single = () => { ops.push(['single']); return q; };
        return q;
    }

    function resolveTable(table, ops, q) {
        F.calls.push({ table, ops: ops.map((o) => o[0]) });
        const single = ops.some((o) => o[0] === 'maybeSingle' || o[0] === 'single');
        let rows = [];
        if (table === 'user_roles') rows = currentUser() === 'admin' ? [{ role: 'admin' }] : [];
        if (table === 'classes') rows = [{ id: C1A, name: '1 A', grade: 1, section: 'A' }, { id: C3A, name: '3 A', grade: 3, section: 'A' }];
        if (table === 'subjects') rows = [{ id: PAI, code: 'PAI', name: 'Pendidikan Agama Islam' }];
        if (table === 'attendance_changes') rows = [{ action: 'buat', old_status: null, new_status: null, reason: null, changed_by: 'u1', changed_at: new Date().toISOString(), student_id: null }];
        if (table === 'teacher_accounts') rows = [{ user_id: 'u1', email: 'sunarsih@fiktif.test' }];
        if (single) return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null, count: q._count ? rows.length : null };
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
