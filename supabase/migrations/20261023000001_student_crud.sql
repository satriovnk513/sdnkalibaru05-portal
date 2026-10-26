-- =============================================================================
-- Migration: CRUD Data Siswa untuk admin dashboard — SDN Kalibaru 05
--
-- Prasyarat: 20261022000001_student_information_system.sql sudah diterapkan.
--
-- Perubahan (hanya menambah; tidak mengubah tabel/policy lama selain tabel siswa):
--   1. Kolom baru student_records: created_by, updated_by, archived_at, archived_by.
--   2. Tabel riwayat public.student_record_changes (audit log, admin hanya baca).
--   3. Admin (user_roles.role = 'admin') boleh INSERT dan UPDATE student_records.
--      TIDAK ada DELETE untuk browser: "hapus" = arsip (archived_at), bisa dipulihkan.
--      Hapus permanen hanya lewat SQL Editor / service_role (riwayat ikut terhapus).
--   4. Trigger penjaga untuk penulisan dari browser (role authenticated):
--        - kolom inti (nik, nama_siswa, nipd, nisn, kelas, nama_ibu_kandung,
--          status_daftar, status_dukcapil) selalu diturunkan dari payload;
--        - id, created_at, created_by, import_batch_id, matching_notes, source_names
--          tidak bisa diubah; field_sources ditandai 'Admin' untuk field yang diubah;
--        - payload hanya key huruf kecil/angka/underscore, nilai skalar, maks 1000 karakter;
--          identifier tidak boleh bertipe angka;
--        - siswa terarsip tidak bisa diubah sebelum dipulihkan; arsip/pulihkan tidak
--          boleh sekaligus mengubah biodata.
--   5. Trigger audit: setiap tambah/ubah/arsip/pulihkan dari browser dicatat
--      (siapa, kapan, field, nilai lama -> baru).
--   6. student_summary() hanya menghitung siswa aktif (tidak terarsip) dan
--      menambah kolom `diarsipkan`.
--
-- Penulisan oleh importer (service_role) tidak diubah oleh trigger penjaga dan
-- tidak dicatat di riwayat.
--
-- Seluruh migration berjalan dalam satu transaksi dan aman dijalankan ulang
-- setelah versi yang sama berhasil diterapkan.
-- =============================================================================

begin;

-- ------------------------------------------------------------------ 1. kolom
alter table public.student_records
    add column if not exists created_by  uuid references auth.users (id) on delete set null,
    add column if not exists updated_by  uuid references auth.users (id) on delete set null,
    add column if not exists archived_at timestamptz,
    add column if not exists archived_by uuid references auth.users (id) on delete set null;

comment on column public.student_records.archived_at is
    'Jika terisi, siswa diarsipkan (soft delete) dan tidak tampil di daftar aktif. Bisa dipulihkan.';

create index if not exists student_records_archived_idx on public.student_records (archived_at);

-- ------------------------------------------------------------------ 2. riwayat
create table if not exists public.student_record_changes (
    id                bigint      generated always as identity primary key,
    student_id        uuid        not null references public.student_records (id) on delete cascade,
    action            text        not null,
    changed_by        uuid        references auth.users (id) on delete set null,
    changed_by_email  text,
    changed_at        timestamptz not null default now(),
    changes           jsonb       not null default '{}'::jsonb,
    constraint student_record_changes_action_valid
        check (action in ('create', 'update', 'archive', 'restore')),
    constraint student_record_changes_changes_object
        check (jsonb_typeof(changes) = 'object')
);

comment on table public.student_record_changes is
    'Riwayat perubahan Data Siswa dari dashboard (PRIVAT, berisi nilai lama/baru). Hanya admin yang membaca; ditulis oleh trigger.';

create index if not exists student_record_changes_student_idx
    on public.student_record_changes (student_id, changed_at desc);

-- ------------------------------------------------------------------ 3. trigger penjaga
create or replace function public.student_records_guard_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_uid      uuid := (select auth.uid());
    v_key      text;
    v_val      jsonb;
    v_changed  text[];
