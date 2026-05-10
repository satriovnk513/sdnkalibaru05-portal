document.addEventListener('DOMContentLoaded', () => {
    // Check login
    if (localStorage.getItem('adminLoggedIn') === 'true') {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        updateSubRoles();
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
        const parts = staff.role.split('|');
        const displayRole = parts[1] || parts[0];
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img src="${staff.image_url}" alt="Foto" style="width: 50px; height: 50px; object-fit: cover; border-radius: 50%;"></td>
            <td>${staff.name}</td>
            <td>${displayRole}</td>
            <td>${staff.nip || '-'}</td>
            <td>
                <button onclick="editStaff('${staff.id}', '${staff.name.replace(/'/g, "\\'")}', '${staff.role.replace(/'/g, "\\'")}', '${(staff.nip || '').replace(/'/g, "\\'")}', '${staff.image_url}')" style="background: #eab308; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
                <button onclick="deleteStaff('${staff.id}')" style="background: #dc2626; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateSubRoles() {
    const cat = document.getElementById('staffRole').value;
    const subGrp = document.getElementById('subRoleGroup');
    const subSel = document.getElementById('staffSubRole');
    subSel.innerHTML = '';
    
    if (cat === 'Kepala Sekolah') {
        subGrp.style.display = 'none';
        subSel.innerHTML = '<option value="Kepala Sekolah">Kepala Sekolah</option>';
    } else if (cat === 'Guru Kelas') {
        subGrp.style.display = 'block';
        for(let i=1; i<=6; i++) {
            subSel.innerHTML += `<option value="Wali Kelas ${i}">Wali Kelas ${i}</option>`;
        }
    } else if (cat === 'Guru Mata Pelajaran') {
        subGrp.style.display = 'block';
        subSel.innerHTML += `<option value="Guru Pendidikan Agama Islam">Guru Pendidikan Agama Islam</option>`;
        subSel.innerHTML += `<option value="Guru Olahraga">Guru Olahraga</option>`;
        subSel.innerHTML += `<option value="Guru Bahasa Inggris">Guru Bahasa Inggris</option>`;
    } else if (cat === 'Tenaga Kependidikan') {
        subGrp.style.display = 'block';
        subSel.innerHTML += `<option value="Penata Kelola Sistem & IT">Penata Kelola Sistem & IT</option>`;
        subSel.innerHTML += `<option value="Operator">Operator</option>`;
        subSel.innerHTML += `<option value="Tenaga Kebersihan">Tenaga Kebersihan</option>`;
        subSel.innerHTML += `<option value="Kepala Tata Usaha">Kepala Tata Usaha</option>`;
    }
}

let editStaffId = null;
let currentEditImageUrl = null;

function editStaff(id, name, fullRole, nip, imageUrl) {
    editStaffId = id;
    currentEditImageUrl = imageUrl;
    
    document.getElementById('staffName').value = name;
    
    // Parse role
    const parts = fullRole.split('|');
    document.getElementById('staffRole').value = parts[0];
    updateSubRoles();
    document.getElementById('staffSubRole').value = parts[1] || parts[0];
    
    document.getElementById('staffNip').value = nip;
    
    const btn = document.getElementById('saveStaffBtn');
    btn.innerText = "Update Data";
    btn.style.background = "#eab308";
    
    // Add cancel button if it doesn't exist
    if (!document.getElementById('cancelEditBtn')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelEditBtn';
        cancelBtn.type = 'button';
        cancelBtn.innerText = 'Batal Edit';
        cancelBtn.style.cssText = 'width: 100%; background: #64748b; color: white; border: none; padding: 1rem; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 0.5rem; transition: 0.3s;';
        cancelBtn.onclick = cancelEdit;
        btn.parentNode.appendChild(cancelBtn);
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
    editStaffId = null;
    currentEditImageUrl = null;
    document.getElementById('staffForm').reset();
    updateSubRoles();
    
    const btn = document.getElementById('saveStaffBtn');
    btn.innerText = "Simpan Data";
    btn.style.background = "#da251c";
    
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) cancelBtn.remove();
}

async function saveStaff(e) {
    e.preventDefault();
    const btn = document.getElementById('saveStaffBtn');
    btn.innerText = "Menyimpan...";
    btn.disabled = true;

    try {
        const name = document.getElementById('staffName').value;
        const cat = document.getElementById('staffRole').value;
        const sub = document.getElementById('staffSubRole').value;
        const role = cat + '|' + sub;
        const nip = document.getElementById('staffNip').value;
        const fileInput = document.getElementById('staffPhoto');
        let imageUrl = currentEditImageUrl || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80"; // default

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}.${fileExt}`;
            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('photos')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabaseClient.storage.from('photos').getPublicUrl(fileName);
            imageUrl = publicUrlData.publicUrl;
        }

        if (editStaffId) {
            const { error } = await supabaseClient.from('staff').update({
                name, role, nip, image_url: imageUrl
            }).eq('id', editStaffId);
            if (error) throw error;
            alert('Data berhasil diupdate!');
            cancelEdit();
        } else {
            const { error } = await supabaseClient.from('staff').insert([{
                name, role, nip, image_url: imageUrl
            }]);
            if (error) throw error;
            document.getElementById('staffForm').reset();
            alert('Data berhasil ditambahkan!');
        }
        
        loadStaff();

    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan: ' + (err.message || err.error_description || JSON.stringify(err)));
    } finally {
        const btn = document.getElementById('saveStaffBtn');
        btn.innerText = editStaffId ? "Update Data" : "Simpan Data";
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
