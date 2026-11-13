/**
 * POST /api/guru-pin  (Authorization: Bearer <jwt guru>)  { password, pin }
 *   Membuat / mengganti PIN pemulihan 6 angka milik guru yang sedang login.
 *   Password saat ini wajib benar, supaya HP yang tertinggal dalam keadaan login
 *   tidak bisa dipakai orang lain untuk memasang PIN lalu mengambil alih akun.
 *
 * PIN di-hash bcrypt di database (fungsi set_recovery_pin, hanya service_role).
 */
import {
    prepare, sendError, readBody, makeRateLimiter, serviceKey, sb, callerFromRequest, SUPABASE_ANON_KEY,
} from './_lib/supa.js';

const limited = makeRateLimiter(10 * 60 * 1000, 8);

/** Sama dengan public.recovery_pin_is_weak di database (dicek lagi di sana). */
export function pinIsWeak(pin) {
    const p = String(pin ?? '');
    if (!/^[0-9]{6}$/.test(p)) return true;
    if (/^(.)\1{5}$/.test(p)) return true;
    if ('0123456789012'.includes(p) || '9876543210987'.includes(p)) return true;
    if (/^(..)\1\1$/.test(p) || /^(...)\1$/.test(p)) return true;
    return ['112233', '111222'].includes(p);
}

export default async function handler(req, res) {
    if (prepare(req, res, ['POST'])) return;

    const key = serviceKey();
    if (!key) return sendError(res, 500, 'config_error', 'Fitur PIN belum dikonfigurasi di server.');
    const caller = await callerFromRequest(req);
    if (!caller?.email) return sendError(res, 401, 'unauthorized', 'Sesi habis. Silakan login ulang.');
    if (limited(caller.id)) {
        res.setHeader('Retry-After', '600');
        return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    }

    const body = readBody(req);
    const password = typeof body?.password === 'string' ? body.password : '';
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
    if (!password || password.length > 200) return sendError(res, 400, 'invalid_request', 'Isi password Anda saat ini.');
    if (!/^[0-9]{6}$/.test(pin)) return sendError(res, 400, 'invalid_pin', 'PIN harus 6 angka.');
    if (pinIsWeak(pin)) return sendError(res, 400, 'weak_pin', 'PIN terlalu mudah ditebak (mis. 123456 atau 111111). Pakai 6 angka acak.');

    const tok = await sb('POST', '/auth/v1/token?grant_type=password', {
        key: SUPABASE_ANON_KEY, body: { email: caller.email, password },
    });
    if (!tok.ok) {
        if (tok.status === 429) return sendError(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi nanti.');
        return sendError(res, 401, 'wrong_password', 'Password saat ini salah.');
    }

    const r = await sb('POST', '/rest/v1/rpc/set_recovery_pin', { key, body: { p_user: caller.id, p_pin: pin } });
    if (!r.ok) {
        if (r.json?.code === '22023') return sendError(res, 400, 'weak_pin', 'PIN terlalu mudah ditebak. Pakai 6 angka acak.');
        if (r.json?.code === 'P0002') return sendError(res, 403, 'not_teacher', 'Akun ini bukan akun guru.');
        return sendError(res, 502, 'upstream_error', 'Gagal menyimpan PIN. Coba lagi.');
    }
    return res.status(200).json({ ok: true });
}
