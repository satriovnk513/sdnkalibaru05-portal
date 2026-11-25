/**
 * Akun Saya — dipakai Portal Guru dan Panel Admin.
 *
 *   AkunSaya.gantiPassword(pw)              → /api/guru-change-password
 *   AkunSaya.gantiEmail(email, password)    → /api/akun-email
 *   AkunSaya.simpanPin(password, pin)       → /api/guru-pin
 *   AkunSaya.pasangFormEmail(root, opts)    → form ganti email di dalam root
 *   AkunSaya.bukaAdmin()                    → Panel Admin: lembar "Akun Saya"
 *
 * Butuh window.supabaseClient dan window.Att (attendance-sheet.js).
 */
(function () {
    'use strict';
    const sb = () => window.supabaseClient;
    const A = () => window.Att;
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    async function token() {
        const { data: { session } } = await sb().auth.getSession();
        if (session?.access_token) return session.access_token;
        try { const { data } = await sb().auth.refreshSession(); return data?.session?.access_token || ''; } catch { return ''; }
    }

    async function post(path, body, gagal) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
            body: JSON.stringify(body),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out?.error?.message || gagal);
        return out;
    }

    const gantiPassword = (password) => post('/api/guru-change-password', { password }, 'Gagal mengganti password.');
    const simpanPin = (password, pin) => post('/api/guru-pin', { password, pin }, 'Gagal menyimpan PIN.');
    async function gantiEmail(email, password) {
        const out = await post('/api/akun-email', { email, password }, 'Gagal mengganti email.');
        // Email ada di dalam token sesi — segarkan supaya halaman langsung memakai email baru.
        try { await sb().auth.refreshSession(); } catch { /* sesi lama tetap berlaku */ }
        return out;
    }

    const angkaSaja = (el) => el.addEventListener('input', () => { el.value = el.value.replace(/[^0-9]/g, '').slice(0, 6); });

    /**
     * Form ganti email.
     * opts.emailSekarang: email yang sedang dipakai
     * opts.onDone(emailBaru): dipanggil setelah berhasil
     */
    function pasangFormEmail(root, { emailSekarang = '', onDone } = {}) {
        root.innerHTML = `<form class="att-stack ak-email" novalidate>
                <div class="att-field"><label>Email sekarang</label><div class="ak-now">${esc(emailSekarang || '—')}</div></div>
                <div class="att-field"><label for="akEmailBaru">Email baru</label>
                    <input class="att-input" id="akEmailBaru" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="200"></div>
                <div class="att-field"><label for="akEmailPw">Password saat ini</label>
                    <input class="att-input" id="akEmailPw" type="password" autocomplete="current-password"></div>
                <p class="att-muted" style="margin:0">Email baru langsung dipakai untuk login (tanpa email verifikasi). Login pakai NIP/NUPTK tetap bisa.</p>
                <div class="att-alert err" id="akEmailErr" role="alert" hidden></div>
                <button type="submit" class="att-btn att-btn-primary" id="akEmailBtn">Ganti email</button>
            </form>`;
        const f = root.querySelector('form');
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = root.querySelector('#akEmailErr');
            const gagal = (m) => { err.textContent = m; err.hidden = false; };
            err.hidden = true;
            const email = root.querySelector('#akEmailBaru').value.trim().toLowerCase();
            const pw = root.querySelector('#akEmailPw').value;
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return gagal('Email baru tidak valid.');
            if (email === String(emailSekarang).toLowerCase()) return gagal('Email baru sama dengan email sekarang.');
            if (!pw) return gagal('Isi password Anda saat ini.');
            const btn = root.querySelector('#akEmailBtn');
            btn.disabled = true; btn.textContent = 'Menyimpan…';
            try {
                await gantiEmail(email, pw);
                A().toast(`Email diganti ke ${email}.`);
                onDone?.(email);
            } catch (er) {
                gagal(A().errMessage(er));
                btn.disabled = false; btn.textContent = 'Ganti email';
            }
        });
    }

    // ------------------------------------------------------------------ Panel Admin
    /** Lembar layar penuh; kembali { el, tutup }. */
    function lembar(html) {
        const back = document.createElement('div');
        back.className = 'att-sheet-backdrop ak-backdrop';
        back.innerHTML = `<div class="att-sheet ak-sheet" role="dialog" aria-modal="true">${html}</div>`;
        document.body.appendChild(back);
        const tutup = () => { back.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') tutup(); };
        back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-ak="tutup"]')) tutup(); });
        document.addEventListener('keydown', onKey);
        return { el: back.querySelector('.ak-sheet'), tutup };
    }

    async function akunSendiri() {
        const { data: { session } } = await sb().auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return null;
        const { data } = await sb().from('teacher_accounts').select('user_id').eq('user_id', uid).maybeSingle();
        let pin = null;
        if (data) { try { const r = await sb().rpc('get_my_recovery_pin'); pin = r.data || { ada: false }; } catch { pin = null; } }
        return { email: session.user.email || '', guru: Boolean(data), pin };
    }

    /** Lembar "Akun Saya" di Panel Admin: email, password, PIN. */
    async function bukaAdmin() {
        const akun = await akunSendiri().catch(() => null);
        if (!akun) return A().toast('Sesi habis. Silakan login ulang.', 'err');
        const { el } = lembar(`
            <div class="ak-head"><h3>Akun Saya</h3><button type="button" class="att-btn att-btn-ghost ak-x" data-ak="tutup" aria-label="Tutup">✕</button></div>
            <section class="ak-sec"><h4>Email login</h4><div id="akEmailHost"></div></section>
            <section class="ak-sec"><h4>Ganti password</h4>
                <form class="att-stack" id="akPwForm" novalidate>
                    <div class="att-field"><label for="akPw1">Password baru</label><input class="att-input" id="akPw1" type="password" autocomplete="new-password" minlength="8"></div>
                    <div class="att-field"><label for="akPw2">Ulangi password baru</label><input class="att-input" id="akPw2" type="password" autocomplete="new-password" minlength="8"></div>
                    <button type="submit" class="att-btn att-btn-primary">Simpan password</button>
                </form></section>
            ${akun.guru ? `<section class="ak-sec"><h4>PIN pemulihan
                    ${akun.pin?.ada ? '<span class="att-badge ok">Sudah dibuat</span>' : '<span class="att-badge warn">Belum dibuat</span>'}</h4>
                <form class="att-stack" id="akPinForm" novalidate>
                    <div class="att-field"><label for="akPinPw">Password saat ini</label><input class="att-input" id="akPinPw" type="password" autocomplete="current-password"></div>
                    <div class="att-field"><label for="akPin1">${akun.pin?.ada ? 'PIN baru' : 'PIN'} (6 angka)</label><input class="att-input g-pin" id="akPin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></div>
                    <div class="att-field"><label for="akPin2">Ulangi PIN</label><input class="att-input g-pin" id="akPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></div>
                    <button type="submit" class="att-btn att-btn-primary">${akun.pin?.ada ? 'Ganti PIN' : 'Simpan PIN'}</button>
                </form></section>` : ''}`);
        pasangFormEmail(el.querySelector('#akEmailHost'), { emailSekarang: akun.email, onDone: (baru) => { akun.email = baru; pasangFormEmail(el.querySelector('#akEmailHost'), { emailSekarang: baru }); } });
        el.querySelector('#akPwForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const a = el.querySelector('#akPw1').value;
            if (a.length < 8) return A().toast('Password minimal 8 karakter.', 'err');
            if (a !== el.querySelector('#akPw2').value) return A().toast('Kedua password tidak sama.', 'err');
            try { await gantiPassword(a); } catch (er) { return A().toast(A().errMessage(er), 'err'); }
            el.querySelector('#akPw1').value = ''; el.querySelector('#akPw2').value = '';
            A().toast('Password berhasil diganti.');
        });
        const pf = el.querySelector('#akPinForm');
        if (pf) {
            angkaSaja(el.querySelector('#akPin1')); angkaSaja(el.querySelector('#akPin2'));
            pf.addEventListener('submit', async (e) => {
                e.preventDefault();
                const pw = el.querySelector('#akPinPw').value;
                const pin = el.querySelector('#akPin1').value;
                if (!pw) return A().toast('Isi password Anda saat ini.', 'err');
                if (!/^[0-9]{6}$/.test(pin)) return A().toast('PIN harus 6 angka.', 'err');
                if (pin !== el.querySelector('#akPin2').value) return A().toast('Kedua PIN tidak sama.', 'err');
                try { await simpanPin(pw, pin); } catch (er) { return A().toast(A().errMessage(er), 'err'); }
                pf.reset();
                A().toast('PIN pemulihan tersimpan.');
            });
        }
    }

    const css = document.createElement('style');
    css.textContent = `
        .ak-backdrop { z-index: 3000; }
        .ak-sheet { max-height: 92vh; overflow-y: auto; }
        .ak-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .ak-head h3 { margin: 0; }
        .ak-x { min-width: 40px; padding: 0 10px; }
        .ak-sec { border-top: 1px solid var(--att-line, #e5e7eb); padding-top: 14px; margin-top: 14px; }
        .ak-sec h4 { margin: 0 0 10px; font-size: .95rem; display: flex; align-items: center; gap: 8px; }
        .ak-now { font-weight: 600; word-break: break-all; }
    `;
    document.head.appendChild(css);

    window.AkunSaya = Object.freeze({ gantiPassword, gantiEmail, simpanPin, pasangFormEmail, bukaAdmin });
})();
