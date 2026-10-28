/**
 * Shared helpers for server-rendered SEO pages (/berita, /berita/:slug, /sitemap.xml).
 * Files in api/_lib are not exposed as serverless functions by Vercel.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SITE = 'https://sdnkalibaru05.sch.id';
export const SITE_NAME = 'SDN Kalibaru 05 Pagi';
export const LOGO = 'https://wwpbghdepykfqgzhyvmh.supabase.co/storage/v1/object/public/photos/logo-baru.png';
export const DEFAULT_IMAGE = LOGO;

// Public (anon) values, same as supabase-config.js; reads are governed by RLS.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wwpbghdepykfqgzhyvmh.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || readAnonKeyFromConfig();

function readAnonKeyFromConfig() {
    try {
        const cfg = readFileSync(join(process.cwd(), 'supabase-config.js'), 'utf8');
        return (cfg.match(/supabaseKey\s*=\s*'([^']+)'/) || [])[1] || '';
    } catch {
        return '';
    }
}

export const CACHE_OK = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';
export const CACHE_MISS = 'public, max-age=0, s-maxage=60';

export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** JSON safe to embed inside <script> (no "</script>", no U+2028/2029 surprises). */
export function jsonForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

export function readTemplate(name) {
    return readFileSync(join(process.cwd(), name), 'utf8');
}

export function safeUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch {
        return '';
    }
}

/** Query the news table through PostgREST with a timeout. Throws on network/HTTP errors. */
export async function fetchNews(query) {
    if (!SUPABASE_ANON_KEY) throw new Error('Supabase key not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/news?${query}`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

export function articlePath(news) {
    return news.slug
        ? `/berita/${encodeURIComponent(news.slug)}`
        : `/berita-detail?id=${encodeURIComponent(news.id)}`;
}

export function imagesOf(news) {
    const list = Array.isArray(news.image_urls) && news.image_urls.length ? news.image_urls : [news.image_url];
    return list.map(safeUrl).filter(Boolean);
}

const MONTHS = {
    januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7,
    agustus: 8, september: 9, oktober: 10, november: 11, desember: 12
};

/** "7 November 2026" -> "2026-11-07T00:00:00+07:00"; falls back to created_at. */
export function publishedIso(news) {
    const m = String(news.date || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
    if (m && MONTHS[m[2]]) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${m[3]}-${pad(MONTHS[m[2]])}-${pad(m[1])}T00:00:00+07:00`;
    }
    const created = new Date(news.created_at);
    return isNaN(created) ? undefined : created.toISOString();
}

export function modifiedIso(news) {
    const stamps = [news.updated_at, news.created_at].map((v) => new Date(v)).filter((d) => !isNaN(d));
    return stamps.length ? new Date(Math.max(...stamps)).toISOString() : publishedIso(news);
}

/** Plain-text summary for meta description, cut at a word boundary. */
export function summary(text, max = 158) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return (space > 80 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '') + '…';
}

/** Escaped paragraphs from plain text (blank line = new paragraph, newline = <br>). */
export function paragraphs(text) {
    return String(text || '')
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

export function replaceOrFail(html, pattern, replacement, label) {
    if (!pattern.test(html)) throw new Error(`Template marker not found: ${label}`);
    return html.replace(pattern, replacement);
}
