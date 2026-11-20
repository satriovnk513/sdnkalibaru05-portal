-- =============================================================================
-- Catatan Siswa (apresiasi, perilaku, catatan) + panel admin/operator untuk
-- catatan siswa dan jurnal mengajar.
--
-- - Semua guru boleh menulis catatan untuk siswa kelas mana pun (tahun ajaran
--   aktif); satu catatan boleh untuk beberapa siswa sekaligus (group_id sama).
-- - Yang bisa membaca: penulis, wali kelas siswa (kelas saat dicatat & kelas
--   sekarang), kepala sekolah, admin/operator.
-- - Penulis mengubah/menghapus catatannya; wali kelas & penulis boleh mengisi
--   tindak lanjut. Admin/operator bisa melihat, mengubah, menghapus semuanya —
--   tercatat di admin_audit_log dan catatan ditandai "dirapikan".
-- - Foto (opsional, maks. 3) di bucket privat "catatan-siswa"; hanya pembaca
--   catatannya yang bisa membuka foto.
-- - Jurnal mengajar: admin/operator bisa melihat & menghapus (tidak menambah /
--   mengubah) — juga tercatat di admin_audit_log.
-- =============================================================================

create table if not exists public.student_notes (
    id              uuid        primary key default gen_random_uuid(),
    group_id        uuid        not null default gen_random_uuid(),
    student_id      uuid        not null references public.student_records (id) on delete cascade,
    class_id        uuid        references public.classes (id) on delete set null,
    jenis           text        not null,
    tingkat         text,
    tanggal         date        not null,
    judul           text        not null,
    cerita          text,
    tindak_lanjut   text,
    tindak_lanjut_oleh text,
    tindak_lanjut_at timestamptz,
    fotos           text[]      not null default '{}',
    author_staff_id uuid        references public.staff (id) on delete set null,
    author_user     uuid        default auth.uid(),
    author_name     text        not null,
    dirapikan_oleh  text,
    dirapikan_at    timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint student_notes_jenis check (jenis in ('apresiasi', 'perilaku', 'catatan')),
    constraint student_notes_tingkat check ((jenis = 'perilaku' and tingkat in ('ringan', 'perhatian', 'serius')) or (jenis <> 'perilaku' and tingkat is null)),
    constraint student_notes_len check (length(judul) between 1 and 120 and coalesce(length(cerita), 0) <= 1000 and coalesce(length(tindak_lanjut), 0) <= 500),
    constraint student_notes_fotos check (coalesce(array_length(fotos, 1), 0) <= 3)
);
create index if not exists student_notes_student_idx on public.student_notes (student_id, tanggal desc);
create index if not exists student_notes_class_idx on public.student_notes (class_id, tanggal desc);
create index if not exists student_notes_author_idx on public.student_notes (author_staff_id);

create table if not exists public.admin_audit_log (
    id          bigint      generated always as identity primary key,
    entitas     text        not null,
    entitas_id  uuid,
    aksi        text        not null,
    ringkasan   text,
    data_lama   jsonb,
    oleh_user   uuid        default auth.uid(),
    oleh_nama   text,
    waktu       timestamptz not null default now(),
    constraint admin_audit_log_aksi check (aksi in ('ubah', 'hapus'))
);
create index if not exists admin_audit_log_waktu_idx on public.admin_audit_log (entitas, waktu desc);

alter table public.student_notes enable row level security;
alter table public.student_notes force row level security;
alter table public.admin_audit_log enable row level security;
alter table public.admin_audit_log force row level security;
revoke all on table public.student_notes, public.admin_audit_log from public, anon, authenticated;
grant all on table public.student_notes, public.admin_audit_log to service_role;

