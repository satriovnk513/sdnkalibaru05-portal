-- =============================================================================
-- Jadwal pelajaran per kelas.
--
-- - Baris jam (jam ke-1, 2, …) per kelas, waktu mulai/selesai opsional (HH:MM).
--   Baris Istirahat terkunci: kelas 1–2 08:50–09:25, kelas 3–6 09:25–09:45.
-- - Isi per hari (Senin–Jumat) × jam: mata pelajaran atau kegiatan (Upacara,
--   Dhuha & Gema Qur'an, Pulang, dll).
-- - Mapel yang punya guru mapel di kelas itu (subject_assignments, mis. PAI/PLBJ)
--   mencatat guru pengajarnya; satu guru tidak boleh mengajar dua kelas di jam
--   yang sama (bentrok → gagal dengan pesan jelas). Guru mapel melihat jadwal
--   mengajarnya dari semua kelas.
-- - Yang mengubah: wali kelas (kelasnya) dan admin. Semua guru kelas itu,
--   kepala sekolah, dan admin bisa melihat.
-- =============================================================================

create table if not exists public.class_schedule_slots (
    class_id   uuid     not null references public.classes (id) on delete cascade,
    slot_no    smallint not null,
    mulai      time,
    selesai    time,
    istirahat  boolean  not null default false,
    primary key (class_id, slot_no),
    constraint class_schedule_slots_no check (slot_no between 1 and 150),
    constraint class_schedule_slots_time check (mulai is null or selesai is null or mulai < selesai)
);

create table if not exists public.class_schedule_entries (
    class_id   uuid        not null,
    hari       smallint    not null,
    slot_no    smallint    not null,
    jenis      text        not null,
    subject_id uuid        references public.subjects (id) on delete cascade,
    kegiatan   text,
    staff_id   uuid        references public.staff (id) on delete set null,
    updated_at timestamptz not null default now(),
    updated_by uuid        references auth.users (id) on delete set null,
    primary key (class_id, hari, slot_no),
    foreign key (class_id, slot_no) references public.class_schedule_slots (class_id, slot_no) on delete cascade on update cascade,
    constraint class_schedule_entries_hari check (hari between 1 and 5),
    constraint class_schedule_entries_isi check (
        (jenis = 'mapel' and subject_id is not null and kegiatan is null)
        or (jenis = 'kegiatan' and subject_id is null and staff_id is null and kegiatan is not null and length(kegiatan) between 1 and 60))
);
create index if not exists class_schedule_entries_staff_idx on public.class_schedule_entries (staff_id, hari) where staff_id is not null;

alter table public.class_schedule_slots enable row level security;
alter table public.class_schedule_slots force row level security;
alter table public.class_schedule_entries enable row level security;
alter table public.class_schedule_entries force row level security;
revoke all on table public.class_schedule_slots, public.class_schedule_entries from public, anon, authenticated;
grant all on table public.class_schedule_slots, public.class_schedule_entries to service_role;

-- -----------------------------------------------------------------------------
-- Internal
-- -----------------------------------------------------------------------------
/** Buat baris jam bawaan (11 jam, 35 menit, mulai 06:30, istirahat sesuai jenjang) bila kelas belum punya. */
create or replace function public.sched__ensure(p_class_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_grade smallint;
    v_t     time := '06:30';
    v_i     int;
    v_break int;
begin
    if exists (select 1 from public.class_schedule_slots where class_id = p_class_id) then return; end if;
    select grade into v_grade from public.classes where id = p_class_id;
    if v_grade is null then return; end if;
    v_break := case when v_grade <= 2 then 5 else 6 end;
    for v_i in 1 .. 11 loop
        if v_i = v_break then
            insert into public.class_schedule_slots (class_id, slot_no, mulai, selesai, istirahat)
            values (p_class_id, v_i, v_t, v_t + (case when v_grade <= 2 then interval '35 min' else interval '20 min' end), true)
            on conflict do nothing;
            v_t := v_t + (case when v_grade <= 2 then interval '35 min' else interval '20 min' end);
        else
            insert into public.class_schedule_slots (class_id, slot_no, mulai, selesai)
            values (p_class_id, v_i, v_t, v_t + interval '35 min') on conflict do nothing;
            v_t := v_t + interval '35 min';
        end if;
    end loop;
    -- Kegiatan rutin sekolah (bisa diubah/dihapus wali kelas).
    insert into public.class_schedule_entries (class_id, hari, slot_no, jenis, kegiatan)
    values (p_class_id, 1, 1, 'kegiatan', 'Upacara Bendera'), (p_class_id, 1, 2, 'kegiatan', 'Upacara Bendera'),
           (p_class_id, 5, 1, 'kegiatan', 'Dhuha & Gema Qur''an'), (p_class_id, 5, 2, 'kegiatan', 'Dhuha & Gema Qur''an')
    on conflict do nothing;
end;
$$;

create or replace function public.sched__can_edit(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select auth.uid()) is not null and (public.att_is_admin() or public.is_homeroom_of(p_class_id));
$$;

create or replace function public.sched__hari(p_hari int)
returns text
language sql
immutable
set search_path = ''
as $$
    select (array['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'])[p_hari];
$$;

/** "07:40" / "7.40" / "" → time (null bila kosong). Galat bila format salah. */
create or replace function public.sched__jam(p_text text)
returns time
language plpgsql
immutable
set search_path = ''
as $$
declare
    m text[];
begin
    if p_text is null or btrim(p_text) = '' then return null; end if;
    m := regexp_match(btrim(p_text), '^(\d{1,2})[:.](\d{2})$');
    if m is null or m[1]::int > 23 or m[2]::int > 59 then
        raise exception 'Format jam harus HH:MM (00:00–23:59), contoh 07:40.' using errcode = '22023';
    end if;
    return make_time(m[1]::int, m[2]::int, 0);
end;
$$;

/**
 * Bentrok jadwal guru: guru p_staff_id sudah mengajar di kelas LAIN pada hari yang sama
 * dan waktunya beririsan (bila kedua jam punya waktu) atau jam ke- sama (bila tidak). Pesan atau null.
 */
create or replace function public.sched__bentrok(p_class_id uuid, p_hari smallint, p_slot smallint, p_staff_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select format('%s sudah mengajar %s di kelas %s pada %s jam ke-%s%s. Ubah jadwal salah satu kelas dulu.',
                  st.name, coalesce(sub.short_name, sub.name), c2.name, public.sched__hari(p_hari), s2.slot_no,
                  case when s2.mulai is not null and s2.selesai is not null
                       then format(' (%s–%s)', to_char(s2.mulai, 'HH24.MI'), to_char(s2.selesai, 'HH24.MI')) else '' end)
    from public.class_schedule_slots s
    join public.class_schedule_entries e2 on e2.staff_id = p_staff_id and e2.hari = p_hari and e2.class_id <> p_class_id
    join public.class_schedule_slots s2 on s2.class_id = e2.class_id and s2.slot_no = e2.slot_no
    join public.classes c2 on c2.id = e2.class_id
    join public.academic_years y on y.id = c2.academic_year_id and y.is_active
    join public.staff st on st.id = p_staff_id
    join public.subjects sub on sub.id = e2.subject_id
    where s.class_id = p_class_id and s.slot_no = p_slot and p_staff_id is not null
      and case when s.mulai is not null and s.selesai is not null and s2.mulai is not null and s2.selesai is not null
               then s.mulai < s2.selesai and s2.mulai < s.selesai
               else s.slot_no = s2.slot_no end
    order by c2.grade, c2.section
    limit 1;
$$;

revoke all on function public.sched__ensure(uuid) from public, anon, authenticated;
revoke all on function public.sched__can_edit(uuid) from public, anon, authenticated;
revoke all on function public.sched__hari(int) from public, anon, authenticated;
revoke all on function public.sched__jam(text) from public, anon, authenticated;
revoke all on function public.sched__bentrok(uuid, smallint, smallint, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Baca
-- -----------------------------------------------------------------------------
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
                           left join public.class_subject_settings cs on cs.class_id = p_class_id and cs.subject_id = sub.id), '[]'::jsonb));
end;
$$;

/**
 * Jadwal mengajar seorang guru (semua kelas, tahun ajaran aktif) — baris yang mencatat dia
 * sebagai guru pengajar. p_staff_id null = diri sendiri; guru lain hanya untuk admin/pimpinan.
 */
create or replace function public.get_teaching_schedule(p_staff_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_staff uuid := coalesce(p_staff_id, public.current_staff_id());
begin
    if (select auth.uid()) is null then
        raise exception 'Harus login.' using errcode = '42501';
    end if;
    if p_staff_id is not null and p_staff_id is distinct from public.current_staff_id()
       and not (public.att_is_admin() or public.is_pimpinan()) then
        raise exception 'Hanya admin atau kepala sekolah.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'guru', (select jsonb_build_object('id', s.id, 'nama', s.name) from public.staff s where s.id = v_staff),
        'isi', coalesce((select jsonb_agg(jsonb_build_object('class_id', c.id, 'kelas', c.name, 'hari', e.hari, 'jam', e.slot_no,
                                 'mulai', to_char(sl.mulai, 'HH24:MI'), 'selesai', to_char(sl.selesai, 'HH24:MI'),
                                 'subject_id', sub.id, 'kode', sub.code, 'mapel', coalesce(sub.short_name, sub.name))
                                 order by e.hari, sl.mulai nulls last, e.slot_no, c.grade, c.section)
                         from public.class_schedule_entries e
                         join public.class_schedule_slots sl on sl.class_id = e.class_id and sl.slot_no = e.slot_no
                         join public.classes c on c.id = e.class_id
                         join public.academic_years y on y.id = c.academic_year_id and y.is_active
                         join public.subjects sub on sub.id = e.subject_id
                         where v_staff is not null and e.staff_id = v_staff), '[]'::jsonb));
end;
$$;

/** Admin: guru yang punya penugasan mapel (untuk tampilan jadwal per guru). */
create or replace function public.get_schedule_teachers()
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
    return coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'nama', x.name, 'mapel', x.mapel, 'jam', x.jam) order by x.name)
        from (
            select st.id, st.name,
                   (select jsonb_agg(distinct coalesce(sub.short_name, sub.name)) from public.subject_assignments sa
                    join public.subjects sub on sub.id = sa.subject_id where sa.staff_id = st.id) as mapel,
                   (select count(*) from public.class_schedule_entries e join public.classes c on c.id = e.class_id
                    join public.academic_years y on y.id = c.academic_year_id and y.is_active where e.staff_id = st.id) as jam
            from public.staff st
            where exists (select 1 from public.subject_assignments sa where sa.staff_id = st.id)) x), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Tulis (wali kelas / admin). Semua mengembalikan jadwal terbaru (get_class_schedule).
