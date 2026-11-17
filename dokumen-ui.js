// =============================================================================
// Formulir "Cetak & Dokumen" yang dipakai bersama oleh Portal Guru (guru.js) dan
// Panel Admin (admin-dokumen.js). Template dokumennya ada di dokumen-templates.js.
//
//   DokUI.mount(host, {
//       typeId, classes: [{ id, label }], classId, onClassChange(classId),
//       rpc(fn, args) → Promise, toast(msg, kind), confirm(opts) → Promise<bool>,
//       today, store,            // store: objek tempat isian diingat per jenis dokumen
//   })
//
// Semua id elemen diawali "gDk" / "gDok" dan dicari di dalam host saja.
// =============================================================================
(function () {
    'use strict';

    const Dok = window.Dok;
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const kelasTitik = (k) => String(k || '').replace(/\s+/, '.');
    const errMessage = (e) => (window.Att && window.Att.errMessage ? window.Att.errMessage(e) : (e && e.message) || 'Terjadi kesalahan.');

    // ------------------------------------------------------------------ data
    let assetsPromise = null;
    /** Gambar kop & logo sebagai data URI (dimuat sekali), supaya cetakan tidak menunggu internet. */
    function loadAssets() {
        if (!assetsPromise) {
            assetsPromise = Promise.all(Dok.ASSETS.map(async (file) => {
                try {
                    const res = await fetch(`/${file}`);
                    if (!res.ok) return [file, null];
                    const blob = await res.blob();
                    const uri = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
                    return [file, String(uri).replace(/^data:[^;]*;/, 'data:image/png;')];
                } catch { return [file, null]; }
            })).then((pairs) => Object.fromEntries(pairs));
        }
        return assetsPromise;
    }

    const cache = { classId: null, data: null };
    async function loadData(rpc, classId) {
        if (cache.data && cache.classId === classId) return cache.data;
        const data = await rpc('get_class_document_data', { p_class_id: classId });
        cache.classId = classId;
        cache.data = data;
        return data;
    }

    /** Isian awal satu jenis dokumen; pilihan bertanda "remember" (versi kop) memakai pilihan terakhir di perangkat. */
    function initValues(type, today, store) {
        if (!store[type.id]) {
            const v = Dok.defaults(type, today);
            for (const f of type.fields) {
                if (!f.remember) continue;
                try { const x = localStorage.getItem(`dok-${f.key}`); if (x && f.options.some(([k]) => k === x)) v[f.key] = x; } catch { /* abaikan */ }
            }
            store[type.id] = v;
        }
        return store[type.id];
    }

    // ------------------------------------------------------------------ isian
    function fieldHtml(f, v, data) {
        const id = `gDk_${f.key}`;
        const lab = `<label for="${id}">${esc(f.label)}</label>`;
        if (f.type === 'hidden') return '';
        if (f.type === 'checks') {
            return `<fieldset class="g-dok-checks"><legend>${esc(f.label)}</legend>${f.options.map(([k, l]) =>
                `<label><input type="checkbox" data-dk="${f.key}" value="${esc(k)}" ${(v || []).includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</fieldset>`;
        }
        if (f.type === 'siswaMulti') {
            const sel = new Set(v || []);
            const all = !sel.size;
            const n = (data?.siswa || []).length;
            return `<details class="g-dok-multi" ${all ? '' : 'open'}>
                <summary><span>${esc(f.label)}</span><b id="gDkPilihInfo">${all ? `Semua siswa (${n})` : `${sel.size} dari ${n} siswa`}</b></summary>
                <div class="g-dok-multi-bar"><button type="button" class="att-btn att-btn-ghost att-btn-sm" data-multi="all">Pilih semua</button>
                    <button type="button" class="att-btn att-btn-ghost att-btn-sm" data-multi="none">Kosongkan</button></div>
                <div class="g-dok-multi-list">${(data?.siswa || []).map((s) => `<label><input type="checkbox" data-dk="${f.key}" value="${esc(s.student_id)}" ${all || sel.has(s.student_id) ? 'checked' : ''}>
                    <span>${esc(s.no)}. ${esc(s.nama)}</span></label>`).join('')}</div>
            </details>`;
        }
        if (f.type === 'nomor') {
            return `<div class="att-field"><label for="${id}">${esc(f.label)}</label>
                <div class="g-dok-nomor"><input class="att-input" id="${id}" data-dk="${f.key}" inputmode="numeric" maxlength="3" placeholder="005" value="${esc(v)}" aria-label="Nomor urut surat">
                    <span>/${esc(Dok.KOP.kodeSurat)}</span>
                    <button type="button" class="att-btn att-btn-ghost att-btn-sm" id="gDokAmbil">Ambil nomor berikutnya</button></div>
                <small class="att-muted">Kosongkan bila nomor diisi tangan oleh TU. "Ambil nomor berikutnya" mencatat nomor itu atas nama Anda supaya tidak dobel.</small></div>`;
        }
        if (f.type === 'check') return `<label class="g-dok-check"><input type="checkbox" id="${id}" data-dk="${f.key}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
        if (f.type === 'select') return `<div class="att-field">${lab}<select class="att-select" id="${id}" data-dk="${f.key}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
        if (f.type === 'siswa') {
            return `<div class="att-field">${lab}<select class="att-select" id="${id}" data-dk="${f.key}">
                <option value="">— pilih siswa —</option>${f.all ? `<option value="*" ${v === '*' ? 'selected' : ''}>Semua siswa (satu lembar per siswa)</option>` : ''}
                ${(data?.siswa || []).map((s) => `<option value="${esc(s.student_id)}" ${s.student_id === v ? 'selected' : ''}>${esc(s.no)}. ${esc(s.nama)}</option>`).join('')}</select></div>`;
        }
        if (f.type === 'textarea') return `<div class="att-field">${lab}<textarea class="att-input" id="${id}" data-dk="${f.key}" rows="5" style="min-height:120px;padding:10px 12px">${esc(v)}</textarea></div>`;
        return `<div class="att-field">${lab}<input class="att-input" id="${id}" data-dk="${f.key}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}"
            value="${esc(v)}" ${f.min ? `min="${f.min}"` : ''} ${f.max ? `max="${f.max}"` : ''} ${f.type === 'number' ? 'inputmode="numeric"' : ''} placeholder="${esc(f.placeholder || '')}"></div>`;
    }

    // ------------------------------------------------------------------ pasang formulir
    async function mount(host, o) {
        const type = Dok.typeOf(o.typeId);
        if (!type) { host.innerHTML = '<div class="att-alert err">Jenis dokumen tidak dikenal.</div>'; return; }
        if (!o.classes.length) { host.innerHTML = '<div class="att-alert info">Belum ada kelas yang bisa dipilih.</div>'; return; }
        const token = {};
        host.__dokToken = token;
        const vals = initValues(type, o.today, o.store);
        host.innerHTML = '<div class="g-loading att-muted">Memuat data kelas…</div>';
        let data;
        let assets;
        try { [data, assets] = await Promise.all([loadData(o.rpc, o.classId), loadAssets()]); } catch (err) {
            host.innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
            return;
        }
        if (host.__dokToken !== token || !host.isConnected) return;   // sudah pindah halaman/dokumen
        for (const f of type.fields) {
            if (f.type === 'siswa' && vals[f.key] && vals[f.key] !== '*' && !data.siswa.some((s) => s.student_id === vals[f.key])) vals[f.key] = '';
            if (f.type === 'siswaMulti') vals[f.key] = (vals[f.key] || []).filter((x) => data.siswa.some((s) => s.student_id === x));
        }
        const has = (k) => type.formats.includes(k);
        const $ = (id) => host.querySelector(`#${id}`);
        host.innerHTML = `<div class="g-dok-layout"><div>
            <p class="att-muted" style="margin:0 0 12px">${esc(type.ket)}</p>
            <form class="att-card att-stack" id="gDokForm" novalidate>
                <div class="att-field"><label for="gDokKelas">Kelas</label><select class="att-select" id="gDokKelas">${o.classes.map((c) =>
        `<option value="${esc(c.id)}" ${c.id === o.classId ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
                ${type.fields.map((f) => fieldHtml(f, vals[f.key], data)).join('')}
                <div class="att-alert err g-hidden" id="gDokErr" role="alert"></div>
                <div class="g-dok-actions">
                    ${has('print') ? '<button type="button" class="att-btn att-btn-primary" data-out="print">Cetak / PDF</button>' : ''}
                    ${has('word') ? '<button type="button" class="att-btn att-btn-ghost" data-out="word">Unduh Word</button>' : ''}
                    ${has('xlsx') ? '<button type="button" class="att-btn att-btn-ghost" data-out="xlsx">Unduh Excel</button>' : ''}
                </div>
            </form></div>
            <div><h2 class="g-dok-h" style="margin-top:0">Pratinjau</h2>
            <div class="g-dok-prev"><iframe id="gDokPrev" title="Pratinjau dokumen" sandbox=""></iframe></div>
            <p class="att-muted" style="margin:8px 0 0">${data.siswa.length} siswa · Kelas ${esc(kelasTitik(data.kelas))}. Nomor surat boleh dikosongkan untuk diisi TU. File Word bisa diedit dulu sebelum dicetak.</p></div></div>`;

        const read = () => {
            for (const f of type.fields) {
                if (f.type === 'hidden') continue;
                if (f.type === 'checks') vals[f.key] = [...host.querySelectorAll(`[data-dk="${f.key}"]:checked`)].map((c) => c.value);
                else if (f.type === 'siswaMulti') {
                    const boxes = [...host.querySelectorAll(`[data-dk="${f.key}"]`)];
                    const on = boxes.filter((c) => c.checked).map((c) => c.value);
                    vals[f.key] = on.length === boxes.length ? [] : on;
                    const info = $('gDkPilihInfo');
                    if (info) info.textContent = on.length === boxes.length ? `Semua siswa (${boxes.length})` : `${on.length} dari ${boxes.length} siswa`;
                } else if (f.type === 'check') vals[f.key] = $(`gDk_${f.key}`).checked;
                else if (f.type === 'nomor') { const el = $(`gDk_${f.key}`); el.value = el.value.replace(/[^0-9]/g, '').slice(0, 3); vals[f.key] = el.value; }
                else {
                    vals[f.key] = $(`gDk_${f.key}`).value;
                    if (f.remember) { try { localStorage.setItem(`dok-${f.key}`, vals[f.key]); } catch { /* abaikan */ } }
                }
            }
            const multi = type.fields.find((f) => f.type === 'siswaMulti');
            if (multi && vals[multi.key].length === 0 && host.querySelectorAll(`[data-dk="${multi.key}"]:checked`).length === 0) return { kosong: true };
            return Dok.build(type.id, data, vals);
        };
        const preview = () => {
            if (host.__dokToken !== token) return;   // formulir sudah diganti (jenis/kelas lain)
            const doc = read();
            const box = $('gDokPrev').parentElement;
            // iframe dibuat baru tiap kali: mengganti srcdoc pada iframe lama menambah riwayat "kembali" di browser.
            const frame = document.createElement('iframe');
            frame.id = 'gDokPrev';
            frame.title = 'Pratinjau dokumen';
            frame.setAttribute('sandbox', '');
            const msg = doc?.kosong ? 'Pilih minimal satu siswa.' : 'Pilih siswa dulu untuk melihat pratinjau.';
            frame.srcdoc = doc && !doc.kosong ? Dok.page(doc, 'preview', assets) : `<p style="font:14px Arial;color:#64748b;padding:16px">${msg}</p>`;
            $('gDokPrev').replaceWith(frame);
            box.classList.toggle('wide', Boolean(doc?.landscape));
            // Perkecil pratinjau supaya satu halaman muat di lebar kolomnya.
            const w = doc?.landscape ? 1123 : 794;
            const h = doc?.landscape ? 794 : 1000;
            const k = Math.min(1, box.clientWidth / w);
            frame.style.transform = `scale(${k})`;
            box.style.height = `${Math.round(h * k)}px`;
            box.style.overflow = 'hidden';
        };
        let timer = null;
        $('gDokForm').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 250); });
        $('gDokKelas').addEventListener('change', (e) => o.onClassChange(e.target.value));
        host.querySelectorAll('[data-multi]').forEach((b) => b.addEventListener('click', () => {
            host.querySelectorAll('[data-dk="pilih"]').forEach((c) => { c.checked = b.dataset.multi === 'all'; });
            preview();
        }));
        $('gDokAmbil')?.addEventListener('click', async () => {
            read();
            const s = data.siswa.find((x) => x.student_id === vals.siswa);
            const ok = await o.confirm({
                title: 'Ambil nomor surat berikutnya?',
                html: `<p class="att-muted">Nomor urut berikutnya akan dicatat di buku nomor surat atas nama Anda untuk <b>${esc(type.nama)}</b>. Nomor yang sudah diambil tidak bisa dipakai surat lain.</p>`,
                confirmText: 'Ambil nomor',
            });
            if (!ok) return;
            try {
                const r = await o.rpc('take_letter_number', {
                    p_jenis: type.nama, p_perihal: s ? `${s.nama} (Kelas ${data.kelas})` : `Kelas ${data.kelas}`, p_kode: vals.kode || Dok.KOP.kodeSurat,
                });
                $('gDk_nomor').value = String(r.nomor).padStart(3, '0');
                o.toast(`Nomor surat ${r.teks} dicatat.`);
                preview();
            } catch (err) { o.toast(errMessage(err), 'err'); }
        });
        host.querySelectorAll('[data-out]').forEach((b) => b.addEventListener('click', async () => {
            const doc = read();
            const err = $('gDokErr');
            err.classList.add('g-hidden');
            if (!doc || doc.kosong) { err.textContent = doc?.kosong ? 'Pilih minimal satu siswa.' : 'Pilih siswa dulu.'; err.classList.remove('g-hidden'); return; }
            const name = Dok.fileName(doc);
            const RP = window.RekapPrint;
            if (b.dataset.out === 'print') {
                if (!RP.print(Dok.page(doc, 'print', assets))) o.toast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.', 'err');
            } else if (b.dataset.out === 'word') {
                RP.download(new TextEncoder().encode(`﻿${Dok.page(doc, 'word')}`), `${name}.doc`, 'application/msword');
                o.toast('File Word diunduh.');
            } else {
                const spec = Dok.xlsx(type.id, data, vals);
                RP.download(RP.buildXlsx({ ...spec, logoPng: await RP.loadLogo() }), `${name}.xlsx`);
                o.toast('File Excel diunduh.');
            }
        }));
        preview();
    }

    /** Hapus data kelas yang tersimpan (mis. setelah keluar). */
    function reset() { cache.classId = null; cache.data = null; }

    window.DokUI = { mount, reset, loadAssets };
}());
