// =============================================================================
// Panel Admin/Operator — Catatan Siswa (lihat, rapikan, hapus) dan Jurnal Mengajar
// guru (lihat & hapus saja). Semua ubah/hapus tercatat di log admin (siapa, kapan,
// isi lama). Hak akses diperiksa di database (get_notes_admin, admin_delete_journal …).
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const $ = (id) => document.getElementById(id);
    const { esc, errMessage, toast, todayJakarta } = window.Att;
    const C = window.Catatan;
    const JR = window.Jurnal;
    const RP = window.RekapPrint;
    const BUCKET = 'catatan-siswa';

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }
    const semesterNow = () => (Number(todayJakarta().slice(5, 7)) >= 7 ? 1 : 2);
    const print = (html) => { if (!RP.print(html)) toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err'); };

    function sheet(html) {
        const back = document.createElement('div');
        back.className = 'att-sheet-backdrop';
        back.innerHTML = `<div class="att-sheet cs-sheet" role="dialog" aria-modal="true">${html}</div>`;
        const close = () => back.remove();
        back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
        document.body.appendChild(back);
        return { el: back, close };
    }

    async function riwayat(entitas) {
        const list = await rpc('get_admin_audit', { p_entitas: entitas, p_limit: 200 });
        const f = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        sheet(`<div class="cs-sheet-head"><h3>Riwayat perubahan admin</h3><button type="button" class="att-btn att-btn-ghost cs-x" data-close aria-label="Tutup">×</button></div>
            ${list.length ? `<ul class="ad-log">${list.map((a) => `<li><b>${a.aksi === 'hapus' ? 'Dihapus' : 'Dirapikan'}</b> · ${esc(a.ringkasan || '')}
                <small>${esc(f.format(new Date(a.waktu)))} · oleh ${esc(a.oleh || '-')}${a.data_lama?.judul && a.aksi === 'ubah' ? ` · judul lama: “${esc(a.data_lama.judul)}”` : ''}</small></li>`).join('')}</ul>`
        : '<p class="att-muted">Belum ada perubahan oleh admin/operator.</p>'}`);
    }

    // ================================================================ Catatan Siswa
    const cs = { smt: semesterNow(), kelas: '', jenis: '', penulis: '', q: '', data: null };
    let qTimer = null;

    async function loadCatatan() {
        const host = $('csAdmHost');
        host.innerHTML = '<div class="att-muted">Memuat…</div>';
        try {
            cs.data = await rpc('get_notes_admin', { p_semester: cs.smt, p_class_id: cs.kelas || null, p_jenis: cs.jenis || null, p_author: cs.penulis || null, p_q: cs.q || null, p_limit: 300 });
            drawCatatan();
        } catch (err) { host.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; }
    }

    function drawCatatan() {
        const d = cs.data;
        const r = d.ringkas || {};
        const host = $('csAdmHost');
        host.innerHTML = `
            <div class="inv-seg nl-seg" role="tablist" aria-label="Semester">
                <button type="button" role="tab" data-smt="1" aria-selected="${cs.smt === 1}">Semester Ganjil</button>
                <button type="button" role="tab" data-smt="2" aria-selected="${cs.smt === 2}">Semester Genap</button></div>
            <div class="inv-stats">
                <div class="inv-stat"><b style="color:var(--t-amber-ink)">${r.apresiasi || 0}</b><span>Apresiasi</span></div>
                <div class="inv-stat"><b style="color:var(--t-red-ink)">${r.perilaku || 0}</b><span>Perilaku · ${r.serius || 0} serius</span></div>
                <div class="inv-stat"><b style="color:var(--t-blue-ink)">${r.catatan || 0}</b><span>Catatan</span></div>
                <div class="inv-stat warn"><b>${r.serius_terbuka || 0}</b><span>Serius, belum ditindaklanjuti</span></div>
            </div>
            <div class="ad-filters">
                <div class="att-field"><label for="csAK">Kelas</label><select class="att-select" id="csAK"><option value="">Semua kelas</option>${d.kelas.map((k) => `<option value="${esc(k.id)}" ${k.id === cs.kelas ? 'selected' : ''}>Kelas ${esc(k.nama)}</option>`).join('')}</select></div>
                <div class="att-field"><label for="csAJ">Jenis</label><select class="att-select" id="csAJ">${[['', 'Semua jenis'], ['apresiasi', 'Apresiasi'], ['perilaku', 'Perilaku'], ['serius', 'Perilaku serius'], ['catatan', 'Catatan']].map(([v, t]) => `<option value="${v}" ${v === cs.jenis ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
                <div class="att-field"><label for="csAP">Penulis</label><select class="att-select" id="csAP"><option value="">Semua guru</option>${d.penulis.map((p) => `<option value="${esc(p.id)}" ${p.id === cs.penulis ? 'selected' : ''}>${esc(p.nama)}</option>`).join('')}</select></div>
                <div class="att-field grow"><label for="csAQ">Cari</label><input class="att-input" id="csAQ" type="search" placeholder="Nama siswa atau isi catatan" value="${esc(cs.q)}"></div>
                <button type="button" class="att-btn att-btn-ghost" id="csALog">Riwayat perubahan admin</button>
                <button type="button" class="att-btn att-btn-primary" id="csAPdf" ${cs.kelas ? '' : 'disabled title="Pilih kelas dulu"'}>Unduh rangkuman PDF</button>
            </div>
            <div class="att-table-wrap" style="overflow-x:auto"><table class="att-table ad-table">
                <thead><tr><th>Tanggal</th><th>Siswa</th><th>Jenis</th><th>Catatan</th><th>Penulis</th><th style="text-align:right">Aksi</th></tr></thead>
                <tbody>${d.catatan.length ? d.catatan.map((n) => `<tr class="${n.tingkat === 'serius' ? 'srs' : ''}">
                    <td data-label="Tanggal" style="white-space:nowrap">${esc(C.tglSedang(n.tanggal))}</td>
                    <td data-label="Siswa"><div><b>${esc(n.siswa)}</b><small>Kelas ${esc(C.kelasTitik(n.kelas || ''))}</small></div></td>
                    <td data-label="Jenis"><span class="cs-tag ${n.jenis} ${n.tingkat || ''}">${esc(C.label(n).toUpperCase())}</span></td>
                    <td data-label="Catatan"><div><b>${esc(n.judul)}</b>${n.cerita ? `<small>${esc(n.cerita)}</small>` : ''}<small>${n.tindak_lanjut ? `Tindak lanjut: ${esc(n.tindak_lanjut)}` : (n.jenis === 'perilaku' ? 'Tindak lanjut belum diisi' : '')}${n.fotos?.length ? ` · ${n.fotos.length} foto` : ''}${n.dirapikan_oleh ? ` · dirapikan ${esc(n.dirapikan_oleh)}` : ''}</small></div></td>
                    <td data-label="Penulis">${esc(n.penulis)}</td>
                    <td class="att-actions ad-aksi"><div class="att-actions"><button type="button" class="att-btn att-btn-ghost att-btn-sm" data-ubah="${esc(n.id)}">Ubah</button><button type="button" class="att-btn att-btn-danger att-btn-sm" data-hapus="${esc(n.id)}">Hapus</button></div></td>
                </tr>`).join('') : '<tr><td colspan="6" class="att-muted">Tidak ada catatan yang cocok.</td></tr>'}</tbody>
            </table></div>
            <p class="ad-note">Setiap ubah/hapus oleh admin/operator tercatat (siapa, kapan, isi lama) dan penulisnya melihat tanda “dirapikan”.</p>`;
        host.querySelectorAll('[data-smt]').forEach((b) => b.addEventListener('click', () => { cs.smt = Number(b.dataset.smt); loadCatatan(); }));
        $('csAK').addEventListener('change', (e) => { cs.kelas = e.target.value; loadCatatan(); });
        $('csAJ').addEventListener('change', (e) => { cs.jenis = e.target.value; loadCatatan(); });
        $('csAP').addEventListener('change', (e) => { cs.penulis = e.target.value; loadCatatan(); });
        $('csAQ').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { cs.q = e.target.value.trim(); loadCatatan().then(() => { const i = $('csAQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 400); });
        $('csALog').addEventListener('click', () => riwayat('catatan_siswa').catch((err) => toast(errMessage(err), 'err')));
        $('csAPdf').addEventListener('click', async () => {
            try { print(C.htmlKelas(await rpc('get_class_notes', { p_class_id: cs.kelas, p_semester: cs.smt }))); } catch (err) { toast(errMessage(err), 'err'); }
        });
        host.querySelectorAll('[data-ubah]').forEach((b) => b.addEventListener('click', () => ubah(d.catatan.find((n) => n.id === b.dataset.ubah))));
        host.querySelectorAll('[data-hapus]').forEach((b) => b.addEventListener('click', async () => {
            const n = d.catatan.find((x) => x.id === b.dataset.hapus);
            if (!await window.Att.confirm({ title: 'Hapus catatan ini?', html: `<p class="att-muted"><b>${esc(n.siswa)}</b> — ${esc(n.judul)} (oleh ${esc(n.penulis)}).<br>Tercatat di riwayat perubahan admin.</p>`, confirmText: 'Hapus', danger: true })) return;
            try {
                const res = await rpc('delete_student_note', { p_id: n.id });
                if (res?.fotos?.length) await sb.storage.from(BUCKET).remove(res.fotos);
                toast('Catatan dihapus', 'ok');
                loadCatatan();
            } catch (err) { toast(errMessage(err), 'err'); }
        }));
    }

    function ubah(n) {
        let jenis = n.jenis; let ting = n.tingkat || 'ringan';
        const sh = sheet(`<div class="cs-sheet-head"><h3>Rapikan catatan</h3><button type="button" class="att-btn att-btn-ghost cs-x" data-close aria-label="Tutup">×</button></div>
            <p class="att-muted" style="margin:0">${esc(n.siswa)} · Kelas ${esc(C.kelasTitik(n.kelas || ''))} · oleh ${esc(n.penulis)}</p>
            <div class="cs-f"><div class="cs-l">Jenis</div><div class="cs-jenis">${['apresiasi', 'perilaku', 'catatan'].map((j) => `<button type="button" data-j="${j}" class="${j}" aria-pressed="${j === jenis}">${C.JENIS[j]}</button>`).join('')}</div></div>
            <div class="cs-f" id="adTing"><div class="cs-l">Tingkat</div><div class="cs-ting">${Object.entries(C.TINGKAT).map(([k, t]) => `<button type="button" data-t="${k}" class="${k}" aria-pressed="${k === ting}">${t}</button>`).join('')}</div></div>
            <div class="cs-f"><label for="adTgl" class="cs-l">Tanggal</label><input class="att-input" type="date" id="adTgl" value="${esc(n.tanggal)}" max="${esc(todayJakarta())}"></div>
            <div class="cs-f"><label for="adJ" class="cs-l">Judul</label><input class="att-input" id="adJ" maxlength="120" value="${esc(n.judul)}"></div>
            <div class="cs-f"><label for="adC" class="cs-l">Cerita</label><textarea class="att-textarea" id="adC" rows="3" maxlength="1000">${esc(n.cerita || '')}</textarea></div>
            <div class="cs-f"><label for="adT" class="cs-l">Tindak lanjut</label><input class="att-input" id="adT" maxlength="500" value="${esc(n.tindak_lanjut || '')}"></div>
            <div class="att-alert err" id="adErr" role="alert" hidden></div>
            <button type="button" class="att-btn att-btn-primary att-btn-block" id="adSave">Simpan</button>`);
        const q = (s) => sh.el.querySelector(s);
        const draw = () => {
            sh.el.querySelectorAll('[data-j]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.j === jenis)));
            sh.el.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === ting)));
            q('#adTing').hidden = jenis !== 'perilaku';
        };
        sh.el.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('click', () => { jenis = b.dataset.j; draw(); }));
        sh.el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { ting = b.dataset.t; draw(); }));
        draw();
        q('#adSave').addEventListener('click', async () => {
            try {
                await rpc('save_student_note', { p_id: n.id, p_jenis: jenis, p_tingkat: jenis === 'perilaku' ? ting : null, p_tanggal: q('#adTgl').value,
                    p_judul: q('#adJ').value, p_cerita: q('#adC').value, p_tindak_lanjut: q('#adT').value, p_fotos: n.fotos || [] });
                sh.close();
                toast('Catatan dirapikan', 'ok');
                loadCatatan();
            } catch (err) { q('#adErr').textContent = errMessage(err); q('#adErr').hidden = false; }
        });
    }

    // ================================================================ Jurnal mengajar
    const jr = { guru: '', bulan: todayJakarta().slice(0, 7), status: '', data: null, pilih: new Set() };

    async function loadJurnal() {
        const host = $('jrAdmHost');
        host.innerHTML = '<div class="att-muted">Memuat…</div>';
        try {
            const [y, m] = jr.bulan.split('-').map(Number);
            if (!jr.guru) {
                const first = await rpc('get_journal_admin', { p_staff_id: '00000000-0000-0000-0000-000000000000', p_tahun: y, p_bulan: m });
                jr.guru = (first.guru.find((g) => g.jumlah) || first.guru[0] || {}).id || '';
            }
            jr.data = await rpc('get_journal_admin', { p_staff_id: jr.guru || '00000000-0000-0000-0000-000000000000', p_tahun: y, p_bulan: m });
            jr.pilih = new Set();
            drawJurnal();
        } catch (err) { host.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; }
    }

    function monthData() {
        const [y, m] = jr.bulan.split('-').map(Number);
        const g = jr.data.guru.find((x) => x.id === jr.guru) || {};
        return { tahun: y, bulan: m, guru: { nama: g.nama || '', nip: '' },
            catatan: jr.data.catatan.slice().reverse().map((c) => ({ tanggal: c.tanggal, kelas: c.kelas, mapel: c.mapel, judul: c.judul, jam: c.jam, status: c.status, materi: c.materi, keterangan: c.keterangan })) };
    }

    function drawJurnal() {
        const d = jr.data;
        const rows = d.catatan.filter((c) => !jr.status || c.status === jr.status);
        const n = { total: d.catatan.length, ok: d.catatan.filter((c) => c.status === 'terlaksana').length, no: d.catatan.filter((c) => c.status === 'tidak').length, dobel: d.catatan.filter((c) => c.dobel).length };
        const host = $('jrAdmHost');
        const hari = (iso) => `${JR.HARI[JR.hariDari(iso)].slice(0, 3)}, ${C.tglSedang(iso)}`;
        host.innerHTML = `
            <div class="ad-filters">
                <div class="att-field grow"><label for="jrAG">Guru</label><select class="att-select" id="jrAG">${d.guru.map((g) => `<option value="${esc(g.id)}" ${g.id === jr.guru ? 'selected' : ''}>${esc(g.nama)}${g.wali ? ` — wali ${esc(g.wali)}` : ''} (${g.jumlah})</option>`).join('')}</select></div>
                <div class="att-field"><label for="jrAB">Bulan</label><input class="att-input" type="month" id="jrAB" value="${esc(jr.bulan)}"></div>
                <div class="att-field"><label for="jrAS">Status</label><select class="att-select" id="jrAS">${[['', 'Semua'], ['terlaksana', 'Terlaksana'], ['tidak', 'Tidak terlaksana']].map(([v, t]) => `<option value="${v}" ${v === jr.status ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
                <button type="button" class="att-btn att-btn-ghost" id="jrALog">Riwayat penghapusan</button>
                <button type="button" class="att-btn att-btn-ghost" id="jrAX">Excel</button>
                <button type="button" class="att-btn att-btn-ghost" id="jrAP">PDF</button>
                <div class="ad-bulk" id="jrBulk" ${jr.pilih.size ? '' : 'hidden'}><span id="jrBulkN">${jr.pilih.size} dipilih</span><button type="button" class="att-btn att-btn-danger att-btn-sm" id="jrBulkDel">Hapus terpilih</button></div>
            </div>
            <div class="inv-stats">
                <div class="inv-stat"><b>${n.total}</b><span>Catatan bulan ini</span></div>
                <div class="inv-stat"><b style="color:var(--t-green-ink)">${n.ok}</b><span>Terlaksana</span></div>
                <div class="inv-stat"><b style="color:var(--t-red-ink)">${n.no}</b><span>Tidak terlaksana</span></div>
                <div class="inv-stat warn"><b>${n.dobel}</b><span>Kemungkinan dobel</span></div>
            </div>
            <div class="att-table-wrap" style="overflow-x:auto"><table class="att-table ad-table">
                <thead><tr><th><label class="sr-only" for="jrAll">Pilih semua</label><input type="checkbox" id="jrAll"></th><th>Tanggal</th><th>Kelas</th><th>Mapel / catatan</th><th>Jam ke</th><th>Status</th><th>Materi / keterangan</th><th style="text-align:right">Aksi</th></tr></thead>
                <tbody>${rows.length ? rows.map((c) => `<tr data-row="${esc(c.id)}">
                    <td data-label="Pilih"><input type="checkbox" data-cek="${esc(c.id)}" aria-label="Pilih ${esc(c.mapel || c.judul || '')} ${esc(c.tanggal)}"></td>
                    <td data-label="Tanggal" style="white-space:nowrap">${esc(hari(c.tanggal))}</td>
                    <td data-label="Kelas">${esc(c.kelas ? C.kelasTitik(c.kelas) : '–')}</td>
                    <td data-label="Mapel / catatan"><div><b>${esc(c.judul || c.mapel || '')}</b>${c.dobel ? '<span class="ad-dobel">dobel?</span>' : ''}</div></td>
                    <td data-label="Jam ke">${esc(c.jam || '–')}</td>
                    <td data-label="Status"><span class="att-badge ${c.status === 'terlaksana' ? 'ok' : 'bad'}">${c.status === 'terlaksana' ? 'Terlaksana' : 'Tidak terlaksana'}</span></td>
                    <td data-label="Materi / ket."><div>${esc(c.materi || '')}${c.keterangan ? `<small>Ket: ${esc(c.keterangan)}</small>` : ''}${!c.materi && !c.keterangan ? '<span class="att-muted">—</span>' : ''}</div></td>
                    <td class="att-actions ad-aksi"><button type="button" class="att-btn att-btn-danger att-btn-sm" data-del="${esc(c.id)}">Hapus</button></td>
                </tr>`).join('') : '<tr><td colspan="8" class="att-muted">Belum ada jurnal di bulan ini.</td></tr>'}</tbody>
            </table></div>
            <p class="ad-note">Operator hanya bisa melihat dan menghapus — tidak bisa menambah atau mengubah isi jurnal guru. Setiap penghapusan tercatat (siapa, kapan, isi lama).</p>`;
        $('jrAG').addEventListener('change', (e) => { jr.guru = e.target.value; loadJurnal(); });
        $('jrAB').addEventListener('change', (e) => { if (e.target.value) { jr.bulan = e.target.value; loadJurnal(); } });
        $('jrAS').addEventListener('change', (e) => { jr.status = e.target.value; drawJurnal(); });
        $('jrALog').addEventListener('click', () => riwayat('jurnal_mengajar').catch((err) => toast(errMessage(err), 'err')));
        $('jrAX').addEventListener('click', () => { const m = monthData(); RP.download(JR.xlsx(m), `${JR.namaFile(m)}_${m.guru.nama.replace(/[^\w]+/g, '_')}.xlsx`); });
        $('jrAP').addEventListener('click', () => print(JR.html(monthData())));
        const sync = () => {
            $('jrBulk').hidden = !jr.pilih.size;
            $('jrBulkN').textContent = `${jr.pilih.size} dipilih`;
            host.querySelectorAll('[data-row]').forEach((tr) => tr.classList.toggle('pilih', jr.pilih.has(tr.dataset.row)));
        };
        host.querySelectorAll('[data-cek]').forEach((c) => c.addEventListener('change', () => { if (c.checked) jr.pilih.add(c.dataset.cek); else jr.pilih.delete(c.dataset.cek); sync(); }));
        $('jrAll').addEventListener('change', (e) => { host.querySelectorAll('[data-cek]').forEach((c) => { c.checked = e.target.checked; if (c.checked) jr.pilih.add(c.dataset.cek); else jr.pilih.delete(c.dataset.cek); }); sync(); });
        const hapus = async (ids) => {
            if (!await window.Att.confirm({ title: `Hapus ${ids.length} catatan jurnal?`, html: '<p class="att-muted">Jurnal guru yang dihapus tidak bisa dikembalikan dari sini, tapi isi lamanya tercatat di riwayat penghapusan.</p>', confirmText: 'Hapus', danger: true })) return;
            try { const k = await rpc('admin_delete_journal', { p_ids: ids }); toast(`${k} catatan jurnal dihapus`, 'ok'); loadJurnal(); } catch (err) { toast(errMessage(err), 'err'); }
        };
        host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => hapus([b.dataset.del])));
        $('jrBulkDel').addEventListener('click', () => hapus([...jr.pilih]));
    }

    const prevShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        const r = prevShowTab(tabId, navEl);
        if (tabId === 'tabCatatan') { $('topbarTitle').textContent = 'Catatan Siswa'; loadCatatan(); }
        if (tabId === 'tabJurnalAdmin') { $('topbarTitle').textContent = 'Jurnal Mengajar'; loadJurnal(); }
        return r;
    };
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { Object.assign(cs, { smt: semesterNow(), kelas: '', jenis: '', penulis: '', q: '', data: null }); Object.assign(jr, { guru: '', data: null }); }
    });
}());
