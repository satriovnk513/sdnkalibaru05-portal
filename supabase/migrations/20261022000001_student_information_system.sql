-- =============================================================================
-- Modul Data Siswa — SDN Kalibaru 05
-- Migration: tabel, constraint, indeks, trigger updated_at, RLS, dan RPC ringkasan.
--
-- Idempotensi: aman dijalankan ulang SETELAH versi migration yang sama ini
-- berhasil diterapkan (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS).
-- Migration ini BUKAN alat untuk memperbaiki tabel draf dengan struktur berbeda:
-- CREATE TABLE IF NOT EXISTS tidak mengubah tabel yang sudah ada. Seluruh isi
-- berada dalam satu transaksi, sehingga jika satu perintah gagal tidak ada
-- perubahan yang tersimpan.
--
-- Dashboard admin bersifat READ-ONLY. Semua penulisan data siswa hanya melalui
-- importer server-side (service_role).
--
-- TIDAK menyentuh tabel, policy, atau storage yang sudah ada.
-- TIDAK berisi data siswa. Data diimpor terpisah oleh scripts/import-students.mjs.
--
-- Data siswa bersifat privat: hanya admin (public.user_roles.role = 'admin').
-- Tabel ini tidak boleh dibaca oleh ai-service.js, kalibot.js, atau /api/chat.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Ekstensi
-- -----------------------------------------------------------------------------
-- Di Supabase, ekstensi diletakkan di schema `extensions`. Jika pg_trgm sudah
-- terpasang di schema lain, perintah ini dilewati dan indeks trigram di bawah
-- otomatis memakai schema tempat pg_trgm berada.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Tabel batch impor
-- -----------------------------------------------------------------------------
create table if not exists public.student_import_batches (
    id            uuid        primary key default gen_random_uuid(),
    source_name   text        not null,
    source_hash   text        not null,
    record_count  integer     not null,
    listed_count  integer     not null,
    review_count  integer     not null,
    imported_at   timestamptz not null default now(),
    imported_by   uuid        references auth.users (id) on delete set null,

    constraint student_import_batches_source_hash_key
        unique (source_hash),
    constraint student_import_batches_source_name_not_blank
        check (btrim(source_name) <> ''),
    constraint student_import_batches_source_hash_sha256
        check (source_hash ~ '^[0-9a-f]{64}$'),
    constraint student_import_batches_counts_non_negative
        check (record_count >= 0 and listed_count >= 0 and review_count >= 0),
    constraint student_import_batches_counts_consistent
        check (listed_count + review_count = record_count)
);

comment on table public.student_import_batches is
    'Riwayat impor data siswa (privat). Hanya admin yang dapat membaca; penulisan hanya oleh importer service-role.';
comment on column public.student_import_batches.source_hash is
    'SHA-256 (hex) file sumber. Unik, sehingga file yang sama tidak tercatat dua kali.';

