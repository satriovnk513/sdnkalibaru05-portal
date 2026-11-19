-- =============================================================================
-- Nilai rapor siswa.
--
-- - 14 mata pelajaran (kode tetap, urutan tampil).
-- - Per kelas & mapel: KKTP (batas tuntas) + tanda "tidak diajarkan di kelas ini".
-- - Per siswa, mapel, semester: UH1–UH3, STS, SAS (angka bulat 0–100, boleh kosong).
--   Nilai Akhir dihitung di aplikasi: round(50% rata-rata UH terisi + 25% STS + 25% SAS).
-- - Yang mengisi: guru mapel bila mapel itu punya guru mapel di kelas tsb
--   (subject_assignments), selain itu wali kelas. Admin boleh semua.
--   Kepala sekolah boleh melihat.
-- - Setiap perubahan tercatat di grade_changes (tidak bisa dihapus).
-- =============================================================================

alter table public.subjects add column if not exists sort_order smallint not null default 99;
alter table public.subjects add column if not exists short_name text;

insert into public.subjects (code, name) values
    ('BIN', 'Bahasa Indonesia'), ('BIG', 'Bahasa Inggris'), ('GAQ', 'Gemar Al-Quran'),
    ('IPAS', 'Ilmu Pengetahuan Alam dan Sosial (IPAS)'), ('KOK', 'Kokurikuler'), ('LIT', 'Literapedia'),
    ('MTK', 'Matematika'), ('NUM', 'Numerapedia'), ('PAI', 'Pendidikan Agama Islam'),
    ('PP', 'Pendidikan Pancasila'), ('PJOK', 'Pendidikan Jasmani, Olahraga, dan Kesehatan'),
    ('PLBJ', 'Pendidikan Lingkungan dan Budaya Jakarta'), ('SR', 'Seni Rupa'), ('SER', 'Serasi')
on conflict (code) do nothing;

update public.subjects s set sort_order = v.ord, short_name = v.short
from (values ('BIN', 1, 'Bahasa Indonesia'), ('BIG', 2, 'Bahasa Inggris'), ('GAQ', 3, 'Gemar Al-Quran'),
             ('IPAS', 4, 'IPAS'), ('KOK', 5, 'Kokurikuler'), ('LIT', 6, 'Literapedia'), ('MTK', 7, 'Matematika'),
             ('NUM', 8, 'Numerapedia'), ('PAI', 9, 'PAI'), ('PP', 10, 'Pendidikan Pancasila'), ('PJOK', 11, 'PJOK'),
             ('PLBJ', 12, 'PLBJ'), ('SR', 13, 'Seni Rupa'), ('SER', 14, 'Serasi')) as v(code, ord, short)
where s.code = v.code;

create table if not exists public.class_subject_settings (
    class_id    uuid        not null references public.classes (id) on delete cascade,
    subject_id  uuid        not null references public.subjects (id) on delete restrict,
    kktp        smallint,
    hidden      boolean     not null default false,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id) on delete set null,
    primary key (class_id, subject_id),
    constraint class_subject_settings_kktp check (kktp is null or kktp between 0 and 100)
);

create table if not exists public.student_grades (
    class_id    uuid        not null references public.classes (id) on delete cascade,
    student_id  uuid        not null references public.student_records (id) on delete cascade,
    subject_id  uuid        not null references public.subjects (id) on delete restrict,
    semester    smallint    not null,
    uh1 smallint, uh2 smallint, uh3 smallint, sts smallint, sas smallint,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id) on delete set null,
    primary key (class_id, student_id, subject_id, semester),
    constraint student_grades_semester check (semester in (1, 2)),
    constraint student_grades_range check (
        (uh1 is null or uh1 between 0 and 100) and (uh2 is null or uh2 between 0 and 100) and
        (uh3 is null or uh3 between 0 and 100) and (sts is null or sts between 0 and 100) and
        (sas is null or sas between 0 and 100))
);
create index if not exists student_grades_class_sem_idx on public.student_grades (class_id, semester, subject_id);

