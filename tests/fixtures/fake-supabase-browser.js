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
        const base = { today, is_school_day: true, holiday_name: null, earliest_date: new Date(Date.parse(`${today}T00:00:00Z`) - 120 * 86400000).toISOString().slice(0, 10), semua_kelas: [], is_admin: false, is_pimpinan: false };
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
                identitas: { nama: 'Siswa Fiktif Dua', kelas: '1 A', nis: '9002', nisn: '0090000002', nik: '3172000000000002', jenis_kelamin: 'P', tempat_lahir: 'Jakarta', tanggal_lahir: '2019-05-01', agama: 'Islam', anak_ke: '2' },
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
        case 'get_class_attendance_stats': {
            const inRange = (d) => d >= args.p_from && d <= args.p_to;
            const harian = Object.entries(F.sessions).filter(([k]) => k.startsWith(`${args.p_class_id}|`) && k.endsWith('|harian|-') && inRange(k.split('|')[1]))
                .sort(([a], [b]) => a.localeCompare(b));
            const zero = () => ({ H: 0, S: 0, I: 0, A: 0, D: 0 });
            const total = zero();
            const perDay = harian.map(([k, v]) => {
                const c = zero();
                for (const r of Object.values(v.records)) if (r.status) { c[r.status] += 1; total[r.status] += 1; }
                return { tanggal: k.split('|')[1], ...c };
            });
            const dow = new Date(`${args.p_from}T00:00:00Z`).getUTCDay();
            let efektif = 0;
            for (let d = args.p_from; d <= args.p_to && d <= today;) {
                const w = new Date(`${d}T00:00:00Z`).getUTCDay();
                if (w !== 0 && w !== 6) efektif += 1;
                d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
            }
            return Promise.resolve(ok({
                kelas: args.p_class_id === C1A ? '1 A' : '3 A', dari: args.p_from, sampai: args.p_to,
                jumlah_siswa: (roster[args.p_class_id] || []).length, hari_efektif: efektif, hari_terisi: harian.length,
                libur: args.p_from === args.p_to && (dow === 0 || dow === 6) ? 'Sabtu/Minggu' : null,
                total, harian: perDay,
                siswa: (roster[args.p_class_id] || []).map((r) => {
                    const c = zero();
                    for (const [, v] of harian) { const st = v.records[r.student_id]?.status; if (st) c[st] += 1; }
                    return { student_id: r.student_id, no: r.no_urut, nama: r.nama, jk: r.jenis_kelamin, ...c };
                }),
            }));
        }
        case 'get_alpha_alerts':
            return Promise.resolve(ok({ batas: args.p_min, dari: '2026-07-13', siswa: F.alpha || [] }));
        case 'take_letter_number': {
            F.letterNo = (F.letterNo || 0) + 1;
            F.calls.push({ rpc: 'take_letter_number', args });
            return Promise.resolve(ok({ tahun: 2026, nomor: F.letterNo, teks: `${String(F.letterNo).padStart(3, '0')}/${args.p_kode}` }));
        }
        case 'get_class_document_data':
            return Promise.resolve(ok({
                kelas: args.p_class_id === C1A ? '1 A' : '3 A', tahun_ajaran: '2026/2027', tanggal: today,
                wali: [{ posisi: 1, nama: 'Sunarsih, S.Pd.', nip: '990000000000000001' }],
                kepala_sekolah: { nama: 'Kepala Fiktif, S.Pd.SD', nip: '990000000000000009' },
                siswa: (roster[args.p_class_id] || []).map((r, i) => ({
                    student_id: r.student_id, no: r.no_urut, nama: r.nama, jk: r.jenis_kelamin, nis: r.nis, nisn: r.nisn,
                    nik: `317200000000000${i}`, no_kk: `317211111111111${i}`, tempat_lahir: 'Jakarta', tanggal_lahir: `2019-0${i + 1}-15`, agama: 'Islam',
                    ayah: `Ayah Fiktif ${i + 1}`, ibu: `Ibu Fiktif ${i + 1}`, hp: `08120000000${i}`, alamat: 'Jl. Fiktif No. 1, RT 001/RW 002, Kel. Kalibaru, Kec. Cilincing',
                })),
            }));
        case 'get_my_recovery_pin':
            return Promise.resolve(ok(F.pin ? { ada: true, dibuat: '13/11/2026 15.30', terkunci: false } : { ada: false, dibuat: null, terkunci: false }));
        case 'student_summary':
            return Promise.resolve(ok([{ total_siswa: 4, tercantum: 4, perlu_verifikasi: 0, jumlah_rombel: 2, daftar_kelas: ['1 A', '3 A'], diarsipkan: 0 }]));
        case 'archive_attendance_session':
            return Promise.resolve(args.p_reason ? ok(null) : err('Alasan wajib diisi.'));
        default:
            if (fn.startsWith('inv_')) return Promise.resolve(invRpc(fn, args, user));
            return Promise.resolve(ok(null));
        }
    }

    // ------------------------------------------------------------------ inventaris tiruan
    const isoDay = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const INV = F.inv = F.inv || {
        seq: 10,
        items: [
            { id: 'i-lap1', kode: 'LAP-001', nama: 'Laptop Acer Aspire 3', kategori: 'Laptop', merk: 'Acer A314', nomor_seri: 'SN-ACER-1', lokasi: 'Ruang TU', kondisi: 'baik', jenis_pinjam: 'jangka_panjang', tahun_perolehan: 2024, catatan: null, aktif: true, qr_token: 'toklap001aaa' },
            { id: 'i-spk1', kode: 'SPK-01', nama: 'Speaker Aktif Portable', kategori: 'Speaker', merk: 'Polytron', nomor_seri: null, lokasi: 'Gudang', kondisi: 'baik', jenis_pinjam: 'harian', tahun_perolehan: 2023, catatan: null, aktif: true, qr_token: 'tokspk01bbbb' },
            { id: 'i-pro1', kode: 'PRO-001', nama: 'Proyektor Epson EB-X500', kategori: 'Proyektor', merk: 'Epson', nomor_seri: null, lokasi: 'Ruang TU', kondisi: 'baik', jenis_pinjam: 'harian', tahun_perolehan: 2022, catatan: null, aktif: true, qr_token: 'tokpro001ccc' },
            { id: 'i-pro2', kode: 'PRO-002', nama: 'Proyektor BenQ MS560', kategori: 'Proyektor', merk: 'BenQ', nomor_seri: null, lokasi: 'Gudang', kondisi: 'rusak', keterangan_rusak: 'Lampu proyektor mati', jenis_pinjam: 'harian', tahun_perolehan: 2020, catatan: null, aktif: true, qr_token: 'tokpro002eee' },
            { id: 'i-pro3', kode: 'PRO-003', nama: 'Proyektor Epson EB-E01', kategori: 'Proyektor', merk: 'Epson', nomor_seri: null, lokasi: 'Lab Komputer', kondisi: 'baik', jenis_pinjam: 'harian', tahun_perolehan: 2024, catatan: null, aktif: true, qr_token: 'tokpro003fff' },
            { id: 'i-meb1', kode: 'MEB-001', nama: 'Lemari Arsip Besi', kategori: 'Mebel', merk: null, nomor_seri: null, lokasi: 'Ruang Kepala Sekolah', kondisi: 'baik', jenis_pinjam: 'tidak_dipinjam', tahun_perolehan: 2019, catatan: null, aktif: true, qr_token: 'tokmeb001ddd' },
        ],
        loans: [
            { id: 'l1', item: 'i-spk1', peminjam: 'Susy Nurhayati', sejak: `${today}T00:30:00Z`, sampai: today, keperluan: 'Upacara', kembali: null, kondisi: null, catatan: null },
            { id: 'l2', item: 'i-pro1', peminjam: 'Sunarsih, S.Pd.', sejak: `${isoDay(-3)}T01:00:00Z`, sampai: isoDay(-1), keperluan: 'Mengajar kelas 1A', kembali: null, kondisi: null, catatan: null },
            { id: 'l0', item: 'i-lap1', peminjam: 'Sunarsih, S.Pd.', sejak: `${isoDay(-40)}T01:00:00Z`, sampai: null, keperluan: 'Rapor', kembali: `${isoDay(-20)}T01:00:00Z`, kondisi: null, catatan: null },
            { id: 'l3', item: 'i-pro3', peminjam: 'Taripah, S.Pd.', sejak: `${isoDay(-2)}T01:00:00Z`, sampai: isoDay(-2), keperluan: 'Rapat', kembali: `${isoDay(-2)}T06:00:00Z`, kondisi: null, catatan: 'Kabel HDMI longgar' },
        ],
    };
    const openLoan = (id) => INV.loans.find((l) => l.item === id && !l.kembali);
    const invJson = (it) => {
        const l = openLoan(it.id);
        return { ...it, pinjaman: l ? { id: l.id, staff_id: l.peminjam, peminjam: l.peminjam, sejak: l.sejak, sampai: l.sampai, keperluan: l.keperluan, terlambat: Boolean(l.sampai && l.sampai < today) } : null };
    };
    const findItem = (code) => INV.items.find((i) => i.qr_token === code || i.kode.toUpperCase() === String(code || '').trim().toUpperCase());
    function nextKode(kat) {
        let pre = String(kat || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
        if (pre.length < 2) pre = 'BRG';
        const n = Math.max(0, ...INV.items.map((i) => (new RegExp(`^${pre}-(\\d+)$`).exec(i.kode) || [])[1] || 0).map(Number)) + 1;
        return `${pre}-${String(n).padStart(3, '0')}`;
    }
    const KOND = { '': 'baik', baik: 'baik', berfungsi: 'baik', rusak: 'rusak', 'rusak ringan': 'rusak', rusak_ringan: 'rusak', 'rusak berat': 'rusak', rusak_berat: 'rusak' };
    const JEN = { harian: 'harian', 'jangka panjang': 'jangka_panjang', jangka_panjang: 'jangka_panjang', 'tidak dipinjam': 'tidak_dipinjam', tidak_dipinjam: 'tidak_dipinjam' };
    function clean(r) {
        const kondisi = KOND[String(r.kondisi || '').trim().toLowerCase()];
        const jenis = JEN[String(r.jenis_pinjam || 'harian').toLowerCase()];
        if (!kondisi) throw new Error('Status harus Berfungsi atau Rusak.');
        if (!jenis) throw new Error('Jenis pinjam harus Harian, Jangka panjang, atau Tidak dipinjam.');
        return { nama: r.nama, kategori: r.kategori || null, merk: r.merk || null, nomor_seri: r.nomor_seri || null, lokasi: r.lokasi || null, kondisi, keterangan_rusak: kondisi === 'rusak' ? (r.keterangan_rusak || null) : null, jenis_pinjam: jenis, tahun_perolehan: r.tahun_perolehan ? Number(r.tahun_perolehan) : null, catatan: r.catatan || null };
    }
    function invRpc(fn, a, user) {
        const me = user === 'admin' ? 'Paroji' : 'Sunarsih, S.Pd.';
        try {
            switch (fn) {
            case 'inv_scan': {
                const it = findItem(a.p_code);
                if (!it || !it.aktif) return err('Barang dengan kode itu tidak ditemukan.');
                const j = invJson(it);
                const mine = j.pinjaman?.peminjam === me;
                const alternatif = !mine && (it.kondisi === 'rusak' || j.pinjaman) && it.kategori
                    ? INV.items.filter((o) => o !== it && o.aktif && o.kondisi === 'baik' && o.jenis_pinjam !== 'tidak_dipinjam' && o.kategori === it.kategori && !openLoan(o.id))
                        .map((o) => ({ kode: o.kode, nama: o.nama, lokasi: o.lokasi })) : [];
                return ok({ ...j, milik_saya: mine, alternatif });
            }
            case 'inv_borrow': case 'inv_admin_lend': {
                const it = fn === 'inv_borrow' ? findItem(a.p_code) : INV.items.find((i) => i.id === a.p_item);
                const holder = openLoan(it.id);
                if (holder) return err(`${it.nama} sedang dipinjam oleh ${holder.peminjam}.`);
                if (it.jenis_pinjam === 'tidak_dipinjam') return err(`${it.nama} tidak untuk dipinjam.`);
                if (it.kondisi === 'rusak') return err(`${it.nama} sedang rusak, tidak bisa dipinjam.`);
                const who = fn === 'inv_borrow' ? me : T.staff.find((x) => x.id === a.p_staff)?.name;
                INV.loans.push({ id: `l${INV.seq++}`, item: it.id, peminjam: who, sejak: new Date().toISOString(), sampai: a.p_sampai || (it.jenis_pinjam === 'harian' ? today : null), keperluan: a.p_keperluan, kembali: null });
                return ok(invJson(it));
            }
            case 'inv_return': case 'inv_admin_return': {
                const it = fn === 'inv_return' ? findItem(a.p_code) : INV.items.find((i) => i.id === a.p_item);
                const l = openLoan(it.id);
                if (!l) return err('Barang ini tidak sedang dipinjam.');
                if (fn === 'inv_return' && user !== 'admin' && l.peminjam !== me) return err('Hanya peminjam atau admin yang bisa mengembalikan.');
                Object.assign(l, { kembali: new Date().toISOString(), kondisi: a.p_kondisi || null, catatan: a.p_catatan || null });
                if (fn === 'inv_admin_return' && a.p_kondisi) Object.assign(it, { kondisi: a.p_kondisi, keterangan_rusak: a.p_kondisi === 'rusak' ? (a.p_keterangan_rusak || null) : null });
                return ok(invJson(it));
            }
            case 'inv_my_loans': {
                const mine = INV.loans.filter((l) => l.peminjam === me);
                const item = (l) => INV.items.find((i) => i.id === l.item);
                return ok({
                    aktif: mine.filter((l) => !l.kembali).map((l) => ({ kode: item(l).kode, nama: item(l).nama, kategori: item(l).kategori, qr_token: item(l).qr_token, sejak: l.sejak, sampai: l.sampai, keperluan: l.keperluan, terlambat: Boolean(l.sampai && l.sampai < today) })),
                    riwayat: mine.filter((l) => l.kembali).map((l) => ({ kode: item(l).kode, nama: item(l).nama, sejak: l.sejak, kembali: l.kembali, kondisi: l.kondisi })),
                });
            }
            case 'inv_admin_overview':
                if (user !== 'admin') return err('Hanya admin atau kepala sekolah yang bisa melihat inventaris.');
                return ok({ hari_ini: today, items: INV.items.map(invJson) });
            case 'inv_save_item': {
                const c = clean(a.p_item);
                const kode = a.p_item.kode ? a.p_item.kode.toUpperCase() : null;
                if (kode && INV.items.some((i) => i.kode === kode && i.id !== a.p_item.id)) return err(`Kode ${kode} sudah dipakai barang lain.`);
                let it = INV.items.find((i) => i.id === a.p_item.id);
                if (it) Object.assign(it, c, { kode: kode || it.kode, aktif: a.p_item.aktif ?? it.aktif });
                else { it = { id: `i-${INV.seq++}`, ...c, kode: kode || nextKode(c.kategori), aktif: true, qr_token: `tok${String(INV.seq).padStart(9, '0')}` }; INV.items.push(it); }
                return ok(invJson(it));
            }
            case 'inv_import_items': {
                let ditambah = 0; let diperbarui = 0;
                const cleaned = a.p_rows.map((r, ix) => { try { return clean(r); } catch (e) { throw new Error(`Baris ${ix + 1}: ${e.message}`); } });
                a.p_rows.forEach((r, ix) => {
                    const c = cleaned[ix];
                    const n = Number(r.jumlah) || 1;
                    for (let k = 1; k <= n; k++) {
                        const kode = r.kode ? (n > 1 ? `${r.kode.toUpperCase()}-${String(k).padStart(2, '0')}` : r.kode.toUpperCase()) : null;
                        const ex = kode && INV.items.find((i) => i.kode === kode);
                        if (ex) { Object.assign(ex, c, { aktif: true }); diperbarui++; } else {
                            INV.items.push({ id: `i-${INV.seq++}`, ...c, kode: kode || nextKode(c.kategori), aktif: true, qr_token: `tok${String(INV.seq).padStart(9, '0')}` });
                            ditambah++;
                        }
                    }
                });
                F.imported = a.p_rows;
                return ok({ ditambah, diperbarui });
            }
            case 'inv_set_status': {
                const it = INV.items.find((i) => i.id === a.p_item);
                const k = KOND[String(a.p_kondisi || '').toLowerCase()];
                if (!a.p_kondisi || !k) return err('Status barang harus Berfungsi atau Rusak.');
                Object.assign(it, { kondisi: k, keterangan_rusak: k === 'rusak' ? (a.p_keterangan || null) : null });
                return ok(invJson(it));
            }
            case 'inv_delete_item': {
                const it = INV.items.find((i) => i.id === a.p_id);
                if (openLoan(it.id)) return err('Barang masih dipinjam. Tandai sudah kembali dulu.');
                if (INV.loans.some((l) => l.item === it.id)) { it.aktif = false; return ok('diarsipkan'); }
                INV.items = INV.items.filter((i) => i !== it);
                return ok('dihapus');
            }
            case 'inv_loan_history':
                return ok(INV.loans.map((l) => {
                    const it = INV.items.find((i) => i.id === l.item);
                    return { id: l.id, item_id: it.id, kode: it.kode, nama: it.nama, kategori: it.kategori, peminjam: l.peminjam, sejak: l.sejak, sampai: l.sampai, keperluan: l.keperluan, kembali: l.kembali, kondisi: l.kondisi, catatan: l.catatan, terlambat: !l.kembali && Boolean(l.sampai && l.sampai < today) };
                }).sort((x, y) => String(y.sejak).localeCompare(String(x.sejak))));
            default:
                return ok(null);
            }
        } catch (e) { return err(e.message); }
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
        teacher_accounts: [{ user_id: 'u1', email: 'sunarsih@fiktif.test' }, { user_id: 'u-wali', email: 'wali@fiktif.test', must_change_password: false }],
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
            const rows = Object.keys(F.sessions).map((k) => ({ id: F.sessions[k].id, class_id: k.split('|')[0], session_date: k.split('|')[1], kind: k.split('|')[2], archived_at: null, created_at: new Date().toISOString() }));
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
