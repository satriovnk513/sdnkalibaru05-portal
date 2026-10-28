/**
 * Dynamic sitemap: static pages + every news article (with images).
 * /sitemap.xml is rewritten here by vercel.json.
 */
import { SITE, fetchNews, articlePath, imagesOf, modifiedIso, escapeHtml } from './_lib/seo.js';

const STATIC_PAGES = ['/', '/profil', '/guru-staff', '/ekstrakurikuler', '/berita', '/kontak'];

export default async function handler(req, res) {
    let news = [];
    try {
        news = await fetchNews('select=id,slug,title,image_url,image_urls,created_at,date&order=created_at.desc');
    } catch (err) {
        console.error('[sitemap] Supabase error:', err.message);
        res.setHeader('Retry-After', '300');
        return res.status(503).send('Sitemap temporarily unavailable');
    }

    const newest = news.length ? modifiedIso(news[0]) : null;
    const urls = STATIC_PAGES.map((path) =>
        `  <url><loc>${SITE}${path}</loc>${path === '/berita' && newest ? `<lastmod>${newest}</lastmod>` : ''}</url>`);

    for (const n of news) {
        const images = imagesOf(n).map((src) =>
            `<image:image><image:loc>${escapeHtml(src)}</image:loc></image:image>`).join('');
        urls.push(`  <url><loc>${escapeHtml(SITE + articlePath(n))}</loc><lastmod>${modifiedIso(n)}</lastmod>${images}</url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
}
