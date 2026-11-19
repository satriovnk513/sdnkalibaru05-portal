// =============================================================================
// Panel Admin — menu Nilai Siswa. Matriks kelas × mapel (berapa siswa yang
// nilainya lengkap); klik sel untuk mengisi/memperbaiki, klik kelas untuk daftar
// mapel, riwayat, dan unduhan Excel/PDF. Tampilan dari nilai-ui.js.
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const $ = (id) => document.getElementById(id);
    let ui = null;
    let state = { view: 'matriks', params: {} };

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }

    function show(view, params) {
        state = { view, params: params || {} };
        if (!ui) {
            ui = window.NilaiUI.create({
                rpc,
                admin: true,
                inlineHead: true,
                wide: true,
                nav: (v, p) => { show(v, p); $('tabNilai')?.scrollIntoView({ block: 'start' }); },
            });
        }
        return ui.render($('nlHost'), state.view, state.params);
    }

    const prevShowTab = window.showTab;
    window.showTab = async function (tabId, navEl) {
        if (window.NilaiUI?.isDirty() && !(await window.NilaiUI.confirmLeave())) return;
        prevShowTab(tabId, navEl);
        if (tabId !== 'tabNilai') return;
        $('topbarTitle').textContent = 'Nilai Siswa';
        show(state.view, state.params);
    };
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { ui?.reset(); state = { view: 'matriks', params: {} }; }
    });
}());
