document.addEventListener('DOMContentLoaded', async () => {
    initFileInputs(); // wire multi-file inputs
    initGalleryInputs(); // wire gallery file input & drag-drop
    initEkskulFileInputs(); // wire ekskul file inputs
    
    // Check login using Supabase Auth
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        updateSubRoles();
        loadStaff();
        loadNews();
        loadGallery();
        loadEkskul();
        loadAIMemory();
        loadAISettingsIntoForm();
    }
    
    // Listen for auth state changes (e.g. token expiration)
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            document.getElementById('loginOverlay').style.display = 'flex';
            document.getElementById('mainContent').style.display = 'none';
        }
    });
});

async function checkLogin() {
    const email = document.getElementById('adminEmail').value.trim();
    const pass = document.getElementById('adminPassword').value;
    const errorMsg = document.getElementById('loginError');
    
    errorMsg.style.display = 'none';
    
    if (!email || !pass) {
        errorMsg.textContent = 'Email dan password harus diisi!';
        errorMsg.style.display = 'block';
        return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: pass,
    });

    if (error) {
        errorMsg.textContent = 'Login gagal: Email atau password salah!';
        errorMsg.style.display = 'block';
        console.error('Login error:', error.message);
    } else {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        updateSubRoles();
        loadStaff();
        loadNews();
        loadGallery();
        loadEkskul();
        loadAIMemory();
        loadAISettingsIntoForm();
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
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

// =======================
// GALLERY LOGIC
// =======================

let selectedGalleryFiles = [];

/** Returns 'image' or 'video' based on MIME type */
function getMediaType(file) {
    return file.type.startsWith('video/') ? 'video' : 'image';
}

/** Wire up gallery file input and drag-and-drop (accepts images + videos) */
function initGalleryInputs() {
    const input = document.getElementById('galleryFileInput');
    const dropArea = document.getElementById('galleryDropArea');
    if (!input || !dropArea) return;

    input.addEventListener('change', function () {
        Array.from(this.files).forEach(f => {
            if (!selectedGalleryFiles.find(x => x.name === f.name && x.size === f.size)) {
                selectedGalleryFiles.push(f);
            }
        });
        this.value = '';
        renderGalleryPreviews();
    });

    // Drag-and-drop (accept images and videos)
    dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('dragover'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', e => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        Array.from(e.dataTransfer.files).forEach(f => {
            const ok = f.type.startsWith('image/') || f.type.startsWith('video/');
            if (ok && !selectedGalleryFiles.find(x => x.name === f.name && x.size === f.size)) {
                selectedGalleryFiles.push(f);
            }
        });
        renderGalleryPreviews();
    });
}

/** Render preview thumbnails / video clips for newly selected gallery files */
function renderGalleryPreviews() {
    const area = document.getElementById('galleryNewPreviews');
    area.innerHTML = '';
    selectedGalleryFiles.forEach((file, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'gallery-new-preview-item';

        const removeBtn = `<button type="button" class="remove-btn" title="Hapus">&#10005;</button>`;

        if (getMediaType(file) === 'video') {
            const url = URL.createObjectURL(file);
            wrap.innerHTML = `<video src="${url}" muted playsinline></video>
                <span style="position:absolute;bottom:3px;left:3px;background:rgba(0,0,0,0.6);color:white;font-size:0.65rem;padding:1px 4px;border-radius:3px;">VIDEO</span>
                ${removeBtn}`;
        } else {
            const reader = new FileReader();
            reader.onload = ev => {
                wrap.innerHTML = `<img src="${ev.target.result}" alt="preview">${removeBtn}`;
                wrap.querySelector('.remove-btn').onclick = () => {
                    selectedGalleryFiles.splice(i, 1);
                    renderGalleryPreviews();
                };
            };
            reader.readAsDataURL(file);
        }

        // Attach remove for video (img path attaches inside reader.onload)
        if (getMediaType(file) === 'video') {
            wrap.querySelector('.remove-btn')?.addEventListener('click', () => {
                selectedGalleryFiles.splice(i, 1);
                renderGalleryPreviews();
            });
            // wait for DOM to be ready then attach
            setTimeout(() => {
                const btn = wrap.querySelector('.remove-btn');
                if (btn) btn.onclick = () => { selectedGalleryFiles.splice(i, 1); renderGalleryPreviews(); };
            }, 0);
        }

        area.appendChild(wrap);
    });
}

