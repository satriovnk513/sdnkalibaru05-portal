/**
 * POST /api/guru-reset-password  { identifier, pin, password }
 *   Lupa password: email ATAU NIP/NUPTK + PIN pemulihan + password baru.
 *   Tidak ada email yang dikirim.
 *
 * Keamanan:
 *   - Salah PIN 5 kali → PIN terkunci 30 menit (dicatat di database, berlaku di
 *     semua server), ditambah batas 10 percobaan / 10 menit per IP.
 *   - Akun tak dikenal, PIN salah, dan belum punya PIN memberi pesan yang sama.
 *   - Status nonaktif baru diberitahukan setelah PIN terbukti benar.
 */
import {
    prepare, sendError, readBody, clientIp, makeRateLimiter, serviceKey, sb,
} from './_lib/supa.js';
import { classifyIdentifier } from './guru-login.js';

const limited = makeRateLimiter(10 * 60 * 1000, 10);
const GENERIC = 'Email/NIP atau PIN salah. Belum pernah membuat PIN? Hubungi admin sekolah.';

export default async function handler(req, res) {
    if (prepare(req, res, ['POST'])) return;

    if (limited(clientIp(req))) {
        res.setHeader('Retry-After', '600');
        return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    }

    const body = readBody(req);
    const id = classifyIdentifier(body?.identifier);
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!id) return sendError(res, 400, 'invalid_request', 'Isi email atau NIP/NUPTK.');
    if (!/^[0-9]{6}$/.test(pin)) return sendError(res, 400, 'invalid_pin', 'PIN harus 6 angka.');
    if (password.length < 8 || password.length > 72) return sendError(res, 400, 'invalid_password', 'Password baru minimal 8 karakter.');
    if (password === pin) return sendError(res, 400, 'invalid_password', 'Password baru tidak boleh sama dengan PIN.');

    const key = serviceKey();
    if (!key) return sendError(res, 500, 'config_error', 'Fitur lupa password belum dikonfigurasi di server.');

    const filter = id.kind === 'email'
        ? `email=eq.${encodeURIComponent(id.value)}`
        : `login_id=eq.${encodeURIComponent(id.value)}`;
    const acc = await sb('GET', `/rest/v1/teacher_accounts?select=user_id,is_active&${filter}`, { key });
    if (!acc.ok) return sendError(res, 502, 'upstream_error', 'Server sedang bermasalah. Coba lagi.');
    const row = Array.isArray(acc.json) ? acc.json[0] : null;
    if (!row) return sendError(res, 401, 'invalid_pin', GENERIC);

    const v = await sb('POST', '/rest/v1/rpc/verify_recovery_pin', { key, body: { p_user: row.user_id, p_pin: pin } });
    if (!v.ok) return sendError(res, 502, 'upstream_error', 'Server sedang bermasalah. Coba lagi.');
    if (v.json === 'terkunci') {
        res.setHeader('Retry-After', '1800');
        return sendError(res, 423, 'locked', 'PIN salah terlalu sering, dikunci 30 menit. Coba lagi nanti atau hubungi admin sekolah.');
    }
    if (v.json !== 'ok') return sendError(res, 401, 'invalid_pin', GENERIC);
    if (!row.is_active) return sendError(res, 403, 'inactive', 'Akun dinonaktifkan. Hubungi admin.');

    const u = await sb('PUT', `/auth/v1/admin/users/${row.user_id}`, { key, body: { password } });
    if (!u.ok) {
        if (u.status === 422) return sendError(res, 400, 'invalid_password', 'Password baru ditolak. Pakai kombinasi huruf dan angka, minimal 8 karakter.');
        return sendError(res, 502, 'upstream_error', 'Gagal mengganti password. Coba lagi.');
    }
    return res.status(200).json({ ok: true });
}
