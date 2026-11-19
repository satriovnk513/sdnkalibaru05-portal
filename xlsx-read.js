// =============================================================================
// Pembaca Excel (.xlsx) & CSV mini, tanpa library luar. Mengambil lembar
// pertama sebagai array baris berisi teks. Cukup untuk impor daftar barang.
//   await XlsxRead.read(arrayBuffer, fileName) → [['Kode','Nama barang',…], …]
//   await XlsxRead.readBook(arrayBuffer) → [{ name, rows }] untuk semua lembar.
// Butuh DecompressionStream('deflate-raw') — ada di Chrome/Edge/Safari/Firefox modern.
// =============================================================================
(function (root) {
    'use strict';

    const u16 = (b, o) => b[o] | (b[o + 1] << 8);
    const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    const dec = new TextDecoder('utf-8');

    async function inflateRaw(bytes) {
        if (typeof DecompressionStream === 'undefined') throw new Error('Browser ini belum bisa membaca file Excel. Simpan sebagai CSV, atau pakai Chrome terbaru.');
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    /** Isi zip → Map(nama → fungsi async yang mengembalikan Uint8Array). */
    function listZip(buf) {
        const b = new Uint8Array(buf);
        let eocd = -1;
        for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
            if (u32(b, i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('File bukan Excel (.xlsx) yang valid.');
        const count = u16(b, eocd + 10);
        let p = u32(b, eocd + 16);
        const files = new Map();
        for (let n = 0; n < count; n++) {
            if (u32(b, p) !== 0x02014b50) throw new Error('File Excel rusak.');
            const method = u16(b, p + 10);
            const size = u32(b, p + 20);
            const nameLen = u16(b, p + 28);
            const extra = u16(b, p + 30);
            const comment = u16(b, p + 32);
            const local = u32(b, p + 42);
            const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
            p += 46 + nameLen + extra + comment;
            files.set(name, async () => {
                const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
                const raw = b.subarray(start, start + size);
                if (method === 0) return raw;
                if (method === 8) return inflateRaw(raw);
                throw new Error('Format kompresi Excel tidak didukung.');
            });
        }
        return files;
    }

    const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    const unxml = (s) => String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
        return ENT[e] ?? m;
    });
    /** Gabungan semua <t>…</t> di dalam potongan XML (rich text punya beberapa <t>). */
    const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');

    function colIndex(ref) {
        const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A';
        let n = 0;
        for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n - 1;
    }

    function parseSheet(xml, sst) {
        const rows = [];
        for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
            const rNum = Number(/\br="(\d+)"/.exec(rm[1])?.[1] || rows.length + 1);
            const row = [];
            for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
                const attrs = cm[1];
                const body = cm[2] || '';
                const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
                const t = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n';
                const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
                let val = '';
                if (t === 's') val = sst[Number(v)] ?? '';
                else if (t === 'inlineStr') val = texts(body);
                else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
                else val = v === undefined ? '' : unxml(v);
                row[ref ? colIndex(ref) : row.length] = String(val).trim();
            }
            rows[rNum - 1] = Array.from(row, (x) => x ?? '');
        }
        return Array.from(rows, (r) => r || []);
    }

    /** Semua lembar sesuai urutan di buku kerja → [{ name, rows }]. */
    async function readBook(buf) {
        const zip = listZip(buf);
        const get = async (name) => (zip.has(name) ? dec.decode(await zip.get(name)()) : null);
        const wb = await get('xl/workbook.xml');
        const rels = await get('xl/_rels/workbook.xml.rels');
        const list = [];
        if (wb && rels) {
            for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
                const name = unxml(/\bname="([^"]*)"/.exec(m[1])?.[1] || '');
                const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
                const target = rid && (new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
                    || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1]);
                if (!target) continue;
                const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
                if (zip.has(path)) list.push({ name, path });
            }
        }
        if (!list.length) {
            [...zip.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()
                .forEach((path, i) => list.push({ name: `Sheet${i + 1}`, path }));
        }
        if (!list.length) throw new Error('Lembar kerja tidak ditemukan di file Excel.');
        const sstXml = await get('xl/sharedStrings.xml');
        const sst = sstXml ? [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
        const out = [];
        for (const s of list) out.push({ name: s.name, rows: parseSheet(await get(s.path), sst) });
        return out;
    }

    async function readXlsx(buf) {
        return (await readBook(buf))[0].rows;
    }

    /** CSV sederhana: koma atau titik koma, tanda kutip ganda didukung. */
    function readCsv(text) {
        const firstLine = text.split(/\r?\n/, 1)[0] || '';
        const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
        const rows = [];
        let row = []; let cell = ''; let q = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (q) {
                if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
            } else if (ch === '"') q = true;
            else if (ch === sep) { row.push(cell.trim()); cell = ''; } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                row.push(cell.trim()); rows.push(row); row = []; cell = '';
            } else cell += ch;
        }
        if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
        return rows;
    }

    async function read(buf, name = '') {
        const b = new Uint8Array(buf);
        if (b[0] === 0x50 && b[1] === 0x4b) return readXlsx(buf);
        if (/\.xls$/i.test(name)) throw new Error('Format .xls lama belum didukung. Di Excel pilih Simpan Sebagai → Excel Workbook (.xlsx).');
        return readCsv(dec.decode(b).replace(/^﻿/, ''));
    }

    const api = { read, readBook, readXlsx, readCsv };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.XlsxRead = api;
}(typeof window !== 'undefined' ? window : globalThis));
