/**
 * Vercel Serverless Function Proxy for AI API
 * Bypasses browser CORS restrictions and secures API requests.
 */

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
        const { messages, model, max_tokens, baseUrl, apiKey } = body || {};

        const targetBaseUrl = (baseUrl || process.env.AI_BASE_URL || 'https://api.pecutopus.web.id/v1').replace(/\/+$/, '');
        const targetApiKey = apiKey || process.env.AI_API_KEY || 'sk-pecut-4o8p60FiiCvlLTyH3FVqSPbwjLnOv5ogVsk3eA51YIk';
        const targetModel = model || 'pecut/gpt-5.6-luna';

        const endpoint = `${targetBaseUrl}/chat/completions`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${targetApiKey}`
            },
            body: JSON.stringify({
                model: targetModel,
                messages: messages || [],
                max_tokens: max_tokens || 1024,
                temperature: 0.7
            })
        });

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data.error?.message || data.message || `API Error (${response.status})`;
            return res.status(response.status).json({
                error: {
                    type: data.error?.type || 'api_error',
                    message: errorMsg
                }
            });
        }

        return res.status(200).json(data);
    } catch (err) {
        console.error('Serverless Function Error:', err);
        return res.status(500).json({
            error: {
                type: 'internal_error',
                message: err.message || 'Gagal menghubungi gateway AI.'
            }
        });
    }
}
