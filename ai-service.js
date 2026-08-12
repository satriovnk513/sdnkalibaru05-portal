/**
 * AI Service for SDN Kalibaru 05 Pagi
 * Powered by PecutOpus Gateway / OpenAI API compatible
 */

const DEFAULT_AI_CONFIG = {
    baseUrl: 'https://api.pecutopus.web.id/v1',
    apiKey: 'sk-pecut-4o8p60FiiCvlLTyH3FVqSPbwjLnOv5ogVsk3eA51YIk',
    model: 'pecut/gpt-5.6-luna',
    maxTokens: 1024
};

// Retrieve AI settings from localStorage or default
function getAISettings() {
    try {
        const saved = localStorage.getItem('kalibaru_ai_config');
        if (saved) {
            return { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.error('Error reading AI settings:', e);
    }
    return DEFAULT_AI_CONFIG;
}

// Save AI settings
function saveAISettings(settings) {
    try {
        localStorage.setItem('kalibaru_ai_config', JSON.stringify(settings));
        return true;
    } catch (e) {
        console.error('Error saving AI settings:', e);
        return false;
    }
}

// Fetch dynamic context from Supabase (ai_knowledge, news, staff, ekskul)
async function buildSchoolSystemPrompt() {
    let basePrompt = `Kamu adalah KaliBot, Asisten AI resmi yang ramah, sopan, dan cerdas untuk portal sekolah SDN Kalibaru 05 Pagi (Sekolah Penggerak di Cilincing, Jakarta Utara).

Tugas utama kamu adalah membantu orang tua murid, calon pendaftar (PPDB), siswa, dan masyarakat umum dengan menjawab pertanyaan tentang SDN Kalibaru 05 Pagi.

Gaya Bahasa:
- Ramah, sopan, antusias, mudah dipahami (cocok untuk lingkungan sekolah dasar).
- Gunakan bahasa Indonesia yang baik dan menarik.
- Jika ada hal yang tidak kamu ketahui pasti, sarankan pengantar untuk menghubungi kontak resmi sekolah.

BERIKUT DATA RESMI DAN MEMORI PENGETAHUAN SEKOLAH TERBARU:
- Nama Sekolah: SDN Kalibaru 05 Pagi (Sekolah Penggerak)
- Lokasi: Kalibaru, Kecamatan Cilincing, Jakarta Utara, DKI Jakarta.
`;

    // 1. Fetch Dynamic Knowledge / Memories from Supabase ai_knowledge
    try {
        if (window.supabaseClient) {
            const { data: memories, error: memErr } = await window.supabaseClient
                .from('ai_knowledge')
                .select('*')
                .eq('is_active', true);

            if (!memErr && memories && memories.length > 0) {
                basePrompt += `\n--- MEMORI & INFORMASI TAMBAHAN DARI ADMIN SEKOLAH ---\n`;
                memories.forEach(mem => {
                    basePrompt += `- [${mem.topic}]: ${mem.content}\n`;
                });
            }
        }
    } catch (err) {
        console.warn('Could not fetch ai_knowledge memories:', err);
    }

    // 2. Fetch Extracurriculars
    try {
        if (window.supabaseClient) {
            const { data: ekskuls } = await window.supabaseClient
                .from('extracurricular')
                .select('title, description');
            if (ekskuls && ekskuls.length > 0) {
                basePrompt += `\n--- KEGIATAN EKSTRAKURIKULER ---\n`;
                ekskuls.forEach(e => {
                    basePrompt += `- ${e.title}: ${e.description || 'Kegiatan ekstrakurikuler sekolah'}\n`;
                });
            }
        }
    } catch (err) {
        console.warn('Could not fetch ekskuls for AI:', err);
    }

    // 3. Fetch Recent News / Announcements
    try {
        if (window.supabaseClient) {
            const { data: newsList } = await window.supabaseClient
                .from('news')
                .select('title, category, created_at')
                .order('created_at', { ascending: false })
                .limit(5);
            if (newsList && newsList.length > 0) {
                basePrompt += `\n--- BERITA & PENGUMUMAN TERBARU ---\n`;
                newsList.forEach(n => {
                    basePrompt += `- ${n.title} (${n.category || 'Berita'})\n`;
                });
            }
        }
    } catch (err) {
        console.warn('Could not fetch news for AI:', err);
    }

    // 4. Fetch Staff / Principal
    try {
        if (window.supabaseClient) {
            const { data: staffList } = await window.supabaseClient
                .from('staff')
                .select('name, role');
            if (staffList && staffList.length > 0) {
                basePrompt += `\n--- DEWAN GURU & STAF ---\n`;
                staffList.forEach(s => {
                    basePrompt += `- ${s.name} (${s.role})\n`;
                });
            }
        }
    } catch (err) {
        console.warn('Could not fetch staff for AI:', err);
    }

    return basePrompt;
}

/**
 * Send Chat Completion Request to PecutOpus / OpenAI endpoint
 */
async function sendAIChatRequest(messages, customConfig = null) {
    const config = customConfig || getAISettings();
    const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model || DEFAULT_AI_CONFIG.model,
            messages: messages,
            max_tokens: config.maxTokens || 1024,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API Request Failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
    }
    throw new Error('Format respons AI tidak valid.');
}

/**
 * High level method for KaliBot chat
 */
async function askKaliBot(userQuestion, chatHistory = []) {
    const systemPrompt = await buildSchoolSystemPrompt();
    
    const messages = [
        { role: 'system', content: systemPrompt }
    ];

    // Append history (limit to last 6 messages)
    const recentHistory = chatHistory.slice(-6);
    recentHistory.forEach(msg => {
        messages.push({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.text
        });
    });

    messages.push({ role: 'user', content: userQuestion });

    return await sendAIChatRequest(messages);
}

/**
 * High level method for News Generation (Admin)
 */
async function generateAINews(topicNotes) {
    const messages = [
        {
            role: 'system',
            content: `Kamu adalah asisten penulis berita profesional untuk portal berita sekolah SDN Kalibaru 05 Pagi. 
Tugasmu adalah membuat draf berita sekolah yang lengkap, menarik, rapi, dan sesuai ejaan resmi Bahasa Indonesia berdasarkan poin-poin yang diberikan oleh admin/guru.

Format keluaran HARUS dalam JSON persis seperti berikut tanpa teks pembungkus lain:
{
  "title": "Judul Berita Menarik & Formal",
  "category": "Pengumuman / Kegiatan / Prestasi",
  "content": "Isi lengkap berita dalam beberapa paragraf yang rapi dan komunikatif."
}`
        },
        {
            role: 'user',
            content: `Tolong buatkan draf berita dari poin-poin berikut: ${topicNotes}`
        }
    ];

    const rawResponse = await sendAIChatRequest(messages);
    try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(rawResponse);
    } catch (e) {
        return {
            title: "Berita Kegiatan SDN Kalibaru 05",
            category: "Kegiatan",
            content: rawResponse
        };
    }
}

/**
 * High level method for Text Polish (Admin)
 */
async function polishAIText(originalText) {
    const messages = [
        {
            role: 'system',
            content: 'Kamu adalah editor bahasa formal. Rapikan tata bahasa, ejaan (PUEBI), serta struktur kalimat berikut agar tampak profesional untuk portal berita sekolah.'
        },
        {
            role: 'user',
            content: originalText
        }
    ];

    return await sendAIChatRequest(messages);
}

/**
 * High level method for Summarization (Public Detail Berita)
 */
async function summarizeAIText(newsText) {
    const messages = [
        {
            role: 'system',
            content: 'Ringkas berita berikut menjadi 3 poin utama yang singkat, jelas, dan mudah dipahami oleh siswa & wali murid.'
        },
        {
            role: 'user',
            content: newsText
        }
    ];

    return await sendAIChatRequest(messages);
}

// Make globally accessible
window.AIService = {
    getAISettings,
    saveAISettings,
    askKaliBot,
    generateAINews,
    polishAIText,
    summarizeAIText,
    sendAIChatRequest,
    DEFAULT_AI_CONFIG
};
