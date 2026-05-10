document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data, error } = await supabaseClient.from('staff').select('*');
        
        if (error) {
            console.error('Supabase error:', error);
            return;
        }

        // Sort client-side: by order_index ascending, NULLs last
        data.sort((a, b) => {
            const aIdx = (a.order_index === null || a.order_index === undefined) ? 9999 : Number(a.order_index);
            const bIdx = (b.order_index === null || b.order_index === undefined) ? 9999 : Number(b.order_index);
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
            const parts = staff.role.split('|');
            const category = parts[0];
            const displayRole = parts[1] || parts[0];
            
            const html = `
                <div class="staff-card ${category === 'Kepala Sekolah' ? 'principal-card' : ''}">
                    <div class="staff-img-wrapper">
                        <img src="${staff.image_url}" alt="${staff.name}" class="staff-img" style="object-position: center top;">
                    </div>
                    <h3 class="staff-name">${staff.name}</h3>
                    <p class="staff-role">${displayRole}</p>
                    <p class="staff-nip">${staff.nip || '-'}</p>
                </div>
            `;

            if (category === 'Kepala Sekolah' && ksContainer) ksContainer.innerHTML += html;
            else if (category === 'Guru Kelas' && gkContainer) gkContainer.innerHTML += html;
            else if (category === 'Guru Mata Pelajaran' && mpContainer) mpContainer.innerHTML += html;
            else if (category === 'Tenaga Kependidikan' && tkContainer) tkContainer.innerHTML += html;
        });

    } catch (err) {
        console.error('Fetch error:', err);
    }
});
