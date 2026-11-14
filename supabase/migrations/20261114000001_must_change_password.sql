-- =============================================================================
-- Modul Absensi — password awal = NIP/NUPTK, wajib diganti saat login pertama.
--
-- teacher_accounts.must_change_password: true saat akun dibuat / password
-- di-reset admin; false setelah guru mengganti password (lewat API server).
-- Guru hanya bisa MEMBACA baris miliknya (policy lama), tidak bisa mengubah.
-- =============================================================================

begin;

alter table public.teacher_accounts
    add column if not exists must_change_password boolean not null default false;

commit;
