-- =============================================================================
-- Kartu Siswa — kartu identitas ber-QR untuk absensi.
--
-- student_cards: satu baris per siswa.
--   token      16 karakter heksadesimal acak (BUKAN NISN/NIK) — isi QR di kartu.
--   versi      naik tiap kartu diterbitkan ulang (kartu hilang); token lama tidak berlaku.
--   foto_path  path foto di bucket privat "foto-siswa" (<student_id>/<file>).
-- Tabel tidak bisa dibaca langsung; semua lewat RPC:
--   get_student_cards(kelas)       data cetak kartu (admin, pimpinan, wali kelas rombel)
--   get_class_card_tokens(kelas)   token QR siswa rombel untuk scan absensi (yang boleh melihat rombel)
--   resolve_student_card(token)    kartu milik siapa (untuk pesan "bukan kelas ini")
--   reissue_student_card(siswa)    kartu hilang → token baru (admin, wali kelas)
--   set_student_photo(siswa, path) pasang / lepas foto (admin, wali kelas)
-- Foto dibaca siapa pun yang boleh melihat rombel siswa; diunggah/dihapus admin
-- atau wali kelasnya. Data cetak (TTL, JK) hanya untuk admin, pimpinan, wali.
-- =============================================================================

create table if not exists public.student_cards (
    student_id       uuid        primary key references public.student_records (id) on delete cascade,
    token            text        not null unique check (token ~ '^[0-9A-F]{16}$'),
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
create or replace function public.card__new_token()
returns text
language sql
volatile
set search_path = ''
as $$
    select upper(left(md5(gen_random_uuid()::text || clock_timestamp()::text || random()::text), 16));
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

revoke all on function public.card__new_token() from public, anon, authenticated;
revoke all on function public.card__siswa_dari_path(text) from public, anon;
revoke all on function public.card__boleh_kelola(uuid) from public, anon;
revoke all on function public.card__boleh_lihat(uuid) from public, anon;
grant execute on function public.card__siswa_dari_path(text), public.card__boleh_kelola(uuid), public.card__boleh_lihat(uuid)
    to authenticated, service_role;
grant execute on function public.card__new_token() to service_role;

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
        where k.token = upper(btrim(coalesce(p_token, '')))
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
