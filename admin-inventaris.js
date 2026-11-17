// =============================================================================
// Panel Admin — menu Inventaris & Peminjaman.
//   Monitoring : terlambat, barang rusak, catatan guru, aktivitas hari ini,
//                statistik bulanan (paling sering dipinjam, peminjam teraktif).
//   Barang     : tambah/edit/hapus, status Berfungsi/Rusak, impor Excel, stiker QR.
//   Dipinjam   : siapa memegang apa, yang terlambat, tandai sudah kembali.
//   Riwayat    : semua pinjaman, export Excel.
// Data lewat RPC inv_* (cek hak akses di database). Guru meminjam sendiri
// dengan scan QR di Portal Guru (/guru#/pinjam/<token>).
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const { esc, errMessage, toast } = window.Att;
    const Inv = window.Inv;
    const $ = (id) => document.getElementById(id);
    const st = { items: [], staff: [], history: null, view: 'monitor', month: '', filter: 'aktif', kategori: '', pick: new Set(), loaded: false, today: '' };
    const tables = {};

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }
    const form = (cfg) => window.AdminForm.formSheet(cfg);

    async function load() {
        const [ov, staff] = await Promise.all([
            rpc('inv_admin_overview'),
            st.staff.length ? st.staff : sb.from('staff').select('id,name,role').order('name').then(({ data, error }) => { if (error) throw error; return data; }),
        ]);
        st.items = ov.items || [];
        st.today = ov.hari_ini;
        if (!st.month) st.month = st.today.slice(0, 7);
        st.staff = staff;
        st.history = null;
        for (const id of [...st.pick]) if (!st.items.some((i) => i.id === id && i.aktif)) st.pick.delete(id);
    }

    // ------------------------------------------------------------------ ringkasan
    function renderStats() {
        const aktif = st.items.filter((i) => i.aktif);
        const dipinjam = aktif.filter((i) => i.pinjaman);
        const telat = dipinjam.filter((i) => i.pinjaman.terlambat);
        const rusak = aktif.filter((i) => i.kondisi === 'rusak');
        const card = (n, label, cls, view, filter) => `<button type="button" class="inv-stat ${cls}" data-go="${view}" data-filter="${filter}">
            <b>${n}</b><span>${label}</span></button>`;
        $('invStats').innerHTML = card(aktif.length, 'Barang tercatat', '', 'barang', 'aktif')
            + card(dipinjam.length, 'Sedang dipinjam', 'info', 'dipinjam', '')
            + card(telat.length, 'Lewat batas kembali', telat.length ? 'bad' : '', 'dipinjam', '')
            + card(rusak.length, 'Barang rusak', rusak.length ? 'warn' : '', 'barang', 'rusak');
    }

    function setView(view) {
        st.view = view;
        $('invSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
        render();
    }

    function render() {
        renderStats();
        if (st.view === 'monitor') return renderMonitor();
        if (st.view === 'barang') return renderBarang();
        if (st.view === 'dipinjam') return renderDipinjam();
        return renderRiwayat();
    }

    // ------------------------------------------------------------------ monitoring
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const jam = (iso) => new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });

    function bars(list, empty) {
        if (!list.length) return `<p class="att-muted inv-empty">${empty}</p>`;
        const max = Math.max(...list.map((x) => x.n));
        return `<ol class="inv-bars">${list.map((x) => `<li><span class="inv-bar-l">${esc(x.k)}</span>
            <span class="inv-bar"><i style="width:${Math.max(6, Math.round((x.n / max) * 100))}%"></i></span><b>${x.n}×</b></li>`).join('')}</ol>`;
    }

    async function renderMonitor() {
        const host = $('invBody');
        host.dataset.view = 'monitor';
        if (!st.history) {
            host.innerHTML = '<div class="att-muted">Memuat monitoring…</div>';
            try { st.history = await rpc('inv_loan_history', {}); } catch (err) { host.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; return; }
            if (st.view !== 'monitor') return;
        }
        const m = Inv.monitor(st.history, st.items, st.month, st.today);
        const [y, mo] = st.month.split('-').map(Number);
        const isNow = st.month === st.today.slice(0, 7);
        const itemByKode = new Map(st.items.map((i) => [i.kode, i]));
        const maxDay = Math.max(1, ...m.perHari.map((d) => d.n));
        const card = (title, body, extra = '') => `<section class="inv-mon-card ${extra}"><h3>${title}</h3>${body}</section>`;

        const late = m.late.length ? `<ul class="inv-list">${m.late.map((l) => `<li><div><b>${esc(l.nama)}</b> <span class="inv-kode att-muted">${esc(l.kode)}</span>
                <small>${esc(l.peminjam)} · batas ${esc(Inv.tgl(l.sampai))}</small></div>
                <span class="att-badge bad">Telat ${l.telat} hari</span>
                <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-back="${esc(l.item_id)}">Tandai kembali</button></li>`).join('')}</ul>`
            : '<p class="inv-empty ok">✓ Semua pinjaman masih dalam batas waktu.</p>';
        const rusak = m.rusak.length ? `<ul class="inv-list">${m.rusak.map((i) => `<li><div><b>${esc(i.nama)}</b> <span class="inv-kode att-muted">${esc(i.kode)}</span>
                <small>${esc(i.keterangan_rusak || 'Tanpa keterangan')}${i.lokasi ? ` · ${esc(i.lokasi)}` : ''}</small></div>
                <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-fixed="${esc(i.id)}">Tandai berfungsi</button></li>`).join('')}</ul>`
            : '<p class="inv-empty ok">✓ Tidak ada barang rusak.</p>';
        const notes = m.notes.length ? `<ul class="inv-list">${m.notes.slice(0, 8).map((l) => {
            const it = itemByKode.get(l.kode);
            return `<li><div><b>${esc(l.nama)}</b> <span class="inv-kode att-muted">${esc(l.kode)}</span>
                <span class="inv-note">“${esc(l.catatan)}”</span><small>${esc(l.peminjam)} · ${esc(Inv.tgl(l.kembali, true))}</small></div>
                ${it && it.aktif && it.kondisi === 'baik' ? `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-broken="${esc(it.id)}">Tandai rusak</button>`
        : it?.kondisi === 'rusak' ? '<span class="att-badge bad">Sudah ditandai rusak</span>' : ''}</li>`;
        }).join('')}</ul>` : '<p class="att-muted inv-empty">Belum ada catatan dari guru dalam 30 hari terakhir.</p>';
        const events = m.events.length ? `<ul class="inv-timeline">${m.events.slice(0, 12).map((e) => `<li class="${e.jenis}">
                <time>${esc(jam(e.t))}</time><span><b>${esc(e.l.peminjam)}</b> ${e.jenis === 'pinjam' ? 'meminjam' : 'mengembalikan'} ${esc(e.l.nama)}
                <span class="inv-kode att-muted">${esc(e.l.kode)}</span></span></li>`).join('')}</ul>`
            : '<p class="att-muted inv-empty">Belum ada pinjam / kembali hari ini.</p>';

        host.innerHTML = `<div class="inv-mon-head">
                <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-mon="-1" aria-label="Bulan sebelumnya">‹</button>
                <b id="invMonth">${BULAN[mo - 1]} ${y}</b>
                <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-mon="1" aria-label="Bulan berikutnya" ${isNow ? 'disabled' : ''}>›</button>
            </div>
            <div class="inv-kpi">
                <div><b>${m.total}</b><span>Pinjaman bulan ini</span></div>
                <div><b>${m.dikembalikan}</b><span>Sudah dikembalikan</span></div>
                <div><b>${m.rataHari === null ? '–' : `${String(m.rataHari).replace('.', ',')} hari`}</b><span>Rata-rata lama pinjam</span></div>
                <div><b>${m.sedang}</b><span>Sedang dipinjam sekarang</span></div>
            </div>
            <div class="inv-mon-grid">
                ${card(`Lewat batas kembali <span class="att-badge ${m.late.length ? 'bad' : 'ok'}">${m.late.length}</span>`, late, m.late.length ? 'alert' : '')}
                ${card(`Barang rusak <span class="att-badge ${m.rusak.length ? 'warn' : 'ok'}">${m.rusak.length}</span>`, rusak)}
                ${card('Catatan dari guru saat mengembalikan', notes)}
                ${card('Aktivitas hari ini', events)}
                ${card(`Pinjaman per hari — ${BULAN[mo - 1]}`, `<div class="inv-days" role="img" aria-label="Grafik jumlah pinjaman per hari">${m.perHari.map((d) => `<span title="${esc(Inv.tgl(d.d))}: ${d.n} pinjaman" class="${d.d === st.today ? 'today' : ''}"><i style="height:${Math.round((d.n / maxDay) * 100)}%"></i></span>`).join('')}</div>
                    <div class="inv-days-axis"><span>1</span><span>${m.perHari.length}</span></div>`, 'wide')}
                ${card('Paling sering dipinjam', bars(m.topBarang, 'Belum ada pinjaman bulan ini.'))}
                ${card('Peminjam teraktif', bars(m.topPeminjam, 'Belum ada pinjaman bulan ini.'))}
            </div>
            <div class="inv-tools-row" style="margin-top:12px"><button type="button" class="att-btn att-btn-ghost att-btn-sm" data-goto="riwayat">Lihat semua riwayat →</button></div>`;
    }

    // ------------------------------------------------------------------ barang
    const statusHtml = (it) => {
        if (!it.aktif) return '<span class="att-badge mute">Diarsipkan</span>';
        if (it.pinjaman) {
            return `<span class="att-badge ${it.pinjaman.terlambat ? 'bad' : 'info'}">${it.pinjaman.terlambat ? 'Terlambat' : 'Dipinjam'}</span>
                <div class="att-muted inv-sub">${esc(it.pinjaman.peminjam)} · sejak ${esc(Inv.tgl(it.pinjaman.sejak))}</div>`;
        }
        if (it.jenis_pinjam === 'tidak_dipinjam') return '<span class="att-badge mute">Tidak dipinjam</span>';
        if (it.kondisi === 'rusak') return '<span class="att-badge mute">Tidak bisa dipinjam</span>';
        return '<span class="att-badge ok">Tersedia</span>';
    };

    function filteredItems() {
        return st.items.filter((it) => {
            if (st.kategori && (it.kategori || '') !== st.kategori) return false;
            switch (st.filter) {
                case 'aktif': return it.aktif;
                case 'tersedia': return it.aktif && !it.pinjaman && it.jenis_pinjam !== 'tidak_dipinjam' && it.kondisi === 'baik';
                case 'dipinjam': return it.aktif && it.pinjaman;
                case 'rusak': return it.aktif && it.kondisi === 'rusak';
                case 'arsip': return !it.aktif;
                default: return true;
            }
        });
    }

    function pickLabel() {
        const n = st.pick.size;
        const b = $('invPrint');
        if (b) b.textContent = n ? `🖨 Cetak stiker QR (${n})` : '🖨 Cetak stiker QR';
        const c = $('invPickAll');
        if (c) c.textContent = n ? 'Kosongkan pilihan' : 'Pilih semua yang tampil';
    }

    function renderBarang() {
        const host = $('invBody');
        const kategori = [...new Set(st.items.map((i) => i.kategori).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
        const rows = filteredItems().map((it) => ({
            ...it, barang: `${it.nama} ${it.kategori || ''} ${it.merk || ''}`, peminjam: it.pinjaman?.peminjam || '',
            kondisiLabel: `${Inv.KONDISI[it.kondisi]} ${it.keterangan_rusak || ''}`, status: it.pinjaman ? 'dipinjam' : 'tersedia',
        }));
        const cfg = {
            rows,
            defaultSort: 'kode',
            searchKeys: ['kode', 'barang', 'lokasi', 'peminjam', 'nomor_seri', 'kondisiLabel'],
            searchPlaceholder: 'Cari kode, nama, lokasi, atau peminjam',
            emptyText: st.items.length ? 'Tidak ada barang untuk filter ini.' : 'Belum ada barang. Klik + Tambah barang atau Impor Excel.',
            toolsHtml: `
                <div class="att-field" style="flex:1 1 150px"><label for="invFilter">Filter</label>
                    <select class="att-select" id="invFilter">${[['aktif', 'Semua barang'], ['tersedia', 'Tersedia'], ['dipinjam', 'Sedang dipinjam'], ['rusak', 'Rusak'], ['arsip', 'Diarsipkan']]
        .map(([v, l]) => `<option value="${v}" ${st.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
                <div class="att-field" style="flex:1 1 150px"><label for="invKat">Kategori</label>
                    <select class="att-select" id="invKat"><option value="">Semua kategori</option>${kategori.map((k) => `<option ${st.kategori === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
                <div class="inv-tools-row">
                    <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="invPickAll">Pilih semua yang tampil</button>
                    <button type="button" class="att-btn att-btn-primary att-btn-sm" id="invPrint">🖨 Cetak stiker QR</button>
                    <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="invXlsx">⬇ Excel daftar barang</button>
                </div>`,
            columns: [
                { key: 'pilih', label: 'Pilih', render: (r) => `<input type="checkbox" class="inv-pick" data-pick="${esc(r.id)}" ${st.pick.has(r.id) ? 'checked' : ''} ${r.aktif ? '' : 'disabled'} aria-label="Pilih ${esc(r.kode)}">` },
                { key: 'kode', label: 'Kode', sort: true, render: (r) => `<b class="inv-kode">${esc(r.kode)}</b>` },
                { key: 'nama', label: 'Barang', sort: true, render: (r) => `<b>${esc(r.nama)}</b><div class="att-muted inv-sub">${esc([r.kategori, r.merk, r.tahun_perolehan].filter(Boolean).join(' · ') || '–')}</div>` },
                { key: 'lokasi', label: 'Lokasi', sort: true, render: (r) => esc(r.lokasi || '–') },
                { key: 'kondisi', label: 'Status barang', sort: true, render: (r) => `<span class="att-badge ${Inv.KONDISI_BADGE[r.kondisi] || 'mute'}">${esc(Inv.KONDISI[r.kondisi] || r.kondisi)}</span><div class="att-muted inv-sub">${esc(r.kondisi === 'rusak' ? (r.keterangan_rusak || 'Tanpa keterangan') : Inv.JENIS_PENDEK[r.jenis_pinjam])}</div>` },
                { key: 'status', label: 'Status', sort: true, render: statusHtml },
                {
                    key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-edit="${esc(r.id)}">Edit</button>
                    ${r.aktif && r.pinjaman ? `<button type="button" class="att-btn att-btn-blue att-btn-sm" data-back="${esc(r.id)}">Tandai kembali</button>` : ''}
                    ${r.aktif && !r.pinjaman && r.jenis_pinjam !== 'tidak_dipinjam' && r.kondisi === 'baik' ? `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-lend="${esc(r.id)}">Pinjamkan</button>` : ''}
                    ${r.aktif ? (r.kondisi === 'rusak' ? `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-fixed="${esc(r.id)}">Tandai berfungsi</button>`
        : `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-broken="${esc(r.id)}">Tandai rusak</button>`) : ''}
                    ${r.aktif ? `<button type="button" class="att-btn att-btn-danger att-btn-sm" data-del="${esc(r.id)}">Hapus</button>`
        : `<button type="button" class="att-btn att-btn-ghost att-btn-sm" data-restore="${esc(r.id)}">Aktifkan lagi</button>`}`,
                },
            ],
        };
        if (tables.barang && tables.barang.host === host && host.dataset.view === 'barang') {
            tables.barang.cfg = cfg;
            tables.barang.setRows(rows);
        } else {
            host.dataset.view = 'barang';
            tables.barang = new window.Att.DataTable(host, { storageKey: 'admin-inventaris', ...cfg });
            $('invFilter').addEventListener('change', (e) => { st.filter = e.target.value; renderBarang(); });
            $('invKat').addEventListener('change', (e) => { st.kategori = e.target.value; renderBarang(); });
            $('invPickAll').addEventListener('click', () => {
                if (st.pick.size) st.pick.clear();
                else for (const r of tables.barang.filtered()) if (r.aktif) st.pick.add(r.id);
                tables.barang.draw();
                pickLabel();
            });
            $('invPrint').addEventListener('click', printStickers);
            $('invXlsx').addEventListener('click', exportItems);
        }
        // Daftar kategori bisa berubah setelah tambah/impor.
        const kat = $('invKat');
        if (kat && kat.options.length - 1 !== kategori.length) {
            kat.innerHTML = `<option value="">Semua kategori</option>${kategori.map((k) => `<option ${st.kategori === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}`;
        }
        pickLabel();
    }

    // ------------------------------------------------------------------ dipinjam
    function renderDipinjam() {
        const host = $('invBody');
        host.dataset.view = 'dipinjam';
        const rows = st.items.filter((i) => i.aktif && i.pinjaman).map((it) => ({
            ...it, peminjam: it.pinjaman.peminjam, sejak: it.pinjaman.sejak, sampai: it.pinjaman.sampai || '9999', keperluan: it.pinjaman.keperluan || '',
            telat: it.pinjaman.terlambat ? '0' : '1',
        }));
        tables.dipinjam = new window.Att.DataTable(host, {
            storageKey: 'admin-inventaris-pinjam',
            rows,
            defaultSort: 'telat',
            searchKeys: ['kode', 'nama', 'peminjam', 'keperluan'],
            searchPlaceholder: 'Cari barang atau peminjam',
            emptyText: 'Tidak ada barang yang sedang dipinjam.',
            columns: [
                { key: 'nama', label: 'Barang', sort: true, render: (r) => `<b>${esc(r.nama)}</b><div class="att-muted inv-sub">${esc(r.kode)}</div>` },
                { key: 'peminjam', label: 'Peminjam', sort: true, render: (r) => `<b>${esc(r.peminjam)}</b>${r.keperluan ? `<div class="att-muted inv-sub">${esc(r.keperluan)}</div>` : ''}` },
                { key: 'sejak', label: 'Sejak', sort: true, render: (r) => esc(Inv.tgl(r.sejak, true)) },
                {
                    key: 'telat', label: 'Batas kembali', sort: true, render: (r) => (r.pinjaman.sampai
                        ? `${esc(Inv.tgl(r.pinjaman.sampai))} ${r.pinjaman.terlambat ? '<span class="att-badge bad">Terlambat</span>' : ''}`
                        : '<span class="att-muted">Tanpa batas</span>'),
                },
                { key: 'aksi', label: 'Aksi', className: 'att-actions', render: (r) => `<button type="button" class="att-btn att-btn-blue att-btn-sm" data-back="${esc(r.id)}">Tandai kembali</button>` },
            ],
        });
    }

    // ------------------------------------------------------------------ riwayat
    async function renderRiwayat() {
        const host = $('invBody');
        host.dataset.view = 'riwayat';
        if (!st.history) {
            host.innerHTML = '<div class="att-muted">Memuat riwayat…</div>';
            try { st.history = await rpc('inv_loan_history', {}); } catch (err) { host.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; return; }
            if (st.view !== 'riwayat') return;
        }
        tables.riwayat = new window.Att.DataTable(host, {
            storageKey: 'admin-inventaris-riwayat',
            rows: st.history.map((l) => ({ ...l, kembaliSort: l.kembali || '' })),
            searchKeys: ['kode', 'nama', 'peminjam', 'keperluan', 'catatan'],
            searchPlaceholder: 'Cari barang, peminjam, atau keperluan',
            emptyText: 'Belum ada riwayat peminjaman.',
            toolsHtml: '<div class="inv-tools-row"><button type="button" class="att-btn att-btn-ghost att-btn-sm" id="invHistXlsx">⬇ Export Excel</button></div>',
            columns: [
                { key: 'sejak', label: 'Dipinjam', sort: true, render: (r) => esc(Inv.tgl(r.sejak, true)) },
                { key: 'nama', label: 'Barang', sort: true, render: (r) => `<b>${esc(r.nama)}</b><div class="att-muted inv-sub">${esc(r.kode)}</div>` },
                { key: 'peminjam', label: 'Peminjam', sort: true, render: (r) => `${esc(r.peminjam)}${r.keperluan ? `<div class="att-muted inv-sub">${esc(r.keperluan)}</div>` : ''}` },
                {
                    key: 'kembaliSort', label: 'Dikembalikan', sort: true, render: (r) => (r.kembali
                        ? `${esc(Inv.tgl(r.kembali, true))}${r.kondisi === 'rusak' ? ' <span class="att-badge bad">Rusak</span>' : ''}${r.catatan ? `<div class="inv-sub inv-note">“${esc(r.catatan)}”</div>` : ''}`
                        : `<span class="att-badge ${r.terlambat ? 'bad' : 'info'}">${r.terlambat ? 'Belum · terlambat' : 'Belum kembali'}</span>`),
                },
            ],
        });
        $('invHistXlsx').addEventListener('click', async () => {
            const R = window.RekapPrint;
            R.download(Inv.historyXlsx(R.buildXlsx, st.history, await R.loadLogo()), `Riwayat Pinjam Barang ${st.today}.xlsx`);
        });
    }

    // ------------------------------------------------------------------ aksi
    const KONDISI_OPTS = Object.entries(Inv.KONDISI).map(([value, label]) => ({ value, label }));
    const JENIS_OPTS = Object.entries(Inv.JENIS).map(([value, label]) => ({ value, label }));

    async function itemForm(it) {
        const v = await form({
            title: it ? `Ubah barang ${it.kode}` : 'Tambah barang',
            fields: [
                { id: 'nama', label: 'Nama barang', value: it?.nama, required: true, max: 120, placeholder: 'Mis. Laptop Acer Aspire 3' },
                { id: 'kategori', label: 'Kategori', value: it?.kategori, max: 60, placeholder: 'Mis. Laptop, Proyektor, Speaker', hint: 'Dipakai untuk kode otomatis: Laptop → LAP-001.' },
                { id: 'kode', label: 'Kode barang', value: it?.kode, max: 30, placeholder: it ? '' : 'Kosongkan = dibuat otomatis', hint: it ? 'Stiker QR tidak berubah walau kode diganti.' : '' },
                { id: 'merk', label: 'Merk / tipe', value: it?.merk, max: 80 },
                { id: 'nomor_seri', label: 'Nomor seri', value: it?.nomor_seri, max: 80 },
                { id: 'lokasi', label: 'Lokasi simpan', value: it?.lokasi, max: 80, placeholder: 'Mis. Ruang TU' },
                { id: 'kondisi', label: 'Status barang', type: 'select', options: KONDISI_OPTS, value: it?.kondisi || 'baik', hint: 'Barang rusak tidak bisa dipinjam guru.' },
                { id: 'keterangan_rusak', label: 'Keterangan rusak (opsional)', value: it?.keterangan_rusak, max: 300, placeholder: 'Mis. lampu proyektor mati — diisi kalau statusnya Rusak' },
                { id: 'jenis_pinjam', label: 'Cara pinjam', type: 'select', options: JENIS_OPTS, value: it?.jenis_pinjam || 'harian', hint: 'Harian: harus kembali hari itu juga (bisa diatur sampai 30 hari). Jangka panjang: mis. laptop dipegang guru berbulan-bulan.' },
                { id: 'tahun_perolehan', label: 'Tahun perolehan', value: it?.tahun_perolehan ?? '', max: 4, placeholder: 'Mis. 2024' },
                { id: 'catatan', label: 'Catatan', value: it?.catatan, max: 300 },
            ],
            validate: (x) => (x.tahun_perolehan && !/^\d{4}$/.test(x.tahun_perolehan) ? 'Tahun perolehan harus 4 angka.' : ''),
        });
        if (!v) return;
        try {
            const saved = await rpc('inv_save_item', { p_item: { ...v, id: it?.id || null } });
            toast(it ? `Barang ${saved.kode} diperbarui.` : `Barang ${saved.kode} ditambahkan.`);
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    async function lend(it) {
        const harian = it.jenis_pinjam === 'harian';
        const v = await form({
            title: `Pinjamkan ${it.nama}`,
            fields: [
                { id: 'staff', label: 'Peminjam', type: 'select', required: true, options: [{ value: '', label: '— pilih guru / staf —' }, ...st.staff.map((s) => ({ value: s.id, label: s.name }))] },
                { id: 'keperluan', label: 'Keperluan', max: 200, placeholder: 'Mis. Rapat orang tua kelas 4' },
                { id: 'sampai', label: harian ? 'Kembali paling lambat' : 'Sampai tanggal (opsional)', type: 'date', value: harian ? st.today : '', hint: harian ? '' : 'Kosongkan bila dipegang sampai diminta kembali.' },
            ],
        });
        if (!v) return;
        try {
            await rpc('inv_admin_lend', { p_item: it.id, p_staff: v.staff, p_keperluan: v.keperluan || null, p_sampai: v.sampai || null });
            toast(`${it.nama} dicatat dipinjam.`);
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    async function giveBack(it) {
        const v = await form({
            title: `${it.nama} sudah kembali`,
            submitText: 'Tandai kembali',
            fields: [
                { id: 'kondisi', label: `Status barang setelah dikembalikan oleh ${it.pinjaman.peminjam}`, type: 'select', options: KONDISI_OPTS, value: it.kondisi },
                { id: 'keterangan_rusak', label: 'Keterangan rusak (kalau Rusak)', value: it.keterangan_rusak, max: 300, placeholder: 'Mis. kabel power putus' },
                { id: 'catatan', label: 'Catatan pengembalian (opsional)', max: 300, placeholder: 'Mis. charger tidak ikut' },
            ],
        });
        if (!v) return;
        try {
            await rpc('inv_admin_return', { p_item: it.id, p_kondisi: v.kondisi, p_catatan: v.catatan || null, p_keterangan_rusak: v.keterangan_rusak || null });
            toast(`${it.nama} ditandai sudah kembali.`);
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    async function markBroken(it) {
        const v = await form({
            title: `Tandai ${it.nama} rusak`,
            submitText: 'Tandai rusak',
            fields: [{ id: 'ket', label: 'Keterangan kerusakan (opsional)', max: 300, value: it.keterangan_rusak, placeholder: 'Mis. layar bergaris, tombol power macet' }],
        });
        if (!v) return;
        try {
            await rpc('inv_set_status', { p_item: it.id, p_kondisi: 'rusak', p_keterangan: v.ket || null });
            toast(`${it.kode} ditandai rusak. Guru tidak bisa meminjamnya sampai ditandai berfungsi.`);
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    async function markFixed(it) {
        try {
            await rpc('inv_set_status', { p_item: it.id, p_kondisi: 'baik', p_keterangan: null });
            toast(`${it.kode} ditandai berfungsi dan bisa dipinjam lagi.`);
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    async function remove(it) {
        if (!await window.Att.confirm({
            title: `Hapus ${it.kode}?`, danger: true, confirmText: 'Hapus',
            html: `<p class="att-muted"><b>${esc(it.nama)}</b>. Barang yang pernah dipinjam akan <b>diarsipkan</b> supaya riwayatnya tetap ada.</p>`,
        })) return;
        try {
            const r = await rpc('inv_delete_item', { p_id: it.id });
            st.pick.delete(it.id);
            toast(r === 'diarsipkan' ? `${it.kode} diarsipkan.` : `${it.kode} dihapus.`);
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    async function restore(it) {
        try {
            await rpc('inv_save_item', { p_item: { ...it, aktif: true } });
            toast(`${it.kode} aktif lagi.`);
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    async function printStickers() {
        const picked = st.items.filter((i) => st.pick.has(i.id) && i.aktif);
        const list = picked.length ? picked : (tables.barang ? tables.barang.filtered().filter((r) => r.aktif) : []);
        if (!list.length) return toast('Belum ada barang untuk dicetak.', 'err');
        const v = await form({
            title: `Cetak ${list.length} stiker QR`,
            submitText: 'Cetak / PDF',
            fields: [
                { id: 'skip', label: 'Lewati slot di awal kertas', type: 'select', value: '0', options: Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: i ? `${i} slot sudah terpakai` : 'Mulai dari slot pertama' })), hint: 'A4, 24 stiker per lembar (3 × 8). Berguna kalau kertas label sisa sebagian.' },
            ],
        });
        if (!v) return;
        const sorted = [...list].sort((a, b) => a.kode.localeCompare(b.kode, 'id', { numeric: true }));
        const ok = window.RekapPrint.print(Inv.stickerHtml(sorted, { qr: (t) => window.QR.svg(t, { size: 120 }), skip: Number(v.skip), logo: await logoData() }));
        if (ok === false) toast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak.', 'err');
    }

    let logoUri = null;
    async function logoData() {
        if (logoUri !== null) return logoUri;
        try {
            const b = await window.RekapPrint.loadLogo();
            let bin = '';
            if (b) for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
            logoUri = b ? `data:image/png;base64,${btoa(bin)}` : '';
        } catch { logoUri = ''; }
        return logoUri;
    }

    async function exportItems() {
        const R = window.RekapPrint;
        R.download(Inv.itemsXlsx(R.buildXlsx, filteredItems(), await R.loadLogo()), `Daftar Inventaris ${st.today}.xlsx`);
    }

    // ------------------------------------------------------------------ impor
    async function importFile(file) {
        let parsed;
        try {
            const rows = await window.XlsxRead.read(await file.arrayBuffer(), file.name);
            parsed = Inv.parseImport(rows);
        } catch (err) { toast(errMessage(err), 'err'); return; }
        const { items, errors } = parsed;
        const total = items.reduce((n, i) => n + (Number(i.jumlah) || 1), 0);
        const preview = items.slice(0, 8).map((i) => `<li><b>${esc(i.nama)}</b>${i.kode ? ` · ${esc(i.kode)}` : ''}${Number(i.jumlah) > 1 ? ` × ${esc(i.jumlah)}` : ''}${i.kategori ? ` <span class="att-muted">(${esc(i.kategori)})</span>` : ''}</li>`).join('');
        if (!items.length) {
            await window.Att.confirm({ title: 'File tidak bisa diimpor', html: `<ul class="inv-err">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`, confirmText: 'Tutup', cancelText: 'Batal' });
            return;
        }
        if (!await window.Att.confirm({
            title: `Impor ${total} barang?`,
            confirmText: `Impor ${total} barang`,
            html: `<p class="att-muted" style="margin-top:0">${items.length} baris dari <b>${esc(file.name)}</b>. Kode yang sudah ada akan diperbarui.</p>
                <ul class="inv-prev">${preview}${items.length > 8 ? `<li class="att-muted">…dan ${items.length - 8} baris lainnya</li>` : ''}</ul>
                ${errors.length ? `<div class="att-alert warn" style="margin-top:10px"><b>${errors.length} baris dilewati:</b><ul class="inv-err">${errors.slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}`,
        })) return;
        try {
            const r = await rpc('inv_import_items', { p_rows: items });
            toast(`Impor selesai: ${r.ditambah} barang baru${r.diperbarui ? `, ${r.diperbarui} diperbarui` : ''}.`);
            st.filter = 'aktif';
            await refresh();
        } catch (err) { toast(errMessage(err), 'err'); }
    }

    function downloadTemplate() {
        const R = window.RekapPrint;
        R.download(Inv.templateXlsx(R.buildXlsx), 'Template Impor Inventaris.xlsx');
    }

    // ------------------------------------------------------------------ wiring
    const byId = (id) => st.items.find((i) => i.id === id);

    async function refresh() {
        await load();
        render();
    }

    async function open() {
        try {
            if (!st.loaded) { $('invBody').innerHTML = '<div class="att-muted">Memuat…</div>'; }
            await load();
            st.loaded = true;
            render();
        } catch (err) {
            $('invBody').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const body = $('invBody');
        if (!body) return;
        $('invSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
        $('invStats').addEventListener('click', (e) => {
            const b = e.target.closest('[data-go]');
            if (!b) return;
            if (b.dataset.filter) st.filter = b.dataset.filter;
            if (b.dataset.go === 'barang') delete $('invBody').dataset.view;
            setView(b.dataset.go);
        });
        $('invAdd').addEventListener('click', () => itemForm(null));
        $('dashInvAlert')?.addEventListener('click', () => { st.view = 'monitor'; showTab('tabInventaris', document.querySelector('[data-tab="tabInventaris"]')); });
        $('invTemplate').addEventListener('click', downloadTemplate);
        $('invImport').addEventListener('click', () => $('invFile').click());
        $('invFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
        body.addEventListener('change', (e) => {
            const c = e.target.closest('[data-pick]');
            if (!c) return;
            if (c.checked) st.pick.add(c.dataset.pick); else st.pick.delete(c.dataset.pick);
            pickLabel();
        });
        body.addEventListener('click', (e) => {
            const nav = e.target.closest('[data-mon]');
            if (nav) {
                const [y, m] = st.month.split('-').map(Number);
                const d = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.mon), 1));
                st.month = d.toISOString().slice(0, 7);
                renderMonitor();
                return;
            }
            const goto = e.target.closest('[data-goto]');
            if (goto) { setView(goto.dataset.goto); return; }
            const b = e.target.closest('[data-edit],[data-lend],[data-back],[data-del],[data-restore],[data-broken],[data-fixed]');
            if (!b) return;
            const it = byId(b.dataset.edit || b.dataset.lend || b.dataset.back || b.dataset.del || b.dataset.restore || b.dataset.broken || b.dataset.fixed);
            if (!it) return;
            if (b.dataset.broken) markBroken(it);
            else if (b.dataset.fixed) markFixed(it);
            else if (b.dataset.edit) itemForm(it);
            else if (b.dataset.lend) lend(it);
            else if (b.dataset.back) giveBack(it);
            else if (b.dataset.del) remove(it);
            else restore(it);
        });
    });

    // ------------------------------------------------------------------ kartu di Dashboard utama
    async function dashAlert() {
        const box = $('dashInvAlert');
        if (!box) return;
        try {
            const ov = await rpc('inv_admin_overview');
            const items = (ov.items || []).filter((i) => i.aktif);
            const late = items.filter((i) => i.pinjaman?.terlambat).length;
            const lent = items.filter((i) => i.pinjaman).length;
            const broken = items.filter((i) => i.kondisi === 'rusak').length;
            if (!items.length) { box.hidden = true; return; }
            box.className = `inv-dash ${late ? 'bad' : ''}`;
            box.innerHTML = `<span class="inv-dash-ico">📦</span><span><b>Inventaris:</b> ${late ? `<b>${late} barang lewat batas kembali</b> · ` : ''}${lent} sedang dipinjam${broken ? ` · ${broken} rusak` : ''}</span>
                <span class="inv-dash-go">Buka monitoring →</span>`;
            box.hidden = false;
        } catch { box.hidden = true; }
    }
    const prevLoadDash = window.loadDashboardStats;
    if (typeof prevLoadDash === 'function') {
        window.loadDashboardStats = async function (...a) {
            const r = await prevLoadDash.apply(this, a);
            dashAlert();
            return r;
        };
    }

    const prevShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        prevShowTab(tabId, navEl);
        if (tabId === 'tabDashboard') dashAlert();
        if (tabId !== 'tabInventaris') return;
        $('topbarTitle').textContent = 'Inventaris';
        open();
    };
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { st.loaded = false; st.items = []; st.staff = []; st.history = null; st.pick.clear(); }
    });
}());
