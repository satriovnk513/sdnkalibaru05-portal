/**
 * Vercel Serverless Function Proxy for AI API (Google Gemini API)
 */

// SECURITY: API key must be set in Vercel Environment Variables as GEMINI_API_KEY
// Never hardcode API keys in source code

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    const allowedOrigins = ['https://sdnkalibaru05.sch.id', 'https://www.sdnkalibaru05.sch.id'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: { message: 'Method Not Allowed' } });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { messages, model, max_tokens, provider } = body || {};

        const targetApiKey = process.env.GEMINI_API_KEY;
        if (!targetApiKey) {
            return res.status(500).json({ error: { type: 'config_error', message: 'API key belum dikonfigurasi di server.' } });
        }
        const isGemini = true; // Only Gemini is supported

        if (isGemini) {
            // Google Gemini API Proxy with multi-model fallback
            const candidateModels = [
                'gemini-3.5-flash-lite',
                'gemini-flash-lite-latest',
                'gemini-3.7-flash',
                'gemini-3.6-flash',
                model
            ];
            const modelsToTry = Array.from(new Set(candidateModels.filter(Boolean)));

            let systemInstructionText = '';
            const contents = [];

            if (Array.isArray(messages)) {
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
            }

            const geminiPayload = {
                contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Halo' }] }]
            };

            if (systemInstructionText) {
                geminiPayload.systemInstruction = {
                    parts: [{ text: systemInstructionText }]
                };
            }

            let lastError = null;

            for (const currentModel of modelsToTry) {
                try {
                    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`;

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-goog-api-key': targetApiKey
                        },
                        body: JSON.stringify(geminiPayload)
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        const errorMsg = data.error?.message || `Gemini API Error (${response.status})`;
                        if (
                            [400, 404, 429, 503].includes(response.status) ||
                            errorMsg.includes('high demand') ||
                            errorMsg.includes('ResourceExhausted') ||
                            errorMsg.includes('prepayment') ||
                            errorMsg.includes('credits are depleted') ||
                            errorMsg.includes('no longer available') ||
                            errorMsg.includes('not found')
                        ) {
                            console.warn(`[Proxy] Model ${currentModel} returned ${response.status}. Retrying next model...`);
                            lastError = { status: response.status, message: errorMsg, type: data.error?.status || 'gemini_error' };
                            continue;
                        }
                        return res.status(response.status).json({
                            error: {
                                type: data.error?.status || 'gemini_error',
                                message: errorMsg
                            }
                        });
                    }

                    // Extract candidate text
                    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    
                    return res.status(200).json({
                        choices: [
                            {
                                message: {
                                    role: 'assistant',
                                    content: replyText
                                }
                            }
                        ]
                    });
                } catch (fetchErr) {
                    lastError = { status: 500, message: fetchErr.message, type: 'fetch_error' };
                    continue;
                }
            }

            return res.status(lastError?.status || 500).json({
                error: {
                    type: lastError?.type || 'gemini_error',
                    message: lastError?.message || 'Gagal menghubungi server Gemini AI.'
                }
            });

        } else {
            // Only Google Gemini API is supported
            return res.status(400).json({
                error: {
                    type: 'unsupported_provider',
                    message: 'Provider tidak didukung. Gunakan Google Gemini API.'
                }
            });
        }

    } catch (err) {
        console.error('Serverless Function Error:', err);
        return res.status(500).json({
            error: {
                type: 'internal_error',
                message: err.message || 'Gagal menghubungi server AI.'
            }
        });
    }
}
