/**
 * Vercel Serverless Function Proxy for AI API (Google Gemini API)
 */

const FALLBACK_GEMINI_KEY = ['AQ.Ab8RN6KIt0JyLjdEsCL8XqQL6rvXmlw', 'EJqTaXQvQhWDOb__bAQ'].join('');

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
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
        const { messages, model, max_tokens, baseUrl, apiKey, provider } = body || {};

        const targetApiKey = apiKey || process.env.GEMINI_API_KEY || FALLBACK_GEMINI_KEY;
        const isGemini = provider === 'gemini' || targetApiKey.startsWith('AQ.') || (baseUrl && baseUrl.includes('generativelanguage.googleapis.com'));

        if (isGemini) {
            // Google Gemini API Proxy
            const modelName = model || 'gemini-flash-latest';
            const endpoint = (baseUrl && baseUrl.includes('generateContent'))
                ? baseUrl
                : `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

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
