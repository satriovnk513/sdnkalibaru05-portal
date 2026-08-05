// Sanitize HTML to prevent XSS injection attacks
function sanitizeHTMLNews(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
function sanitizeURLNews(url) {
    if (!url) return '';
    try {
        const p = new URL(url);
        return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
    } catch { return ''; }
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
        data.forEach((news, index) => {
            const delayClass = index % 3 === 0 ? '' : `delay-${index % 3}`;
            const safeTitle = sanitizeHTMLNews(news.title);
            const safeDate = sanitizeHTMLNews(news.date);
            const safeDesc = sanitizeHTMLNews(news.description);
            const safeImg = sanitizeURLNews(news.image_url);
            const safeSlug = news.slug ? sanitizeHTMLNews(news.slug) : '';
            const newsLink = safeSlug ? `/berita/${safeSlug}` : `berita-detail?id=${sanitizeHTMLNews(news.id)}`;
            const html = `
                <article class="news-card">
                    <div class="news-img" style="background-image: url('${safeImg}')"></div>
                    <div class="news-content">
                        <span class="news-date">${safeDate}</span>
                        <a href="${newsLink}" class="news-title-link">
                            <h3 class="news-title">${safeTitle}</h3>
                        </a>
                        <p>${safeDesc}</p>
                        <a href="${newsLink}" class="read-more">Baca Selengkapnya <i class="fas fa-arrow-right"></i></a>
                    </div>
                </article>
            `;
            container.innerHTML += html;
        });

    } catch (err) {
        console.error('Fetch error:', err);
    }
});

