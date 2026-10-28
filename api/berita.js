/**
 * Server-rendered news pages for search engines and link previews.
 *   /berita            -> rewrite to /api/berita              (list)
 *   /berita/:slug      -> rewrite to /api/berita?slug=:slug   (article)
 * The HTML is the normal page template with real <title>, meta description, canonical,
 * Open Graph, JSON-LD and the article content already in the markup. The browser scripts
 * still run and take over rendering (the article data is embedded, so no second fetch).
 */
import {
    SITE, SITE_NAME, LOGO, DEFAULT_IMAGE, CACHE_OK, CACHE_MISS,
    escapeHtml, jsonForScript, readTemplate, fetchNews, articlePath, imagesOf,
    publishedIso, modifiedIso, summary, paragraphs, safeUrl, replaceOrFail
} from './_lib/seo.js';

const PUBLISHER = {
    '@type': 'EducationalOrganization',
    name: SITE_NAME,
    url: `${SITE}/`,
    logo: { '@type': 'ImageObject', url: LOGO }
};

function headTags({ title, description, canonical, image, type, extra = '' }) {
    return [
        `<title>${escapeHtml(title)}</title>`,
        `<meta name="description" content="${escapeHtml(description)}">`,
        `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`,
        `<link rel="canonical" href="${escapeHtml(canonical)}">`,
        `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
        `<meta property="og:locale" content="id_ID">`,
        `<meta property="og:type" content="${type}">`,
        `<meta property="og:title" content="${escapeHtml(title)}">`,
        `<meta property="og:description" content="${escapeHtml(description)}">`,
        `<meta property="og:url" content="${escapeHtml(canonical)}">`,
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${escapeHtml(title)}">`,
        `<meta name="twitter:description" content="${escapeHtml(description)}">`,
        `<meta name="twitter:image" content="${escapeHtml(image)}">`,
        extra
    ].filter(Boolean).join('\n    ');
}

/** Remove the template's own SEO tags so each appears exactly once. */
function stripTemplateHead(html) {
    return html
        .replace(/\s*<!-- Template for \/api\/berita[^>]*-->/, '')
        .replace(/\s*<title>[\s\S]*?<\/title>/i, '')
        .replace(/\s*<meta\s+name="(description|robots)"[^>]*>/gi, '')
        .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '');
}

function injectHead(html, tags) {
    return replaceOrFail(stripTemplateHead(html), /<meta name="viewport"[^>]*>/i,
        (m) => `${m}\n    ${tags}`, 'viewport meta');
}

function sendHtml(res, status, html, cache) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', cache);
    return res.status(status).send(html);
}

// ---------------------------------------------------------------- article
function renderArticleBody(news) {
    const images = imagesOf(news);
    const gallery = images.length
        ? `<div class="news-img-gallery${images.length === 1 ? ' single' : ''}">${images.map((src, i) =>
            `<img src="${escapeHtml(src)}" alt="Gambar ${i + 1} - ${escapeHtml(news.title)}"${i ? ' loading="lazy"' : ''}>`).join('')}</div>`
        : '';
    const pdfs = (Array.isArray(news.pdf_attachments) && news.pdf_attachments.length
        ? news.pdf_attachments
        : (news.pdf_url ? [{ url: news.pdf_url, filename: news.pdf_filename }] : []))
        .map((a) => ({ url: safeUrl(a.url), name: a.filename || `${news.title}.pdf` }))
        .filter((a) => a.url);
    const pdfHtml = pdfs.length
        ? `<ul class="pdf-attachments-wrapper">${pdfs.map((a) =>
            `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Lampiran: ${escapeHtml(a.name)}</a></li>`).join('')}</ul>`
        : '';
    const published = publishedIso(news);
    return `
        <article>
            <nav class="news-breadcrumb" aria-label="Breadcrumb"><a href="/">Beranda</a> / <a href="/berita">Berita &amp; Pengumuman</a> / ${escapeHtml(news.title)}</nav>
            <header class="news-detail-header">
                <time class="news-detail-date"${published ? ` datetime="${escapeHtml(published)}"` : ''}>${escapeHtml(news.date)}</time>
                <h1 class="news-detail-title">${escapeHtml(news.title)}</h1>
            </header>
            ${gallery}
            <div class="news-detail-content">${paragraphs(news.content || news.description)}</div>
            ${pdfHtml}
            <p><a href="/berita">Kembali ke Semua Berita</a></p>
        </article>`;
}

function articleJsonLd(news, canonical, images, description) {
    return [
        {
            '@context': 'https://schema.org',
            '@type': 'NewsArticle',
            headline: String(news.title || '').slice(0, 110),
            description,
            image: images.length ? images : [DEFAULT_IMAGE],
            datePublished: publishedIso(news),
            dateModified: modifiedIso(news),
            inLanguage: 'id-ID',
            mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
            author: { '@type': 'EducationalOrganization', name: SITE_NAME, url: `${SITE}/` },
            publisher: PUBLISHER
        },
        {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Beranda', item: `${SITE}/` },
                { '@type': 'ListItem', position: 2, name: 'Berita & Pengumuman', item: `${SITE}/berita` },
                { '@type': 'ListItem', position: 3, name: String(news.title || ''), item: canonical }
            ]
        }
    ];
}

