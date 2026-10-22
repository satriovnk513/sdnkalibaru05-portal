// Escape text for HTML text and quoted-attribute contexts
function sanitizeHTMLNews(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function sanitizeURLNews(url) {
    if (!url) return '';
    try {
        const p = new URL(url);
        return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
    } catch { return ''; }
}
function newsLinkFor(news) {
    return news.slug
        ? `/berita/${encodeURIComponent(news.slug)}`
        : `/berita-detail?id=${encodeURIComponent(news.id)}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data, error } = await supabaseClient.from('news').select('*').order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase error:', error);
            return;
        }

        const container = document.getElementById('newsContainer');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #64748b;">Belum ada berita terbaru.</p>';
            return;
        }

        container.innerHTML = '';
        data.forEach((news) => {
            const newsLink = sanitizeHTMLNews(newsLinkFor(news));
            const article = document.createElement('article');
            article.className = 'news-card';
            article.innerHTML = `
                <div class="news-img"></div>
                <div class="news-content">
                    <span class="news-date">${sanitizeHTMLNews(news.date)}</span>
                    <a href="${newsLink}" class="news-title-link">
                        <h3 class="news-title">${sanitizeHTMLNews(news.title)}</h3>
                    </a>
                    <p>${sanitizeHTMLNews(news.description)}</p>
                    <a href="${newsLink}" class="read-more">Baca Selengkapnya <i class="fas fa-arrow-right"></i></a>
                </div>
            `;
            const img = sanitizeURLNews(news.image_url);
            if (img) article.querySelector('.news-img').style.backgroundImage = `url(${JSON.stringify(img)})`;
            container.appendChild(article);
        });

    } catch (err) {
        console.error('Fetch error:', err);
    }
});
