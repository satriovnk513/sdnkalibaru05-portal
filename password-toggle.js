/**
 * Tombol mata buka/tutup untuk setiap <input type="password"> — termasuk yang
 * baru muncul belakangan (form ganti password, PIN, dsb.). Cukup dimuat sekali
 * per halaman; tidak perlu mengubah markup input-nya.
 */
(function () {
    'use strict';
    if (window.__pwToggle) return;
    window.__pwToggle = true;

    const SVG = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const MATA = SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
    const MATA_TUTUP = SVG('<path d="M17.94 17.94A10.5 10.5 0 0 1 12 19c-6.4 0-10-7-10-7a18.6 18.6 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.7 9.7 0 0 1 12 4c6.4 0 10 7 10 7a18.8 18.8 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M2 2l20 20"/>');

    const css = document.createElement('style');
    css.textContent = `
        .pwt { position: relative; display: block; width: 100%; }
        .pwt > input { width: 100%; padding-right: 46px !important; box-sizing: border-box; }
        .pwt-btn { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); width: 38px; height: 38px;
            display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0;
            border: 0; border-radius: 8px; background: transparent; color: var(--att-muted, var(--t-muted, currentColor)); cursor: pointer; }
        .pwt-btn:hover, .pwt-btn[aria-pressed="true"] { color: var(--t-ink, var(--t-text, currentColor)); }
        .pwt-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
    `;
    document.head.appendChild(css);

    function pasang(inp) {
        if (inp.dataset.pwt || !inp.parentNode) return;
        inp.dataset.pwt = '1';
        const pin = inp.inputMode === 'numeric';
        const kata = pin ? 'PIN' : 'password';
        const wrap = document.createElement('span');
        wrap.className = 'pwt';
        inp.parentNode.insertBefore(wrap, inp);
        wrap.appendChild(inp);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pwt-btn';
        b.tabIndex = 0;
        const set = (tampil) => {
            inp.type = tampil ? 'text' : 'password';
            b.innerHTML = tampil ? MATA_TUTUP : MATA;
            b.setAttribute('aria-pressed', String(tampil));
            b.setAttribute('aria-label', tampil ? `Sembunyikan ${kata}` : `Tampilkan ${kata}`);
            b.title = tampil ? `Sembunyikan ${kata}` : `Tampilkan ${kata}`;
        };
        set(false);
        b.addEventListener('mousedown', (e) => e.preventDefault()); // jangan curi fokus dari input
        b.addEventListener('click', () => set(inp.type === 'password'));
        // Saat form dikirim/di-reset, kembalikan ke tersembunyi supaya browser menyimpan sebagai password.
        inp.form?.addEventListener('submit', () => set(false));
        wrap.appendChild(b);
    }

    const scan = (root) => root.querySelectorAll?.('input[type="password"]').forEach(pasang);
    const mulai = () => {
        scan(document);
        new MutationObserver((ms) => {
            for (const m of ms) for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.matches?.('input[type="password"]')) pasang(n); else scan(n);
            }
        }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai); else mulai();
})();
