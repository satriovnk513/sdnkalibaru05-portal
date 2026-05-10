document.addEventListener('DOMContentLoaded', () => {
    // Check login
    if (localStorage.getItem('adminLoggedIn') === 'true') {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        updateSubRoles();
        loadStaff();
        loadNews();
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
    const { data, error } = await supabaseClient.from('staff').select('*');
    if (error) {
        console.error('Error loading staff:', error);
        return;
    }

    // Sort client-side: by order_index ascending, NULLs last
    data.sort((a, b) => {
        const aIdx = (a.order_index === null || a.order_index === undefined) ? 9999 : Number(a.order_index);
        const bIdx = (b.order_index === null || b.order_index === undefined) ? 9999 : Number(b.order_index);
        return aIdx - bIdx;
    });

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
            <td>${staff.order_index || 99}</td>
            <td>
                <button onclick="editStaff('${staff.id}', '${staff.name.replace(/'/g, "\\'")}', '${staff.role.replace(/'/g, "\\'")}', '${(staff.nip || '').replace(/'/g, "\\'")}', '${staff.image_url}', ${staff.order_index})" style="background: #eab308; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
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
        subGrp.style.display = 'none';
        subSel.innerHTML = '<option value="Guru Kelas">Guru Kelas</option>';
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

function editStaff(id, name, fullRole, nip, imageUrl, orderIndex) {
    editStaffId = id;
    currentEditImageUrl = imageUrl;
    
    document.getElementById('staffName').value = name;
    
    // Parse role
    const parts = fullRole.split('|');
    document.getElementById('staffRole').value = parts[0];
    updateSubRoles();
    document.getElementById('staffSubRole').value = parts[1] || parts[0];
    
    document.getElementById('staffNip').value = nip;
    document.getElementById('staffOrder').value = orderIndex || 99;
    
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
        const orderIndex = document.getElementById('staffOrder').value || 99;
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
                name, role, nip, image_url: imageUrl, order_index: orderIndex
            }).eq('id', editStaffId);
            if (error) throw error;
            alert('Data berhasil diupdate!');
            cancelEdit();
        } else {
            const { error } = await supabaseClient.from('staff').insert([{
                name, role, nip, image_url: imageUrl, order_index: orderIndex
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

// =======================
// NEWS LOGIC
// =======================

async function loadNews() {
    const { data, error } = await supabaseClient.from('news').select('*').order('created_at', { ascending: false });
    if (error) {
        console.error('Error loading news:', error);
        return;
    }

    const tbody = document.getElementById('newsTableBody');
    tbody.innerHTML = '';
    
    if(!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">Belum ada berita.</td></tr>';
        return;
    }
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img src="${item.image_url}" alt="Foto" style="width: 80px; height: 50px; object-fit: cover; border-radius: 4px;"></td>
            <td>${item.title}</td>
            <td>${item.date}</td>
            <td>
                <button onclick="editNews('${item.id}', '${item.title.replace(/'/g, "\\'")}', '${item.date.replace(/'/g, "\\'")}', '${item.description.replace(/'/g, "\\'")}', '${(item.link || '#').replace(/'/g, "\\'")}', '${item.image_url}')" style="background: #eab308; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
                <button onclick="deleteNews('${item.id}')" style="background: #dc2626; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

let editNewsId = null;
let currentNewsImageUrl = null;

function editNews(id, title, date, desc, link, imageUrl) {
    editNewsId = id;
    currentNewsImageUrl = imageUrl;
    
    document.getElementById('newsTitle').value = title;
    document.getElementById('newsDate').value = date;
    document.getElementById('newsDesc').value = desc;
    document.getElementById('newsLink').value = link;
    
    const btn = document.getElementById('saveNewsBtn');
    btn.innerText = "Update Berita";
    btn.style.background = "#eab308";
    
    if (!document.getElementById('cancelEditNewsBtn')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelEditNewsBtn';
        cancelBtn.type = 'button';
        cancelBtn.innerText = 'Batal Edit';
        cancelBtn.style.cssText = 'width: 100%; background: #64748b; color: white; border: none; padding: 1rem; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 0.5rem; transition: 0.3s;';
        cancelBtn.onclick = cancelEditNews;
        btn.parentNode.appendChild(cancelBtn);
    }
    
    showTab('tabNews');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditNews() {
    editNewsId = null;
    currentNewsImageUrl = null;
    document.getElementById('newsForm').reset();
    
    const btn = document.getElementById('saveNewsBtn');
    btn.innerText = "Simpan Berita";
    btn.style.background = "#da251c";
    
    const cancelBtn = document.getElementById('cancelEditNewsBtn');
    if (cancelBtn) cancelBtn.remove();
}

async function saveNews(e) {
    e.preventDefault();
    const btn = document.getElementById('saveNewsBtn');
    btn.innerText = "Menyimpan...";
    btn.disabled = true;

    try {
        const title = document.getElementById('newsTitle').value;
        const date = document.getElementById('newsDate').value;
        const description = document.getElementById('newsDesc').value;
        const link = document.getElementById('newsLink').value || '#';
        const fileInput = document.getElementById('newsPhoto');
        let imageUrl = currentNewsImageUrl || "https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=600&q=80";

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `news_${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabaseClient.storage.from('photos').upload(fileName, file);
            if (uploadError) throw uploadError;
            const { data: publicUrlData } = supabaseClient.storage.from('photos').getPublicUrl(fileName);
            imageUrl = publicUrlData.publicUrl;
        }

        if (editNewsId) {
            const { error } = await supabaseClient.from('news').update({
                title, date, description, link, image_url: imageUrl
            }).eq('id', editNewsId);
            if (error) throw error;
            alert('Berita berhasil diupdate!');
            cancelEditNews();
        } else {
            const { error } = await supabaseClient.from('news').insert([{
                title, date, description, link, image_url: imageUrl
            }]);
            if (error) throw error;
            document.getElementById('newsForm').reset();
            alert('Berita berhasil ditambahkan!');
        }
        
        loadNews();

    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan: ' + (err.message || err.error_description || JSON.stringify(err)));
    } finally {
        const btn = document.getElementById('saveNewsBtn');
        btn.innerText = editNewsId ? "Update Berita" : "Simpan Berita";
        btn.disabled = false;
    }
}

async function deleteNews(id) {
    if(!confirm("Yakin ingin menghapus berita ini?")) return;
    
    const { error } = await supabaseClient.from('news').delete().eq('id', id);
    if(error) {
        alert("Gagal menghapus berita.");
        console.error(error);
    } else {
        loadNews();
    }
}
