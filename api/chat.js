/**
 * Vercel Serverless Function Proxy for AI API (Google Gemini API)
 *
 * SECURITY: API key must be set in Vercel Environment Variables as GEMINI_API_KEY.
 * Never hardcode API keys in source code.
 *
 * Abuse controls (this endpoint spends the school's Gemini quota):
 *  - only browser requests from the school's own origins are accepted
 *  - request shape and size are validated before any upstream call
 *  - best-effort per-IP rate limit (in-memory, per serverless instance; for a hard
 *    global limit add a Vercel Firewall rate-limit rule on /api/chat)
 *  - output tokens are capped server-side and the model list is fixed server-side
 */

const PRODUCTION_ORIGINS = ['https://sdnkalibaru05.sch.id', 'https://www.sdnkalibaru05.sch.id'];

// Tried in order; the client cannot choose arbitrary models.
const MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.7-flash',
    'gemini-3.6-flash'
];

const LIMITS = {
    maxMessages: 20,
    maxMessageChars: 24000,
    maxTotalChars: 60000,
    maxOutputTokens: 4096,
    attemptTimeoutMs: 25000,
    totalBudgetMs: 50000,
    rateWindowMs: 5 * 60 * 1000,
    rateMaxRequests: 20
};

const ROLES = new Set(['system', 'user', 'assistant']);
const rateBuckets = new Map();

function allowedOrigins() {
    const origins = [...PRODUCTION_ORIGINS];
    // Vercel preview/branch deployments call the API from their own host.
    if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);
    if (process.env.VERCEL_BRANCH_URL) origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
    return origins;
}

function isLocalDevOrigin(origin) {
    return process.env.VERCEL_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
}

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
    return first.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function rateLimited(ip, now = Date.now()) {
    const bucket = rateBuckets.get(ip);
    if (!bucket || now - bucket.start >= LIMITS.rateWindowMs) {
        rateBuckets.set(ip, { start: now, count: 1 });
        if (rateBuckets.size > 5000) {
            for (const [key, value] of rateBuckets) {
                if (now - value.start >= LIMITS.rateWindowMs) rateBuckets.delete(key);
            }
        }
        return false;
    }
    bucket.count += 1;
    return bucket.count > LIMITS.rateMaxRequests;
}

function sendError(res, status, type, message) {
    return res.status(status).json({ error: { type, message } });
}

/** Returns { systemText, contents } or { error } */
function validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return { error: 'Format pesan tidak valid.' };
    }
    if (messages.length > LIMITS.maxMessages) {
        return { error: 'Terlalu banyak pesan dalam satu permintaan.' };
    }
    let total = 0;
    let systemText = '';
    const contents = [];
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object' || !ROLES.has(msg.role) || typeof msg.content !== 'string') {
            return { error: 'Format pesan tidak valid.' };
        }
        if (msg.content.length > LIMITS.maxMessageChars) {
            return { error: 'Pesan terlalu panjang.' };
        }
        total += msg.content.length;
        if (msg.role === 'system') {
            systemText += (systemText ? '\n' : '') + msg.content;
        } else if (msg.content.trim()) {
            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        }
    }
    if (total > LIMITS.maxTotalChars) {
        return { error: 'Permintaan terlalu panjang.' };
    }
    if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
        return { error: 'Pertanyaan tidak boleh kosong.' };
    }
    return { systemText, contents };
}

function isRetryable(status, message) {
    if ([404, 429, 500, 502, 503, 504].includes(status)) return true;
    // Gemini reports some quota/availability problems as 400.
    return status === 400 && /high demand|ResourceExhausted|prepayment|credits are depleted|no longer available|not found/i.test(message);
}

export default async function handler(req, res) {
    const origin = req.headers.origin;
    const originAllowed = allowedOrigins().includes(origin) || isLocalDevOrigin(origin);

    if (originAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
        return res.status(originAllowed ? 204 : 403).end();
    }

    if (req.method !== 'POST') {
        return sendError(res, 405, 'method_not_allowed', 'Method Not Allowed');
    }

    // Browsers always send Origin on POST; requests from other sites or bare scripts are refused.
    if (!originAllowed) {
        return sendError(res, 403, 'forbidden_origin', 'Akses ditolak.');
    }

    if (rateLimited(clientIp(req))) {
        res.setHeader('Retry-After', String(Math.ceil(LIMITS.rateWindowMs / 1000)));
        return sendError(res, 429, 'rate_limited', 'Terlalu banyak permintaan. Silakan coba lagi beberapa menit lagi.');
    }

    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
        return sendError(res, 400, 'invalid_json', 'Format permintaan tidak valid.');
    }

    const validated = validateMessages(body && body.messages);
    if (validated.error) {
        return sendError(res, 400, 'invalid_request', validated.error);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return sendError(res, 500, 'config_error', 'API key belum dikonfigurasi di server.');
    }

    const geminiPayload = {
        contents: validated.contents,
        generationConfig: { maxOutputTokens: LIMITS.maxOutputTokens }
    };
    if (validated.systemText) {
        geminiPayload.systemInstruction = { parts: [{ text: validated.systemText }] };
    }

    const startedAt = Date.now();
    let lastError = null;

    for (const model of MODELS) {
        const remaining = LIMITS.totalBudgetMs - (Date.now() - startedAt);
        if (remaining <= 1000) break;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(LIMITS.attemptTimeoutMs, remaining));
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
                body: JSON.stringify(geminiPayload),
                signal: controller.signal
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                const message = data.error?.message || `Gemini API Error (${response.status})`;
                lastError = { status: response.status, type: data.error?.status || 'gemini_error', message };
                if (isRetryable(response.status, message)) {
                    console.warn(`[Proxy] Model ${model} returned ${response.status}. Trying next model...`);
                    continue;
                }
                console.error(`[Proxy] Model ${model} failed with ${response.status}: ${message}`);
                return sendError(res, 502, lastError.type, 'Layanan AI sedang bermasalah. Silakan coba lagi nanti.');
            }

            const replyText = (data.candidates?.[0]?.content?.parts || [])
                .map(part => (typeof part.text === 'string' ? part.text : ''))
                .join('');

            return res.status(200).json({
                choices: [{ message: { role: 'assistant', content: replyText } }]
            });
        } catch (err) {
            lastError = { status: 504, type: 'fetch_error', message: err.name === 'AbortError' ? 'timeout' : err.message };
            console.warn(`[Proxy] Model ${model} request failed: ${lastError.message}`);
        } finally {
            clearTimeout(timer);
        }
    }

    console.error('[Proxy] All Gemini models failed:', lastError);
    const status = lastError?.status === 429 ? 503 : 502;
    return sendError(res, status, lastError?.type || 'gemini_error', 'Layanan AI sedang sibuk atau tidak tersedia. Silakan coba lagi nanti.');
}
