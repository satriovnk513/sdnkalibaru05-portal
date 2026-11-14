/**
 * POST /api/guru-change-password  (Authorization: Bearer <jwt guru>)  { password }
 *   Mengganti password guru yang sedang login dan mencabut tanda
 *   "wajib ganti password" (password awal = NIP/NUPTK).
 *   Password baru tidak boleh sama dengan NIP/NUPTK atau email sendiri.
 */
import {
    prepare, sendError, readBody, makeRateLimiter, serviceKey, sb, callerFromRequest,
} from './_lib/supa.js';

const limited = makeRateLimiter(10 * 60 * 1000, 10);

/** Pesan penolakan, atau null jika password boleh dipakai. */
export function passwordProblem(password, { login_id, email } = {}) {
    if (typeof password !== 'string' || password.length < 8) return 'Password baru minimal 8 karakter.';
    if (password.length > 72) return 'Password terlalu panjang (maksimal 72 karakter).';
    const p = password.trim().toLowerCase();
    if (login_id && p.replace(/[\s.]/g, '') === String(login_id)) return 'Password baru tidak boleh sama dengan NIP/NUPTK.';
    if (email && p === String(email).toLowerCase()) return 'Password baru tidak boleh sama dengan email.';
    return null;
}

export default async function handler(req, res) {
    if (prepare(req, res, ['POST'])) return;

    const key = serviceKey();
    if (!key) return sendError(res, 500, 'config_error', 'Fitur ganti password belum dikonfigurasi di server.');
    const caller = await callerFromRequest(req);
    if (!caller) return sendError(res, 401, 'unauthorized', 'Sesi habis. Silakan login ulang.');
    if (limited(caller.id)) {
        res.setHeader('Retry-After', '600');
        return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    }

    const acc = await sb('GET', `/rest/v1/teacher_accounts?select=login_id,email&user_id=eq.${caller.id}`, { key });
    if (!acc.ok) return sendError(res, 502, 'upstream_error', 'Server sedang bermasalah. Coba lagi.');
    const row = Array.isArray(acc.json) ? acc.json[0] : null;
    if (!row) return sendError(res, 403, 'not_teacher', 'Akun ini bukan akun guru.');

    const password = readBody(req)?.password;
    const problem = passwordProblem(password, row);
    if (problem) return sendError(res, 400, 'invalid_password', problem);

    const u = await sb('PUT', `/auth/v1/admin/users/${caller.id}`, { key, body: { password } });
    if (!u.ok) {
        if (u.status === 422) return sendError(res, 400, 'invalid_password', 'Password ditolak. Pakai kombinasi huruf dan angka, minimal 8 karakter.');
        return sendError(res, 502, 'upstream_error', 'Gagal mengganti password. Coba lagi.');
    }
    await sb('PATCH', `/rest/v1/teacher_accounts?user_id=eq.${caller.id}`, {
        key, body: { must_change_password: false, updated_at: new Date().toISOString() }, headers: { Prefer: 'return=minimal' },
    });
    return res.status(200).json({ ok: true });
}
