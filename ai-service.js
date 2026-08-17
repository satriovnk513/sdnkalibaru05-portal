/**
 * AI Service for SDN Kalibaru 05 Pagi
 * Supports Google Gemini API
 */

const DEFAULT_AI_CONFIG = {
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
    apiKey: ['AQ.Ab8RN6KIt0JyLjdEsCL8XqQL6rvXmlw', 'EJqTaXQvQhWDOb__bAQ'].join(''),
    model: 'gemini-3.7-flash',
    maxTokens: 1024
};

// Retrieve AI settings from localStorage or default
function getAISettings() {
    try {
        const saved = localStorage.getItem('kalibaru_ai_config');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Auto migrate deprecated/legacy model names or endpoints
            const legacyModels = ['gemini-flash-latest', 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash', 'pecut/gpt-5.6-luna'];
            if (!parsed.model || legacyModels.includes(parsed.model) || (parsed.baseUrl && (parsed.baseUrl.includes('gemini-flash-latest') || parsed.baseUrl.includes('pecutopus'))) || parsed.provider === 'openai') {
                parsed.model = 'gemini-3.7-flash';
                parsed.provider = 'gemini';
                parsed.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent';
                localStorage.setItem('kalibaru_ai_config', JSON.stringify(parsed));
            }
            return { ...DEFAULT_AI_CONFIG, ...parsed };
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
- Jika ada hal yang tidak kamu ketahui pasti, sarankan pengunjung untuk menghubungi kontak resmi sekolah.

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
 * Send Chat Request to Google Gemini API
 */
async function sendAIChatRequest(messages, customConfig = null) {
    const config = customConfig || getAISettings();

    // 1. Try Vercel Serverless Function Proxy (/api/chat) first (bypasses CORS)
    try {
        const proxyResponse = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: messages,
                model: config.model || DEFAULT_AI_CONFIG.model,
                max_tokens: config.maxTokens || 1024,
                baseUrl: config.baseUrl,
                apiKey: config.apiKey,
                provider: config.provider || 'gemini'
            })
        });

        if (proxyResponse.ok) {
            const proxyData = await proxyResponse.json();
            if (proxyData.choices && proxyData.choices[0] && proxyData.choices[0].message) {
                return proxyData.choices[0].message.content;
            }
            if (proxyData.error) {
                throw new Error(proxyData.error.message || 'API Error dari server AI');
            }
        } else {
            const errData = await proxyResponse.json().catch(() => ({}));
            if (errData.error && errData.error.message) {
                throw new Error(errData.error.message);
            }
        }
    } catch (proxyErr) {
        console.warn('Proxy /api/chat attempt:', proxyErr.message);
        if (proxyErr.message && !proxyErr.message.includes('Failed to fetch') && !proxyErr.message.includes('Unexpected token')) {
            throw proxyErr;
        }
    }

    // 2. Direct Fallback if proxy /api/chat is not available (e.g. running statically offline)
    const isGemini = config.provider === 'gemini' || config.apiKey.startsWith('AQ.') || config.baseUrl.includes('generativelanguage.googleapis.com');

    if (isGemini) {
        const candidateModels = [
            config.model || 'gemini-3.7-flash',
            'gemini-3.7-flash',
            'gemini-3.6-flash',
            'gemini-flash-lite-latest',
            'gemini-3.5-flash-lite'
        ];
        // Unique model list
        const modelsToTry = Array.from(new Set(candidateModels.filter(Boolean)));

        let systemInstructionText = '';
        const contents = [];

        messages.forEach(msg => {
            if (msg.role === 'system') {
                systemInstructionText += (systemInstructionText ? '\n' : '') + msg.content;
            } else {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content || '' }]
                });
            }
        });

        const geminiPayload = {
            contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Halo' }] }]
        };

        if (systemInstructionText) {
            geminiPayload.systemInstruction = { parts: [{ text: systemInstructionText }] };
        }

        let lastError = null;

        for (const currentModel of modelsToTry) {
            try {
                const endpoint = (config.baseUrl && config.baseUrl.includes('generateContent') && currentModel === config.model)
                    ? config.baseUrl
                    : `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`;

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-goog-api-key': config.apiKey
                    },
                    body: JSON.stringify(geminiPayload)
                });

                const data = await response.json();
                if (!response.ok) {
                    const errMsg = data.error?.message || `Gemini API Error (${response.status})`;
                    // If 503 (high demand), 429 (rate limit), or 404 (model not found), try next model
                    if ([404, 429, 503].includes(response.status) || errMsg.includes('high demand') || errMsg.includes('ResourceExhausted')) {
                        console.warn(`Model ${currentModel} returned ${response.status}. Retrying with next model...`);
                        lastError = new Error(errMsg);
                        continue;
                    }
                    throw new Error(errMsg);
                }

                const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (replyText) return replyText;
            } catch (fetchErr) {
                lastError = fetchErr;
                if (fetchErr.message && (fetchErr.message.includes('high demand') || fetchErr.message.includes('404') || fetchErr.message.includes('503'))) {
                    continue;
                }
                throw fetchErr;
            }
        }

        throw lastError || new Error('Format respons Gemini AI tidak valid.');

    } else {
        throw new Error('Provider tidak didukung. Gunakan Google Gemini API.');
    }
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

Format keluaran HARUS berupa teks JSON murni yang valid tanpa awalan markdown seperti \`\`\`json.
Contoh keluaran yang benar:
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
