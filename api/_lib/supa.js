// Helper bersama untuk API absensi (login guru, akun guru).
// SUPABASE_SERVICE_ROLE_KEY hanya dibaca dari environment Vercel; tidak pernah
// dicetak, dikirim ke browser, atau ditulis ke log.

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wwpbghdepykfqgzhyvmh.supabase.co';
// Anon key = kunci publik (sama dengan supabase-config.js di browser).
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cGJnaGRlcHlrZnFnemh5dm1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzOTkxMjIsImV4cCI6MjA5Mzk3NTEyMn0.09wxazMcQnBpSoSk8qyuYlsW6kd9KLMxpcUXtGz4cLc';

const PRODUCTION_ORIGINS = ['https://sdnkalibaru05.sch.id', 'https://www.sdnkalibaru05.sch.id'];

export function allowedOrigin(origin) {
    const origins = [...PRODUCTION_ORIGINS];
    if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);
    if (process.env.VERCEL_BRANCH_URL) origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
    if (origins.includes(origin)) return true;
    return process.env.VERCEL_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
}

/** Header standar + preflight. Mengembalikan true jika request sudah dijawab. */
export function prepare(req, res, methods) {
    const origin = req.headers.origin;
    const ok = allowedOrigin(origin);
    res.setHeader('Vary', 'Origin');
    if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', `${methods.join(', ')}, OPTIONS`);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
        res.status(ok ? 204 : 403).end();
        return true;
    }
    if (!methods.includes(req.method)) {
        sendError(res, 405, 'method_not_allowed', 'Method Not Allowed');
        return true;
    }
    if (!ok) {
        sendError(res, 403, 'forbidden_origin', 'Akses ditolak.');
        return true;
    }
    return false;
}

export function sendError(res, status, type, message) {
    return res.status(status).json({ error: { type, message } });
}

export function readBody(req) {
    try {
        const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
    } catch {
        return null;
    }
}

export function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
    return first.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/** Pembatas sederhana per instance (Supabase Auth juga punya batas sendiri). */
export function makeRateLimiter(windowMs, max) {
    const buckets = new Map();
    return function limited(key, now = Date.now()) {
        const b = buckets.get(key);
        if (!b || now - b.start >= windowMs) {
            buckets.set(key, { start: now, count: 1 });
            if (buckets.size > 5000) {
                for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
            }
            return false;
        }
        b.count += 1;
        return b.count > max;
    };
}

export function serviceKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

/** fetch ke Supabase. `key` = service role atau anon; `token` = JWT user (opsional). */
export async function sb(method, path, { key, token, body, headers = {} } = {}) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
        method,
        headers: {
            apikey: key,
            Authorization: `Bearer ${token || key}`,
            'Content-Type': 'application/json',
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* abaikan */ }
    return { status: res.status, ok: res.ok, json };
}

/** User dari header Authorization: Bearer <jwt>. null jika tidak valid. */
export async function callerFromRequest(req) {
    const auth = String(req.headers.authorization || '');
    const m = auth.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
    if (!m) return null;
    const r = await sb('GET', '/auth/v1/user', { key: SUPABASE_ANON_KEY, token: m[1] });
    if (!r.ok || !r.json?.id) return null;
    return { id: r.json.id, email: r.json.email };
}

export async function isAdminUser(userId, key) {
    const r = await sb('GET', `/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(userId)}&role=eq.admin`, { key });
    return r.ok && Array.isArray(r.json) && r.json.length > 0;
}
