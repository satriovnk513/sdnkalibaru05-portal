/**
 * /api/admin/teacher-accounts — kelola akun login guru. HANYA admin.
 *
 * GET  → daftar guru/staf + status akun (belum didaftarkan / siap dibuat / aktif / nonaktif)
 * POST { action, ... }
 *   create          { staff_ids?: uuid[] }   buat akun untuk daftar yang belum punya akun (default: semua)
 *   reset_password  { staff_id }             buat password baru
 *   set_active      { staff_id, active }     aktifkan / nonaktifkan
 *   save_request    { staff_id, email, login_id, make_admin }  tambah/ubah data akun
 *   delete_request  { staff_id }             hapus dari daftar (hanya jika akun belum dibuat)
 *
 * Akun dibuat dengan email_confirm = true: TIDAK ada email undangan/verifikasi yang
 * dikirim. Password awal dikembalikan SEKALI di respons untuk dibagikan admin; tidak
 * disimpan di mana pun dan tidak dicatat di log.
 */
import { randomInt } from 'node:crypto';
import {
    prepare, sendError, readBody, serviceKey, sb, callerFromRequest, isAdminUser,
} from '../_lib/supa.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generatePassword(length = 10) {
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    return out;
}

export function normalizeRequest(b) {
    const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
    const rawLogin = b?.login_id == null ? '' : String(b.login_id).replace(/[\s.]/g, '');
    if (!UUID.test(String(b?.staff_id || ''))) return { error: 'Data guru tidak valid.' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return { error: 'Email tidak valid.' };
    if (rawLogin && !/^[0-9]{8,20}$/.test(rawLogin)) return { error: 'NIP/NUPTK harus 8–20 angka.' };
    return { staff_id: b.staff_id, email, login_id: rawLogin || null, make_admin: b?.make_admin === true };
}

async function loadState(key) {
    const [staff, reqs, accs] = await Promise.all([
        sb('GET', '/rest/v1/staff?select=id,name,role,order_index&order=order_index.asc,name.asc', { key }),
        sb('GET', '/rest/v1/teacher_account_requests?select=staff_id,email,login_id,make_admin', { key }),
        sb('GET', '/rest/v1/teacher_accounts?select=user_id,staff_id,email,login_id,is_active,created_at', { key }),
    ]);
    if (!staff.ok || !reqs.ok || !accs.ok) throw new Error('upstream');
    return { staff: staff.json, reqs: reqs.json, accs: accs.json };
}

export function buildRows({ staff, reqs, accs }, adminIds = new Set()) {
    const reqBy = new Map(reqs.map((r) => [r.staff_id, r]));
    const accBy = new Map(accs.map((a) => [a.staff_id, a]));
    return staff.map((s) => {
        const acc = accBy.get(s.id);
        const req = reqBy.get(s.id);
        const status = acc ? (acc.is_active ? 'aktif' : 'nonaktif') : (req ? 'siap_dibuat' : 'belum_didaftarkan');
        return {
            staff_id: s.id,
            nama: s.name,
            jabatan: String(s.role || '').split('|')[1] || String(s.role || '').split('|')[0] || '',
            email: acc?.email ?? req?.email ?? null,
            login_id: acc?.login_id ?? req?.login_id ?? null,
            admin: acc ? adminIds.has(acc.user_id) : Boolean(req?.make_admin),
            status,
            dibuat: acc?.created_at ?? null,
        };
    });
}

async function adminUserIds(key, userIds) {
    if (!userIds.length) return new Set();
    const r = await sb('GET', `/rest/v1/user_roles?select=user_id&role=eq.admin&user_id=in.(${userIds.join(',')})`, { key });
    return new Set((r.ok ? r.json : []).map((x) => x.user_id));
}

async function createOne(key, staff, req) {
    const password = generatePassword();
    const created = await sb('POST', '/auth/v1/admin/users', {
        key,
        body: { email: req.email, password, email_confirm: true, user_metadata: { full_name: staff.name } },
    });
    if (!created.ok || !created.json?.id) {
        const msg = created.status === 422 ? 'Email sudah dipakai akun lain.' : `Gagal membuat akun (HTTP ${created.status}).`;
        return { staff_id: staff.id, nama: staff.name, ok: false, pesan: msg };
    }
    const userId = created.json.id;
    const link = await sb('POST', '/rest/v1/teacher_accounts', {
        key,
        body: { user_id: userId, staff_id: staff.id, email: req.email, login_id: req.login_id },
        headers: { Prefer: 'return=minimal' },
    });
    if (!link.ok) {
        // Batalkan user Auth supaya bisa dicoba lagi.
        await sb('DELETE', `/auth/v1/admin/users/${userId}`, { key });
        const msg = link.status === 409 ? 'NIP/NUPTK atau email sudah dipakai.' : `Gagal menghubungkan akun (HTTP ${link.status}).`;
        return { staff_id: staff.id, nama: staff.name, ok: false, pesan: msg };
    }
    if (req.make_admin) {
        await sb('POST', '/rest/v1/user_roles?on_conflict=user_id,role', {
            key, body: { user_id: userId, role: 'admin' },
            headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        });
    }
    return { staff_id: staff.id, nama: staff.name, email: req.email, login_id: req.login_id, password, ok: true };
}

export default async function handler(req, res) {
    if (prepare(req, res, ['GET', 'POST'])) return;

    const key = serviceKey();
    if (!key) {
        return sendError(res, 500, 'config_error',
            'SUPABASE_SERVICE_ROLE_KEY belum diisi di Vercel (Settings → Environment Variables).');
    }
    const caller = await callerFromRequest(req);
    if (!caller) return sendError(res, 401, 'unauthorized', 'Sesi habis. Silakan login ulang.');
    if (!(await isAdminUser(caller.id, key))) return sendError(res, 403, 'forbidden', 'Hanya admin.');

    try {
        if (req.method === 'GET') {
            const state = await loadState(key);
            const admins = await adminUserIds(key, state.accs.map((a) => a.user_id));
            return res.status(200).json({ rows: buildRows(state, admins) });
        }

        const body = readBody(req);
        if (!body) return sendError(res, 400, 'invalid_json', 'Format permintaan tidak valid.');
        const state = await loadState(key);
        const staffBy = new Map(state.staff.map((s) => [s.id, s]));
        const accBy = new Map(state.accs.map((a) => [a.staff_id, a]));
        const reqBy = new Map(state.reqs.map((r) => [r.staff_id, r]));

        switch (body.action) {
        case 'create': {
            let ids = Array.isArray(body.staff_ids) ? body.staff_ids.filter((x) => UUID.test(String(x))) : null;
            if (!ids) ids = state.reqs.map((r) => r.staff_id);
            if (ids.length > 100) return sendError(res, 400, 'invalid_request', 'Maksimal 100 akun sekali buat.');
            const results = [];
            for (const id of ids) {
                const staff = staffBy.get(id);
                const r = reqBy.get(id);
                if (!staff || !r) { results.push({ staff_id: id, ok: false, pesan: 'Belum ada data email.' }); continue; }
                if (accBy.has(id)) { results.push({ staff_id: id, nama: staff.name, ok: false, pesan: 'Sudah punya akun.' }); continue; }
                results.push(await createOne(key, staff, r));
            }
            return res.status(200).json({ results });
        }
        case 'reset_password': {
            const acc = accBy.get(body.staff_id);
            if (!acc) return sendError(res, 404, 'not_found', 'Akun belum dibuat.');
            const password = generatePassword();
            const r = await sb('PUT', `/auth/v1/admin/users/${acc.user_id}`, { key, body: { password } });
            if (!r.ok) return sendError(res, 502, 'upstream_error', `Gagal mengganti password (HTTP ${r.status}).`);
            return res.status(200).json({ staff_id: acc.staff_id, nama: staffBy.get(acc.staff_id)?.name, email: acc.email, login_id: acc.login_id, password });
        }
        case 'set_active': {
            const acc = accBy.get(body.staff_id);
            if (!acc) return sendError(res, 404, 'not_found', 'Akun belum dibuat.');
            if (acc.user_id === caller.id && body.active !== true) {
                return sendError(res, 400, 'invalid_request', 'Tidak bisa menonaktifkan akun sendiri.');
            }
            const active = body.active === true;
            const p = await sb('PATCH', `/rest/v1/teacher_accounts?staff_id=eq.${acc.staff_id}`, {
                key, body: { is_active: active, updated_at: new Date().toISOString() }, headers: { Prefer: 'return=minimal' },
            });
            if (!p.ok) return sendError(res, 502, 'upstream_error', 'Gagal menyimpan.');
            await sb('PUT', `/auth/v1/admin/users/${acc.user_id}`, { key, body: { ban_duration: active ? 'none' : '876000h' } });
            return res.status(200).json({ ok: true });
        }
        case 'save_request': {
            const n = normalizeRequest(body);
            if (n.error) return sendError(res, 400, 'invalid_request', n.error);
            if (!staffBy.has(n.staff_id)) return sendError(res, 404, 'not_found', 'Guru tidak ditemukan.');
            const acc = accBy.get(n.staff_id);
            if (acc) {
                if (acc.email !== n.email) {
                    const u = await sb('PUT', `/auth/v1/admin/users/${acc.user_id}`, { key, body: { email: n.email, email_confirm: true } });
                    if (!u.ok) return sendError(res, 409, 'conflict', 'Email sudah dipakai akun lain.');
                }
                const p = await sb('PATCH', `/rest/v1/teacher_accounts?staff_id=eq.${n.staff_id}`, {
                    key, body: { email: n.email, login_id: n.login_id, updated_at: new Date().toISOString() },
                    headers: { Prefer: 'return=minimal' },
                });
                if (!p.ok) return sendError(res, 409, 'conflict', 'Email atau NIP/NUPTK sudah dipakai.');
            }
            const up = await sb('POST', '/rest/v1/teacher_account_requests?on_conflict=staff_id', {
                key, body: { ...n, updated_at: new Date().toISOString() },
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            });
            if (!up.ok) return sendError(res, 409, 'conflict', 'Email atau NIP/NUPTK sudah dipakai.');
            return res.status(200).json({ ok: true });
        }
        case 'delete_request': {
            if (!UUID.test(String(body.staff_id || ''))) return sendError(res, 400, 'invalid_request', 'Data guru tidak valid.');
            if (accBy.has(body.staff_id)) return sendError(res, 400, 'invalid_request', 'Akun sudah dibuat. Nonaktifkan saja.');
            const d = await sb('DELETE', `/rest/v1/teacher_account_requests?staff_id=eq.${body.staff_id}`, { key, headers: { Prefer: 'return=minimal' } });
            if (!d.ok) return sendError(res, 502, 'upstream_error', 'Gagal menghapus.');
            return res.status(200).json({ ok: true });
        }
        default:
            return sendError(res, 400, 'invalid_request', 'Aksi tidak dikenal.');
        }
    } catch {
        return sendError(res, 502, 'upstream_error', 'Server sedang bermasalah. Coba lagi.');
    }
}
