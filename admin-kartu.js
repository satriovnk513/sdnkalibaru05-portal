// =============================================================================
// Panel Admin — Kartu Siswa: foto siswa & cetak kartu pelajar ber-QR (kartu-ui.js).
// Admin/operator bisa mengelola kartu semua rombel tahun ajaran aktif.
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const $ = (id) => document.getElementById(id);
    const { esc, errMessage, romawi } = window.Att;
    let ui = null;
    let kelasList = null;

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }

    async function kelas() {
        if (kelasList) return kelasList;
        const { data, error } = await sb.from('classes').select('id,name,grade,section,academic_years!inner(is_active)')
            .eq('academic_years.is_active', true).order('grade').order('section');
        if (error) throw error;
        kelasList = (data || []).map((c) => ({ id: c.id, label: `Kelas ${romawi(c.name)}` }));
        return kelasList;
    }

    async function buka() {
        $('topbarTitle').textContent = 'Kartu Siswa';
        if (!ui) ui = window.KartuUI.create({ rpc, storage: sb.storage, kelas });
        try { await ui.render($('ktAdmHost')); } catch (err) { $('ktAdmHost').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`; }
    }

    const prevShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        const r = prevShowTab(tabId, navEl);
        if (tabId === 'tabKartu') buka();
        return r;
    };
    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { ui = null; kelasList = null; } });
}());
