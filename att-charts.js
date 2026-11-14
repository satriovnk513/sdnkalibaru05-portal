// =============================================================================
// Grafik absensi tanpa library luar (SVG + HTML). Dipakai Portal Guru:
// kartu rekap per tanggal di dashboard dan halaman Statistik.
// Bisa dipakai di browser (window.AttCharts) dan di node (tes).
//
// Warna status sama dengan lembar absensi; setiap grafik selalu disertai label
// dan angka, jadi tidak bergantung pada warna saja.
// =============================================================================
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AttCharts = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ORDER = ['H', 'S', 'I', 'A', 'D'];
    const LABEL = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa', D: 'Dispensasi' };
    const COLOR = { H: '#16a34a', S: '#d97706', I: '#2563eb', A: '#dc2626', D: '#7c3aed' };
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => Number(v) || 0;
    const sum = (t) => ORDER.reduce((n, k) => n + num(t?.[k]), 0);

    /** % kehadiran: dispensasi (kegiatan resmi sekolah) dihitung hadir. null jika belum ada data. */
    function pct(t) {
        const total = sum(t);
        return total ? Math.round(((num(t.H) + num(t.D)) / total) * 1000) / 10 : null;
    }
    const pctText = (p) => (p === null ? '–' : `${String(p).replace('.', ',')}%`);

    /** Baris "Hadir (H) … 28 siswa" + batang, seperti kartu rekap harian. */
    function rows(t, { unit = 'siswa', order = ['H', 'I', 'S', 'A', 'D'] } = {}) {
        const total = sum(t);
        return `<div class="ac-rows">${order.map((k) => {
            const v = num(t?.[k]);
            const w = total ? Math.round((v / total) * 100) : 0;
            return `<div class="ac-row" data-k="${k}">
                <div class="ac-row-top"><span>${LABEL[k]} (${k})</span><b style="color:${COLOR[k]}">${v} ${esc(unit)}</b></div>
                <div class="ac-track" role="img" aria-label="${LABEL[k]} ${v} ${esc(unit)}, ${w}%"><i style="width:${w}%;background:${COLOR[k]}"></i></div>
            </div>`;
        }).join('')}</div>`;
    }

    /** Lingkaran "% Kehadiran". */
    function badge(t) {
        const p = pct(t);
        return `<div class="ac-badge ${p === null ? 'empty' : ''}"><b>${pctText(p)}</b><span>Kehadiran</span></div>`;
    }

    function legend(t) {
        const total = sum(t);
        return `<ul class="ac-legend">${ORDER.map((k) => `<li><i style="background:${COLOR[k]}"></i>${LABEL[k]}
            <b>${num(t?.[k])}</b><span>${total ? Math.round((num(t?.[k]) / total) * 100) : 0}%</span></li>`).join('')}</ul>`;
    }

    /** Donat komposisi H/S/I/A/D dengan % kehadiran di tengah. */
    function donut(t) {
        const total = sum(t);
        const R = 54; const C = 2 * Math.PI * R;
        let off = 0;
        const arcs = total ? ORDER.filter((k) => num(t[k]) > 0).map((k) => {
            const len = (num(t[k]) / total) * C;
            const seg = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${COLOR[k]}" stroke-width="20"
                stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"><title>${LABEL[k]}: ${num(t[k])}</title></circle>`;
            off += len;
            return seg;
        }).join('') : `<circle cx="70" cy="70" r="${R}" fill="none" stroke="#e2e8f0" stroke-width="20"/>`;
        const desc = total ? ORDER.map((k) => `${LABEL[k]} ${num(t[k])}`).join(', ') : 'Belum ada data';
        return `<div class="ac-donut"><svg viewBox="0 0 140 140" role="img" aria-label="Komposisi kehadiran: ${esc(desc)}">${arcs}
            <text x="70" y="68" text-anchor="middle" font-size="22" font-weight="800" fill="#0f172a">${pctText(pct(t))}</text>
            <text x="70" y="86" text-anchor="middle" font-size="10" fill="#64748b">kehadiran</text></svg>${legend(t)}</div>`;
    }

    /** Batang mendatar komposisi (alternatif donat). */
    function bars(t) {
        return `<div class="ac-bars">${rows(t, { unit: 'kali', order: ORDER })}</div>`;
    }

    const W = 340; const H = 190; const PL = 30; const PR = 8; const PT = 10; const PB = 34;

    function axis(max, fmt = (v) => v) {
        const lines = [];
        for (let i = 0; i <= 4; i++) {
            const v = (max / 4) * i;
            const y = PT + (H - PT - PB) * (1 - i / 4);
            lines.push(`<line x1="${PL}" x2="${W - PR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>
                <text x="${PL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#64748b">${esc(fmt(Math.round(v)))}</text>`);
        }
        return lines.join('');
    }

    /** Label sumbu X: dijarangkan supaya tidak bertumpuk di layar HP. */
    function xLabels(points, x) {
        const step = Math.max(1, Math.ceil(points.length / 8));
        return points.map((p, i) => (i % step === 0 || i === points.length - 1
            ? `<text x="${x(i).toFixed(1)}" y="${H - PB + 13}" text-anchor="middle" font-size="9" fill="#64748b">${esc(p.label)}</text>` : '')).join('');
    }

    const empty = (msg) => `<div class="ac-empty">${esc(msg || 'Belum ada absensi pada periode ini.')}</div>`;

    /** Batang bertumpuk per titik waktu. points: [{label, title, H,S,I,A,D}] */
    function stacked(points) {
        if (!points.length) return empty();
        const max = Math.max(1, ...points.map(sum));
        const slot = (W - PL - PR) / points.length;
        const bw = Math.min(26, slot * 0.7);
        const x = (i) => PL + slot * i + slot / 2;
        const ih = H - PT - PB;
        const body = points.map((p, i) => {
            let y = H - PB;
            const segs = ORDER.filter((k) => num(p[k]) > 0).map((k) => {
                const h = (num(p[k]) / max) * ih;
                y -= h;
                return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${COLOR[k]}"/>`;
            }).join('');
            return `<g><title>${esc(p.title || p.label)}: ${ORDER.map((k) => `${LABEL[k]} ${num(p[k])}`).join(', ')}</title>${segs}</g>`;
        }).join('');
        return `<svg class="ac-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik batang jumlah status per ${points.length > 12 ? 'hari' : 'periode'}">${axis(max)}${body}${xLabels(points, x)}</svg>
            <ul class="ac-legend inline">${ORDER.map((k) => `<li><i style="background:${COLOR[k]}"></i>${LABEL[k]}</li>`).join('')}</ul>`;
    }

    /** Garis % kehadiran (0–100). points: [{label, title, H,S,I,A,D}] */
    function line(points) {
        const pts = points.map((p) => ({ ...p, pct: pct(p) })).filter((p) => p.pct !== null);
        if (!pts.length) return empty();
        const iw = W - PL - PR; const ih = H - PT - PB;
        const x = (i) => (pts.length === 1 ? PL + iw / 2 : PL + (iw * i) / (pts.length - 1));
        const y = (v) => PT + ih * (1 - v / 100);
        const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' ');
        const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="${pts.length > 20 ? 2 : 3.5}" fill="#16a34a"><title>${esc(p.title || p.label)}: ${pctText(p.pct)}</title></circle>`).join('');
        const lowest = pts.reduce((a, b) => (b.pct < a.pct ? b : a));
        return `<svg class="ac-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik garis persentase kehadiran, terendah ${pctText(lowest.pct)} pada ${esc(lowest.title || lowest.label)}">
            ${axis(100, (v) => `${v}%`)}<path d="${path}" fill="none" stroke="#16a34a" stroke-width="2" stroke-linejoin="round"/>${dots}${xLabels(pts, x)}</svg>
            <p class="ac-note">Terendah <b>${pctText(lowest.pct)}</b> (${esc(lowest.title || lowest.label)}). Dispensasi dihitung hadir.</p>`;
    }

    /** Siswa paling sering tidak hadir: batang mendatar S/I/A. rows: [{nama, S, I, A}] */
    function students(list, limit = 10) {
        const top = list.map((s) => ({ ...s, n: num(s.S) + num(s.I) + num(s.A) })).filter((s) => s.n > 0)
            .sort((a, b) => b.n - a.n || num(b.A) - num(a.A) || String(a.nama).localeCompare(String(b.nama))).slice(0, limit);
        if (!top.length) return empty('Tidak ada siswa yang sakit, izin, atau alpa pada periode ini.');
        const max = top[0].n;
        return `<ol class="ac-students">${top.map((s) => `<li>
            <div class="ac-row-top"><span>${esc(s.nama)}</span><b>${s.n} hari</b></div>
            <div class="ac-track tall" role="img" aria-label="${esc(s.nama)}: sakit ${num(s.S)}, izin ${num(s.I)}, alpa ${num(s.A)}">${['S', 'I', 'A'].filter((k) => num(s[k]) > 0)
        .map((k) => `<i style="width:${(num(s[k]) / max) * 100}%;background:${COLOR[k]}">${num(s[k])}</i>`).join('')}</div>
        </li>`).join('')}</ol>
        <ul class="ac-legend inline">${['S', 'I', 'A'].map((k) => `<li><i style="background:${COLOR[k]}"></i>${LABEL[k]}</li>`).join('')}</ul>`;
    }

    /** Gabungkan data harian menjadi per bulan (untuk rentang semester). */
    function byMonth(harian, bulan) {
        const map = new Map();
        for (const d of harian) {
            const key = String(d.tanggal).slice(0, 7);
            const cur = map.get(key) || { H: 0, S: 0, I: 0, A: 0, D: 0, hari: 0 };
            for (const k of ORDER) cur[k] += num(d[k]);
            cur.hari += 1;
            map.set(key, cur);
        }
        return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => {
            const m = Number(key.slice(5, 7));
            const name = bulan ? bulan[m - 1] : key;
            return { ...v, label: name.slice(0, 3), title: `${name} ${key.slice(0, 4)} (${v.hari} hari)` };
        });
    }

    return { ORDER, LABEL, COLOR, sum, pct, pctText, rows, badge, legend, donut, bars, stacked, line, students, byMonth };
}));