-- -----------------------------------------------------------------------------
/**
 * Isi p_jumlah jam berturut-turut mulai jam ke-p_slot pada hari p_hari.
 * p_jenis: 'mapel' (p_subject_id, p_staff_id untuk mapel bergurumapel), 'kegiatan' (p_kegiatan), 'kosong' (hapus).
 */
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

/** Ubah waktu satu baris jam (berlaku semua hari). Kosong = tanpa waktu. Istirahat terkunci. */
create or replace function public.set_schedule_slot(p_class_id uuid, p_slot smallint, p_mulai text, p_selesai text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_m time := public.sched__jam(p_mulai);
    v_s time := public.sched__jam(p_selesai);
    v_e record;
    v_msg text;
begin
    if not public.sched__can_edit(p_class_id) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengubah jadwal kelas ini.' using errcode = '42501';
    end if;
    perform public.sched__ensure(p_class_id);
    if not exists (select 1 from public.class_schedule_slots where class_id = p_class_id and slot_no = p_slot) then
        raise exception 'Jam ke-% tidak ada.', p_slot using errcode = '22023';
    end if;
    if exists (select 1 from public.class_schedule_slots where class_id = p_class_id and slot_no = p_slot and istirahat) then
        raise exception 'Jam istirahat terkunci.' using errcode = '22023';
    end if;
    if v_m is not null and v_s is not null and v_m >= v_s then
        raise exception 'Jam selesai harus setelah jam mulai.' using errcode = '22023';
    end if;
    update public.class_schedule_slots set mulai = v_m, selesai = v_s where class_id = p_class_id and slot_no = p_slot;
    for v_e in select hari, staff_id from public.class_schedule_entries where class_id = p_class_id and slot_no = p_slot and staff_id is not null loop
        v_msg := public.sched__bentrok(p_class_id, v_e.hari, p_slot, v_e.staff_id);
        if v_msg is not null then raise exception 'Gagal disimpan. %', v_msg using errcode = '23P01'; end if;
    end loop;
    return public.get_class_schedule(p_class_id);
end;
$$;

/** Tambah satu baris jam di akhir (maks. 15 jam). */
create or replace function public.add_schedule_slot(p_class_id uuid, p_mulai text default null, p_selesai text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_m time := public.sched__jam(p_mulai);
    v_s time := public.sched__jam(p_selesai);
    v_no smallint;
begin
    if not public.sched__can_edit(p_class_id) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengubah jadwal kelas ini.' using errcode = '42501';
    end if;
    perform public.sched__ensure(p_class_id);
    if v_m is not null and v_s is not null and v_m >= v_s then
        raise exception 'Jam selesai harus setelah jam mulai.' using errcode = '22023';
    end if;
    select coalesce(max(slot_no), 0) + 1 into v_no from public.class_schedule_slots where class_id = p_class_id;
    if v_no > 15 then raise exception 'Maksimal 15 jam per hari.' using errcode = '22023'; end if;
    insert into public.class_schedule_slots (class_id, slot_no, mulai, selesai) values (p_class_id, v_no, v_m, v_s);
    return public.get_class_schedule(p_class_id);
end;
$$;

/** Hapus satu baris jam beserta isinya di semua hari; jam sesudahnya bergeser naik. Istirahat tidak bisa dihapus. */
create or replace function public.delete_schedule_slot(p_class_id uuid, p_slot smallint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if not public.sched__can_edit(p_class_id) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengubah jadwal kelas ini.' using errcode = '42501';
    end if;
    if exists (select 1 from public.class_schedule_slots where class_id = p_class_id and slot_no = p_slot and istirahat) then
        raise exception 'Jam istirahat terkunci dan tidak bisa dihapus.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.class_schedule_slots where class_id = p_class_id and slot_no = p_slot) then
        raise exception 'Jam ke-% tidak ada.', p_slot using errcode = '22023';
    end if;
    delete from public.class_schedule_slots where class_id = p_class_id and slot_no = p_slot;
    -- geser nomor (dua langkah supaya kunci utama tidak bentrok di tengah jalan)
    update public.class_schedule_slots set slot_no = slot_no + 100 where class_id = p_class_id and slot_no > p_slot;
    update public.class_schedule_slots set slot_no = slot_no - 101 where class_id = p_class_id and slot_no > 100;
    return public.get_class_schedule(p_class_id);
end;
$$;

revoke all on function public.get_class_schedule(uuid) from public, anon;
revoke all on function public.get_teaching_schedule(uuid) from public, anon;
revoke all on function public.get_schedule_teachers() from public, anon;
revoke all on function public.save_schedule_entry(uuid, smallint, smallint, smallint, text, uuid, text, uuid) from public, anon;
revoke all on function public.set_schedule_slot(uuid, smallint, text, text) from public, anon;
revoke all on function public.add_schedule_slot(uuid, text, text) from public, anon;
revoke all on function public.delete_schedule_slot(uuid, smallint) from public, anon;
grant execute on function public.get_class_schedule(uuid), public.get_teaching_schedule(uuid), public.get_schedule_teachers(),
    public.save_schedule_entry(uuid, smallint, smallint, smallint, text, uuid, text, uuid),
    public.set_schedule_slot(uuid, smallint, text, text), public.add_schedule_slot(uuid, text, text),
    public.delete_schedule_slot(uuid, smallint)
    to authenticated, service_role;