/** Load gallery media from Supabase and render admin grid */
async function loadGallery() {
    const grid = document.getElementById('galleryAdminGrid');
    const countEl = document.getElementById('galleryCount');
    if (!grid) return;

    grid.innerHTML = '<p style="color:#94a3b8;font-size:0.9rem;">Memuat media...</p>';

    const { data, error } = await supabaseClient
        .from('gallery')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        grid.innerHTML = `<p style="color:#dc2626;font-size:0.9rem;">Gagal memuat galeri: ${error.message}</p>`;
        return;
    }

    if (countEl) countEl.textContent = `${data.length} item`;

    if (!data || data.length === 0) {
        grid.innerHTML = '<p style="color:#94a3b8;font-size:0.9rem;grid-column:1/-1;text-align:center;padding:2rem 0;">Belum ada media di galeri. Upload foto atau video pertama kamu!</p>';
        return;
    }

    grid.innerHTML = '';
    data.forEach(item => {
        const isVideo = item.media_type === 'video';
        const el = document.createElement('div');
        el.className = 'gallery-admin-item';

        const mediaEl = isVideo
            ? `<video src="${item.image_url}" muted playsinline preload="metadata"
                    onerror="this.parentElement.style.background='#fee2e2';"></video>
               <span class="media-type-badge">&#127916; VIDEO</span>`
            : `<img src="${item.image_url}" alt="${item.caption || 'Galeri'}" loading="lazy"
                    onerror="this.src='https://via.placeholder.com/200x200.png?text=Error';">`;

        el.innerHTML = `
            ${mediaEl}
            <div class="gallery-item-overlay">
                <span class="gallery-caption">${item.caption || '(tanpa keterangan)'}</span>
                <button class="btn-delete-gallery" onclick="deleteGallery('${item.id}', this)">&#128465; Hapus</button>
            </div>
        `;
        grid.appendChild(el);
    });
}

/** Upload selected gallery files to Supabase storage and insert into gallery table */
async function saveGallery() {
    if (selectedGalleryFiles.length === 0) {
        alert('Pilih setidaknya satu foto atau video terlebih dahulu.');
        return;
    }

    const btn = document.getElementById('saveGalleryBtn');
    const progress = document.getElementById('galleryUploadProgress');
    const progressBar = document.getElementById('galleryProgressBar');
    const progressText = document.getElementById('galleryProgressText');
    const caption = document.getElementById('galleryCaption').value.trim();

    btn.disabled = true;
    btn.innerText = 'Mengupload...';
    progress.style.display = 'block';

    try {
        const total = selectedGalleryFiles.length;
        for (let i = 0; i < total; i++) {
            const file = selectedGalleryFiles[i];
            const ext = file.name.split('.').pop();
            const mediaType = getMediaType(file);
            const prefix = mediaType === 'video' ? 'gallery_vid' : 'gallery_img';
            const path = `${prefix}_${Date.now()}_${i}.${ext}`;

            progressText.textContent = `Mengupload ${mediaType === 'video' ? 'video' : 'foto'} ${i + 1} dari ${total}...`;
            progressBar.style.width = `${Math.round((i / total) * 100)}%`;

            // Upload to Supabase storage bucket 'photos'
            const { error: upErr } = await supabaseClient.storage
                .from('photos')
                .upload(path, file, { cacheControl: '3600', upsert: false });
            if (upErr) throw upErr;

            const { data: pub } = supabaseClient.storage.from('photos').getPublicUrl(path);

            // Insert row into gallery table with media_type
            const { error: insErr } = await supabaseClient.from('gallery').insert([{
                image_url: pub.publicUrl,
                caption: caption || null,
                media_type: mediaType,
            }]);
            if (insErr) throw insErr;

            progressBar.style.width = `${Math.round(((i + 1) / total) * 100)}%`;
        }

        progressText.textContent = 'Semua media berhasil diupload!';
        progressBar.style.width = '100%';

        // Reset form
        selectedGalleryFiles = [];
        document.getElementById('galleryNewPreviews').innerHTML = '';
        document.getElementById('galleryCaption').value = '';

        setTimeout(() => {
            progress.style.display = 'none';
            progressBar.style.width = '0%';
        }, 1800);

        await loadGallery();
        alert(`${total} file berhasil diupload ke Galeri Kegiatan!`);

    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan saat upload: ' + (err.message || JSON.stringify(err)));
    } finally {
        btn.disabled = false;
        btn.innerText = 'Upload ke Galeri';
    }
}

