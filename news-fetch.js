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
            const html = `
                <article class="news-card">
                    <div class="news-img" style="background-image: url('${news.image_url}')"></div>
                    <div class="news-content">
                        <span class="news-date">${news.date}</span>
                        <h3 class="news-title">${news.title}</h3>
                        <p>${news.description}</p>
                        <a href="${(news.link === 'berita-detail' || !news.link || news.link === '#') ? `berita-detail?id=${news.id}` : news.link}" class="read-more">Baca Selengkapnya <i class="fas fa-arrow-right"></i></a>
                    </div>
                </article>
            `;
            container.innerHTML += html;
        });

    } catch (err) {
        console.error('Fetch error:', err);
    }
});