begin
    -- Penulisan server-side (service_role / postgres) tidak diubah.
    if current_user <> 'authenticated' then
        return new;
    end if;

    if new.payload is null or jsonb_typeof(new.payload) <> 'object' then
        raise exception 'Data siswa tidak valid: payload harus object.' using errcode = '22023';
    end if;

    -- Validasi payload
    for v_key, v_val in select key, value from jsonb_each(new.payload) loop
        if v_key !~ '^[a-z0-9_]{1,64}$' then
            raise exception 'Nama field tidak valid.' using errcode = '22023';
        end if;
        if jsonb_typeof(v_val) not in ('string', 'number', 'boolean', 'null') then
            raise exception 'Nilai field "%" harus teks, angka, atau kosong.', v_key using errcode = '22023';
        end if;
        if jsonb_typeof(v_val) = 'string' and length(v_val #>> '{}') > 1000 then
            raise exception 'Nilai field "%" terlalu panjang (maks 1000 karakter).', v_key using errcode = '22023';
        end if;
        if jsonb_typeof(v_val) = 'number'
           and v_key ~ '(^|_)(nik|nik_wali|nisn|nipd|no_kk|no_hp|no_telp|no_telepon|kode_pos|rt|rw|nomor_akta|hp_orang_tua_ppdb)$' then
            raise exception 'Field identitas "%" harus disimpan sebagai teks.', v_key using errcode = '22023';
        end if;
    end loop;

    -- Kolom inti selalu diturunkan dari payload (sumber kebenaran tunggal).
    -- Sama persis dengan importer: nilai payload apa adanya (key tidak ada -> null).
    new.nik              := new.payload ->> 'nik_siswa';
    new.nama_siswa       := new.payload ->> 'nama_siswa';
    new.nipd             := new.payload ->> 'siswa_nipd';
    new.nisn             := new.payload ->> 'siswa_nisn';
    new.kelas            := new.payload ->> 'kelas';
    new.nama_ibu_kandung := new.payload ->> 'siswa_nama_ibu_kandung';
    new.status_daftar    := new.payload ->> 'status_daftar';
    new.status_dukcapil  := new.payload ->> 'status_dukcapil';

    if tg_op = 'INSERT' then
        new.id              := gen_random_uuid();
        new.created_at      := now();
        new.updated_at      := now();
        new.created_by      := v_uid;
        new.updated_by      := v_uid;
        new.import_batch_id := null;
        new.archived_at     := null;
        new.archived_by     := null;
        new.matching_notes  := null;
        new.source_names    := '["Input admin"]'::jsonb;
        select coalesce(jsonb_object_agg(key, 'Admin'), '{}'::jsonb) into new.field_sources
        from jsonb_each(new.payload)
        where jsonb_typeof(value) <> 'null' and nullif(btrim(value #>> '{}'), '') is not null;
        return new;
    end if;

    -- UPDATE: kolom yang tidak boleh diubah dari browser.
    new.id              := old.id;
    new.created_at      := old.created_at;
    new.created_by      := old.created_by;
    new.import_batch_id := old.import_batch_id;
    new.matching_notes  := old.matching_notes;
    new.source_names    := old.source_names;
    new.updated_by      := v_uid;

    if (old.archived_at is null) <> (new.archived_at is null) then
        -- Arsip / pulihkan: biodata tidak boleh ikut berubah.
        if new.payload is distinct from old.payload then
            raise exception 'Arsip atau pulihkan tidak boleh sekaligus mengubah biodata.' using errcode = '22023';
        end if;
        new.field_sources := old.field_sources;
        if new.archived_at is not null then
            new.archived_at := now();
            new.archived_by := v_uid;
        else
            new.archived_by := null;
        end if;
        return new;
    end if;

    if old.archived_at is not null then
        raise exception 'Siswa ini diarsipkan. Pulihkan terlebih dahulu sebelum mengubah data.' using errcode = '22023';
    end if;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;

    select array_agg(k) into v_changed
    from (select key as k from jsonb_each(old.payload)
          union
          select key from jsonb_each(new.payload)) keys
    where (old.payload -> k) is distinct from (new.payload -> k);

    new.field_sources := coalesce(old.field_sources, '{}'::jsonb);
    if v_changed is not null then
        select new.field_sources || coalesce(jsonb_object_agg(k, 'Admin'), '{}'::jsonb)
        into new.field_sources
        from unnest(v_changed) as k;
    end if;
    return new;
end;
$$;

revoke all on function public.student_records_guard_write() from public, anon, authenticated;

drop trigger if exists student_records_guard_write on public.student_records;
create trigger student_records_guard_write
    before insert or update on public.student_records
    for each row
    execute function public.student_records_guard_write();

-- ------------------------------------------------------------------ 4. trigger audit
-- SECURITY DEFINER agar trigger bisa menulis riwayat walau authenticated tidak
-- punya grant INSERT pada tabel riwayat. Hanya dipanggil sebagai trigger.
create or replace function public.student_records_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_uid     uuid := (select auth.uid());
    v_email   text;
    v_action  text;
    v_changes jsonb := '{}'::jsonb;
begin
    if v_uid is null then
        return null;  -- penulisan server-side tidak dicatat
    end if;

    begin
        v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
    exception when others then
        v_email := null;
    end;

    if tg_op = 'INSERT' then
        v_action := 'create';
        select coalesce(jsonb_object_agg(key, jsonb_build_object('lama', null, 'baru', value)), '{}'::jsonb)
        into v_changes
        from jsonb_each(new.payload)
        where jsonb_typeof(value) <> 'null' and nullif(btrim(value #>> '{}'), '') is not null;
    elsif (old.archived_at is null) and (new.archived_at is not null) then
        v_action := 'archive';
    elsif (old.archived_at is not null) and (new.archived_at is null) then
        v_action := 'restore';
    else
        v_action := 'update';
        select coalesce(jsonb_object_agg(k, jsonb_build_object('lama', old.payload -> k, 'baru', new.payload -> k)), '{}'::jsonb)
        into v_changes
        from (select key as k from jsonb_each(old.payload)
              union
              select key from jsonb_each(new.payload)) keys
        where (old.payload -> k) is distinct from (new.payload -> k);
        if v_changes = '{}'::jsonb then
            return null;  -- tidak ada perubahan biodata
        end if;
    end if;

    insert into public.student_record_changes (student_id, action, changed_by, changed_by_email, changes)
    values (new.id, v_action, v_uid, v_email, v_changes);
    return null;
end;
$$;

revoke all on function public.student_records_audit() from public, anon, authenticated;

drop trigger if exists student_records_audit on public.student_records;
create trigger student_records_audit
    after insert or update on public.student_records
    for each row
    execute function public.student_records_audit();

-- ------------------------------------------------------------------ 5. hak akses
revoke all on table public.student_record_changes from public, anon, authenticated;
grant select on table public.student_record_changes to authenticated;
grant select, delete on table public.student_record_changes to service_role;

-- Admin browser: SELECT (sudah ada) + INSERT + UPDATE. Tetap tanpa DELETE.
revoke delete on table public.student_records from authenticated;
grant insert, update on table public.student_records to authenticated;

alter table public.student_record_changes enable row level security;
alter table public.student_record_changes force  row level security;

drop policy if exists student_record_changes_admin_select on public.student_record_changes;
create policy student_record_changes_admin_select
    on public.student_record_changes
    for select
    to authenticated
    using (exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    ));

drop policy if exists student_records_admin_insert on public.student_records;
create policy student_records_admin_insert
    on public.student_records
    for insert
    to authenticated
    with check (exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    ));

drop policy if exists student_records_admin_update on public.student_records;
create policy student_records_admin_update
    on public.student_records
    for update
    to authenticated
    using (exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    ))
    with check (exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    ));

-- Sengaja TIDAK ada policy DELETE.
drop policy if exists student_records_admin_delete on public.student_records;

-- ------------------------------------------------------------------ 6. ringkasan
drop function if exists public.student_summary();
create function public.student_summary()
returns table (
    total_siswa       bigint,
    tercantum         bigint,
    perlu_verifikasi  bigint,
    jumlah_rombel     bigint,
    daftar_kelas      text[],
    diarsipkan        bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        count(*) filter (where s.archived_at is null)                                    as total_siswa,
        count(*) filter (where s.archived_at is null
                           and s.status_daftar = 'Tercantum di daftar kelas')             as tercantum,
        count(*) filter (where s.archived_at is null
                           and s.status_daftar = 'Perlu verifikasi lebih lanjut')         as perlu_verifikasi,
        count(distinct s.kelas) filter (
            where s.archived_at is null
              and s.status_daftar = 'Tercantum di daftar kelas'
              and nullif(btrim(s.kelas), '') is not null)                                as jumlah_rombel,
        coalesce(
            array_agg(distinct s.kelas order by s.kelas) filter (
                where s.archived_at is null
                  and s.status_daftar = 'Tercantum di daftar kelas'
                  and nullif(btrim(s.kelas), '') is not null),
            array[]::text[])                                                             as daftar_kelas,
        count(*) filter (where s.archived_at is not null)                                as diarsipkan
    from public.student_records s;
$$;

comment on function public.student_summary() is
    'Ringkasan siswa aktif (tidak terarsip) untuk dashboard admin. SECURITY INVOKER: tunduk pada RLS student_records.';

revoke all     on function public.student_summary() from public, anon;
grant  execute on function public.student_summary() to authenticated, service_role;

commit;