create table if not exists public.grade_changes (
    id          bigint      generated always as identity primary key,
    class_id    uuid        not null references public.classes (id) on delete cascade,
    student_id  uuid        references public.student_records (id) on delete cascade,
    subject_id  uuid        not null references public.subjects (id) on delete restrict,
    semester    smallint,
    field       text        not null,
    old_value   smallint,
    new_value   smallint,
    source      text        not null default 'portal',
    changed_by  uuid        default auth.uid(),
    changed_by_name text,
    changed_at  timestamptz not null default now(),
    constraint grade_changes_field check (field in ('uh1', 'uh2', 'uh3', 'sts', 'sas', 'kktp')),
    constraint grade_changes_source check (source in ('portal', 'impor', 'admin'))
);
create index if not exists grade_changes_class_idx on public.grade_changes (class_id, changed_at desc);

alter table public.class_subject_settings enable row level security;
alter table public.class_subject_settings force row level security;
alter table public.student_grades enable row level security;
alter table public.student_grades force row level security;
alter table public.grade_changes enable row level security;
alter table public.grade_changes force row level security;
revoke all on table public.class_subject_settings, public.student_grades, public.grade_changes from public, anon, authenticated;
grant all on table public.class_subject_settings, public.student_grades, public.grade_changes to service_role;
-- Semua baca/tulis lewat RPC di bawah (tidak ada akses tabel langsung untuk pengguna).

