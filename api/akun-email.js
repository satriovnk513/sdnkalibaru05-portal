/**
 * POST /api/akun-email  (Authorization: Bearer <jwt>)  { email, password }
 *   Mengganti email login akun yang sedang login — guru maupun admin.
 *   Password saat ini wajib benar, supaya HP/laptop yang tertinggal dalam keadaan
 *   login tidak bisa dipakai orang lain untuk memindahkan akun ke email lain.
 *
 * Email langsung aktif (email_confirm) — tidak ada email verifikasi yang dikirim,
 * sama seperti saat admin membuat akun. Data akun guru (teacher_accounts dan
 * daftar di Akun Guru) ikut diperbarui supaya login dengan email baru jalan.
 */
import {
    prepare, sendError, readBody, makeRateLimiter, serviceKey, sb, callerFromRequest, SUPABASE_ANON_KEY,
} from './_lib/supa.js';

const limited = makeRateLimiter(10 * 60 * 1000, 8);

/** Email yang sudah dirapikan, atau null kalau tidak valid. */
export function cleanEmail(raw) {
    const e = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 200) return null;
    return e;
}

export default async function handler(req, res) {
    if (prepare(req, res, ['POST'])) return;

    const key = serviceKey();
    if (!key) return sendError(res, 500, 'config_error', 'Fitur ganti email belum dikonfigurasi di server.');
    const caller = await callerFromRequest(req);
    if (!caller?.email) return sendError(res, 401, 'unauthorized', 'Sesi habis. Silakan login ulang.');
    if (limited(caller.id)) {
        res.setHeader('Retry-After', '600');
        return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    }

    const body = readBody(req);
    const email = cleanEmail(body?.email);
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email) return sendError(res, 400, 'invalid_email', 'Email baru tidak valid.');
    if (!password || password.length > 200) return sendError(res, 400, 'invalid_request', 'Isi password Anda saat ini.');
    if (email === String(caller.email).toLowerCase()) return sendError(res, 400, 'same_email', 'Email baru sama dengan email sekarang.');

    const tok = await sb('POST', '/auth/v1/token?grant_type=password', {
        key: SUPABASE_ANON_KEY, body: { email: caller.email, password },
    });
    if (!tok.ok) {
        if (tok.status === 429) return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi nanti.');
        return sendError(res, 401, 'wrong_password', 'Password saat ini salah.');
    }

    const u = await sb('PUT', `/auth/v1/admin/users/${caller.id}`, { key, body: { email, email_confirm: true } });
    if (!u.ok) {
        if (u.status === 422 || u.status === 409) return sendError(res, 409, 'email_taken', 'Email itu sudah dipakai akun lain.');
        return sendError(res, 502, 'upstream_error', 'Gagal mengganti email. Coba lagi.');
    }

    // Akun guru: samakan email di data akun & daftar Akun Guru.
    const acc = await sb('GET', `/rest/v1/teacher_accounts?select=staff_id&user_id=eq.${caller.id}`, { key });
    const row = acc.ok && Array.isArray(acc.json) ? acc.json[0] : null;
    if (row) {
        const now = new Date().toISOString();
        const a = await sb('PATCH', `/rest/v1/teacher_accounts?user_id=eq.${caller.id}`, {
            key, body: { email, updated_at: now }, headers: { Prefer: 'return=minimal' },
        });
        await sb('PATCH', `/rest/v1/teacher_account_requests?staff_id=eq.${row.staff_id}`, {
            key, body: { email, updated_at: now }, headers: { Prefer: 'return=minimal' },
        });
        if (!a.ok) {
            // Kembalikan email di Auth supaya login lewat NIP tidak putus.
            await sb('PUT', `/auth/v1/admin/users/${caller.id}`, { key, body: { email: caller.email, email_confirm: true } });
            return sendError(res, 409, 'email_taken', 'Email itu sudah dipakai akun lain.');
        }
    }
    return res.status(200).json({ ok: true, email });
}