/** Delete a gallery item from the database */
async function deleteGallery(id, btnEl) {
    if (!confirm('Yakin ingin menghapus media ini dari galeri?')) return;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Menghapus...'; }

    const { error } = await supabaseClient.from('gallery').delete().eq('id', id);
    if (error) {
        alert('Gagal menghapus media: ' + error.message);
        if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '&#128465; Hapus'; }
    } else {
        await loadGallery();
    }
}

// =======================
// EKSKUL LOGIC
// =======================

let editEkskulId = null;
let existingEkskulImgUrls = [];
let selectedEkskulImgFiles = [];

function initEkskulFileInputs() {
    const photoInput = document.getElementById('ekskulPhoto');
    if (!photoInput) return;
    
    photoInput.addEventListener('change', function () {
        Array.from(this.files).forEach(f => {
            if (!selectedEkskulImgFiles.find(x => x.name === f.name && x.size === f.size)) {
                selectedEkskulImgFiles.push(f);
            }
        });
        this.value = '';
        renderEkskulImgPreviews();
    });
}

function renderEkskulImgPreviews() {
    const area = document.getElementById('ekskulImgPreviewArea');
    if (!area) return;
    area.innerHTML = '';
    selectedEkskulImgFiles.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = ev => {
            const wrap = document.createElement('div');
            wrap.className = 'preview-img-item';
            wrap.innerHTML = `<img src="${ev.target.result}" alt="preview">
                <button type="button" class="remove-btn" title="Hapus">&#10005;</button>`;
            wrap.querySelector('.remove-btn').onclick = () => {
                selectedEkskulImgFiles.splice(i, 1);
                renderEkskulImgPreviews();
            };
            area.appendChild(wrap);
        };
        reader.readAsDataURL(file);
    });
}

function renderExistingEkskulImgs() {
    const list = document.getElementById('existingEkskulImgList');
    if (!list) return;
    if (!existingEkskulImgUrls.length) { list.style.display = 'none'; return; }
    list.style.display = 'flex';
    list.innerHTML = '';
    existingEkskulImgUrls.forEach((url, i) => {
        const chip = document.createElement('div');
        chip.className = 'existing-img-chip';
        chip.innerHTML = `<img src="${url}" alt="img">
            <button type="button" class="remove-existing" title="Hapus">&#10005;</button>`;
        chip.querySelector('.remove-existing').onclick = () => {
            existingEkskulImgUrls.splice(i, 1);
            renderExistingEkskulImgs();
        };
        list.appendChild(chip);
    });
}

function clearEkskulFileSelections() {
    selectedEkskulImgFiles = [];
    const input = document.getElementById('ekskulPhoto');
    if (input) input.value = '';
    const area = document.getElementById('ekskulImgPreviewArea');
    if (area) area.innerHTML = '';
}