-- -----------------------------------------------------------------------------
-- Hak akses
-- -----------------------------------------------------------------------------
/** Mapel ini di kelas ini diisi guru mapel? (ada subject_assignments) */
create or replace function public.grade__has_subject_teacher(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (select 1 from public.subject_assignments sa where sa.class_id = p_class_id and sa.subject_id = p_subject_id);
$$;

create or replace function public.grade_can_edit(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (
        public.att_is_admin()
        or (public.grade__has_subject_teacher(p_class_id, p_subject_id) and public.teaches(p_class_id, p_subject_id))
        or (not public.grade__has_subject_teacher(p_class_id, p_subject_id) and public.is_homeroom_of(p_class_id)));
$$;

create or replace function public.grade_can_view(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (
        public.att_is_admin() or public.is_pimpinan() or public.is_homeroom_of(p_class_id)
        or public.teaches(p_class_id, p_subject_id));
$$;

/** Tanggal acuan daftar siswa untuk semester: hari ini bila di dalam semester, selain itu batas semester. */
create or replace function public.grade__roster_date(p_class_id uuid, p_semester smallint)
returns date
language sql
stable
security definer
set search_path = ''
as $$
    select greatest(r.mulai, least(public.jakarta_today(), r.selesai))
    from (
        select case when p_semester = 1 then y.start_date else make_date(extract(year from y.end_date)::int, 1, 1) end as mulai,
               case when p_semester = 1 then make_date(extract(year from y.start_date)::int, 12, 31) else y.end_date end as selesai
        from public.classes c join public.academic_years y on y.id = c.academic_year_id
        where c.id = p_class_id) r;
$$;

create or replace function public.grade__nama_pengubah()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select s.name from public.staff s where s.id = public.current_staff_id()),
                    case when public.att_is_admin() then 'Admin' end, 'Pengguna');
$$;

revoke all on function public.grade__has_subject_teacher(uuid, uuid) from public, anon, authenticated;
revoke all on function public.grade__roster_date(uuid, smallint) from public, anon, authenticated;
revoke all on function public.grade__nama_pengubah() from public, anon, authenticated;
revoke all on function public.grade_can_edit(uuid, uuid) from public, anon;
revoke all on function public.grade_can_view(uuid, uuid) from public, anon;
grant execute on function public.grade_can_edit(uuid, uuid), public.grade_can_view(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Baca
-- -----------------------------------------------------------------------------
/**
 * Semua yang dibutuhkan halaman nilai satu kelas & semester: info kelas, daftar mapel
 * yang boleh dilihat pemanggil (+ KKTP, siapa pengisinya, boleh ubah?), daftar siswa,
 * dan nilai. p_subject_id diisi → hanya mapel itu.
 */
create or replace function public.get_class_grades(p_class_id uuid, p_semester smallint, p_subject_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_date  date;
    v_class record;
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke kelas ini.' using errcode = '42501';
    end if;
    if p_semester not in (1, 2) then
        raise exception 'Semester harus 1 atau 2.' using errcode = '22023';
    end if;
    select c.id, c.grade, c.section, c.name, y.name as tahun into v_class
    from public.classes c join public.academic_years y on y.id = c.academic_year_id where c.id = p_class_id;
    v_date := public.grade__roster_date(p_class_id, p_semester);

    return jsonb_build_object(
        'kelas', jsonb_build_object('id', v_class.id, 'nama', v_class.name, 'tingkat', v_class.grade, 'rombel', v_class.section, 'tahun_ajaran', v_class.tahun),
        'semester', p_semester,
        'wali', coalesce((select jsonb_agg(jsonb_build_object('nama', s.name, 'posisi', h.position,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), '')) order by h.position)
                          from public.homeroom_assignments h join public.staff s on s.id = h.staff_id where h.class_id = p_class_id), '[]'::jsonb),
        'kepala_sekolah', (select jsonb_build_object('nama', s.name,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                           from public.staff s where split_part(s.role, '|', 1) = 'Kepala Sekolah'
                           order by s.order_index nulls last, s.name limit 1),
        'mapel', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', sub.id, 'kode', sub.code, 'nama', sub.name, 'singkat', coalesce(sub.short_name, sub.name),
                'kktp', cs.kktp, 'hidden', coalesce(cs.hidden, false),
                'guru_mapel', (select jsonb_agg(st.name order by st.name) from public.subject_assignments sa
                               join public.staff st on st.id = sa.staff_id where sa.class_id = p_class_id and sa.subject_id = sub.id),
                'can_edit', public.grade_can_edit(p_class_id, sub.id)) order by sub.sort_order, sub.name)
            from public.subjects sub
            left join public.class_subject_settings cs on cs.class_id = p_class_id and cs.subject_id = sub.id
            where (p_subject_id is null or sub.id = p_subject_id)
              and public.grade_can_view(p_class_id, sub.id)), '[]'::jsonb),
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object('id', r.student_id, 'no', r.no_urut, 'nama', r.nama, 'jk', r.jenis_kelamin, 'nis', r.nis, 'nisn', r.nisn) order by r.no_urut)
            from public.get_class_roster(p_class_id, v_date) r), '[]'::jsonb),
        'nilai', coalesce((
            select jsonb_agg(jsonb_build_object('s', g.student_id, 'm', g.subject_id, 'uh1', g.uh1, 'uh2', g.uh2, 'uh3', g.uh3, 'sts', g.sts, 'sas', g.sas))
            from public.student_grades g
            where g.class_id = p_class_id and g.semester = p_semester
              and (p_subject_id is null or g.subject_id = p_subject_id)
              and public.grade_can_view(p_class_id, g.subject_id)), '[]'::jsonb));
end;
$$;

/** Kelas yang bisa dibuka pemanggil di menu Nilai (wali kelas + kelas yang diajar guru mapel), tahun ajaran aktif. */
create or replace function public.get_my_grade_classes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.name, 'tingkat', c.grade, 'rombel', c.section,
               'wali', public.is_homeroom_of(c.id),
               'mapel', (select jsonb_agg(sub.short_name order by sub.sort_order) from public.subject_assignments sa
                         join public.subjects sub on sub.id = sa.subject_id
                         where sa.class_id = c.id and sa.staff_id = public.current_staff_id()))
           order by public.is_homeroom_of(c.id) desc, c.grade, c.section), '[]'::jsonb)
    from public.classes c
    join public.academic_years y on y.id = c.academic_year_id and y.is_active
    where (select auth.uid()) is not null
      and (public.is_homeroom_of(c.id) or public.is_pimpinan()
           or exists (select 1 from public.subject_assignments sa where sa.class_id = c.id and sa.staff_id = public.current_staff_id()));