-- -----------------------------------------------------------------------------
-- Internal
-- -----------------------------------------------------------------------------
/** Kelas siswa sekarang (tahun ajaran aktif). */
create or replace function public.note__kelas_kini(p_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select e.class_id
    from public.student_enrollments e
    join public.classes c on c.id = e.class_id
    join public.academic_years y on y.id = c.academic_year_id and y.is_active
    where e.student_id = p_student_id and e.start_date <= public.jakarta_today()
      and (e.end_date is null or e.end_date >= public.jakarta_today())
    order by e.start_date desc
    limit 1;
$$;

/** Daftar siswa rombel pada tanggal (tanpa cek akses — semua guru boleh mencatat siswa kelas mana pun). */
create or replace function public.note__roster(p_class_id uuid, p_date date)
returns table (student_id uuid, no_urut integer, nama text, jenis_kelamin text, nis text)
language sql
stable
security definer
set search_path = ''
as $$
    select s.id, (row_number() over (order by upper(btrim(s.nama_siswa)), s.id))::integer, s.nama_siswa,
           case s.payload ->> 'siswa_jenis_kelamin_nama' when 'Laki-laki' then 'L' when 'Perempuan' then 'P' else null end, s.nipd
    from public.student_enrollments e
    join public.student_records s on s.id = e.student_id
    where e.class_id = p_class_id and e.start_date <= p_date and (e.end_date is null or e.end_date >= p_date) and s.archived_at is null
    order by 2;
$$;

/** Boleh membaca catatan ini? */
create or replace function public.note__boleh_baca(p_author_staff uuid, p_class_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (
        public.att_is_admin() or public.is_pimpinan()
        or (p_author_staff is not null and p_author_staff = public.current_staff_id())
        or (p_class_id is not null and public.is_homeroom_of(p_class_id))
        or coalesce(public.is_homeroom_of(public.note__kelas_kini(p_student_id)), false));
$$;

/** Rentang tanggal semester untuk kelas (semester 1 = awal tahun ajaran–31 Des; 2 = 1 Jan–akhir). */
create or replace function public.note__rentang(p_class_id uuid, p_semester smallint)
returns table (mulai date, selesai date)
language sql
stable
security definer
set search_path = ''
as $$
    select case when p_semester = 1 then y.start_date else make_date(extract(year from y.end_date)::int, 1, 1) end,
           case when p_semester = 1 then make_date(extract(year from y.start_date)::int, 12, 31) else y.end_date end
    from public.classes c join public.academic_years y on y.id = c.academic_year_id where c.id = p_class_id;
$$;

/** Nama yang mengubah dari akun admin/operator (nama staf bila akunnya tertaut, selain itu email). */
create or replace function public.admin__nama()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select s.name from public.staff s where s.id = public.current_staff_id()),
                    (select split_part(u.email, '@', 1) from auth.users u where u.id = (select auth.uid())),
                    'Admin');
$$;

create or replace function public.note__json(n public.student_notes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object('id', n.id, 'group_id', n.group_id, 'student_id', n.student_id, 'class_id', n.class_id,
        'kelas', (select c.name from public.classes c where c.id = n.class_id),
        'siswa', (select r.nama_siswa from public.student_records r where r.id = n.student_id),
        'jenis', n.jenis, 'tingkat', n.tingkat, 'tanggal', n.tanggal, 'judul', n.judul, 'cerita', n.cerita,
        'tindak_lanjut', n.tindak_lanjut, 'tindak_lanjut_oleh', n.tindak_lanjut_oleh, 'tindak_lanjut_at', n.tindak_lanjut_at,
        'fotos', to_jsonb(n.fotos), 'penulis', n.author_name,
        'penulis_peran', case when n.class_id is not null and exists (select 1 from public.homeroom_assignments h where h.class_id = n.class_id and h.staff_id = n.author_staff_id) then 'wali kelas'
                              else (select split_part(s.role, '|', 2) from public.staff s where s.id = n.author_staff_id) end,
        'milik_saya', n.author_staff_id is not null and n.author_staff_id = public.current_staff_id(),
        'bisa_tindak_lanjut', public.att_is_admin() or (n.author_staff_id is not null and n.author_staff_id = public.current_staff_id())
                              or (n.class_id is not null and public.is_homeroom_of(n.class_id)) or coalesce(public.is_homeroom_of(public.note__kelas_kini(n.student_id)), false),
        'dirapikan_oleh', n.dirapikan_oleh, 'dirapikan_at', n.dirapikan_at, 'dibuat', n.created_at);
$$;

revoke all on function public.note__kelas_kini(uuid) from public, anon, authenticated;
revoke all on function public.note__roster(uuid, date) from public, anon, authenticated;
revoke all on function public.note__boleh_baca(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.note__rentang(uuid, smallint) from public, anon, authenticated;
revoke all on function public.admin__nama() from public, anon, authenticated;
revoke all on function public.note__json(public.student_notes) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Guru
-- -----------------------------------------------------------------------------
/** Kelas yang bisa dibuka di menu Catatan Siswa: semua rombel tahun ajaran aktif (kelas walian/ajar ditandai). */
create or replace function public.get_note_classes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or (public.current_staff_id() is null and not public.att_is_admin()) then
        raise exception 'Catatan siswa hanya untuk akun guru.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.name, 'tingkat', c.grade, 'rombel', c.section,
                   'wali', public.is_homeroom_of(c.id),
                   'ajar', exists (select 1 from public.subject_assignments sa where sa.class_id = c.id and sa.staff_id = public.current_staff_id()))
               order by public.is_homeroom_of(c.id) desc,
                        exists (select 1 from public.subject_assignments sa where sa.class_id = c.id and sa.staff_id = public.current_staff_id()) desc,
                        c.grade, c.section)
        from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active), '[]'::jsonb);
