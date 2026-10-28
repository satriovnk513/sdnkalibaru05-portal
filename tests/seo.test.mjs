// Run: node --test tests/*.test.mjs
// Server-rendered news pages and sitemap, with a mocked Supabase (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
const { default: berita } = await import('../api/berita.js');
const { default: sitemap } = await import('../api/sitemap.js');

const ROWS = [
    {
        id: 'a1', slug: 'juara-silat', title: 'Siswa Raih Juara <Silat> & "Medali"',
        description: 'Kabar membanggakan dari SDN Kalibaru 05 Pagi. '.repeat(8),
        content: 'Paragraf satu.\nBaris dua.\n\nParagraf </script><script>alert(1)</script> tiga.',
        date: '7 November 2026', created_at: '2026-10-28T01:18:59Z',
        image_urls: ['https://img.test/a.jpg', 'javascript:alert(1)'],
        pdf_attachments: [{ url: 'https://img.test/doc.pdf', filename: 'Jadwal.pdf' }]
    },
    { id: 'b2', slug: 'spmb-2026', title: 'SPMB 2026', description: 'Info SPMB', content: 'Isi', date: 'tanggal aneh', created_at: '2026-05-14T11:27:32Z', image_url: 'https://img.test/b.png' }
];

function mockSupabase({ fail = false } = {}) {
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(url);
        if (fail) throw new Error('network down');
        const q = new URL(url).searchParams;
        let rows = ROWS;
        if (q.get('slug')) rows = ROWS.filter((r) => `ilike.${r.slug}` === q.get('slug'));
        return { ok: true, status: 200, json: async () => rows };
    };
    return calls;
}

async function call(handler, query = {}) {
    const out = { headers: {} };
    const res = {
        setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
        status(n) { out.status = n; return this; },
        send(body) { out.body = String(body); return this; }
    };
    await handler({ method: 'GET', query, headers: {} }, res);
    return out;
}

const count = (s, re) => (s.match(re) || []).length;

test('article: full SEO head, content in HTML, safe embedding', async () => {
    mockSupabase();
    const r = await call(berita, { slug: 'juara-silat' });
    assert.equal(r.status, 200);
    const h = r.body;
    assert.equal(count(h, /<title>/g), 1);
    assert.match(h, /<title>Siswa Raih Juara &lt;Silat&gt; &amp; &quot;Medali&quot; - SDN Kalibaru 05 Pagi<\/title>/);
    assert.equal(count(h, /<meta name="description"/g), 1);
    assert.equal(count(h, /<link rel="canonical"/g), 1);
    assert.match(h, /<link rel="canonical" href="https:\/\/sdnkalibaru05\.sch\.id\/berita\/juara-silat">/);
    assert.match(h, /<meta name="robots" content="index, follow/);
    assert.doesNotMatch(h, /noindex/);
    assert.match(h, /<meta property="og:image" content="https:\/\/img\.test\/a\.jpg">/);
    assert.match(h, /<h1 class="news-detail-title">Siswa Raih Juara &lt;Silat&gt;/);
    assert.match(h, /<p>Paragraf satu\.<br>Baris dua\.<\/p>/);
    assert.match(h, /Jadwal\.pdf/);
    assert.doesNotMatch(h, /(src|href)="javascript:/); // raw row in __NEWS__ is data; client re-sanitizes URLs
    // No raw script breakout anywhere (content, JSON-LD, embedded data)
    assert.equal(count(h, /<\/script><script>alert/g), 0);
    const ld = JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    assert.equal(ld[0]['@type'], 'NewsArticle');
    assert.equal(ld[0].datePublished, '2026-11-07T00:00:00+07:00');
    assert.deepEqual(ld[0].image, ['https://img.test/a.jpg']);
    assert.ok(ld[0].description.length <= 158);
    assert.equal(ld[1]['@type'], 'BreadcrumbList');
    const embedded = JSON.parse(h.match(/window\.__NEWS__ = (.*?);<\/script>/)[1]);
    assert.equal(embedded.slug, 'juara-silat');
    assert.match(r.headers['cache-control'], /s-maxage=300/);
});

test('article: unknown slug returns real 404 with noindex', async () => {
    mockSupabase();
    const r = await call(berita, { slug: 'tidak-ada' });
    assert.equal(r.status, 404);
    assert.match(r.body, /noindex/);
    assert.equal(count(r.body, /<title>/g), 1);
});

test('article: LIKE wildcards in slug are escaped', async () => {
    const calls = mockSupabase();
    await call(berita, { slug: 'juara%' });
    assert.match(calls[0], /slug=ilike\.juara%5C%25/);
});

test('date fallback uses created_at when text date is unparseable', async () => {
    mockSupabase();
    const r = await call(berita, { slug: 'spmb-2026' });
    const ld = JSON.parse(r.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    assert.equal(ld[0].datePublished, '2026-05-14T11:27:32.000Z');
});

test('Supabase outage returns 503 (crawlers retry, nothing deindexed)', async () => {
    mockSupabase({ fail: true });
    const r = await call(berita, { slug: 'juara-silat' });
    assert.equal(r.status, 503);
    assert.equal(r.headers['retry-after'], '300');
    assert.equal((await call(sitemap)).status, 503);
});

test('list: cards with crawlable links + CollectionPage JSON-LD', async () => {
    mockSupabase();
    const r = await call(berita);
    assert.equal(r.status, 200);
    assert.match(r.body, /href="\/berita\/juara-silat" class="news-title-link"/);
    assert.match(r.body, /href="\/berita\/spmb-2026"/);
    assert.match(r.body, /<link rel="canonical" href="https:\/\/sdnkalibaru05\.sch\.id\/berita">/);
    assert.doesNotMatch(r.body, /noindex/);
    const ld = JSON.parse(r.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    assert.equal(ld.mainEntity.itemListElement.length, 2);
});

test('sitemap: static pages + every article with lastmod and images', async () => {
    mockSupabase();
    const r = await call(sitemap);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/xml/);
    assert.match(r.body, /<loc>https:\/\/sdnkalibaru05\.sch\.id\/berita\/juara-silat<\/loc><lastmod>2026-10-28T01:18:59\.000Z<\/lastmod><image:image><image:loc>https:\/\/img\.test\/a\.jpg<\/image:loc>/);
    assert.match(r.body, /<loc>https:\/\/sdnkalibaru05\.sch\.id\/kontak<\/loc>/);
    assert.doesNotMatch(r.body, /javascript:/);
});
