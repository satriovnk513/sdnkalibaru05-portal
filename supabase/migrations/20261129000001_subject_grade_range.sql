-- =============================================================================
-- Mata pelajaran yang hanya diajarkan di sebagian tingkat.
--
-- - subjects.grade_min/grade_max (bawaan 1–6) menandai tingkat mana saja yang
--   mengajarkan mapel itu. Mapel di luar rentang tidak muncul di menu Nilai,
--   matriks nilai admin, dan pilihan mapel jadwal kelas itu; nilainya juga
--   tidak bisa disimpan dan gurunya tidak bisa ditugaskan ke kelas tsb.
-- - Mapel baru: KKA — Koding dan Kecerdasan Artifisial, hanya kelas 5 & 6.
-- =============================================================================

alter table public.subjects add column if not exists grade_min smallint not null default 1;
alter table public.subjects add column if not exists grade_max smallint not null default 6;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'subjects_grade_range') then
        alter table public.subjects add constraint subjects_grade_range
            check (grade_min between 1 and 6 and grade_max between 1 and 6 and grade_min <= grade_max);
    end if;
end
$$;

comment on column public.subjects.grade_min is 'Tingkat terendah yang mengajarkan mapel ini (1–6).';
comment on column public.subjects.grade_max is 'Tingkat tertinggi yang mengajarkan mapel ini (1–6).';

-- Mapel baru: Koding dan Kecerdasan Artifisial (kelas 5 & 6).
insert into public.subjects (code, name, short_name, sort_order, grade_min, grade_max)
values ('KKA', 'Koding dan Kecerdasan Artifisial', 'Koding & KA', 5, 5, 6)
on conflict (code) do update
    set name = excluded.name, short_name = excluded.short_name,
        grade_min = excluded.grade_min, grade_max = excluded.grade_max;

-- Urutan tampil disusun ulang (abjad nama): KKA masuk setelah IPAS.
update public.subjects s set sort_order = v.ord
from (values ('BIN', 1), ('BIG', 2), ('GAQ', 3), ('IPAS', 4), ('KKA', 5), ('KOK', 6), ('LIT', 7),
             ('MTK', 8), ('NUM', 9), ('PAI', 10), ('PP', 11), ('PJOK', 12), ('PLBJ', 13),
             ('SR', 14), ('SER', 15)) as v(code, ord)
where s.code = v.code and s.sort_order is distinct from v.ord;

-- -----------------------------------------------------------------------------
-- Penjaga: mapel ini diajarkan di kelas ini?
-- -----------------------------------------------------------------------------
/** Mapel p_subject_id termasuk tingkat kelas p_class_id? (mapel/kelas tak dikenal → false) */
create or replace function public.subject_in_class(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.subjects sub, public.classes c
        where sub.id = p_subject_id and c.id = p_class_id
          and c.grade between sub.grade_min and sub.grade_max);
$$;

