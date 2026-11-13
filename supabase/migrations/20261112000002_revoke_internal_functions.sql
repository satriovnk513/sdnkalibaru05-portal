-- =============================================================================
-- Tutup fungsi internal lama dari API (temuan Supabase security advisor).
--
-- - handle_new_user(): fungsi trigger on_auth_user_created. Trigger tetap jalan
--   tanpa hak EXECUTE (dicek di tes lokal), jadi aman dicabut.
-- - rls_auto_enable(): fungsi event trigger ensure_rls. Sama.
-- - has_role(uuid, app_role): tidak dipakai policy maupun kode; bisa dipakai
--   user login untuk mengecek peran user lain.
--
-- is_admin() TIDAK dicabut: dipakai policy tabel staff (dievaluasi sebagai user).
-- =============================================================================

begin;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.has_role(uuid, public.app_role) from public, anon, authenticated;

commit;
