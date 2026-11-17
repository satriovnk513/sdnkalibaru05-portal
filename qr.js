// =============================================================================
// QR Code generator mini (tanpa library luar) — mode byte, koreksi galat M,
// versi 1–15 (cukup untuk URL ±200 karakter). Dipakai untuk stiker inventaris.
//   QR.svg(text, { size: 120 })  → string <svg>
//   QR.matrix(text)             → { size, dark(x, y) }
// Algoritma mengikuti ISO/IEC 18004 (penempatan modul, Reed–Solomon GF(256),
// pemilihan mask dengan skor penalti).
// =============================================================================
(function (root) {
    'use strict';

    // Kolom per versi (indeks 1..15), level M.
    const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
    const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
    const MAX_VERSION = 15;
    const FORMAT_M = 0;   // bit level koreksi untuk M

    function rawDataModules(ver) {
        let r = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            const na = Math.floor(ver / 7) + 2;
            r -= (25 * na - 10) * na - 55;
            if (ver >= 7) r -= 36;
        }
        return r;
    }
    const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

    // ---------------------------------------------------------------- Reed–Solomon
    function gfMul(x, y) {
        let z = 0;
        for (let i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11d);
            z ^= ((y >>> i) & 1) * x;
        }
        return z & 0xff;
    }
    function rsDivisor(degree) {
        const res = new Array(degree).fill(0);
        res[degree - 1] = 1;
        let root = 1;
        for (let i = 0; i < degree; i++) {
            for (let j = 0; j < degree; j++) {
                res[j] = gfMul(res[j], root);
                if (j + 1 < degree) res[j] ^= res[j + 1];
            }
            root = gfMul(root, 0x02);
        }
        return res;
    }
    function rsRemainder(data, div) {
        const res = new Array(div.length).fill(0);
        for (const b of data) {
            const factor = b ^ res.shift();
            res.push(0);
            div.forEach((c, i) => { res[i] ^= gfMul(c, factor); });
        }
        return res;
    }

    // ---------------------------------------------------------------- data
    function utf8(text) {
        return Array.from(new TextEncoder().encode(String(text)));
    }

    function encodeData(bytes) {
        let ver = 1;
        for (; ver <= MAX_VERSION; ver++) {
            const ccBits = ver <= 9 ? 8 : 16;
            if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
        }
        if (ver > MAX_VERSION) throw new Error('Teks terlalu panjang untuk QR.');
        const cap = dataCodewords(ver) * 8;
        const bits = [];
        const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
        put(0b0100, 4);
        put(bytes.length, ver <= 9 ? 8 : 16);
        for (const b of bytes) put(b, 8);
        put(0, Math.min(4, cap - bits.length));
        put(0, (8 - (bits.length % 8)) % 8);
        for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
        const cw = [];
        for (let i = 0; i < bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
        return { ver, cw };
    }

    function addEcc(ver, data) {
        const nb = NUM_BLOCKS[ver];
        const eccLen = ECC_PER_BLOCK[ver];
        const raw = Math.floor(rawDataModules(ver) / 8);
        const numShort = nb - (raw % nb);
        const shortLen = Math.floor(raw / nb);
        const div = rsDivisor(eccLen);
        const blocks = [];
        for (let i = 0, k = 0; i < nb; i++) {
            const len = shortLen - eccLen + (i < numShort ? 0 : 1);
            const dat = data.slice(k, k + len);
            k += len;
            const ecc = rsRemainder(dat, div);
            if (i < numShort) dat.push(0);
            blocks.push(dat.concat(ecc));
        }
        const out = [];
        for (let i = 0; i < blocks[0].length; i++) {
            blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]); });
        }
        return out;
    }

    // ---------------------------------------------------------------- matriks
    function alignPositions(ver) {
        if (ver === 1) return [];
        const n = Math.floor(ver / 7) + 2;
        const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
        const res = [6];
        for (let pos = ver * 4 + 17 - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
        return res;
    }

    function build(ver, codewords, mask) {
        const size = ver * 4 + 17;
        const m = Array.from({ length: size }, () => new Array(size).fill(false));
        const fn = Array.from({ length: size }, () => new Array(size).fill(false));
        const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

        for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
        for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
            for (let dy = -4; dy <= 4; dy++) {
                for (let dx = -4; dx <= 4; dx++) {
                    const d = Math.max(Math.abs(dx), Math.abs(dy));
                    const x = cx + dx; const y = cy + dy;
                    if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
                }
            }
        }
        const al = alignPositions(ver);
        for (let i = 0; i < al.length; i++) {
            for (let j = 0; j < al.length; j++) {
                if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
        // Bit format (diisi ulang setelah mask)
        const drawFormat = () => {
            const data = (FORMAT_M << 3) | mask;
            let rem = data;
            for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            const bits = ((data << 10) | rem) ^ 0x5412;
            const bit = (i) => ((bits >>> i) & 1) !== 0;
            for (let i = 0; i <= 5; i++) set(8, i, bit(i));
            set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
            for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
            for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
            for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
            set(8, size - 8, true);
        };
        drawFormat();
        if (ver >= 7) {
            let rem = ver;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
            const bits = (ver << 12) | rem;
            for (let i = 0; i < 18; i++) {
                const b = ((bits >>> i) & 1) !== 0;
                const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
                set(a, c, b); set(c, a, b);
            }
        }
        // Data zig-zag
        let i = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const up = ((right + 1) & 2) === 0;
                    const y = up ? size - 1 - vert : vert;
                    if (!fn[y][x] && i < codewords.length * 8) {
                        m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
                        i++;
                    }
                }
            }
        }
        // Mask
        const MASKS = [
            (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
            (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
            (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
        drawFormat();
        return { size, m };
    }

    function penalty({ size, m }) {
        let p = 0;
        const lineScore = (get) => {
            let s = 0;
            for (let a = 0; a < size; a++) {
                let run = 1;
                for (let b = 1; b <= size; b++) {
                    if (b < size && get(a, b) === get(a, b - 1)) { run++; continue; }
                    if (run >= 5) s += run - 2;
                    run = 1;
                }
                // pola mirip finder 1:1:3:1:1 dengan 4 terang di salah satu sisi
                for (let b = 0; b + 10 < size + 4; b++) {
                    const v = (k) => (k >= 0 && k < size ? get(a, k) : false);
                    const core = v(b) && !v(b + 1) && v(b + 2) && v(b + 3) && v(b + 4) && !v(b + 5) && v(b + 6);
                    if (!core) continue;
                    const lightBefore = !v(b - 1) && !v(b - 2) && !v(b - 3) && !v(b - 4);
                    const lightAfter = !v(b + 7) && !v(b + 8) && !v(b + 9) && !v(b + 10);
                    if (lightBefore || lightAfter) s += 40;
                }
            }
            return s;
        };
        p += lineScore((a, b) => m[a][b]);
        p += lineScore((a, b) => m[b][a]);
        for (let y = 0; y + 1 < size; y++) {
            for (let x = 0; x + 1 < size; x++) {
                const c = m[y][x];
                if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
            }
        }
        let dark = 0;
        for (const row of m) for (const c of row) if (c) dark++;
        const total = size * size;
        p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
        return p;
    }

    function matrix(text) {
        const { ver, cw } = encodeData(utf8(text));
        const all = addEcc(ver, cw);
        let best = null; let bestScore = Infinity;
        for (let mask = 0; mask < 8; mask++) {
            const q = build(ver, all, mask);
            const s = penalty(q);
            if (s < bestScore) { best = q; bestScore = s; }
        }
        return { size: best.size, version: ver, dark: (x, y) => best.m[y][x] };
    }

    /** SVG hitam di atas putih, dengan zona tenang 4 modul. */
    function svg(text, { size = 128, quiet = 4, title = '' } = {}) {
        const q = matrix(text);
        const n = q.size + quiet * 2;
        let d = '';
        for (let y = 0; y < q.size; y++) {
            for (let x = 0; x < q.size; x++) {
                if (!q.dark(x, y)) continue;
                let w = 1;
                while (x + w < q.size && q.dark(x + w, y)) w++;
                d += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`;
                x += w - 1;
            }
        }
        const t = String(title).replace(/[<>&"]/g, '');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img"${t ? ` aria-label="${t}"` : ''}><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    }

    const api = { matrix, svg };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QR = api;
}(typeof window !== 'undefined' ? window : globalThis));
