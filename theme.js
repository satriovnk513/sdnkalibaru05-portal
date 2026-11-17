// Tema terang/gelap Portal Guru & Panel Admin. Dimuat di <head> sebelum halaman tampil
// supaya tidak berkedip. Pilihan disimpan di perangkat; tanpa pilihan, ikut pengaturan HP/komputer.
(function () {
    'use strict';
    const KEY = 'tema';
    const root = document.documentElement;
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const saved = () => { try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch { return null; } };
    const current = () => saved() || (mq && mq.matches ? 'dark' : 'light');

    function apply(t) {
        root.dataset.theme = t;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = t === 'dark' ? '#0b1220' : '#ffffff';
        document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
            b.setAttribute('aria-pressed', String(t === 'dark'));
            b.setAttribute('aria-label', t === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
            b.title = t === 'dark' ? 'Mode terang' : 'Mode gelap';
            const lab = b.querySelector('[data-theme-label]');
            if (lab) lab.textContent = t === 'dark' ? 'Mode terang' : 'Mode gelap';
        });
    }
    function set(t) {
        try { localStorage.setItem(KEY, t); } catch { /* abaikan */ }
        apply(t);
    }
    apply(current());
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (!saved()) apply(current()); });

    const ICON = '<svg class="ic-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
        + '<svg class="ic-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
            if (!b.querySelector('svg')) b.insertAdjacentHTML('afterbegin', ICON);
            b.addEventListener('click', () => set(current() === 'dark' ? 'light' : 'dark'));
        });
        apply(current());
    });
    window.Theme = { get: current, set, toggle: () => set(current() === 'dark' ? 'light' : 'dark') };
}());