/** Teks "kelas 5 & 6" / "kelas 1–4" untuk pesan galat & tampilan. */
create or replace function public.subject_grade_label(p_subject_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when sub.grade_min = 1 and sub.grade_max = 6 then 'semua kelas'
        when sub.grade_min = sub.grade_max then 'kelas ' || sub.grade_min
        when sub.grade_max = sub.grade_min + 1 then 'kelas ' || sub.grade_min || ' & ' || sub.grade_max
        else 'kelas ' || sub.grade_min || '–' || sub.grade_max
    end
    from public.subjects sub where sub.id = p_subject_id;
$$;

revoke all on function public.subject_in_class(uuid, uuid) from public, anon;
revoke all on function public.subject_grade_label(uuid) from public, anon;
grant execute on function public.subject_in_class(uuid, uuid), public.subject_grade_label(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Nilai: mapel di luar tingkatnya tidak terlihat & tidak bisa diisi
-- -----------------------------------------------------------------------------
create or replace function public.grade_can_edit(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null
      and public.subject_in_class(p_class_id, p_subject_id)
      and (
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
    select (select auth.uid()) is not null
      and public.subject_in_class(p_class_id, p_subject_id)
      and (
        public.att_is_admin() or public.is_pimpinan() or public.is_homeroom_of(p_class_id)
        or public.teaches(p_class_id, p_subject_id));
$$;

/** Matriks kelas × mapel untuk Panel Admin; mapel di luar tingkatnya ditandai luar = true. */
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

revoke all on function public.get_grades_admin_matrix(smallint) from public, anon;
grant execute on function public.get_grades_admin_matrix(smallint) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Jadwal: mapel di luar tingkatnya tidak muncul & tidak bisa dipasang
-- -----------------------------------------------------------------------------
create or replace function public.sched__guard_subject(p_class_id uuid, p_subject_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.subject_in_class(p_class_id, p_subject_id) then
        raise exception 'Mapel % hanya untuk %.',
            (select coalesce(short_name, name) from public.subjects where id = p_subject_id),
            public.subject_grade_label(p_subject_id) using errcode = '22023';
    end if;
end
$$;
revoke all on function public.sched__guard_subject(uuid, uuid) from public, anon, authenticated;

-- Dua fungsi jadwal berikut disalin dari 20261120000001_schedule.sql dengan tambahan saringan tingkat.
create or replace function public.get_class_schedule(p_class_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_class record;
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke kelas ini.' using errcode = '42501';
    end if;
    select c.id, c.grade, c.section, c.name, y.name as tahun into v_class
    from public.classes c join public.academic_years y on y.id = c.academic_year_id where c.id = p_class_id;
    if v_class.id is null then
        raise exception 'Kelas tidak ditemukan.' using errcode = '22023';
    end if;
    perform public.sched__ensure(p_class_id);
    return jsonb_build_object(
        'kelas', jsonb_build_object('id', v_class.id, 'nama', v_class.name, 'tingkat', v_class.grade, 'rombel', v_class.section, 'tahun_ajaran', v_class.tahun),
        'can_edit', public.sched__can_edit(p_class_id),
        'wali', coalesce((select jsonb_agg(jsonb_build_object('nama', s.name, 'posisi', h.position,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), '')) order by h.position)
                          from public.homeroom_assignments h join public.staff s on s.id = h.staff_id where h.class_id = p_class_id), '[]'::jsonb),
        'kepala_sekolah', (select jsonb_build_object('nama', s.name,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                           from public.staff s where split_part(s.role, '|', 1) = 'Kepala Sekolah'
                           order by s.order_index nulls last, s.name limit 1),
        'slot', coalesce((select jsonb_agg(jsonb_build_object('no', sl.slot_no, 'mulai', to_char(sl.mulai, 'HH24:MI'),
                                 'selesai', to_char(sl.selesai, 'HH24:MI'), 'istirahat', sl.istirahat) order by sl.slot_no)
                          from public.class_schedule_slots sl where sl.class_id = p_class_id), '[]'::jsonb),
        'isi', coalesce((select jsonb_agg(jsonb_build_object('hari', e.hari, 'jam', e.slot_no, 'jenis', e.jenis,
                                 'subject_id', e.subject_id, 'kode', sub.code, 'mapel', sub.name, 'singkat', coalesce(sub.short_name, sub.name),
                                 'kegiatan', e.kegiatan, 'staff_id', e.staff_id, 'guru', st.name) order by e.hari, e.slot_no)
                         from public.class_schedule_entries e
                         left join public.subjects sub on sub.id = e.subject_id
                         left join public.staff st on st.id = e.staff_id
                         where e.class_id = p_class_id), '[]'::jsonb),
        'mapel', coalesce((select jsonb_agg(jsonb_build_object('id', sub.id, 'kode', sub.code, 'nama', sub.name,
                                 'singkat', coalesce(sub.short_name, sub.name), 'hidden', coalesce(cs.hidden, false),
                                 'guru', (select jsonb_agg(jsonb_build_object('id', st.id, 'nama', st.name) order by st.name)
                                          from public.subject_assignments sa join public.staff st on st.id = sa.staff_id
                                          where sa.class_id = p_class_id and sa.subject_id = sub.id)) order by sub.sort_order, sub.name)
                           from public.subjects sub
                           left join public.class_subject_settings cs on cs.class_id = p_class_id and cs.subject_id = sub.id
                           where v_class.grade between sub.grade_min and sub.grade_max), '[]'::jsonb));
end;
$$;

create or replace function public.save_schedule_entry(p_class_id uuid, p_hari smallint, p_slot smallint, p_jumlah smallint,
                                                      p_jenis text, p_subject_id uuid default null, p_kegiatan text default null,
                                                      p_staff_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_n      int := coalesce(p_jumlah, 1);
    v_slot   smallint;
    v_staff  uuid := p_staff_id;
    v_keg    text := nullif(btrim(regexp_replace(coalesce(p_kegiatan, ''), '\s+', ' ', 'g')), '');
    v_guru   int;
    v_msg    text;
begin
    if not public.sched__can_edit(p_class_id) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengubah jadwal kelas ini.' using errcode = '42501';
    end if;
    if p_hari not between 1 and 5 then raise exception 'Hari harus Senin–Jumat.' using errcode = '22023'; end if;
    if v_n not between 1 and 8 then raise exception 'Jumlah jam 1–8.' using errcode = '22023'; end if;
    if p_jenis not in ('mapel', 'kegiatan', 'kosong') then raise exception 'Jenis isi tidak dikenal.' using errcode = '22023'; end if;
    perform public.sched__ensure(p_class_id);
    if (select count(*) from public.class_schedule_slots where class_id = p_class_id and slot_no between p_slot and p_slot + v_n - 1) <> v_n then
        raise exception 'Jam ke-% sampai ke-% tidak ada di jadwal kelas ini.', p_slot, p_slot + v_n - 1 using errcode = '22023';
    end if;
    if exists (select 1 from public.class_schedule_slots where class_id = p_class_id and slot_no between p_slot and p_slot + v_n - 1 and istirahat) then
        raise exception 'Jam istirahat terkunci dan tidak bisa diisi.' using errcode = '22023';
    end if;

    if p_jenis = 'kosong' then
        delete from public.class_schedule_entries where class_id = p_class_id and hari = p_hari and slot_no between p_slot and p_slot + v_n - 1;
        return public.get_class_schedule(p_class_id);
    end if;

    if p_jenis = 'kegiatan' then
        if v_keg is null or length(v_keg) > 60 then raise exception 'Nama kegiatan wajib diisi (maks. 60 huruf).' using errcode = '22023'; end if;
        v_staff := null;
    else
        if not exists (select 1 from public.subjects where id = p_subject_id) then
            raise exception 'Mata pelajaran tidak dikenal.' using errcode = '22023';
        end if;
        perform public.sched__guard_subject(p_class_id, p_subject_id);
        select count(*) into v_guru from public.subject_assignments where class_id = p_class_id and subject_id = p_subject_id;
        if v_guru = 0 then
            v_staff := null;   -- diajar wali kelas
        elsif v_staff is null and v_guru = 1 then
            select staff_id into v_staff from public.subject_assignments where class_id = p_class_id and subject_id = p_subject_id;
        elsif v_staff is null then
            raise exception 'Pilih guru pengajar mapel ini.' using errcode = '22023';
        elsif not exists (select 1 from public.subject_assignments where class_id = p_class_id and subject_id = p_subject_id and staff_id = v_staff) then
            raise exception 'Guru itu tidak ditugaskan mengajar mapel ini di kelas ini.' using errcode = '22023';
        end if;
        v_keg := null;
    end if;

    for v_slot in p_slot .. p_slot + v_n - 1 loop
        if v_staff is not null then
            v_msg := public.sched__bentrok(p_class_id, p_hari, v_slot::smallint, v_staff);
            if v_msg is not null then raise exception 'Gagal disimpan. %', v_msg using errcode = '23P01'; end if;
        end if;
        insert into public.class_schedule_entries (class_id, hari, slot_no, jenis, subject_id, kegiatan, staff_id, updated_by)
        values (p_class_id, p_hari, v_slot, p_jenis, case when p_jenis = 'mapel' then p_subject_id end, v_keg, v_staff, (select auth.uid()))
        on conflict (class_id, hari, slot_no) do update
        set jenis = excluded.jenis, subject_id = excluded.subject_id, kegiatan = excluded.kegiatan, staff_id = excluded.staff_id,
            updated_at = now(), updated_by = excluded.updated_by;
    end loop;
    return public.get_class_schedule(p_class_id);
end;
$$;

revoke all on function public.get_class_schedule(uuid) from public, anon;
revoke all on function public.save_schedule_entry(uuid, smallint, smallint, smallint, text, uuid, text, uuid) from public, anon;
grant execute on function public.get_class_schedule(uuid),
    public.save_schedule_entry(uuid, smallint, smallint, smallint, text, uuid, text, uuid) to authenticated, service_role;

-- Disalin dari 20261113000001_attendance_akademik.sql; menolak kelas di luar tingkat mapel.
create or replace function public.set_subject_assignments(p_subject_id uuid, p_staff_id uuid, p_class_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_n integer;
begin
    if not public.att_is_admin() then
        raise exception 'Hanya admin.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.subjects where id = p_subject_id) then
        raise exception 'Mata pelajaran tidak ditemukan.' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.staff where id = p_staff_id) then
        raise exception 'Guru tidak ditemukan.' using errcode = 'P0002';
    end if;
    if exists (select 1 from unnest(coalesce(p_class_ids, '{}')) c(id)
               where not exists (select 1 from public.classes k where k.id = c.id)) then
        raise exception 'Ada kelas yang tidak ditemukan.' using errcode = 'P0002';
    end if;
    if exists (select 1 from unnest(coalesce(p_class_ids, '{}')) c(id)
               where not public.subject_in_class(c.id, p_subject_id)) then
        raise exception 'Mapel ini hanya untuk %.', public.subject_grade_label(p_subject_id) using errcode = '22023';
    end if;
    delete from public.subject_assignments where subject_id = p_subject_id and staff_id = p_staff_id;
    insert into public.subject_assignments (subject_id, class_id, staff_id)
    select p_subject_id, c.id, p_staff_id from (select distinct unnest(coalesce(p_class_ids, '{}')) as id) c;
    get diagnostics v_n = row_count;
    return v_n;
end;
$$;

revoke all on function public.set_subject_assignments(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.set_subject_assignments(uuid, uuid, uuid[]) to authenticated, service_role;
