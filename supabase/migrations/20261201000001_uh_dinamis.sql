-- =============================================================================
-- Jumlah ulangan harian tidak selalu tiga. Sekarang tiap kelas+mapel+semester
-- punya jumlah kolom UH sendiri (1–10, bawaan 3) yang bisa diatur guru
-- pengampu, wali kelas, atau admin — persis sesiapa yang boleh mengisi nilainya.
--
-- Rumus Nilai Akhir tidak berubah: round(50% rata-rata UH terisi + 25% STS +
-- 25% SAS). Yang berubah hanya "berapa UH" yang ikut dirata-rata.
--
-- Mengurangi jumlah UH yang kolomnya masih terisi akan menghapus nilai itu,
-- jadi harus dikonfirmasi dulu (p_force) dan setiap nilai yang hilang dicatat
-- di riwayat nilai.
-- =============================================================================

alter table public.student_grades
    add column if not exists uh4  smallint, add column if not exists uh5  smallint,
    add column if not exists uh6  smallint, add column if not exists uh7  smallint,
    add column if not exists uh8  smallint, add column if not exists uh9  smallint,
    add column if not exists uh10 smallint;

alter table public.student_grades drop constraint if exists student_grades_range;
alter table public.student_grades add constraint student_grades_range check (
    (uh1 is null or uh1 between 0 and 100) and (uh2 is null or uh2 between 0 and 100) and
    (uh3 is null or uh3 between 0 and 100) and (uh4 is null or uh4 between 0 and 100) and
    (uh5 is null or uh5 between 0 and 100) and (uh6 is null or uh6 between 0 and 100) and
    (uh7 is null or uh7 between 0 and 100) and (uh8 is null or uh8 between 0 and 100) and
    (uh9 is null or uh9 between 0 and 100) and (uh10 is null or uh10 between 0 and 100) and
    (sts is null or sts between 0 and 100) and (sas is null or sas between 0 and 100));

alter table public.grade_changes drop constraint if exists grade_changes_field;
alter table public.grade_changes add constraint grade_changes_field check (
    field in ('uh1', 'uh2', 'uh3', 'uh4', 'uh5', 'uh6', 'uh7', 'uh8', 'uh9', 'uh10',
              'sts', 'sas', 'kktp', 'jumlah_uh'));

-- -----------------------------------------------------------------------------
-- Jumlah kolom UH per kelas + mapel + semester
-- -----------------------------------------------------------------------------
create table if not exists public.class_subject_uh (
    class_id   uuid        not null references public.classes (id) on delete cascade,
    subject_id uuid        not null references public.subjects (id) on delete cascade,
    semester   smallint    not null,
    uh_count   smallint    not null default 3,
    updated_at timestamptz not null default now(),
    updated_by uuid        references auth.users (id) on delete set null,
    primary key (class_id, subject_id, semester),
    constraint class_subject_uh_semester check (semester in (1, 2)),
    constraint class_subject_uh_count check (uh_count between 1 and 10)
);

comment on table public.class_subject_uh is
    'Jumlah kolom ulangan harian per kelas+mapel+semester (1–10). Baris tidak ada = 3 kolom.';

alter table public.class_subject_uh enable row level security;
alter table public.class_subject_uh force row level security;
revoke all on table public.class_subject_uh from public, anon, authenticated;

/** Jumlah kolom UH kelas+mapel+semester ini; 3 bila belum pernah diatur. */
create or replace function public.grade__uh_count(p_class_id uuid, p_subject_id uuid, p_semester smallint)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select uh_count from public.class_subject_uh
                     where class_id = p_class_id and subject_id = p_subject_id and semester = p_semester), 3::smallint);
$$;
revoke all on function public.grade__uh_count(uuid, uuid, smallint) from public, anon;
grant execute on function public.grade__uh_count(uuid, uuid, smallint) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Atur jumlah kolom UH
-- -----------------------------------------------------------------------------
/**
 * Ubah jumlah kolom UH satu mapel di satu kelas & semester (1–10).
 * Mengurangi jumlah membuang nilai di kolom yang hilang, jadi:
 *   - p_force = false  -> kalau masih ada nilai, ditolak dan dilaporkan berapa yang akan hilang
 *   - p_force = true   -> nilai dikosongkan dan setiap penghapusan dicatat di riwayat
 * Kembali: {jumlah, sebelumnya, terhapus}
 */