async function loadEkskul() {
    const tbody = document.getElementById('ekskulTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5">Memuat data...</td></tr>';
    
    const { data, error } = await supabaseClient.from('extracurricular').select('*').order('order_index', { ascending: true });
    
    if (error) {
        console.error('Error loading extracurricular:', error);
        tbody.innerHTML = `<tr><td colspan="5" style="color:#dc2626">Gagal memuat data: ${error.message}</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Belum ada data ekstrakurikuler.</td></tr>';
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        const numPhotos = (item.image_urls && Array.isArray(item.image_urls)) ? item.image_urls.length : 0;
        const dataAttr = encodeURIComponent(JSON.stringify(item));
        
        tr.innerHTML = `
            <td><div style="width:36px;height:36px;background:#fef2f2;color:#da251c;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;"><i class="${item.icon}"></i></div></td>
            <td><strong>${item.name}</strong><br><small style="color:#64748b">${item.description ? item.description.substring(0, 45) + '...' : ''}</small></td>
            <td><span style="background:#e0f2fe;color:#0369a1;font-weight:700;padding:2px 8px;border-radius:12px;font-size:0.8rem;">📷 ${numPhotos} foto</span></td>
            <td>${item.order_index || 99}</td>
            <td>
                <button onclick="editEkskul('${item.id}', '${dataAttr}')" style="background: #eab308; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
                <button onclick="deleteEkskul('${item.id}')" style="background: #dc2626; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function editEkskul(id, encodedData) {
    const item = JSON.parse(decodeURIComponent(encodedData));
    editEkskulId = id;

    existingEkskulImgUrls = Array.isArray(item.image_urls) ? [...item.image_urls] : [];
    clearEkskulFileSelections();

    document.getElementById('ekskulName').value = item.name || '';
    document.getElementById('ekskulIcon').value = item.icon || 'fas fa-star';
    document.getElementById('ekskulDesc').value = item.description || '';
    document.getElementById('ekskulOrder').value = item.order_index || 99;

    renderExistingEkskulImgs();

    const btn = document.getElementById('saveEkskulBtn');
    btn.innerText = 'Update Ekstrakurikuler';
    btn.style.background = '#eab308';

    if (!document.getElementById('cancelEditEkskulBtn')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelEditEkskulBtn';
        cancelBtn.type = 'button';
        cancelBtn.innerText = 'Batal Edit';
        cancelBtn.style.cssText = 'width: 100%; background: #64748b; color: white; border: none; padding: 1rem; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 0.5rem; transition: 0.3s;';
        cancelBtn.onclick = cancelEditEkskul;
        btn.parentNode.appendChild(cancelBtn);
    }

    showTab('tabEkskul');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditEkskul() {
    editEkskulId = null;
    existingEkskulImgUrls = [];
    clearEkskulFileSelections();
    document.getElementById('ekskulForm').reset();
    const existingList = document.getElementById('existingEkskulImgList');
    if (existingList) { existingList.style.display = 'none'; existingList.innerHTML = ''; }

    const btn = document.getElementById('saveEkskulBtn');
    btn.innerText = 'Simpan Ekstrakurikuler';
    btn.style.background = '#da251c';

    const cancelBtn = document.getElementById('cancelEditEkskulBtn');
    if (cancelBtn) cancelBtn.remove();
}

async function saveEkskul(e) {
    e.preventDefault();
    const btn = document.getElementById('saveEkskulBtn');
    btn.disabled = true;

    try {
        const name = document.getElementById('ekskulName').value.trim();
        const icon = document.getElementById('ekskulIcon').value.trim() || 'fas fa-star';
        const description = document.getElementById('ekskulDesc').value.trim();
        const order_index = parseInt(document.getElementById('ekskulOrder').value) || 99;

        // Upload new photos to storage 'photos'
        const newImageUrls = [];
        for (let i = 0; i < selectedEkskulImgFiles.length; i++) {
            btn.innerText = `Upload foto ${i + 1}/${selectedEkskulImgFiles.length}...`;
            const file = selectedEkskulImgFiles[i];
            const ext = file.name.split('.').pop();
            const path = `ekskul_img_${Date.now()}_${i}.${ext}`;
            const { error: upErr } = await supabaseClient.storage.from('photos').upload(path, file);
            if (upErr) throw upErr;
            const { data: pub } = supabaseClient.storage.from('photos').getPublicUrl(path);
            newImageUrls.push(pub.publicUrl);
        }

        const finalImageUrls = [...existingEkskulImgUrls, ...newImageUrls];

        btn.innerText = 'Menyimpan...';

        const ekskulData = {
            name,
            icon,
            description,
            order_index,
            image_urls: finalImageUrls,
        };

        if (editEkskulId) {
            const { error } = await supabaseClient.from('extracurricular').update(ekskulData).eq('id', editEkskulId);
            if (error) throw error;
            alert('Ekstrakurikuler berhasil diupdate!');
            cancelEditEkskul();
        } else {
            const { error } = await supabaseClient.from('extracurricular').insert([ekskulData]);
            if (error) throw error;
            document.getElementById('ekskulForm').reset();
            clearEkskulFileSelections();
            alert('Ekstrakurikuler berhasil ditambahkan!');
        }

        loadEkskul();

    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan: ' + (err.message || JSON.stringify(err)));
    } finally {
        btn.innerText = editEkskulId ? 'Update Ekstrakurikuler' : 'Simpan Ekstrakurikuler';
        btn.disabled = false;
    }
}

async function deleteEkskul(id) {
    if (!confirm('Yakin ingin menghapus ekstrakurikuler ini?')) return;
    const { error } = await supabaseClient.from('extracurricular').delete().eq('id', id);
    if (error) {
        alert('Gagal menghapus ekstrakurikuler: ' + error.message);
    } else {
        loadEkskul();
    }
}

/* ==========================================================================
   AI Memory & Knowledge Base Handlers (Supabase ai_knowledge)
   ========================================================================== */
let editingMemoryId = null;

async function loadAIMemory() {
    const tbody = document.getElementById('aiMemoryTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4">Memuat data memori...</td></tr>';

    try {
        const { data, error } = await supabaseClient
            .from('ai_knowledge')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        tbody.innerHTML = '';
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="color: #94a3b8; text-align: center;">Belum ada memori tambahan. Tambahkan memori di atas!</td></tr>';
            return;
        }

        data.forEach(item => {
            const tr = document.createElement('tr');
            const statusBadge = item.is_active
                ? '<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 12px; font-weight: 700; font-size: 0.78rem;">Aktif</span>'
                : '<span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 12px; font-weight: 700; font-size: 0.78rem;">Non-Aktif</span>';

            tr.innerHTML = `
                <td style="font-weight: 700;">${escapeHtml(item.topic)}</td>
                <td>${escapeHtml(item.content)}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display: flex; gap: 4px;">
                        <button onclick="toggleAIMemoryStatus('${item.id}', ${item.is_active})" style="background: ${item.is_active ? '#e2e8f0' : '#dcfce7'}; color: #1e293b; border: none; padding: 4px 8px; border-radius: 6px; font-size: 0.78rem; cursor: pointer;">${item.is_active ? 'Matikan' : 'Aktifkan'}</button>
                        <button onclick="editAIMemory('${item.id}')" style="background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 6px; font-size: 0.78rem; cursor: pointer;">Edit</button>
                        <button onclick="deleteAIMemory('${item.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 6px; font-size: 0.78rem; cursor: pointer;">Hapus</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error loading AI Memory:', err);
        tbody.innerHTML = `<tr><td colspan="4" style="color: #ef4444;">Gagal memuat data memori: ${err.message}</td></tr>`;
    }
}

async function saveAIMemory(e) {
    e.preventDefault();
    const btn = document.getElementById('saveAIMemoryBtn');
    const topic = document.getElementById('aiMemoryTopic').value.trim();
    const content = document.getElementById('aiMemoryContent').value.trim();
    const isActive = document.getElementById('aiMemoryIsActive').checked;
    const memId = document.getElementById('aiMemoryId').value;

    if (!topic || !content) {
        alert('Topik dan Isi Memori harus diisi!');
        return;
    }

    btn.disabled = true;
    btn.innerText = 'Menyimpan...';

    try {
        if (memId) {
            const { error } = await supabaseClient
                .from('ai_knowledge')
                .update({ topic, content, is_active: isActive, updated_at: new Date() })
                .eq('id', memId);
            if (error) throw error;
        } else {
            const { error } = await supabaseClient
                .from('ai_knowledge')
                .insert([{ topic, content, is_active: isActive }]);
            if (error) throw error;
        }

        document.getElementById('aiMemoryForm').reset();
        document.getElementById('aiMemoryId').value = '';
        btn.innerText = 'Simpan Memori';
        alert('Memori KaliBot berhasil disimpan!');
        loadAIMemory();
    } catch (err) {
        console.error('Error saving AI Memory:', err);
        alert('Gagal menyimpan memori: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Simpan Memori';
    }
}

async function editAIMemory(id) {
    const { data, error } = await supabaseClient
        .from('ai_knowledge')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) {
        alert('Gagal mengambil data memori!');
        return;
    }

    document.getElementById('aiMemoryId').value = data.id;
    document.getElementById('aiMemoryTopic').value = data.topic;
    document.getElementById('aiMemoryContent').value = data.content;
    document.getElementById('aiMemoryIsActive').checked = data.is_active;

    document.getElementById('saveAIMemoryBtn').innerText = 'Update Memori';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function toggleAIMemoryStatus(id, currentStatus) {
    const { error } = await supabaseClient
        .from('ai_knowledge')
        .update({ is_active: !currentStatus, updated_at: new Date() })
        .eq('id', id);

    if (error) {
        alert('Gagal mengubah status: ' + error.message);
    } else {
        loadAIMemory();
    }
}

async function deleteAIMemory(id) {
    if (!confirm('Yakin ingin menghapus memori ini dari KaliBot?')) return;
    const { error } = await supabaseClient
        .from('ai_knowledge')
        .delete()
        .eq('id', id);

    if (error) {
        alert('Gagal menghapus memori: ' + error.message);
    } else {
        loadAIMemory();
    }
}

/* ==========================================================================
   AI Gateway Settings Handlers
   ========================================================================== */
function loadAISettingsIntoForm() {
    if (!window.AIService) return;
    const settings = window.AIService.getAISettings();
    
    if (document.getElementById('aiBaseUrl')) {
        document.getElementById('aiBaseUrl').value = settings.baseUrl || '';
        document.getElementById('aiApiKey').value = settings.apiKey || '';
        document.getElementById('aiModel').value = settings.model || '';
        document.getElementById('aiMaxTokens').value = settings.maxTokens || 1024;
    }
}

function saveAISettingsForm(e) {
    e.preventDefault();
    if (!window.AIService) return;

    const settings = {
        baseUrl: document.getElementById('aiBaseUrl').value.trim(),
        apiKey: document.getElementById('aiApiKey').value.trim(),
        model: document.getElementById('aiModel').value.trim(),
        maxTokens: parseInt(document.getElementById('aiMaxTokens').value) || 1024
    };

    if (window.AIService.saveAISettings(settings)) {
        alert('Pengaturan AI berhasil disimpan!');
    } else {
        alert('Gagal menyimpan pengaturan AI.');
    }
}

async function testAIConnection() {
    const resBox = document.getElementById('aiTestResult');
    resBox.style.display = 'block';
    resBox.style.background = '#f1f5f9';
    resBox.style.color = '#334155';
    resBox.innerText = 'Mengirim pesan uji koneksi ke PecutOpus AI Gateway...';

    const testConfig = {
        baseUrl: document.getElementById('aiBaseUrl').value.trim(),
        apiKey: document.getElementById('aiApiKey').value.trim(),
        model: document.getElementById('aiModel').value.trim(),
        maxTokens: 100
    };

    try {
        const reply = await window.AIService.sendAIChatRequest(
            [{ role: 'user', content: 'Halo PecutOpus, respon singkat "Koneksi Berhasil"' }],
            testConfig
        );
        resBox.style.background = '#dcfce7';
        resBox.style.color = '#166534';
        resBox.innerHTML = `<strong>Koneksi Berhasil! ✅</strong><br>Jawaban AI: <em>${escapeHtml(reply)}</em>`;
    } catch (err) {
        resBox.style.background = '#fee2e2';
        resBox.style.color = '#991b1b';
        resBox.innerHTML = `<strong>Koneksi Gagal ❌</strong><br>${escapeHtml(err.message)}`;
    }
}

/* ==========================================================================
   AI News Generator Handlers
   ========================================================================== */
async function generateNewsWithAI() {
    const promptInput = document.getElementById('aiNewsPrompt');
    const promptText = promptInput ? promptInput.value.trim() : '';

    if (!promptText) {
        alert('Silakan masukkan draf atau poin singkat berita terlebih dahulu pada kotak AI Assistant.');
        if (promptInput) promptInput.focus();
        return;
    }

    const btn = event.target;
    const origText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '✨ Membuat...';

    try {
        const result = await window.AIService.generateAINews(promptText);
        if (result.title) document.getElementById('newsTitle').value = result.title;
        if (result.content) document.getElementById('newsContent').value = result.content;
        
        if (result.content && document.getElementById('newsDesc')) {
            document.getElementById('newsDesc').value = result.content.substring(0, 150) + '...';
        }

        if (document.getElementById('newsDate')) {
            const today = new Date();
            const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            document.getElementById('newsDate').value = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
        }

        alert('Berita berhasil dibuat oleh AI! Anda dapat memeriksa dan mengedit kembali isi berita di form.');
    } catch (err) {
        console.error('Error generating AI news:', err);
        alert('Gagal membuat berita AI: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = origText;
    }
}

async function polishNewsContentWithAI() {
    const contentEl = document.getElementById('newsContent');
    const text = contentEl ? contentEl.value.trim() : '';

    if (!text) {
        alert('Tuliskan teks pada Isi Berita Lengkap terlebih dahulu untuk dirapikan.');
        if (contentEl) contentEl.focus();
        return;
    }

    const btn = event.target;
    const origText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '📝 Merapikan...';

    try {
        const polished = await window.AIService.polishAIText(text);
        contentEl.value = polished;
        alert('Teks berita berhasil dirapikan oleh AI!');
    } catch (err) {
        console.error('Error polishing text:', err);
        alert('Gagal merapikan teks: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = origText;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


