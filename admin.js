document.addEventListener('DOMContentLoaded', () => {
    initFileInputs(); // wire multi-file inputs
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

    // Sort client-side: by order_index ascending, 0/NULLs last
    data.sort((a, b) => {
        const aIdx = (!a.order_index || a.order_index === 0) ? 9999 : Number(a.order_index);
        const bIdx = (!b.order_index || b.order_index === 0) ? 9999 : Number(b.order_index);
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

// ---------- state ----------
let editNewsId = null;
let existingImgUrls = [];   // array of URLs already saved (edit mode)
let existingPdfAttachments = []; // array of {url, filename} already saved (edit mode)
// selectedImgFiles / selectedPdfFiles are tracked via DataTransfer-backed arrays
let selectedImgFiles = [];
let selectedPdfFiles = [];

// ---------- helpers ----------

/** Render preview chips for newly selected images */
function renderImgPreviews() {
    const area = document.getElementById('imgPreviewArea');
    area.innerHTML = '';
    selectedImgFiles.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = ev => {
            const wrap = document.createElement('div');
            wrap.className = 'preview-img-item';
            wrap.innerHTML = `<img src="${ev.target.result}" alt="preview">
                <button type="button" class="remove-btn" title="Hapus">&#10005;</button>`;
            wrap.querySelector('.remove-btn').onclick = () => {
                selectedImgFiles.splice(i, 1);
                renderImgPreviews();
            };
            area.appendChild(wrap);
        };
        reader.readAsDataURL(file);
    });
}

/** Render preview chips for newly selected PDFs */
function renderPdfPreviews() {
    const area = document.getElementById('pdfPreviewArea');
    area.innerHTML = '';
    selectedPdfFiles.forEach((file, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'preview-pdf-item';
        wrap.innerHTML = `📄 <span title="${file.name}">${file.name}</span>
            <button type="button" class="remove-btn" title="Hapus">&#10005;</button>`;
        wrap.querySelector('.remove-btn').onclick = () => {
            selectedPdfFiles.splice(i, 1);
            renderPdfPreviews();
        };
        area.appendChild(wrap);
    });
}

/** Render existing image chips (edit mode) */
function renderExistingImgs() {
    const list = document.getElementById('existingImgList');
    if (!existingImgUrls.length) { list.style.display = 'none'; return; }
    list.style.display = 'flex';
    list.innerHTML = '';
    existingImgUrls.forEach((url, i) => {
        const chip = document.createElement('div');
        chip.className = 'existing-img-chip';
        chip.innerHTML = `<img src="${url}" alt="img">
            <button type="button" class="remove-existing" title="Hapus">&#10005;</button>`;
        chip.querySelector('.remove-existing').onclick = () => {
            existingImgUrls.splice(i, 1);
            renderExistingImgs();
        };
        list.appendChild(chip);
    });
}

/** Render existing PDF chips (edit mode) */
function renderExistingPdfs() {
    const list = document.getElementById('existingPdfList');
    if (!existingPdfAttachments.length) { list.style.display = 'none'; return; }
    list.style.display = 'flex';
    list.innerHTML = '';
    existingPdfAttachments.forEach((att, i) => {
        const chip = document.createElement('div');
        chip.className = 'existing-pdf-chip';
        chip.innerHTML = `📄 <span title="${att.filename}">${att.filename}</span>
            <button type="button" class="remove-existing" title="Hapus">&#10005;</button>`;
        chip.querySelector('.remove-existing').onclick = () => {
            existingPdfAttachments.splice(i, 1);
            renderExistingPdfs();
        };
        list.appendChild(chip);
    });
}

/** Reset the new-file selections and clear preview areas */
function clearFileSelections() {
    selectedImgFiles = [];
    selectedPdfFiles = [];
    document.getElementById('newsPhoto').value = '';
    document.getElementById('newsPdf').value = '';
    document.getElementById('imgPreviewArea').innerHTML = '';
    document.getElementById('pdfPreviewArea').innerHTML = '';
}

// Wire up file input change events (called once on DOMContentLoaded)
function initFileInputs() {
    document.getElementById('newsPhoto').addEventListener('change', function () {
        // Append newly picked files (avoid duplicates by name)
        Array.from(this.files).forEach(f => {
            if (!selectedImgFiles.find(x => x.name === f.name && x.size === f.size)) {
                selectedImgFiles.push(f);
            }
        });
        this.value = ''; // reset so same file can be re-added if removed
        renderImgPreviews();
    });

    document.getElementById('newsPdf').addEventListener('change', function () {
        Array.from(this.files).forEach(f => {
            if (!selectedPdfFiles.find(x => x.name === f.name && x.size === f.size)) {
                selectedPdfFiles.push(f);
            }
        });
        this.value = '';
        renderPdfPreviews();
    });
}

// ---------- load news table ----------
async function loadNews() {
    const { data, error } = await supabaseClient.from('news').select('*').order('created_at', { ascending: false });
    if (error) {
        console.error('Error loading news:', error);
        return;
    }

    const tbody = document.getElementById('newsTableBody');
    tbody.innerHTML = '';
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">Belum ada berita.</td></tr>';
        return;
    }
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        // Thumbnail: prefer first of image_urls, fallback to image_url
        const thumbUrl = (item.image_urls && item.image_urls.length > 0)
            ? item.image_urls[0]
            : (item.image_url || '');
        const dataAttr = encodeURIComponent(JSON.stringify(item));
        tr.innerHTML = `
            <td><img src="${thumbUrl}" alt="Foto" style="width: 80px; height: 50px; object-fit: cover; border-radius: 4px;"></td>
            <td>${item.title}</td>
            <td>${item.date}</td>
            <td>
                <button onclick="editNews('${item.id}', '${dataAttr}')" style="background: #eab308; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
                <button onclick="deleteNews('${item.id}')" style="background: #dc2626; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ---------- edit ----------
function editNews(id, encodedData) {
    const item = JSON.parse(decodeURIComponent(encodedData));
    editNewsId = id;

    // Populate existing images
    existingImgUrls = Array.isArray(item.image_urls) && item.image_urls.length > 0
        ? [...item.image_urls]
        : (item.image_url ? [item.image_url] : []);

    // Populate existing PDFs
    existingPdfAttachments = Array.isArray(item.pdf_attachments) && item.pdf_attachments.length > 0
        ? item.pdf_attachments.map(a => ({ url: a.url, filename: a.filename }))
        : (item.pdf_url ? [{ url: item.pdf_url, filename: item.pdf_filename || item.title + '.pdf' }] : []);

    // Clear new file selections
    clearFileSelections();

    // Fill form fields
    document.getElementById('newsTitle').value = item.title || '';
    document.getElementById('newsDate').value = item.date || '';
    document.getElementById('newsDesc').value = item.description || '';
    document.getElementById('newsLink').value = item.link || 'berita-detail';
    document.getElementById('newsContent').value = item.content || '';

    // Render existing media chips
    renderExistingImgs();
    renderExistingPdfs();

    const btn = document.getElementById('saveNewsBtn');
    btn.innerText = 'Update Berita';
    btn.style.background = '#eab308';

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
    existingImgUrls = [];
    existingPdfAttachments = [];
    clearFileSelections();
    document.getElementById('newsForm').reset();
    document.getElementById('existingImgList').style.display = 'none';
    document.getElementById('existingImgList').innerHTML = '';
    document.getElementById('existingPdfList').style.display = 'none';
    document.getElementById('existingPdfList').innerHTML = '';

    const btn = document.getElementById('saveNewsBtn');
    btn.innerText = 'Simpan Berita';
    btn.style.background = '#da251c';

    const cancelBtn = document.getElementById('cancelEditNewsBtn');
    if (cancelBtn) cancelBtn.remove();
}

// ---------- save ----------
async function saveNews(e) {
    e.preventDefault();
    const btn = document.getElementById('saveNewsBtn');
    const originalText = btn.innerText;
    btn.disabled = true;

    try {
        const title       = document.getElementById('newsTitle').value.trim();
        const date        = document.getElementById('newsDate').value.trim();
        const description = document.getElementById('newsDesc').value.trim();
        const content     = document.getElementById('newsContent').value.trim();
        const link        = document.getElementById('newsLink').value.trim() || 'berita-detail';

        // Generate slug
        const slug = title.toLowerCase()
            .replace(/\//g, '-')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        // ── Upload all new images ──
        const newImageUrls = [];
        for (let i = 0; i < selectedImgFiles.length; i++) {
            btn.innerText = `Upload gambar ${i + 1}/${selectedImgFiles.length}...`;
            const file = selectedImgFiles[i];
            const ext  = file.name.split('.').pop();
            const path = `news_img_${Date.now()}_${i}.${ext}`;
            const { error: upErr } = await supabaseClient.storage.from('photos').upload(path, file);
            if (upErr) throw upErr;
            const { data: pub } = supabaseClient.storage.from('photos').getPublicUrl(path);
            newImageUrls.push(pub.publicUrl);
        }

        // ── Upload all new PDFs ──
        const newPdfAttachments = [];
        for (let i = 0; i < selectedPdfFiles.length; i++) {
            btn.innerText = `Upload PDF ${i + 1}/${selectedPdfFiles.length}...`;
            const file = selectedPdfFiles[i];
            const ext  = file.name.split('.').pop();
            const path = `news_doc_${Date.now()}_${i}.${ext}`;
            const { error: upErr } = await supabaseClient.storage.from('photos').upload(path, file);
            if (upErr) throw upErr;
            const { data: pub } = supabaseClient.storage.from('photos').getPublicUrl(path);
            newPdfAttachments.push({ url: pub.publicUrl, filename: file.name });
        }

        // ── Merge existing + new ──
        const finalImageUrls       = [...existingImgUrls, ...newImageUrls];
        const finalPdfAttachments  = [...existingPdfAttachments, ...newPdfAttachments];

        // Keep legacy single-value fields for backward compatibility
        const DEFAULT_IMG = 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=600&q=80';
        const legacyImageUrl    = finalImageUrls[0] || DEFAULT_IMG;
        const legacyPdfUrl      = finalPdfAttachments.length > 0 ? finalPdfAttachments[0].url : null;
        const legacyPdfFilename = finalPdfAttachments.length > 0 ? finalPdfAttachments[0].filename : null;

        btn.innerText = 'Menyimpan...';

        const newsData = {
            title, date, description, content, link, slug,
            image_urls:      finalImageUrls,
            pdf_attachments: finalPdfAttachments,
            // legacy columns kept in sync
            image_url:    legacyImageUrl,
            pdf_url:      legacyPdfUrl,
            pdf_filename: legacyPdfFilename,
        };

        if (editNewsId) {
            const { error } = await supabaseClient.from('news').update(newsData).eq('id', editNewsId);
            if (error) throw error;
            alert('Berita berhasil diupdate!');
            cancelEditNews();
        } else {
            const { error } = await supabaseClient.from('news').insert([newsData]);
            if (error) throw error;
            document.getElementById('newsForm').reset();
            clearFileSelections();
            alert('Berita berhasil ditambahkan!');
        }

        loadNews();

    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan: ' + (err.message || err.error_description || JSON.stringify(err)));
    } finally {
        btn.innerText = editNewsId ? 'Update Berita' : 'Simpan Berita';
        btn.disabled = false;
    }
}

// ---------- delete ----------
async function deleteNews(id) {
    if (!confirm('Yakin ingin menghapus berita ini?')) return;
    const { error } = await supabaseClient.from('news').delete().eq('id', id);
    if (error) {
        alert('Gagal menghapus berita.');
        console.error(error);
    } else {
        loadNews();
    }
}