end;
$$;

/**
 * Halaman kelas: daftar siswa + jumlah catatan yang BOLEH DILIHAT pemanggil, semester itu, dan catatannya.
 * lihat_semua = wali kelas / kepala sekolah / admin (selain itu hanya catatan sendiri).
 */
create or replace function public.get_class_notes(p_class_id uuid, p_semester smallint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_m date; v_s date; v_class record;
begin
    if (select auth.uid()) is null or (public.current_staff_id() is null and not public.att_is_admin() and not public.is_pimpinan()) then
        raise exception 'Catatan siswa hanya untuk akun guru.' using errcode = '42501';
    end if;
    if p_semester not in (1, 2) then raise exception 'Semester harus 1 atau 2.' using errcode = '22023'; end if;
    select c.id, c.grade, c.section, c.name, y.name as tahun into v_class
    from public.classes c join public.academic_years y on y.id = c.academic_year_id where c.id = p_class_id;
    if v_class.id is null then raise exception 'Kelas tidak ditemukan.' using errcode = '22023'; end if;
    select r.mulai, r.selesai into v_m, v_s from public.note__rentang(p_class_id, p_semester) r;
    return jsonb_build_object(
        'kelas', jsonb_build_object('id', v_class.id, 'nama', v_class.name, 'tingkat', v_class.grade, 'rombel', v_class.section, 'tahun_ajaran', v_class.tahun),
        'semester', p_semester,
        'lihat_semua', public.att_is_admin() or public.is_pimpinan() or public.is_homeroom_of(p_class_id),
        'wali', coalesce((select jsonb_agg(jsonb_build_object('nama', s.name, 'posisi', h.position,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), '')) order by h.position)
                          from public.homeroom_assignments h join public.staff s on s.id = h.staff_id where h.class_id = p_class_id), '[]'::jsonb),
        'kepala_sekolah', (select jsonb_build_object('nama', s.name,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                           from public.staff s where split_part(s.role, '|', 1) = 'Kepala Sekolah'
                           order by s.order_index nulls last, s.name limit 1),
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object('id', r.student_id, 'no', r.no_urut, 'nama', r.nama, 'jk', r.jenis_kelamin, 'nis', r.nis) order by r.no_urut)
            from public.note__roster(p_class_id, least(greatest(public.jakarta_today(), v_m), v_s)) r), '[]'::jsonb),
        'catatan', coalesce((
            select jsonb_agg(public.note__json(n) order by n.tanggal desc, n.created_at desc)
            from public.student_notes n
            where n.tanggal between v_m and v_s
              and n.student_id in (select r.student_id from public.note__roster(p_class_id, least(greatest(public.jakarta_today(), v_m), v_s)) r)
              and public.note__boleh_baca(n.author_staff_id, n.class_id, n.student_id)), '[]'::jsonb));
