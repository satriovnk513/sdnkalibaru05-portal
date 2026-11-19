-- =============================================================================
-- Jurnal mengajar — catatan harian PRIBADI guru (bukan laporan ke kepala sekolah).
--
-- - Daftar harian terisi otomatis dari jadwal pelajaran: wali kelas mendapat mapel
--   kelasnya yang tidak diajar guru mapel; guru mapel mendapat jam yang mencatat
--   dirinya sebagai guru pengajar. Guru menandai Terlaksana / Tidak terlaksana,
--   materi & keterangan opsional. Bisa menambah "catatan lain" bebas.
-- - Hanya pemiliknya yang bisa membaca & mengubah (admin pun tidak lewat RPC ini).
-- - Tanggal tidak boleh di masa depan.
-- =============================================================================

create table if not exists public.teaching_journal (
    id          uuid        primary key default gen_random_uuid(),
    staff_id    uuid        not null references public.staff (id) on delete cascade,
    tanggal     date        not null,
    class_id    uuid        references public.classes (id) on delete set null,
    subject_id  uuid        references public.subjects (id) on delete set null,
    judul       text,
    jam         text,
    status      text        not null,
    materi      text,
    keterangan  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint teaching_journal_status check (status in ('terlaksana', 'tidak')),
    constraint teaching_journal_isi check (subject_id is not null or (judul is not null and length(judul) between 1 and 80)),
    constraint teaching_journal_len check (coalesce(length(materi), 0) <= 500 and coalesce(length(keterangan), 0) <= 300 and coalesce(length(jam), 0) <= 40)
);
create unique index if not exists teaching_journal_jadwal_key on public.teaching_journal (staff_id, tanggal, class_id, subject_id)
    where subject_id is not null and judul is null;
create index if not exists teaching_journal_staff_tgl_idx on public.teaching_journal (staff_id, tanggal);

alter table public.teaching_journal enable row level security;
alter table public.teaching_journal force row level security;
revoke all on table public.teaching_journal from public, anon, authenticated;
grant all on table public.teaching_journal to service_role;

-- -----------------------------------------------------------------------------
-- Baca
-- -----------------------------------------------------------------------------
/**
 * Satu hari jurnal milik pemanggil: jadwal hari itu (dari jadwal pelajaran) + catatan tersimpan.
 * jadwal: baris per jam [{class_id, kelas, subject_id, kode, mapel, jam, mulai, selesai}] — dikelompokkan di aplikasi.
 */
create or replace function public.get_my_journal_day(p_tanggal date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_staff uuid := public.current_staff_id();
    v_hari  int := extract(isodow from p_tanggal)::int;
begin
    if (select auth.uid()) is null or v_staff is null then
        raise exception 'Jurnal mengajar hanya untuk akun guru.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'tanggal', p_tanggal,
        'hari_ini', public.jakarta_today(),
        'hari_sekolah', public.is_school_day(p_tanggal),
        'libur', (select h.name from public.school_holidays h where h.holiday_date = p_tanggal limit 1),
        'jadwal', coalesce((
            select jsonb_agg(jsonb_build_object('class_id', c.id, 'kelas', c.name, 'subject_id', sub.id, 'kode', sub.code,
                                 'mapel', coalesce(sub.short_name, sub.name), 'jam', e.slot_no,
                                 'mulai', to_char(sl.mulai, 'HH24:MI'), 'selesai', to_char(sl.selesai, 'HH24:MI'))
                             order by sl.mulai nulls last, e.slot_no, c.grade, c.section)
            from public.class_schedule_entries e
            join public.class_schedule_slots sl on sl.class_id = e.class_id and sl.slot_no = e.slot_no
            join public.classes c on c.id = e.class_id
            join public.academic_years y on y.id = c.academic_year_id and y.is_active
            join public.subjects sub on sub.id = e.subject_id
            where v_hari between 1 and 5 and e.hari = v_hari and e.jenis = 'mapel'
              and (e.staff_id = v_staff
                   or (e.staff_id is null and exists (select 1 from public.homeroom_assignments h where h.class_id = c.id and h.staff_id = v_staff)))), '[]'::jsonb),
        'catatan', coalesce((
            select jsonb_agg(jsonb_build_object('id', j.id, 'class_id', j.class_id, 'kelas', c.name, 'subject_id', j.subject_id,
                                 'mapel', coalesce(sub.short_name, sub.name), 'judul', j.judul, 'jam', j.jam, 'status', j.status,
                                 'materi', j.materi, 'keterangan', j.keterangan, 'diubah', j.updated_at) order by j.created_at)
            from public.teaching_journal j
            left join public.classes c on c.id = j.class_id
            left join public.subjects sub on sub.id = j.subject_id
            where j.staff_id = v_staff and j.tanggal = p_tanggal), '[]'::jsonb),
        'kelas', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.name) order by c.grade, c.section)
            from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active
            where exists (select 1 from public.homeroom_assignments h where h.class_id = c.id and h.staff_id = v_staff)
               or exists (select 1 from public.subject_assignments sa where sa.class_id = c.id and sa.staff_id = v_staff)), '[]'::jsonb));
end;
$$;