create or replace function public.set_subject_uh_count(p_class_id uuid, p_subject_id uuid, p_count smallint,
                                                       p_semester smallint, p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_lama    smallint;
    v_isi     int := 0;
    v_hapus   int := 0;
    v_who     text := public.grade__nama_pengubah();
    v_src     text := case when public.att_is_admin() and public.current_staff_id() is null then 'admin' else 'portal' end;
begin
    if not public.grade_can_edit(p_class_id, p_subject_id) then
        raise exception 'Anda tidak berhak mengubah jumlah UH mapel ini.' using errcode = '42501';
    end if;
    if p_semester not in (1, 2) then
        raise exception 'Semester harus 1 atau 2.' using errcode = '22023';
    end if;
    if p_count is null or p_count not between 1 and 10 then
        raise exception 'Jumlah UH harus 1–10.' using errcode = '22023';
    end if;
    v_lama := public.grade__uh_count(p_class_id, p_subject_id, p_semester);

    if p_count < v_lama then
        select count(*) into v_isi
        from public.student_grades g
        where g.class_id = p_class_id and g.subject_id = p_subject_id and g.semester = p_semester
          and exists (select 1 from unnest(array[g.uh1, g.uh2, g.uh3, g.uh4, g.uh5,
                                                 g.uh6, g.uh7, g.uh8, g.uh9, g.uh10]) with ordinality u(nilai, ke)
                      where u.ke > p_count and u.nilai is not null);
        if v_isi > 0 and not p_force then
            raise exception 'Masih ada nilai di kolom UH yang akan dibuang (% siswa).', v_isi using errcode = '23514';
        end if;

        insert into public.grade_changes (class_id, student_id, subject_id, semester, field, old_value, new_value, source, changed_by_name)
        select g.class_id, g.student_id, g.subject_id, g.semester, 'uh' || u.ke, u.nilai, null, v_src, v_who
        from public.student_grades g,
             unnest(array[g.uh1, g.uh2, g.uh3, g.uh4, g.uh5,
                          g.uh6, g.uh7, g.uh8, g.uh9, g.uh10]) with ordinality u(nilai, ke)
        where g.class_id = p_class_id and g.subject_id = p_subject_id and g.semester = p_semester
          and u.ke > p_count and u.nilai is not null;
        get diagnostics v_hapus = row_count;

        update public.student_grades g
        set uh2  = case when 2  > p_count then null else g.uh2  end,
            uh3  = case when 3  > p_count then null else g.uh3  end,
            uh4  = case when 4  > p_count then null else g.uh4  end,
            uh5  = case when 5  > p_count then null else g.uh5  end,
            uh6  = case when 6  > p_count then null else g.uh6  end,
            uh7  = case when 7  > p_count then null else g.uh7  end,
            uh8  = case when 8  > p_count then null else g.uh8  end,
            uh9  = case when 9  > p_count then null else g.uh9  end,
            uh10 = case when 10 > p_count then null else g.uh10 end,
            updated_at = now(), updated_by = (select auth.uid())
        where g.class_id = p_class_id and g.subject_id = p_subject_id and g.semester = p_semester;
    end if;

    insert into public.class_subject_uh (class_id, subject_id, semester, uh_count, updated_by)
    values (p_class_id, p_subject_id, p_semester, p_count, (select auth.uid()))
    on conflict (class_id, subject_id, semester) do update
    set uh_count = excluded.uh_count, updated_at = now(), updated_by = excluded.updated_by;

    if p_count is distinct from v_lama then
        insert into public.grade_changes (class_id, subject_id, semester, field, old_value, new_value, source, changed_by_name)
        values (p_class_id, p_subject_id, p_semester, 'jumlah_uh', v_lama, p_count, v_src, v_who);
    end if;

    return jsonb_build_object('jumlah', p_count, 'sebelumnya', v_lama, 'terhapus', v_hapus);
end;
$$;

revoke all on function public.set_subject_uh_count(uuid, uuid, smallint, smallint, boolean) from public, anon;
grant execute on function public.set_subject_uh_count(uuid, uuid, smallint, smallint, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Baca nilai: ikut mengirim jumlah UH dan kolom uh4–uh10
-- -----------------------------------------------------------------------------
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
                'jumlah_uh', public.grade__uh_count(p_class_id, sub.id, p_semester),
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
            select jsonb_agg(jsonb_build_object('s', g.student_id, 'm', g.subject_id,
                       'uh1', g.uh1, 'uh2', g.uh2, 'uh3', g.uh3, 'uh4', g.uh4, 'uh5', g.uh5,
                       'uh6', g.uh6, 'uh7', g.uh7, 'uh8', g.uh8, 'uh9', g.uh9, 'uh10', g.uh10,
                       'sts', g.sts, 'sas', g.sas))
            from public.student_grades g
            where g.class_id = p_class_id and g.semester = p_semester
              and (p_subject_id is null or g.subject_id = p_subject_id)
              and public.grade_can_view(p_class_id, g.subject_id)), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Simpan nilai: UH 1–10, tolak kolom di luar jumlah UH
-- -----------------------------------------------------------------------------
/**
 * Simpan nilai banyak mapel sekaligus (satu transaksi — dipakai halaman isi nilai & impor Excel).
 * p_items: [{subject_id, kktp?, entries: [{student_id, uh1..uh10, sts, sas}]}]
 *  - Kolom UH di luar jumlah UH kelas+mapel+semester ini ditolak.
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
    v_fields  text[] := array['uh1', 'uh2', 'uh3', 'uh4', 'uh5', 'uh6', 'uh7', 'uh8', 'uh9', 'uh10', 'sts', 'sas'];
    v_n       constant int := 12;          -- 10 UH + STS + SAS
    v_uhn     smallint;
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
        v_uhn := public.grade__uh_count(p_class_id, v_sub, p_semester);

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
            v_cur := array[v_old.uh1, v_old.uh2, v_old.uh3, v_old.uh4, v_old.uh5, v_old.uh6,
                           v_old.uh7, v_old.uh8, v_old.uh9, v_old.uh10, v_old.sts, v_old.sas];
            if not v_found then v_cur := array_fill(null::smallint, array[v_n]); end if;
            v_new := v_cur;
            for v_i in 1 .. v_n loop
                continue when not (e ? v_fields[v_i]);
                v_val := e -> v_fields[v_i];
                if jsonb_typeof(v_val) = 'null' or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '') then
                    if not p_keep_blank then v_new[v_i] := null; end if;
                    continue;
                end if;
                if v_i <= 10 and v_i > v_uhn then
                    raise exception '% hanya punya % kolom UH di kelas ini, jadi % tidak bisa diisi.',
                        v_sname, v_uhn, upper(v_fields[v_i]) using errcode = '22023';
                end if;
                begin v_num := (v_val #>> '{}')::numeric; exception when others then v_num := -1; end;
                if v_num is null or v_num <> trunc(v_num) or v_num < 0 or v_num > 100 then
                    select nama_siswa into v_sname from public.student_records where id = v_stu;
                    raise exception 'Nilai % % harus angka bulat 0–100.', upper(v_fields[v_i]), v_sname using errcode = '22023';
                end if;
                v_new[v_i] := v_num::smallint;
            end loop;
            continue when v_new is not distinct from v_cur;
            for v_i in 1 .. v_n loop
                if v_new[v_i] is distinct from v_cur[v_i] then
                    insert into public.grade_changes (class_id, student_id, subject_id, semester, field, old_value, new_value, source, changed_by_name)
                    values (p_class_id, v_stu, v_sub, p_semester, v_fields[v_i], v_cur[v_i], v_new[v_i], v_src, v_who);
                    if v_cur[v_i] is null then v_baru := v_baru + 1;
                    elsif v_new[v_i] is null then v_hapus := v_hapus + 1;
                    else v_ubah := v_ubah + 1; end if;
                end if;
            end loop;
            insert into public.student_grades (class_id, student_id, subject_id, semester,
                   uh1, uh2, uh3, uh4, uh5, uh6, uh7, uh8, uh9, uh10, sts, sas, updated_by)
            values (p_class_id, v_stu, v_sub, p_semester,
                   v_new[1], v_new[2], v_new[3], v_new[4], v_new[5], v_new[6],
                   v_new[7], v_new[8], v_new[9], v_new[10], v_new[11], v_new[12], (select auth.uid()))
            on conflict (class_id, student_id, subject_id, semester) do update
            set uh1 = excluded.uh1, uh2 = excluded.uh2, uh3 = excluded.uh3, uh4 = excluded.uh4, uh5 = excluded.uh5,
                uh6 = excluded.uh6, uh7 = excluded.uh7, uh8 = excluded.uh8, uh9 = excluded.uh9, uh10 = excluded.uh10,
                sts = excluded.sts, sas = excluded.sas,
                updated_at = now(), updated_by = excluded.updated_by;
        end loop;
    end loop;
    return jsonb_build_object('baru', v_baru, 'berubah', v_ubah, 'dihapus', v_hapus, 'kktp', v_kktp);
end;
$$;

-- -----------------------------------------------------------------------------
-- Matriks admin: "lengkap" mengikuti jumlah UH tiap kelas+mapel
-- -----------------------------------------------------------------------------
/** Berapa siswa yang nilainya lengkap / baru terisi sebagian, sesuai jumlah UH mapel itu. */
create or replace function public.grade__isi(p_class_id uuid, p_subject_id uuid, p_semester smallint, p_lengkap boolean)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select count(*)::int
    from public.student_grades g
    cross join lateral (
        select count(*) filter (where u.nilai is not null) as terisi, count(*) as dipakai
        from unnest(array[g.uh1, g.uh2, g.uh3, g.uh4, g.uh5,
                          g.uh6, g.uh7, g.uh8, g.uh9, g.uh10]) with ordinality u(nilai, ke)
        where u.ke <= public.grade__uh_count(p_class_id, p_subject_id, p_semester)) uh
    where g.class_id = p_class_id and g.subject_id = p_subject_id and g.semester = p_semester
      and case when p_lengkap
               then uh.terisi = uh.dipakai and g.sts is not null and g.sas is not null
               else uh.terisi > 0 or g.sts is not null or g.sas is not null end;
$$;
revoke all on function public.grade__isi(uuid, uuid, smallint, boolean) from public, anon;
grant execute on function public.grade__isi(uuid, uuid, smallint, boolean) to authenticated, service_role;

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
        'mapel', (select jsonb_agg(jsonb_build_object('id', id, 'kode', code, 'singkat', coalesce(short_name, name), 'nama', name,
                     'kelas_min', grade_min, 'kelas_max', grade_max,
                     'kelas_teks', public.subject_grade_label(id)) order by sort_order, name) from public.subjects),
        'kelas', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', c.id, 'nama', c.name, 'tingkat', c.grade,
                'siswa', (select count(*) from public.get_class_roster(c.id, public.grade__roster_date(c.id, p_semester))),
                'sel', (select jsonb_object_agg(sub.id, jsonb_build_object(
                            'hidden', coalesce(cs.hidden, false),
                            'luar', c.grade not between sub.grade_min and sub.grade_max,
                            'kktp', cs.kktp,
                            'jumlah_uh', public.grade__uh_count(c.id, sub.id, p_semester),
                            'lengkap', public.grade__isi(c.id, sub.id, p_semester, true),
                            'terisi', public.grade__isi(c.id, sub.id, p_semester, false)))
                        from public.subjects sub
                        left join public.class_subject_settings cs on cs.class_id = c.id and cs.subject_id = sub.id))
                order by c.grade, c.section)
            from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active), '[]'::jsonb));
end;
$$;

revoke all on function public.get_grades_admin_matrix(smallint) from public, anon;
grant execute on function public.get_grades_admin_matrix(smallint) to authenticated, service_role;
