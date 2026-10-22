// Escape text for HTML text and quoted-attribute contexts
function sanitizeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Sanitize URL — only allow http/https protocols
function sanitizeURL(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
        return '';
    } catch {
        return '';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data, error } = await supabaseClient.from('staff').select('name, role, image_url, order_index');

        if (error) {
            console.error('Supabase error:', error);
            return;
        }

        if (!data || data.length === 0) return;

        // Sort client-side: by order_index ascending, 0/NULLs last
        data.sort((a, b) => {
            const aIdx = (!a.order_index || a.order_index === 0) ? 9999 : Number(a.order_index);
            const bIdx = (!b.order_index || b.order_index === 0) ? 9999 : Number(b.order_index);
            return aIdx - bIdx;
        });

        const ksContainer = document.getElementById('kepsekContainer');
        const gkContainer = document.getElementById('guruKelasContainer');
        const mpContainer = document.getElementById('guruMapelContainer');
        const tkContainer = document.getElementById('tendikContainer');

        data.forEach(staff => {
            const imgUrl = sanitizeURL(staff.image_url);
            const parts = String(staff.role || '').split('|');
            const category = parts[0];
            const displayRole = parts[1] || parts[0];
            const isPrincipal = category === 'Kepala Sekolah' || category === 'Wakil Kepala Sekolah';

            const card = document.createElement('div');
            card.className = 'staff-card' + (isPrincipal ? ' principal-card' : '');
            card.innerHTML = `
                <div class="staff-img-wrapper" style="cursor: pointer;">
                    <img src="${sanitizeHTML(imgUrl)}" alt="${sanitizeHTML(staff.name)}" class="staff-img" style="object-position: center top;">
                </div>
                <h3 class="staff-name">${sanitizeHTML(staff.name)}</h3>
                <p class="staff-role">${sanitizeHTML(displayRole)}</p>
            `;
            card.querySelector('.staff-img-wrapper').addEventListener('click', () => {
                if (typeof openStaffLightbox === 'function') openStaffLightbox(imgUrl, staff.name || '', displayRole);
            });

            let target = null;
            if (isPrincipal) target = ksContainer;
            else if (category === 'Guru Kelas' || category === 'Bendahara Sekolah') target = gkContainer;
            else if (category === 'Guru Mata Pelajaran') target = mpContainer;
            else if (category === 'Tenaga Kependidikan') target = tkContainer;
            if (target) target.appendChild(card);
        });

    } catch (err) {
        console.error('Fetch error:', err);
    }
});