/** Semua catatan jurnal pemanggil dalam satu bulan (untuk unduhan) + nama & NIP guru. */
create or replace function public.get_my_journal_month(p_tahun int, p_bulan int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_staff uuid := public.current_staff_id();
    v_awal  date;
begin
    if (select auth.uid()) is null or v_staff is null then
        raise exception 'Jurnal mengajar hanya untuk akun guru.' using errcode = '42501';
    end if;
    if p_bulan not between 1 and 12 or p_tahun not between 2020 and 2100 then
        raise exception 'Bulan tidak valid.' using errcode = '22023';
    end if;
    v_awal := make_date(p_tahun, p_bulan, 1);
    return jsonb_build_object(
        'tahun', p_tahun, 'bulan', p_bulan,
        'guru', (select jsonb_build_object('nama', s.name, 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                 from public.staff s where s.id = v_staff),
        'catatan', coalesce((
            select jsonb_agg(jsonb_build_object('tanggal', j.tanggal, 'kelas', c.name, 'mapel', coalesce(sub.short_name, sub.name),
                                 'judul', j.judul, 'jam', j.jam, 'status', j.status, 'materi', j.materi, 'keterangan', j.keterangan)
                             order by j.tanggal, j.created_at)
            from public.teaching_journal j
            left join public.classes c on c.id = j.class_id
            left join public.subjects sub on sub.id = j.subject_id
            where j.staff_id = v_staff and j.tanggal >= v_awal and j.tanggal < (v_awal + interval '1 month')::date), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Tulis
-- -----------------------------------------------------------------------------
/**
 * Simpan satu catatan. p_id diisi = ubah catatan itu. Tanpa p_id: dari jadwal (p_class_id + p_subject_id,
 * satu per kelas-mapel-tanggal, ditimpa bila sudah ada) atau catatan lain (p_judul wajib).
 */
create or replace function public.save_journal_entry(p_tanggal date, p_status text, p_id uuid default null,
                                                     p_class_id uuid default null, p_subject_id uuid default null,
                                                     p_judul text default null, p_jam text default null,
                                                     p_materi text default null, p_keterangan text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_staff  uuid := public.current_staff_id();
    v_judul  text := nullif(btrim(coalesce(p_judul, '')), '');
    v_materi text := nullif(btrim(coalesce(p_materi, '')), '');
    v_ket    text := nullif(btrim(coalesce(p_keterangan, '')), '');
    v_jam    text := nullif(btrim(coalesce(p_jam, '')), '');
    v_id     uuid;
begin
    if (select auth.uid()) is null or v_staff is null then
        raise exception 'Jurnal mengajar hanya untuk akun guru.' using errcode = '42501';
    end if;
    if p_tanggal is null or p_tanggal > public.jakarta_today() then
        raise exception 'Jurnal tidak bisa diisi untuk tanggal yang belum tiba.' using errcode = '22023';
    end if;
    if p_tanggal < public.jakarta_today() - 400 then
        raise exception 'Tanggal terlalu lama.' using errcode = '22023';
    end if;
    if p_status not in ('terlaksana', 'tidak') then
        raise exception 'Status harus Terlaksana atau Tidak terlaksana.' using errcode = '22023';
    end if;
    if length(coalesce(v_materi, '')) > 500 then raise exception 'Materi maksimal 500 huruf.' using errcode = '22023'; end if;
    if length(coalesce(v_ket, '')) > 300 then raise exception 'Keterangan maksimal 300 huruf.' using errcode = '22023'; end if;
    if p_class_id is not null and not public.can_view_class(p_class_id) then
        raise exception 'Kelas itu bukan kelas Anda.' using errcode = '42501';
    end if;

    if p_id is not null then
        update public.teaching_journal
        set status = p_status, materi = v_materi, keterangan = v_ket,
            judul = case when subject_id is null or judul is not null then coalesce(v_judul, judul) else judul end,
            class_id = case when judul is not null then p_class_id else class_id end,
            updated_at = now()
        where id = p_id and staff_id = v_staff
        returning id into v_id;
        if v_id is null then raise exception 'Catatan tidak ditemukan.' using errcode = '22023'; end if;
    elsif v_judul is null then
        if p_class_id is null or p_subject_id is null then
            raise exception 'Isi judul catatan.' using errcode = '22023';
        end if;
        insert into public.teaching_journal (staff_id, tanggal, class_id, subject_id, jam, status, materi, keterangan)
        values (v_staff, p_tanggal, p_class_id, p_subject_id, v_jam, p_status, v_materi, v_ket)
        on conflict (staff_id, tanggal, class_id, subject_id) where subject_id is not null and judul is null
        do update set status = excluded.status, materi = excluded.materi, keterangan = excluded.keterangan,
                      jam = coalesce(excluded.jam, public.teaching_journal.jam), updated_at = now()
        returning id into v_id;
    else
        if length(v_judul) > 80 then raise exception 'Judul maksimal 80 huruf.' using errcode = '22023'; end if;
        insert into public.teaching_journal (staff_id, tanggal, class_id, subject_id, judul, jam, status, materi, keterangan)
        values (v_staff, p_tanggal, p_class_id, p_subject_id, v_judul, v_jam, p_status, v_materi, v_ket)
        returning id into v_id;
    end if;
    return public.get_my_journal_day(p_tanggal);
end;
$$;

create or replace function public.delete_journal_entry(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_tgl date;
begin
    if (select auth.uid()) is null or public.current_staff_id() is null then
        raise exception 'Jurnal mengajar hanya untuk akun guru.' using errcode = '42501';
    end if;
    delete from public.teaching_journal where id = p_id and staff_id = public.current_staff_id() returning tanggal into v_tgl;
    if v_tgl is null then raise exception 'Catatan tidak ditemukan.' using errcode = '22023'; end if;
    return public.get_my_journal_day(v_tgl);
end;
$$;

revoke all on function public.get_my_journal_day(date) from public, anon;
revoke all on function public.get_my_journal_month(int, int) from public, anon;
revoke all on function public.save_journal_entry(date, text, uuid, uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.delete_journal_entry(uuid) from public, anon;
grant execute on function public.get_my_journal_day(date), public.get_my_journal_month(int, int),
    public.save_journal_entry(date, text, uuid, uuid, uuid, text, text, text, text), public.delete_journal_entry(uuid)
    to authenticated, service_role;
