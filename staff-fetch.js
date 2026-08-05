// Sanitize HTML to prevent XSS injection attacks
function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
        const { data, error } = await supabaseClient.from('staff').select('*');
        
        if (error) {
            console.error('Supabase error:', error);
            return;
        }

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

        if (!data || data.length === 0) {
            // Optional: Show empty state
            return;
        }

        data.forEach(staff => {
            const safeName = sanitizeHTML(staff.name);
            const safeImgUrl = sanitizeURL(staff.image_url);
            const safeNip = sanitizeHTML(staff.nip || '-');

            const parts = sanitizeHTML(staff.role).split('|');
            const category = parts[0];
            const displayRole = parts[1] || parts[0];
            
            const html = `
                <div class="staff-card ${(category === 'Kepala Sekolah' || category === 'Wakil Kepala Sekolah') ? 'principal-card' : ''}">
                    <div class="staff-img-wrapper" onclick="openStaffLightbox('${safeImgUrl.replace(/'/g, "\\'")}', '${safeName.replace(/'/g, "\\'")}', '${displayRole.replace(/'/g, "\\'")}', '${safeNip.replace(/'/g, "\\'")}')" style="cursor: pointer;">
                        <img src="${safeImgUrl}" alt="${safeName}" class="staff-img" style="object-position: center top;">
                    </div>
                    <h3 class="staff-name">${safeName}</h3>
                    <p class="staff-role">${displayRole}</p>
                    <p class="staff-nip">${safeNip}</p>
                </div>
            `;

            if ((category === 'Kepala Sekolah' || category === 'Wakil Kepala Sekolah') && ksContainer) ksContainer.innerHTML += html;
            else if ((category === 'Guru Kelas' || category === 'Bendahara Sekolah') && gkContainer) gkContainer.innerHTML += html;
            else if (category === 'Guru Mata Pelajaran' && mpContainer) mpContainer.innerHTML += html;
            else if (category === 'Tenaga Kependidikan' && tkContainer) tkContainer.innerHTML += html;
        });

    } catch (err) {
        console.error('Fetch error:', err);
    }
});
