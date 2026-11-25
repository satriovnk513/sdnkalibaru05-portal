-- =============================================================================
-- Kartu Siswa — kartu identitas ber-QR untuk absensi.
--
-- student_cards: satu baris per siswa.
--   token      kode siswa 8 karakter acak (alfabet Crockford: tanpa I, L, O, U) — BUKAN
--              NISN/NIK. Dicetak "KB05-XXXX-XXXX" di bawah QR (isi QR sama).
--   versi      naik tiap kartu diterbitkan ulang (kartu hilang); token lama tidak berlaku.
--   foto_path  path foto di bucket privat "foto-siswa" (<student_id>/<file>).
-- Tabel tidak bisa dibaca langsung; semua lewat RPC:
--   get_student_cards(kelas)       data cetak kartu (admin, pimpinan, wali kelas rombel)
--   get_class_card_tokens(kelas)   token QR siswa rombel untuk scan absensi (yang boleh melihat rombel)
--   resolve_student_card(token)    kartu milik siapa (untuk pesan "bukan kelas ini")
--   reissue_student_card(siswa)    kartu hilang → token baru (admin, wali kelas)
--   set_student_photo(siswa, path) pasang / lepas foto (admin, wali kelas)
--   get_student_photo(siswa)       foto untuk Data Siswa / profil (yang boleh melihat rombel)
--   set_card_settings(json)        pengaturan kartu: tempat & tanggal TTD, kepsek, TTD,
--                                  stempel, logo, foto latar (admin). Gambar di bucket privat
--                                  "kartu-aset", dibaca admin, pimpinan, dan wali kelas.
-- Foto dibaca siapa pun yang boleh melihat rombel siswa; diunggah/dihapus admin
-- atau wali kelasnya. Data cetak (TTL, JK) hanya untuk admin, pimpinan, wali.
-- =============================================================================

create table if not exists public.student_cards (
    student_id       uuid        primary key references public.student_records (id) on delete cascade,
    token            text        not null unique check (token ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
    versi            integer     not null default 1 check (versi >= 1),
    foto_path        text,
    foto_updated_at  timestamptz,
    issued_at        timestamptz not null default now(),
    issued_by        uuid        references auth.users (id) on delete set null,
    updated_at       timestamptz not null default now()
);
alter table public.student_cards enable row level security;
revoke all on table public.student_cards from public, anon, authenticated;
grant all on table public.student_cards to service_role;

-- ----------------------------------------------------------------------------- helper
/** Kode siswa 8 karakter acak dari alfabet Crockford (mudah dibaca/diketik: tanpa I, L, O, U). */
create or replace function public.card__new_token()
returns text
language sql
volatile
set search_path = ''
as $$
    select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(b, i) % 32) + 1, 1), '' order by i)
    from (select decode(md5(gen_random_uuid()::text || clock_timestamp()::text || random()::text), 'hex') as b) x,
         generate_series(0, 7) as i;
$$;

