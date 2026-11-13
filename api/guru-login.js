/**
 * POST /api/guru-login  { identifier, password }
 *   identifier = email ATAU NIP/NUPTK (angka saja).
 * Mengembalikan { access_token, refresh_token, expires_in } untuk supabase.auth.setSession().
 *
 * NIP dicocokkan ke email di server (service role), jadi browser tidak pernah bisa
 * menebak email dari NIP. Pesan gagal selalu sama, apa pun penyebabnya.
 */
import {
    prepare, sendError, readBody, clientIp, makeRateLimiter, serviceKey, sb, SUPABASE_ANON_KEY,
} from './_lib/supa.js';

const limited = makeRateLimiter(10 * 60 * 1000, 10);
const GENERIC = 'Email/NIP atau password salah.';

export function classifyIdentifier(raw) {
    const s = String(raw ?? '').trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { kind: 'email', value: s.toLowerCase() };
    const digits = s.replace(/[\s.]/g, '');
    if (/^[0-9]{8,20}$/.test(digits)) return { kind: 'nip', value: digits };
    return null;
}

export default async function handler(req, res) {
    if (prepare(req, res, ['POST'])) return;

    const ip = clientIp(req);
    if (limited(ip)) {
        res.setHeader('Retry-After', '600');
        return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    }

    const body = readBody(req);
    const id = classifyIdentifier(body?.identifier);
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!id || !password || password.length > 200) {
        return sendError(res, 400, 'invalid_request', 'Isi email atau NIP/NUPTK dan password.');
    }

    const key = serviceKey();
    if (!key) return sendError(res, 500, 'config_error', 'Login guru belum dikonfigurasi di server.');

    // Cari akun guru (aktif) berdasarkan email atau NIP.
    const filter = id.kind === 'email'
        ? `email=eq.${encodeURIComponent(id.value)}`
        : `login_id=eq.${encodeURIComponent(id.value)}`;
    const acc = await sb('GET', `/rest/v1/teacher_accounts?select=email,is_active&${filter}`, { key });
    if (!acc.ok) return sendError(res, 502, 'upstream_error', 'Server sedang bermasalah. Coba lagi.');
    const row = Array.isArray(acc.json) ? acc.json[0] : null;
    if (!row) return sendError(res, 401, 'invalid_login', GENERIC);

    const tok = await sb('POST', '/auth/v1/token?grant_type=password', {
        key: SUPABASE_ANON_KEY,
        body: { email: row.email, password },
    });
    if (!tok.ok || !tok.json?.access_token) {
        if (tok.status === 429) return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi nanti.');
        return sendError(res, 401, 'invalid_login', GENERIC);
    }
    // Status nonaktif baru diberitahukan setelah password terbukti benar.
    if (!row.is_active) return sendError(res, 403, 'inactive', 'Akun dinonaktifkan. Hubungi admin.');
    return res.status(200).json({
        access_token: tok.json.access_token,
        refresh_token: tok.json.refresh_token,
        expires_in: tok.json.expires_in,
    });
}
