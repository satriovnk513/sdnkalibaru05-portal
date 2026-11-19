// =============================================================================
// Panel Admin — menu Jadwal Pelajaran. Per kelas: tabel jadwal yang bisa diubah
// (sama dengan wali kelas di Portal Guru). Per guru mapel: jadwal mengajar
// seorang guru dari semua kelas. Tampilan dari jadwal-ui.js.
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const $ = (id) => document.getElementById(id);
    let ui = null;
    let classes = null;
    let state = { view: 'kelas', params: {} };

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }

    function show(view, params) {
        state = { view, params: params || {} };
        $('jdSeg')?.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === view)));
        if (!ui) {
            ui = window.JadwalUI.create({
                rpc,
                admin: true,
                inlineHead: true,
                wide: true,
                classes: async () => {
                    if (!classes) {
                        const m = await rpc('get_grades_admin_matrix', { p_semester: 1 });
                        classes = (m.kelas || []).map((k) => ({ id: k.id, nama: k.nama, wali: true, mapel: [] }));
                    }
                    return classes;
                },
                nav: (v, p) => show(v, p),
            });
        }
        return ui.render($('jdHost'), state.view, state.params);
    }

    $('jdSeg')?.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => show(b.dataset.v, {})));

    const prevShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        const r = prevShowTab(tabId, navEl);
        if (tabId !== 'tabJadwal') return r;
        $('topbarTitle').textContent = 'Jadwal Pelajaran';
        show(state.view, state.params);
        return r;
    };
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { ui?.reset(); classes = null; state = { view: 'kelas', params: {} }; }
    });
}());