$$;

create or replace function public.get_grade_history(p_class_id uuid, p_semester smallint default null, p_limit int default 300)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke kelas ini.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(x order by (x ->> 'id')::bigint desc)
        from (
            select jsonb_build_object('id', gc.id, 'waktu', gc.changed_at, 'siswa', sr.nama_siswa, 'mapel', coalesce(sub.short_name, sub.name),
                                      'semester', gc.semester, 'kolom', gc.field, 'lama', gc.old_value, 'baru', gc.new_value,
                                      'oleh', gc.changed_by_name, 'sumber', gc.source) as x
            from public.grade_changes gc
            join public.subjects sub on sub.id = gc.subject_id
            left join public.student_records sr on sr.id = gc.student_id
            where gc.class_id = p_class_id
              and (p_semester is null or gc.semester is null or gc.semester = p_semester)
              and public.grade_can_view(p_class_id, gc.subject_id)
            order by gc.id desc
            limit least(greatest(coalesce(p_limit, 300), 1), 2000)) t), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Tulis
-- -----------------------------------------------------------------------------
/**
 * Simpan nilai banyak mapel sekaligus (satu transaksi — dipakai halaman isi nilai & impor Excel).
 * p_items: [{subject_id, kktp?, entries: [{student_id, uh1, uh2, uh3, sts, sas}]}]
 *  - Kunci yang tidak ada di entry = tidak diubah. null = dikosongkan (kecuali p_keep_blank).
 *  - p_keep_blank = true (impor): null diabaikan, nilai lama tidak dihapus.
 *  - "kktp" di item: angka = set, null = kosongkan, tidak ada = tidak diubah.
 * Kembali: {baru, berubah, dihapus, kktp}
 */
