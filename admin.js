document.addEventListener('DOMContentLoaded', () => {
    // Check login
    if (localStorage.getItem('adminLoggedIn') === 'true') {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        loadStaff();
    }
});

function checkLogin() {
    let email = document.getElementById('adminEmail').value.trim();
    let pass = document.getElementById('adminPassword').value;

    if (email === 'admin@sdnkalibaru05.sch.id' && pass === 'admin123') {
        localStorage.setItem('adminLoggedIn', 'true');
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        loadStaff();
    } else {
        document.getElementById('loginError').style.display = 'block';
    }
}

function logout() {
    localStorage.removeItem('adminLoggedIn');
    location.reload();
}

// Show Tab
function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById(tabId).style.display = 'block';
    
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.querySelector(`.tab-btn[onclick="showTab('${tabId}')"]`).classList.add('active');
}

// Supabase Logic
async function loadStaff() {
    const { data, error } = await supabaseClient.from('staff').select('*').order('order_index', { ascending: true });
    if (error) {
        console.error('Error loading staff:', error);
        return;
    }

    const tbody = document.getElementById('staffTableBody');
    tbody.innerHTML = '';
    
    data.forEach(staff => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img src="${staff.image_url}" alt="Foto" style="width: 50px; height: 50px; object-fit: cover; border-radius: 50%;"></td>
            <td>${staff.name}</td>
            <td>${staff.role}</td>
            <td>${staff.nip || '-'}</td>
            <td>
                <button onclick="deleteStaff('${staff.id}')" style="background: #dc2626; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function saveStaff(e) {
    e.preventDefault();
    const btn = document.getElementById('saveStaffBtn');
    btn.innerText = "Menyimpan...";
    btn.disabled = true;

    try {
        const name = document.getElementById('staffName').value;
        const role = document.getElementById('staffRole').value;
        const nip = document.getElementById('staffNip').value;
        const fileInput = document.getElementById('staffPhoto');
        let imageUrl = "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80"; // default

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}.${fileExt}`;
            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('photos')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: publicUrlData } = supabaseClient.storage.from('photos').getPublicUrl(fileName);
            imageUrl = publicUrlData.publicUrl;
        }

        const { error } = await supabaseClient.from('staff').insert([{
            name, role, nip, image_url: imageUrl
        }]);

        if (error) throw error;

        document.getElementById('staffForm').reset();
        alert('Data berhasil disimpan!');
        loadStaff();

    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan: ' + (err.message || err.error_description || JSON.stringify(err)));
    } finally {
        btn.innerText = "Simpan Data";
        btn.disabled = false;
    }
}

async function deleteStaff(id) {
    if(!confirm("Yakin ingin menghapus data ini?")) return;
    
    const { error } = await supabaseClient.from('staff').delete().eq('id', id);
    if(error) {
        alert("Gagal menghapus data.");
        console.error(error);
    } else {
        loadStaff();
    }
}