/** "KB05-7kq2-9xhm" / "7KQ29XHM" / salah ketik O→0, I/L→1 → "7KQ29XHM". */
create or replace function public.card__norm_token(p text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case when length(v) = 12 and left(v, 4) = 'KB05' then translate(substr(v, 5), 'OIL', '011') else translate(v, 'OIL', '011') end
    from (select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')) as v) x;
$$;

/** "<uuid>/file.jpg" → uuid siswa (null kalau bukan uuid). Dipakai policy storage. */
create or replace function public.card__siswa_dari_path(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
    select case when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then split_part(p_name, '/', 1)::uuid end;
$$;

/** Admin, atau wali kelas rombel siswa saat ini: boleh ganti foto & terbitkan ulang kartu. */
create or replace function public.card__boleh_kelola(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (
        public.att_is_admin()
        or exists (select 1 from public.student_enrollments e
                   where e.student_id = p_student and e.end_date is null and public.is_homeroom_of(e.class_id)));
$$;

/** Boleh melihat foto siswa: admin, atau siapa pun yang boleh melihat rombelnya (wali, guru mapel, pimpinan). */
create or replace function public.card__boleh_lihat(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (
        public.att_is_admin()
        or exists (select 1 from public.student_enrollments e
                   where e.student_id = p_student and e.end_date is null and public.can_view_class(e.class_id)));
$$;

/** Boleh mencetak kartu: admin, pimpinan, atau wali kelas mana pun. */
create or replace function public.card__boleh_cetak()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (
        public.att_is_admin() or public.is_pimpinan()
        or exists (select 1 from public.homeroom_assignments h where h.staff_id = public.current_staff_id()));
$$;

revoke all on function public.card__new_token() from public, anon, authenticated;
revoke all on function public.card__norm_token(text) from public, anon;
revoke all on function public.card__boleh_cetak() from public, anon;
grant execute on function public.card__norm_token(text), public.card__boleh_cetak() to authenticated, service_role;
revoke all on function public.card__siswa_dari_path(text) from public, anon;
revoke all on function public.card__boleh_kelola(uuid) from public, anon;
revoke all on function public.card__boleh_lihat(uuid) from public, anon;
grant execute on function public.card__siswa_dari_path(text), public.card__boleh_kelola(uuid), public.card__boleh_lihat(uuid)
    to authenticated, service_role;
grant execute on function public.card__new_token() to service_role;

-- ----------------------------------------------------------------------------- pengaturan kartu
create table if not exists public.card_settings (
    id            smallint    primary key default 1 check (id = 1),
    tempat        text        not null default 'Jakarta' check (length(tempat) between 1 and 60),
    tanggal_ttd   date,       -- null = tanggal saat dicetak
    kepsek_nama   text        check (kepsek_nama is null or length(kepsek_nama) <= 120),
    kepsek_nip    text        check (kepsek_nip is null or length(kepsek_nip) <= 40),
    ttd_path      text,
    stempel_path  text,
    logo_path     text,
    latar_path    text,
    updated_at    timestamptz not null default now(),
    updated_by    uuid        references auth.users (id) on delete set null
);
insert into public.card_settings (id) values (1) on conflict (id) do nothing;
alter table public.card_settings enable row level security;
revoke all on table public.card_settings from public, anon, authenticated;
grant all on table public.card_settings to service_role;

/** Pengaturan + nama/NIP kepala sekolah dari data guru (dipakai bila kepsek_nama kosong). */
create or replace function public.card__pengaturan()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'tempat', c.tempat, 'tanggal_ttd', c.tanggal_ttd, 'kepsek_nama', c.kepsek_nama, 'kepsek_nip', c.kepsek_nip,
        'ttd', c.ttd_path, 'stempel', c.stempel_path, 'logo', c.logo_path, 'latar', c.latar_path, 'diubah', c.updated_at,
        'kepsek_default', (select jsonb_build_object('nama', s.name,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                           from public.staff s where split_part(s.role, '|', 1) = 'Kepala Sekolah'
                           order by s.order_index nulls last, s.name limit 1))
    from public.card_settings c where c.id = 1;
$$;
revoke all on function public.card__pengaturan() from public, anon, authenticated;

/**
 * Ubah pengaturan (admin). Hanya kunci yang dikirim yang diubah; "" / null mengosongkan.
 * Gambar: path di bucket kartu-aset, mis. {"ttd": "ttd/abc.png"}. Kembali { pengaturan, hapus: [path lama] }.
 */
create or replace function public.set_card_settings(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_old public.card_settings;
    v_hapus text[] := '{}';
    k text;
    v text;
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin yang bisa mengubah pengaturan kartu.' using errcode = '42501';
    end if;
    if jsonb_typeof(coalesce(p, 'null'::jsonb)) <> 'object' then
        raise exception 'Data pengaturan tidak valid.' using errcode = '22023';
    end if;
    foreach k in array array['ttd', 'stempel', 'logo', 'latar'] loop
        v := nullif(btrim(p ->> k), '');
        if p ? k and v is not null and v !~ ('^' || k || '/[A-Za-z0-9._-]{1,80}$') then
            raise exception 'Path gambar % tidak valid.', k using errcode = '22023';
        end if;
    end loop;
    if p ? 'tanggal_ttd' and nullif(btrim(p ->> 'tanggal_ttd'), '') is not null and (p ->> 'tanggal_ttd') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Tanggal TTD tidak valid.' using errcode = '22023';
    end if;
    if p ? 'tempat' and nullif(btrim(p ->> 'tempat'), '') is null then
        raise exception 'Tempat TTD wajib diisi.' using errcode = '22023';
    end if;

    select * into v_old from public.card_settings where id = 1 for update;
    update public.card_settings set
        tempat       = case when p ? 'tempat' then left(btrim(p ->> 'tempat'), 60) else tempat end,
        tanggal_ttd  = case when p ? 'tanggal_ttd' then nullif(btrim(p ->> 'tanggal_ttd'), '')::date else tanggal_ttd end,
        kepsek_nama  = case when p ? 'kepsek_nama' then nullif(left(btrim(p ->> 'kepsek_nama'), 120), '') else kepsek_nama end,
        kepsek_nip   = case when p ? 'kepsek_nip' then nullif(left(btrim(p ->> 'kepsek_nip'), 40), '') else kepsek_nip end,
        ttd_path     = case when p ? 'ttd' then nullif(btrim(p ->> 'ttd'), '') else ttd_path end,
        stempel_path = case when p ? 'stempel' then nullif(btrim(p ->> 'stempel'), '') else stempel_path end,
        logo_path    = case when p ? 'logo' then nullif(btrim(p ->> 'logo'), '') else logo_path end,
        latar_path   = case when p ? 'latar' then nullif(btrim(p ->> 'latar'), '') else latar_path end,
        updated_at   = now(),
        updated_by   = (select auth.uid())
    where id = 1;

    if p ? 'ttd' and v_old.ttd_path is distinct from nullif(btrim(p ->> 'ttd'), '') and v_old.ttd_path is not null then v_hapus := v_hapus || v_old.ttd_path; end if;
    if p ? 'stempel' and v_old.stempel_path is distinct from nullif(btrim(p ->> 'stempel'), '') and v_old.stempel_path is not null then v_hapus := v_hapus || v_old.stempel_path; end if;
    if p ? 'logo' and v_old.logo_path is distinct from nullif(btrim(p ->> 'logo'), '') and v_old.logo_path is not null then v_hapus := v_hapus || v_old.logo_path; end if;
    if p ? 'latar' and v_old.latar_path is distinct from nullif(btrim(p ->> 'latar'), '') and v_old.latar_path is not null then v_hapus := v_hapus || v_old.latar_path; end if;

    return jsonb_build_object('pengaturan', public.card__pengaturan(), 'hapus', to_jsonb(v_hapus));
end;
$$;

-- ----------------------------------------------------------------------------- data cetak
create or replace function public.get_student_cards(p_class_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_out jsonb;
begin
    if (select auth.uid()) is null
       or not (public.att_is_admin() or public.is_pimpinan() or public.is_homeroom_of(p_class_id)) then
        raise exception 'Kartu siswa hanya untuk admin, kepala sekolah, dan wali kelas rombel ini.' using errcode = '42501';
    end if;

    -- Siswa yang belum punya kartu langsung dibuatkan token.
    insert into public.student_cards (student_id, token, issued_by)
    select e.student_id, public.card__new_token(), (select auth.uid())
    from public.student_enrollments e
    join public.student_records s on s.id = e.student_id
    where e.class_id = p_class_id and e.end_date is null and s.archived_at is null
    on conflict (student_id) do nothing;

    select jsonb_build_object(
        'kelas', (select jsonb_build_object('id', c.id, 'nama', c.name, 'tingkat', c.grade, 'rombel', c.section, 'tahun_ajaran', y.name)
                  from public.classes c join public.academic_years y on y.id = c.academic_year_id
                  where c.id = p_class_id),
        'bisa_kelola', public.att_is_admin() or public.is_homeroom_of(p_class_id),
        'admin', public.att_is_admin(),
        'pengaturan', public.card__pengaturan(),
        'siswa', coalesce(jsonb_agg(jsonb_build_object(
            'student_id', s.id,
            'nama', s.nama_siswa,
            'nisn', s.nisn,
            'nis', s.nipd,
            'jk', case s.payload ->> 'siswa_jenis_kelamin_nama' when 'Laki-laki' then 'L' when 'Perempuan' then 'P' end,
            'tempat_lahir', nullif(btrim(s.payload ->> 'siswa_tempat_lahir'), ''),
            'tanggal_lahir', case when s.payload ->> 'siswa_tanggal_lahir' ~ '^\d{4}-\d{2}-\d{2}$' then s.payload ->> 'siswa_tanggal_lahir' end,
            'token', k.token,
            'versi', k.versi,
            'foto', k.foto_path,
            'foto_diubah', k.foto_updated_at)
            order by upper(btrim(s.nama_siswa)), s.id), '[]'::jsonb))
    into v_out
    from public.student_enrollments e
    join public.student_records s on s.id = e.student_id
    join public.student_cards k on k.student_id = s.id
    where e.class_id = p_class_id and e.end_date is null and s.archived_at is null;

    return v_out;
end;
$$;

-- ----------------------------------------------------------------------------- scan absensi
/** [{student_id, token}] siswa rombel yang sudah punya kartu. */
create or replace function public.get_class_card_tokens(p_class_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('student_id', k.student_id, 'token', k.token))
        from public.student_enrollments e
        join public.student_records s on s.id = e.student_id and s.archived_at is null
        join public.student_cards k on k.student_id = e.student_id
        where e.class_id = p_class_id and e.end_date is null), '[]'::jsonb);
end;
$$;

/** Kartu milik siapa? null kalau token tidak dikenal (mis. kartu lama yang sudah diganti). */
create or replace function public.resolve_student_card(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.current_staff_id() is not null) then
        raise exception 'Hanya guru dan admin.' using errcode = '42501';
    end if;
    return (
        select jsonb_build_object(
            'student_id', s.id,
            'nama', s.nama_siswa,
            'aktif', s.archived_at is null,
            'class_id', e.class_id,
            'kelas', c.name)
        from public.student_cards k
        join public.student_records s on s.id = k.student_id
        left join public.student_enrollments e on e.student_id = s.id and e.end_date is null
        left join public.classes c on c.id = e.class_id
        where k.token = public.card__norm_token(p_token)
        limit 1);
end;
$$;

-- ----------------------------------------------------------------------------- kelola
/** Kartu hilang/rusak: terbitkan token baru. Kartu lama otomatis tidak berlaku. */
create or replace function public.reissue_student_card(p_student_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_row public.student_cards;
begin
    if not public.card__boleh_kelola(p_student_id) then
        raise exception 'Hanya admin atau wali kelas siswa ini yang bisa menerbitkan ulang kartu.' using errcode = '42501';
    end if;
    insert into public.student_cards as k (student_id, token, issued_by)
    values (p_student_id, public.card__new_token(), (select auth.uid()))
    on conflict (student_id) do update
        set token = public.card__new_token(), versi = k.versi + 1, issued_at = now(),
            issued_by = (select auth.uid()), updated_at = now()
    returning * into v_row;
    return jsonb_build_object('token', v_row.token, 'versi', v_row.versi);
end;
$$;

/** Pasang (p_path) atau lepas (null) foto. Kembalikan path foto lama supaya klien menghapusnya dari storage. */
create or replace function public.set_student_photo(p_student_id uuid, p_path text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_old text;
begin
    if not public.card__boleh_kelola(p_student_id) then
        raise exception 'Hanya admin atau wali kelas siswa ini yang bisa mengganti foto.' using errcode = '42501';
    end if;
    if p_path is not null and p_path !~ ('^' || p_student_id::text || '/[A-Za-z0-9._-]{1,80}$') then
        raise exception 'Path foto tidak valid.' using errcode = '22023';
    end if;
    insert into public.student_cards (student_id, token, issued_by)
    values (p_student_id, public.card__new_token(), (select auth.uid()))
    on conflict (student_id) do nothing;
    select foto_path into v_old from public.student_cards where student_id = p_student_id for update;
    update public.student_cards
       set foto_path = p_path, foto_updated_at = case when p_path is null then null else now() end, updated_at = now()
     where student_id = p_student_id;
    return case when v_old is distinct from p_path then v_old end;
end;
$$;

/** Foto siswa untuk Data Siswa (admin) dan profil siswa (Portal Guru). */
create or replace function public.get_student_photo(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.card__boleh_lihat(p_student_id) then
        raise exception 'Tidak punya akses ke siswa ini.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'foto', (select foto_path from public.student_cards where student_id = p_student_id),
        'bisa_kelola', public.card__boleh_kelola(p_student_id));
end;
$$;

revoke all on function public.set_card_settings(jsonb) from public, anon;
revoke all on function public.get_student_photo(uuid) from public, anon;
grant execute on function public.set_card_settings(jsonb), public.get_student_photo(uuid) to authenticated, service_role;
revoke all on function public.get_student_cards(uuid) from public, anon;
revoke all on function public.get_class_card_tokens(uuid) from public, anon;
revoke all on function public.resolve_student_card(text) from public, anon;
revoke all on function public.reissue_student_card(uuid) from public, anon;
revoke all on function public.set_student_photo(uuid, text) from public, anon;
grant execute on function public.get_student_cards(uuid), public.get_class_card_tokens(uuid), public.resolve_student_card(text),
    public.reissue_student_card(uuid), public.set_student_photo(uuid, text)
    to authenticated, service_role;

-- ----------------------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foto-siswa', 'foto-siswa', false, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "foto_siswa_baca" on storage.objects;
drop policy if exists "foto_siswa_unggah" on storage.objects;
drop policy if exists "foto_siswa_ubah" on storage.objects;
drop policy if exists "foto_siswa_hapus" on storage.objects;
create policy "foto_siswa_baca" on storage.objects for select to authenticated
    using (bucket_id = 'foto-siswa' and public.card__boleh_lihat(public.card__siswa_dari_path(name)));
create policy "foto_siswa_unggah" on storage.objects for insert to authenticated
    with check (bucket_id = 'foto-siswa' and public.card__boleh_kelola(public.card__siswa_dari_path(name)));
create policy "foto_siswa_ubah" on storage.objects for update to authenticated
    using (bucket_id = 'foto-siswa' and public.card__boleh_kelola(public.card__siswa_dari_path(name)))
    with check (bucket_id = 'foto-siswa' and public.card__boleh_kelola(public.card__siswa_dari_path(name)));
create policy "foto_siswa_hapus" on storage.objects for delete to authenticated
    using (bucket_id = 'foto-siswa' and public.card__boleh_kelola(public.card__siswa_dari_path(name)));

-- Aset kartu (TTD kepala sekolah, stempel, logo, foto latar): privat — TTD rawan dipalsukan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kartu-aset', 'kartu-aset', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kartu_aset_baca" on storage.objects;
drop policy if exists "kartu_aset_tulis" on storage.objects;
drop policy if exists "kartu_aset_ubah" on storage.objects;
drop policy if exists "kartu_aset_hapus" on storage.objects;
create policy "kartu_aset_baca" on storage.objects for select to authenticated
    using (bucket_id = 'kartu-aset' and public.card__boleh_cetak());
create policy "kartu_aset_tulis" on storage.objects for insert to authenticated
    with check (bucket_id = 'kartu-aset' and public.att_is_admin() and name ~ '^(ttd|stempel|logo|latar)/[A-Za-z0-9._-]{1,80}$');
create policy "kartu_aset_ubah" on storage.objects for update to authenticated
    using (bucket_id = 'kartu-aset' and public.att_is_admin())
    with check (bucket_id = 'kartu-aset' and public.att_is_admin() and name ~ '^(ttd|stempel|logo|latar)/[A-Za-z0-9._-]{1,80}$');
create policy "kartu_aset_hapus" on storage.objects for delete to authenticated
    using (bucket_id = 'kartu-aset' and public.att_is_admin());