create or replace function public.save_grades(p_class_id uuid, p_semester smallint, p_items jsonb,
                                              p_source text default 'portal', p_keep_blank boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    it        jsonb;
    e         jsonb;
    v_sub     uuid;
    v_stu     uuid;
    v_old     public.student_grades%rowtype;
    v_found   boolean;
    v_new     smallint[];
    v_cur     smallint[];
    v_fields  text[] := array['uh1', 'uh2', 'uh3', 'sts', 'sas'];
    v_val     jsonb;
    v_num     numeric;
    v_i       int;
    v_who     text := public.grade__nama_pengubah();
    v_src     text := case when p_source = 'impor' then 'impor' when public.att_is_admin() and public.current_staff_id() is null then 'admin' else 'portal' end;
    v_roster  uuid[];
    v_baru    int := 0;
    v_ubah    int := 0;
    v_hapus   int := 0;
    v_kktp    int := 0;
    v_oldk    smallint;
    v_newk    smallint;
    v_sname   text;
begin
    if (select auth.uid()) is null then
        raise exception 'Harus login.' using errcode = '42501';
    end if;
    if p_semester not in (1, 2) then
        raise exception 'Semester harus 1 atau 2.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_items) is distinct from 'array' then
        raise exception 'Data nilai tidak valid.' using errcode = '22023';
    end if;
    select array_agg(r.student_id) into v_roster
    from public.get_class_roster(p_class_id, public.grade__roster_date(p_class_id, p_semester)) r;
    v_roster := coalesce(v_roster, array[]::uuid[]);

    for it in select * from jsonb_array_elements(p_items) loop
        v_sub := nullif(it ->> 'subject_id', '')::uuid;
        select name into v_sname from public.subjects where id = v_sub;
        if v_sname is null then
            raise exception 'Mata pelajaran tidak dikenal.' using errcode = '22023';
        end if;
        if not public.grade_can_edit(p_class_id, v_sub) then
            raise exception 'Anda tidak berhak mengisi nilai % di kelas ini.', v_sname using errcode = '42501';
        end if;

        -- KKTP
        if it ? 'kktp' then
            v_val := it -> 'kktp';
            if jsonb_typeof(v_val) = 'null' or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '') then
                v_newk := null;
            else
                begin v_num := (v_val #>> '{}')::numeric; exception when others then v_num := -1; end;
                if v_num is null or v_num <> trunc(v_num) or v_num < 0 or v_num > 100 then
                    raise exception 'KKTP % harus angka bulat 0–100.', v_sname using errcode = '22023';
                end if;
                v_newk := v_num::smallint;
            end if;
            select kktp into v_oldk from public.class_subject_settings where class_id = p_class_id and subject_id = v_sub;
            if v_newk is distinct from v_oldk and not (p_keep_blank and v_newk is null) then
                insert into public.class_subject_settings (class_id, subject_id, kktp, updated_by)
                values (p_class_id, v_sub, v_newk, (select auth.uid()))
                on conflict (class_id, subject_id) do update set kktp = excluded.kktp, updated_at = now(), updated_by = excluded.updated_by;
                insert into public.grade_changes (class_id, subject_id, semester, field, old_value, new_value, source, changed_by_name)
                values (p_class_id, v_sub, null, 'kktp', v_oldk, v_newk, v_src, v_who);
                v_kktp := v_kktp + 1;
            end if;
        end if;

        for e in select * from jsonb_array_elements(coalesce(it -> 'entries', '[]'::jsonb)) loop
            v_stu := nullif(e ->> 'student_id', '')::uuid;
            if v_stu is null or not (v_stu = any (v_roster)) then
                raise exception 'Ada siswa yang tidak terdaftar di kelas ini.' using errcode = '22023';
            end if;
            select * into v_old from public.student_grades
            where class_id = p_class_id and student_id = v_stu and subject_id = v_sub and semester = p_semester for update;
            v_found := found;
            v_cur := array[v_old.uh1, v_old.uh2, v_old.uh3, v_old.sts, v_old.sas];
            if not v_found then v_cur := array[null, null, null, null, null]::smallint[]; end if;
            v_new := v_cur;
            for v_i in 1 .. 5 loop
                continue when not (e ? v_fields[v_i]);
                v_val := e -> v_fields[v_i];
                if jsonb_typeof(v_val) = 'null' or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '') then
                    if not p_keep_blank then v_new[v_i] := null; end if;
                    continue;
                end if;
                begin v_num := (v_val #>> '{}')::numeric; exception when others then v_num := -1; end;
                if v_num is null or v_num <> trunc(v_num) or v_num < 0 or v_num > 100 then
                    select nama_siswa into v_sname from public.student_records where id = v_stu;
                    raise exception 'Nilai % % harus angka bulat 0–100.', upper(v_fields[v_i]), v_sname using errcode = '22023';
                end if;
                v_new[v_i] := v_num::smallint;
            end loop;
            continue when v_new is not distinct from v_cur;
            for v_i in 1 .. 5 loop
                if v_new[v_i] is distinct from v_cur[v_i] then
                    insert into public.grade_changes (class_id, student_id, subject_id, semester, field, old_value, new_value, source, changed_by_name)
                    values (p_class_id, v_stu, v_sub, p_semester, v_fields[v_i], v_cur[v_i], v_new[v_i], v_src, v_who);
                    if v_cur[v_i] is null then v_baru := v_baru + 1;
                    elsif v_new[v_i] is null then v_hapus := v_hapus + 1;
                    else v_ubah := v_ubah + 1; end if;
                end if;
            end loop;
            insert into public.student_grades (class_id, student_id, subject_id, semester, uh1, uh2, uh3, sts, sas, updated_by)
            values (p_class_id, v_stu, v_sub, p_semester, v_new[1], v_new[2], v_new[3], v_new[4], v_new[5], (select auth.uid()))
            on conflict (class_id, student_id, subject_id, semester) do update
            set uh1 = excluded.uh1, uh2 = excluded.uh2, uh3 = excluded.uh3, sts = excluded.sts, sas = excluded.sas,
                updated_at = now(), updated_by = excluded.updated_by;
        end loop;
    end loop;
    return jsonb_build_object('baru', v_baru, 'berubah', v_ubah, 'dihapus', v_hapus, 'kktp', v_kktp);
end;
$$;

/** Tandai mapel "tidak diajarkan di kelas ini" (mis. IPAS di kelas 1–2). Wali kelas atau admin. */
create or replace function public.set_class_subject_hidden(p_class_id uuid, p_subject_id uuid, p_hidden boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.is_homeroom_of(p_class_id)) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengatur mapel kelas.' using errcode = '42501';
    end if;
    insert into public.class_subject_settings (class_id, subject_id, hidden, updated_by)
    values (p_class_id, p_subject_id, coalesce(p_hidden, false), (select auth.uid()))
    on conflict (class_id, subject_id) do update set hidden = excluded.hidden, updated_at = now(), updated_by = excluded.updated_by;
end;
$$;

/** Panel Admin: kelengkapan nilai per kelas × mapel (tahun ajaran aktif). */
create or replace function public.get_grades_admin_matrix(p_semester smallint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.is_pimpinan()) then
        raise exception 'Hanya admin atau kepala sekolah.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'mapel', (select jsonb_agg(jsonb_build_object('id', id, 'kode', code, 'singkat', coalesce(short_name, name), 'nama', name) order by sort_order, name) from public.subjects),
        'kelas', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', c.id, 'nama', c.name,
                'siswa', (select count(*) from public.get_class_roster(c.id, public.grade__roster_date(c.id, p_semester))),
                'sel', (select jsonb_object_agg(sub.id, jsonb_build_object(
                            'hidden', coalesce(cs.hidden, false), 'kktp', cs.kktp,
                            'lengkap', (select count(*) from public.student_grades g where g.class_id = c.id and g.subject_id = sub.id and g.semester = p_semester
                                          and g.uh1 is not null and g.uh2 is not null and g.uh3 is not null and g.sts is not null and g.sas is not null),
                            'terisi', (select count(*) from public.student_grades g where g.class_id = c.id and g.subject_id = sub.id and g.semester = p_semester
                                          and num_nonnulls(g.uh1, g.uh2, g.uh3, g.sts, g.sas) > 0)))
                        from public.subjects sub
                        left join public.class_subject_settings cs on cs.class_id = c.id and cs.subject_id = sub.id))
                order by c.grade, c.section)
            from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active), '[]'::jsonb));
end;
$$;

revoke all on function public.get_class_grades(uuid, smallint, uuid) from public, anon;
revoke all on function public.get_my_grade_classes() from public, anon;
revoke all on function public.get_grade_history(uuid, smallint, int) from public, anon;
revoke all on function public.save_grades(uuid, smallint, jsonb, text, boolean) from public, anon;
revoke all on function public.set_class_subject_hidden(uuid, uuid, boolean) from public, anon;
revoke all on function public.get_grades_admin_matrix(smallint) from public, anon;
grant execute on function public.get_class_grades(uuid, smallint, uuid), public.get_my_grade_classes(),
    public.get_grade_history(uuid, smallint, int), public.save_grades(uuid, smallint, jsonb, text, boolean),
    public.set_class_subject_hidden(uuid, uuid, boolean), public.get_grades_admin_matrix(smallint)
    to authenticated, service_role;
