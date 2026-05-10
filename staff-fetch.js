document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data, error } = await supabase.from('staff').select('*').order('order_index', { ascending: true });
        
        if (error) {
            console.error('Supabase error:', error);
            return;
        }

        const ksContainer = document.getElementById('kepsekContainer');
        const gkContainer = document.getElementById('guruKelasContainer');
        const mpContainer = document.getElementById('guruMapelContainer');
        const tkContainer = document.getElementById('tendikContainer');

        if (!data || data.length === 0) {
            // Optional: Show empty state
            return;
        }

        data.forEach(staff => {
            const html = `
                <div class="staff-card ${staff.role === 'Kepala Sekolah' ? 'principal-card animate-up' : ''}">
                    <div class="staff-img-wrapper">
                        <img src="${staff.image_url}" alt="${staff.name}" class="staff-img" style="object-position: center top;">
                    </div>
                    <h3 class="staff-name">${staff.name}</h3>
                    <p class="staff-role">${staff.role}</p>
                    <p class="staff-nip">${staff.nip || '-'}</p>
                </div>
            `;

            if (staff.role === 'Kepala Sekolah' && ksContainer) ksContainer.innerHTML += html;
            else if (staff.role === 'Guru Kelas' && gkContainer) gkContainer.innerHTML += html;
            else if (staff.role === 'Guru Mata Pelajaran' && mpContainer) mpContainer.innerHTML += html;
            else if (staff.role === 'Tenaga Kependidikan' && tkContainer) tkContainer.innerHTML += html;
        });

    } catch (err) {
        console.error('Fetch error:', err);
    }
});