-- -----------------------------------------------------------------------------
-- 2. Tabel data siswa
-- -----------------------------------------------------------------------------
create table if not exists public.student_records (
    id                uuid        primary key default gen_random_uuid(),
    nik               text        not null,
    nama_siswa        text        not null,
    nipd              text,
    nisn              text,
    kelas             text,
    nama_ibu_kandung  text,
    status_daftar     text        not null,
    status_dukcapil   text,
    payload           jsonb       not null,
    field_sources     jsonb,
    matching_notes    jsonb,
    source_names      jsonb,
    import_batch_id   uuid        references public.student_import_batches (id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    constraint student_records_nik_key
        unique (nik),
    constraint student_records_nik_format
        check (nik ~ '^[0-9]{16}$'),
    constraint student_records_nama_siswa_not_blank
        check (btrim(nama_siswa) <> ''),
    constraint student_records_status_daftar_valid
        check (status_daftar in ('Tercantum di daftar kelas', 'Perlu verifikasi lebih lanjut')),
    -- Siswa yang tercantum di daftar kelas wajib punya kelas.
    constraint student_records_listed_has_kelas
        check (status_daftar <> 'Tercantum di daftar kelas' or nullif(btrim(kelas), '') is not null),
    constraint student_records_payload_object
        check (jsonb_typeof(payload) = 'object'),
    -- Metadata sumber disimpan di kolom khusus, bukan di payload.
    constraint student_records_payload_no_metadata
        check (not (payload ?| array['_sources', '_catatan', '_asal_data'])),
    constraint student_records_field_sources_object
        check (field_sources is null or jsonb_typeof(field_sources) = 'object'),
    constraint student_records_matching_notes_array
        check (matching_notes is null or jsonb_typeof(matching_notes) = 'array'),
    constraint student_records_source_names_array
        check (source_names is null or jsonb_typeof(source_names) = 'array')
);

comment on table public.student_records is
    'Biodata siswa (PRIVAT: NIK, KK, HP, alamat, keluarga). Hanya admin. Bukan sumber pengetahuan KaliBot/AI.';
comment on column public.student_records.nik is 'Identitas utama, 16 digit, disimpan sebagai text.';
comment on column public.student_records.payload is 'Seluruh field biodata sumber (key/value datar) tanpa _sources/_catatan/_asal_data.';
comment on column public.student_records.field_sources is 'Dari _sources: peta nama field -> sumber (KJP/Dapodik/Daftar kelas).';
comment on column public.student_records.matching_notes is 'Dari _catatan: array catatan pencocokan.';
comment on column public.student_records.source_names is 'Dari _asal_data: array sumber yang dimiliki siswa.';

-- -----------------------------------------------------------------------------
-- 3. Indeks
-- -----------------------------------------------------------------------------
-- nik sudah terindeks oleh constraint unique. text_pattern_ops mendukung
-- pencarian awalan (LIKE '123%') untuk identifier numerik.
create index if not exists student_records_nik_pattern_idx    on public.student_records (nik  text_pattern_ops);
create index if not exists student_records_nisn_idx           on public.student_records (nisn text_pattern_ops);
create index if not exists student_records_nipd_idx           on public.student_records (nipd text_pattern_ops);
create index if not exists student_records_kelas_idx          on public.student_records (kelas);
create index if not exists student_records_status_daftar_idx  on public.student_records (status_daftar);
create index if not exists student_records_import_batch_idx   on public.student_records (import_batch_id);

-- Indeks trigram untuk pencarian nama (ILIKE '%...%').
do $$
declare
    trgm_schema text;
begin
    select n.nspname into trgm_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm';

    execute format(
        'create index if not exists student_records_nama_siswa_trgm_idx
           on public.student_records using gin (nama_siswa %I.gin_trgm_ops)', trgm_schema);
    execute format(
        'create index if not exists student_records_nama_ibu_trgm_idx
           on public.student_records using gin (nama_ibu_kandung %I.gin_trgm_ops)', trgm_schema);
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Trigger updated_at (nama fungsi khusus agar tidak menimpa fungsi lain)
-- -----------------------------------------------------------------------------
create or replace function public.student_records_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

revoke all on function public.student_records_set_updated_at() from public, anon, authenticated;

drop trigger if exists student_records_set_updated_at on public.student_records;
create trigger student_records_set_updated_at
    before update on public.student_records
    for each row
    execute function public.student_records_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Hak akses tabel
-- -----------------------------------------------------------------------------
-- Supabase memberi grant default ke anon/authenticated untuk tabel baru di
-- schema public. Cabut semuanya, lalu berikan hanya yang diperlukan.
revoke all on table public.student_records        from public, anon, authenticated;
revoke all on table public.student_import_batches from public, anon, authenticated;

-- authenticated hanya SELECT (dashboard read-only); RLS di bawah membatasi ke admin.
grant select on table public.student_records        to authenticated;
grant select on table public.student_import_batches to authenticated;

-- Importer server-side (SUPABASE_SERVICE_ROLE_KEY).
grant select, insert, update, delete on table public.student_records        to service_role;
grant select, insert, update, delete on table public.student_import_batches to service_role;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.student_records        enable row level security;
alter table public.student_records        force  row level security;
alter table public.student_import_batches enable row level security;
alter table public.student_import_batches force  row level security;

-- student_records: admin hanya SELECT. Syarat admin ditulis eksplisit dari
-- user_roles + auth.uid().
drop policy if exists student_records_admin_select on public.student_records;
create policy student_records_admin_select
    on public.student_records
    for select
    to authenticated
    using (exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    ));

-- Policy tulis dari draf sebelumnya dibersihkan dan TIDAK dibuat kembali.
-- Tanpa grant INSERT/UPDATE/DELETE dan tanpa policy tulis, admin browser tidak
-- bisa mengubah data; penulisan hanya oleh importer service_role (bypass RLS).
drop policy if exists student_records_admin_insert on public.student_records;
drop policy if exists student_records_admin_update on public.student_records;
drop policy if exists student_records_admin_delete on public.student_records;

-- student_import_batches: admin hanya membaca. Tidak ada policy tulis;
-- penulisan dilakukan importer service-role (bypass RLS).
drop policy if exists student_import_batches_admin_select on public.student_import_batches;
create policy student_import_batches_admin_select
    on public.student_import_batches
    for select
    to authenticated
    using (exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    ));

-- -----------------------------------------------------------------------------
-- 7. RPC ringkasan untuk kartu statistik dan dropdown kelas
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER: query dijalankan dengan hak pemanggil, sehingga RLS tetap
-- berlaku. Non-admin mendapat angka 0 dan daftar kelas kosong.
-- Rombel dan daftar kelas hanya dari siswa 'Tercantum di daftar kelas' dengan
-- kelas tidak kosong.
create or replace function public.student_summary()
returns table (
    total_siswa       bigint,
    tercantum         bigint,
    perlu_verifikasi  bigint,
    jumlah_rombel     bigint,
    daftar_kelas      text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        count(*)                                                                as total_siswa,
        count(*) filter (where s.status_daftar = 'Tercantum di daftar kelas')     as tercantum,
        count(*) filter (where s.status_daftar = 'Perlu verifikasi lebih lanjut') as perlu_verifikasi,
        count(distinct s.kelas) filter (
            where s.status_daftar = 'Tercantum di daftar kelas'
              and nullif(btrim(s.kelas), '') is not null)                         as jumlah_rombel,
        coalesce(
            array_agg(distinct s.kelas order by s.kelas) filter (
                where s.status_daftar = 'Tercantum di daftar kelas'
                  and nullif(btrim(s.kelas), '') is not null),
            array[]::text[])                                                      as daftar_kelas
    from public.student_records s;
$$;

comment on function public.student_summary() is
    'Ringkasan data siswa untuk dashboard admin. SECURITY INVOKER: tunduk pada RLS student_records.';

revoke all     on function public.student_summary() from public, anon;
grant  execute on function public.student_summary() to authenticated, service_role;

commit;