end;
$$;

/** Riwayat satu siswa (semua catatan yang boleh dilihat; p_semua=false → semester berjalan saja). */
create or replace function public.get_student_notes(p_student_id uuid, p_semua boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_kelas uuid := public.note__kelas_kini(p_student_id);
    v_m date := '1900-01-01'; v_s date := '2999-12-31';
begin
    if (select auth.uid()) is null or (public.current_staff_id() is null and not public.att_is_admin() and not public.is_pimpinan()) then
        raise exception 'Catatan siswa hanya untuk akun guru.' using errcode = '42501';
    end if;
    if not p_semua and v_kelas is not null then
        select r.mulai, r.selesai into v_m, v_s from public.note__rentang(v_kelas, case when extract(month from public.jakarta_today()) >= 7 then 1 else 2 end::smallint) r;
    end if;
    return jsonb_build_object(
        'siswa', (select jsonb_build_object('id', s.id, 'nama', s.nama_siswa, 'nis', coalesce(s.nipd, s.payload ->> 'siswa_nipd'),
                         'jk', case when s.payload ->> 'siswa_jenis_kelamin_nama' ilike 'p%' then 'P' when s.payload ->> 'siswa_jenis_kelamin_nama' ilike 'l%' then 'L' end,
                         'class_id', v_kelas, 'kelas', (select c.name from public.classes c where c.id = v_kelas))
                  from public.student_records s where s.id = p_student_id),
        'catatan', coalesce((
            select jsonb_agg(public.note__json(n) order by n.tanggal desc, n.created_at desc)
            from public.student_notes n
            where n.student_id = p_student_id and n.tanggal between v_m and v_s
              and public.note__boleh_baca(n.author_staff_id, n.class_id, n.student_id)), '[]'::jsonb));
end;
$$;

/**
 * Tulis (p_id null, untuk 1+ siswa sekaligus) atau ubah catatan sendiri (p_id; admin: tercatat & ditandai dirapikan).
 * Foto: path di bucket catatan-siswa; foto baru harus di folder pengunggah sendiri (<uid>/…).
 */
create or replace function public.save_student_note(p_jenis text, p_judul text, p_tanggal date,
                                                    p_student_ids uuid[] default null, p_class_id uuid default null,
                                                    p_tingkat text default null, p_cerita text default null,
                                                    p_tindak_lanjut text default null, p_fotos text[] default '{}',
                                                    p_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_staff  uuid := public.current_staff_id();
    v_judul  text := nullif(btrim(regexp_replace(coalesce(p_judul, ''), '\s+', ' ', 'g')), '');
    v_cerita text := nullif(btrim(coalesce(p_cerita, '')), '');
    v_tl     text := nullif(btrim(coalesce(p_tindak_lanjut, '')), '');
    v_fotos  text[] := coalesce(p_fotos, '{}');
    v_ting   text := case when p_jenis = 'perilaku' then coalesce(nullif(p_tingkat, ''), 'ringan') end;
    v_old    public.student_notes;
    v_admin  boolean := public.att_is_admin();
    v_group  uuid := gen_random_uuid();
    v_sid    uuid;
    v_ids    uuid[] := '{}';
    v_id     uuid;
    v_f      text;
    v_nama   text;
begin
    if (select auth.uid()) is null or (v_staff is null and not v_admin) then
        raise exception 'Catatan siswa hanya untuk akun guru.' using errcode = '42501';
    end if;
    if p_jenis not in ('apresiasi', 'perilaku', 'catatan') then raise exception 'Jenis catatan tidak dikenal.' using errcode = '22023'; end if;
    if v_ting is not null and v_ting not in ('ringan', 'perhatian', 'serius') then raise exception 'Tingkat tidak dikenal.' using errcode = '22023'; end if;
    if v_judul is null or length(v_judul) > 120 then raise exception 'Judul wajib diisi (maks. 120 huruf).' using errcode = '22023'; end if;
    if length(coalesce(v_cerita, '')) > 1000 then raise exception 'Cerita maksimal 1000 huruf.' using errcode = '22023'; end if;
    if length(coalesce(v_tl, '')) > 500 then raise exception 'Tindak lanjut maksimal 500 huruf.' using errcode = '22023'; end if;
    if coalesce(array_length(v_fotos, 1), 0) > 3 then raise exception 'Maksimal 3 foto per catatan.' using errcode = '22023'; end if;
    if p_tanggal is null or p_tanggal > public.jakarta_today() then raise exception 'Tanggal catatan tidak boleh di masa depan.' using errcode = '22023'; end if;
    select coalesce((select s.name from public.staff s where s.id = v_staff), public.admin__nama()) into v_nama;

    if p_id is not null then
        select * into v_old from public.student_notes where id = p_id for update;
        if v_old.id is null then raise exception 'Catatan tidak ditemukan.' using errcode = '22023'; end if;
        if not (v_admin or (v_staff is not null and v_old.author_staff_id = v_staff)) then
            raise exception 'Hanya penulis atau admin/operator yang bisa mengubah catatan ini.' using errcode = '42501';
        end if;
        foreach v_f in array v_fotos loop
            if not (v_f = any (v_old.fotos) or split_part(v_f, '/', 1) = (select auth.uid())::text) then
                raise exception 'Foto tidak valid.' using errcode = '22023';
            end if;
        end loop;
        update public.student_notes
        set jenis = p_jenis, tingkat = v_ting, tanggal = p_tanggal, judul = v_judul, cerita = v_cerita, fotos = v_fotos,
            tindak_lanjut = v_tl,
            tindak_lanjut_oleh = case when v_tl is distinct from v_old.tindak_lanjut then case when v_tl is null then null else v_nama end else tindak_lanjut_oleh end,
            tindak_lanjut_at = case when v_tl is distinct from v_old.tindak_lanjut then case when v_tl is null then null else now() end else tindak_lanjut_at end,
            dirapikan_oleh = case when v_old.author_staff_id is distinct from v_staff then public.admin__nama() else dirapikan_oleh end,
            dirapikan_at = case when v_old.author_staff_id is distinct from v_staff then now() else dirapikan_at end,
            updated_at = now()
        where id = p_id;
        if v_old.author_staff_id is distinct from v_staff then
            insert into public.admin_audit_log (entitas, entitas_id, aksi, ringkasan, data_lama, oleh_nama)
            values ('catatan_siswa', p_id, 'ubah', format('%s — %s', (select nama_siswa from public.student_records where id = v_old.student_id), v_old.judul),
                    to_jsonb(v_old), public.admin__nama());
        end if;
        return jsonb_build_object('ids', jsonb_build_array(p_id));
    end if;

    if p_student_ids is null or coalesce(array_length(p_student_ids, 1), 0) = 0 then
        raise exception 'Pilih minimal satu siswa.' using errcode = '22023';
    end if;
    if array_length(p_student_ids, 1) > 40 then raise exception 'Maksimal 40 siswa sekaligus.' using errcode = '22023'; end if;
    foreach v_f in array v_fotos loop
        if split_part(v_f, '/', 1) <> (select auth.uid())::text then raise exception 'Foto tidak valid.' using errcode = '22023'; end if;
    end loop;
    foreach v_sid in array p_student_ids loop
        if p_class_id is null or not exists (select 1 from public.note__roster(p_class_id, p_tanggal) r where r.student_id = v_sid)
           and not exists (select 1 from public.note__roster(p_class_id, public.jakarta_today()) r where r.student_id = v_sid) then
            raise exception 'Ada siswa yang tidak terdaftar di kelas itu.' using errcode = '22023';
        end if;
        insert into public.student_notes (group_id, student_id, class_id, jenis, tingkat, tanggal, judul, cerita, tindak_lanjut,
                                          tindak_lanjut_oleh, tindak_lanjut_at, fotos, author_staff_id, author_name)
        values (v_group, v_sid, p_class_id, p_jenis, v_ting, p_tanggal, v_judul, v_cerita, v_tl,
                case when v_tl is not null then v_nama end, case when v_tl is not null then now() end, v_fotos, v_staff, v_nama)
        returning id into v_id;
        v_ids := v_ids || v_id;
    end loop;
    return jsonb_build_object('ids', to_jsonb(v_ids), 'group_id', v_group);
end;
$$;

/** Isi/ubah tindak lanjut (penulis, wali kelas siswa, admin/operator). */
create or replace function public.set_note_followup(p_id uuid, p_text text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_n public.student_notes;
    v_tl text := nullif(btrim(coalesce(p_text, '')), '');
begin
    select * into v_n from public.student_notes where id = p_id for update;
    if v_n.id is null then raise exception 'Catatan tidak ditemukan.' using errcode = '22023'; end if;
    if (select auth.uid()) is null or not (public.att_is_admin()
            or (v_n.author_staff_id is not null and v_n.author_staff_id = public.current_staff_id())
            or (v_n.class_id is not null and public.is_homeroom_of(v_n.class_id))
            or coalesce(public.is_homeroom_of(public.note__kelas_kini(v_n.student_id)), false)) then
        raise exception 'Hanya penulis, wali kelas, atau admin/operator yang bisa mengisi tindak lanjut.' using errcode = '42501';
    end if;
    if length(coalesce(v_tl, '')) > 500 then raise exception 'Tindak lanjut maksimal 500 huruf.' using errcode = '22023'; end if;
    update public.student_notes
    set tindak_lanjut = v_tl, tindak_lanjut_oleh = case when v_tl is null then null else coalesce((select s.name from public.staff s where s.id = public.current_staff_id()), public.admin__nama()) end,
        tindak_lanjut_at = case when v_tl is null then null else now() end, updated_at = now()
    where id = p_id returning * into v_n;
    return public.note__json(v_n);
end;
$$;

/** Hapus catatan (penulis atau admin/operator; admin tercatat). Kembalikan foto yang perlu dihapus dari storage. */
create or replace function public.delete_student_note(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_n public.student_notes;
    v_staff uuid := public.current_staff_id();
begin
    select * into v_n from public.student_notes where id = p_id for update;
    if v_n.id is null then raise exception 'Catatan tidak ditemukan.' using errcode = '22023'; end if;
    if (select auth.uid()) is null or not (public.att_is_admin() or (v_staff is not null and v_n.author_staff_id = v_staff)) then
        raise exception 'Hanya penulis atau admin/operator yang bisa menghapus catatan ini.' using errcode = '42501';
    end if;
    if v_n.author_staff_id is distinct from v_staff then
        insert into public.admin_audit_log (entitas, entitas_id, aksi, ringkasan, data_lama, oleh_nama)
        values ('catatan_siswa', p_id, 'hapus', format('%s — %s', (select nama_siswa from public.student_records where id = v_n.student_id), v_n.judul),
                to_jsonb(v_n), public.admin__nama());
    end if;
    delete from public.student_notes where id = p_id;
    -- foto yang tidak dipakai catatan lain (catatan grup berbagi foto)
    return jsonb_build_object('fotos', coalesce((select jsonb_agg(f) from unnest(v_n.fotos) f
                                                 where not exists (select 1 from public.student_notes o where f = any (o.fotos))), '[]'::jsonb));
end;
$$;

/** Boleh membuka foto? (dipakai policy storage) */
create or replace function public.note_foto_boleh(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (
        split_part(p_name, '/', 1) = (select auth.uid())::text
        or public.att_is_admin()
        or exists (select 1 from public.student_notes n where p_name = any (n.fotos)
                   and public.note__boleh_baca(n.author_staff_id, n.class_id, n.student_id)));
$$;

-- -----------------------------------------------------------------------------
-- Admin / operator
-- -----------------------------------------------------------------------------
create or replace function public.get_notes_admin(p_semester smallint, p_class_id uuid default null, p_jenis text default null,
                                                  p_author uuid default null, p_q text default null, p_limit int default 300)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_m date; v_s date; v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin/operator.' using errcode = '42501';
    end if;
    select case when p_semester = 1 then y.start_date else make_date(extract(year from y.end_date)::int, 1, 1) end,
           case when p_semester = 1 then make_date(extract(year from y.start_date)::int, 12, 31) else y.end_date end
    into v_m, v_s from public.academic_years y where y.is_active;
    return jsonb_build_object(
        'ringkas', (select jsonb_build_object(
                'apresiasi', count(*) filter (where jenis = 'apresiasi'), 'perilaku', count(*) filter (where jenis = 'perilaku'),
                'serius', count(*) filter (where tingkat = 'serius'), 'catatan', count(*) filter (where jenis = 'catatan'),
                'serius_terbuka', count(*) filter (where tingkat = 'serius' and tindak_lanjut is null))
            from public.student_notes where tanggal between v_m and v_s),
        'kelas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.name) order by c.grade, c.section)
                           from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active), '[]'::jsonb),
        'penulis', coalesce((select jsonb_agg(jsonb_build_object('id', x.author_staff_id, 'nama', x.author_name) order by x.author_name)
                             from (select distinct on (author_staff_id) author_staff_id, author_name from public.student_notes
                                   where author_staff_id is not null and tanggal between v_m and v_s order by author_staff_id, created_at desc) x), '[]'::jsonb),
        'catatan', coalesce((
            select jsonb_agg(j order by (j ->> 'tanggal') desc, (j ->> 'dibuat') desc)
            from (select public.note__json(n) j from public.student_notes n
                  left join public.student_records r on r.id = n.student_id
                  where n.tanggal between v_m and v_s
                    and (p_class_id is null or n.class_id = p_class_id)
                    and (p_jenis is null or n.jenis = p_jenis or (p_jenis = 'serius' and n.tingkat = 'serius'))
                    and (p_author is null or n.author_staff_id = p_author)
                    and (v_q is null or r.nama_siswa ilike '%' || v_q || '%' or n.judul ilike '%' || v_q || '%' or coalesce(n.cerita, '') ilike '%' || v_q || '%')
                  order by n.tanggal desc, n.created_at desc
                  limit least(greatest(coalesce(p_limit, 300), 1), 1000)) t), '[]'::jsonb));
end;
$$;

/** Jurnal mengajar seorang guru dalam satu bulan (admin/operator), dengan tanda kemungkinan dobel. */
create or replace function public.get_journal_admin(p_staff_id uuid, p_tahun int, p_bulan int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_awal date;
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin/operator.' using errcode = '42501';
    end if;
    if p_bulan not between 1 and 12 or p_tahun not between 2020 and 2100 then raise exception 'Bulan tidak valid.' using errcode = '22023'; end if;
    v_awal := make_date(p_tahun, p_bulan, 1);
    return jsonb_build_object(
        'guru', coalesce((
            select jsonb_agg(jsonb_build_object('id', s.id, 'nama', s.name,
                       'jumlah', (select count(*) from public.teaching_journal j where j.staff_id = s.id and j.tanggal >= v_awal and j.tanggal < (v_awal + interval '1 month')::date),
                       'wali', (select string_agg(c.name, ', ') from public.homeroom_assignments h join public.classes c on c.id = h.class_id
                                join public.academic_years y on y.id = c.academic_year_id and y.is_active where h.staff_id = s.id))
                   order by s.name)
            from public.staff s
            where exists (select 1 from public.teaching_journal j where j.staff_id = s.id)
               or exists (select 1 from public.homeroom_assignments h where h.staff_id = s.id)
               or exists (select 1 from public.subject_assignments sa where sa.staff_id = s.id)), '[]'::jsonb),
        'catatan', coalesce((
            select jsonb_agg(jsonb_build_object('id', x.id, 'tanggal', x.tanggal, 'kelas', x.kelas, 'mapel', x.mapel, 'judul', x.judul,
                       'jam', x.jam, 'status', x.status, 'materi', x.materi, 'keterangan', x.keterangan, 'dobel', x.n > 1)
                   order by x.tanggal desc, x.created_at)
            from (select j.*, c.name as kelas, coalesce(sub.short_name, sub.name) as mapel,
                         count(*) over (partition by j.tanggal, j.class_id, lower(coalesce(sub.short_name, sub.name, j.judul))) as n
                  from public.teaching_journal j
                  left join public.classes c on c.id = j.class_id
                  left join public.subjects sub on sub.id = j.subject_id
                  where j.staff_id = p_staff_id and j.tanggal >= v_awal and j.tanggal < (v_awal + interval '1 month')::date) x), '[]'::jsonb));
end;
$$;

/** Hapus beberapa catatan jurnal (admin/operator) — tercatat di log. */
create or replace function public.admin_delete_journal(p_ids uuid[])
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_j public.teaching_journal;
    v_n int := 0;
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin/operator.' using errcode = '42501';
    end if;
    for v_j in select * from public.teaching_journal where id = any (coalesce(p_ids, '{}')) loop
        insert into public.admin_audit_log (entitas, entitas_id, aksi, ringkasan, data_lama, oleh_nama)
        values ('jurnal_mengajar', v_j.id, 'hapus',
                format('%s — %s, %s', (select s.name from public.staff s where s.id = v_j.staff_id),
                       coalesce((select coalesce(sub.short_name, sub.name) from public.subjects sub where sub.id = v_j.subject_id), v_j.judul),
                       to_char(v_j.tanggal, 'DD-MM-YYYY')),
                to_jsonb(v_j), public.admin__nama());
        delete from public.teaching_journal where id = v_j.id;
        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;

create or replace function public.get_admin_audit(p_entitas text default null, p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin/operator.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'entitas', a.entitas, 'aksi', a.aksi, 'ringkasan', a.ringkasan,
                   'data_lama', a.data_lama, 'oleh', a.oleh_nama, 'waktu', a.waktu) order by a.id desc)
        from (select * from public.admin_audit_log where p_entitas is null or entitas = p_entitas
              order by id desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) a), '[]'::jsonb);
end;
$$;

revoke all on function public.get_note_classes() from public, anon;
revoke all on function public.get_class_notes(uuid, smallint) from public, anon;
revoke all on function public.get_student_notes(uuid, boolean) from public, anon;
revoke all on function public.save_student_note(text, text, date, uuid[], uuid, text, text, text, text[], uuid) from public, anon;
revoke all on function public.set_note_followup(uuid, text) from public, anon;
revoke all on function public.delete_student_note(uuid) from public, anon;
revoke all on function public.note_foto_boleh(text) from public, anon;
revoke all on function public.get_notes_admin(smallint, uuid, text, uuid, text, int) from public, anon;
revoke all on function public.get_journal_admin(uuid, int, int) from public, anon;
revoke all on function public.admin_delete_journal(uuid[]) from public, anon;
revoke all on function public.get_admin_audit(text, int) from public, anon;
grant execute on function public.get_note_classes(), public.get_class_notes(uuid, smallint), public.get_student_notes(uuid, boolean),
    public.save_student_note(text, text, date, uuid[], uuid, text, text, text, text[], uuid), public.set_note_followup(uuid, text),
    public.delete_student_note(uuid), public.note_foto_boleh(text), public.get_notes_admin(smallint, uuid, text, uuid, text, int),
    public.get_journal_admin(uuid, int, int), public.admin_delete_journal(uuid[]), public.get_admin_audit(text, int)
    to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Storage: bucket privat foto catatan
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catatan-siswa', 'catatan-siswa', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "catatan_siswa_foto_baca" on storage.objects;
drop policy if exists "catatan_siswa_foto_unggah" on storage.objects;
drop policy if exists "catatan_siswa_foto_hapus" on storage.objects;
create policy "catatan_siswa_foto_baca" on storage.objects for select to authenticated
    using (bucket_id = 'catatan-siswa' and public.note_foto_boleh(name));
create policy "catatan_siswa_foto_unggah" on storage.objects for insert to authenticated
    with check (bucket_id = 'catatan-siswa' and (storage.foldername(name))[1] = (select auth.uid())::text
                and (public.current_staff_id() is not null or public.att_is_admin()));
create policy "catatan_siswa_foto_hapus" on storage.objects for delete to authenticated
    using (bucket_id = 'catatan-siswa' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.att_is_admin()));