async function renderArticle(res, slug) {
    const template = readTemplate('berita-detail.html');
    let rows;
    try {
        // Exact (case-insensitive) match; escape LIKE wildcards.
        const pattern = slug.replace(/[\\%_*]/g, '\\$&');
        rows = await fetchNews(`select=*&slug=ilike.${encodeURIComponent(pattern)}&limit=1`);
    } catch (err) {
        console.error('[berita] Supabase error:', err.message);
        // Temporary problem: tell crawlers to retry later; the browser script still tries to load.
        res.setHeader('Retry-After', '300');
        return sendHtml(res, 503, template, 'no-store');
    }

    const news = rows[0];
    if (!news) {
        const html = injectHead(template, `<title>Berita tidak ditemukan - ${SITE_NAME}</title>\n    <meta name="robots" content="noindex, follow">`);
        return sendHtml(res, 404, html, CACHE_MISS);
    }

    const canonical = SITE + articlePath(news);
    const images = imagesOf(news);
    const description = summary(news.description || news.content);
    const jsonLd = articleJsonLd(news, canonical, images, description);
    const published = publishedIso(news);
    const tags = headTags({
        title: `${news.title} - ${SITE_NAME}`,
        description,
        canonical,
        image: images[0] || DEFAULT_IMAGE,
        type: 'article',
        extra: [
            published ? `<meta property="article:published_time" content="${escapeHtml(published)}">` : '',
            `<meta property="article:modified_time" content="${escapeHtml(modifiedIso(news))}">`,
            `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`,
            `<script>window.__NEWS__ = ${jsonForScript(news)};</script>`
        ].filter(Boolean).join('\n    ')
    });

    let html = injectHead(template, tags);
    html = replaceOrFail(html, /(<main class="news-detail-container" id="newsDetail">)[\s\S]*?(<\/main>)/,
        (_, open, close) => `${open}${renderArticleBody(news)}\n    ${close}`, 'newsDetail main');
    return sendHtml(res, 200, html, CACHE_OK);
}

// ---------------------------------------------------------------- list
function renderCard(news) {
    const link = escapeHtml(articlePath(news));
    const img = imagesOf(news)[0];
    return `
                <article class="news-card">
                    <div class="news-img"${img ? ` style="background-image: url(&quot;${escapeHtml(img)}&quot;)"` : ''} role="img" aria-label="${escapeHtml(news.title)}"></div>
                    <div class="news-content">
                        <span class="news-date">${escapeHtml(news.date)}</span>
                        <a href="${link}" class="news-title-link"><h3 class="news-title">${escapeHtml(news.title)}</h3></a>
                        <p>${escapeHtml(news.description)}</p>
                        <a href="${link}" class="read-more">Baca Selengkapnya <i class="fas fa-arrow-right"></i></a>
                    </div>
                </article>`;
}

async function renderList(res) {
    const template = readTemplate('berita-list.html');
    let rows;
    try {
        rows = await fetchNews('select=id,slug,title,description,date,image_url,image_urls,created_at&order=created_at.desc');
    } catch (err) {
        console.error('[berita] Supabase error:', err.message);
        res.setHeader('Retry-After', '300');
        return sendHtml(res, 503, template, 'no-store');
    }

    const canonical = `${SITE}/berita`;
    const description = 'Berita, prestasi, dan pengumuman resmi terbaru dari SDN Kalibaru 05 Pagi, Cilincing, Jakarta Utara: kegiatan siswa, SPMB, dan informasi sekolah.';
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Berita & Pengumuman SDN Kalibaru 05 Pagi',
        url: canonical,
        description,
        inLanguage: 'id-ID',
        publisher: PUBLISHER,
        mainEntity: {
            '@type': 'ItemList',
            itemListElement: rows.map((n, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + articlePath(n), name: n.title }))
        }
    };
    const tags = headTags({
        title: 'Berita & Pengumuman Terbaru - SDN Kalibaru 05 Pagi, Cilincing, Jakarta Utara',
        description,
        canonical,
        image: imagesOf(rows[0] || {})[0] || DEFAULT_IMAGE,
        type: 'website',
        extra: `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`
    });

    let html = injectHead(template, tags);
    html = replaceOrFail(html, /(<div class="news-grid" id="newsContainer">)[\s\S]*?(<\/div>\s*<\/div>\s*<\/section>)/,
        (_, open, close) => `${open}${rows.map(renderCard).join('')}\n            ${close}`, 'newsContainer');
    return sendHtml(res, 200, html, CACHE_OK);
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('Method Not Allowed');
    }
    try {
        const slug = typeof req.query?.slug === 'string' ? req.query.slug.trim() : '';
        return slug ? await renderArticle(res, slug) : await renderList(res);
    } catch (err) {
        console.error('[berita] render error:', err);
        res.setHeader('Retry-After', '300');
        return res.status(503).send('Layanan sedang sibuk, silakan muat ulang halaman.');
    }
}
