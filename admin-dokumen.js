// =============================================================================
// Panel Admin — menu Cetak & Dokumen. Sama dengan menu Dokumen di Portal Guru,
// tetapi admin/operator bisa memilih kelas mana pun (tahun ajaran aktif) dan
// siswanya. Formulir & template dipakai bersama: dokumen-ui.js, dokumen-templates.js.
// =============================================================================
(function () {
    'use strict';

    const sb = window.supabaseClient;
    const { esc, todayJakarta, errMessage, toast, romawi } = window.Att;
    const Dok = window.Dok;
    const $ = (id) => document.getElementById(id);
    const st = { classes: [], classId: null, typeId: 'daftar', values: {}, loaded: false };

    async function rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data;
    }

    async function loadClasses() {
        const [c, y] = await Promise.all([
            sb.from('classes').select('id,name,grade,section,academic_year_id').order('grade').order('section'),
            sb.from('academic_years').select('id,is_active'),
        ]);
        if (c.error || y.error) throw (c.error || y.error);
        const active = y.data.find((x) => x.is_active);
        st.classes = c.data.filter((x) => !active || x.academic_year_id === active.id)
            .map((x) => ({ id: x.id, label: `Kelas ${x.name} (${romawi(x.name)})` }));
        if (!st.classId || !st.classes.some((x) => x.id === st.classId)) st.classId = st.classes[0]?.id || null;
    }

    function renderTypes() {
        const groups = [...new Set(Dok.TYPES.map((t) => t.grup))];
        $('dkTypes').innerHTML = groups.map((g) => `<optgroup label="${esc(g)}">${Dok.TYPES.filter((t) => t.grup === g)
            .map((t) => `<option value="${esc(t.id)}" ${t.id === st.typeId ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</optgroup>`).join('');
    }

    function mountForm() {
        return window.DokUI.mount($('dkHost'), {
            typeId: st.typeId,
            classes: st.classes,
            classId: st.classId,
            onClassChange: (cid) => { st.classId = cid; mountForm(); },
            rpc, toast, confirm: window.Att.confirm, today: todayJakarta(), store: st.values,
        });
    }

    async function open() {
        try {
            if (!st.loaded) { await loadClasses(); st.loaded = true; renderTypes(); }
            await mountForm();
        } catch (err) {
            $('dkHost').innerHTML = `<div class="att-alert err">${esc(errMessage(err))}</div>`;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('dkTypes')?.addEventListener('change', (e) => { st.typeId = e.target.value; mountForm(); });
    });

    const prevShowTab = window.showTab;
    window.showTab = function (tabId, navEl) {
        prevShowTab(tabId, navEl);
        if (tabId !== 'tabDokumen') return;
        $('topbarTitle').textContent = 'Cetak & Dokumen';
        open();
    };
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { st.loaded = false; st.values = {}; st.classId = null; window.DokUI.reset(); }
    });
}());
