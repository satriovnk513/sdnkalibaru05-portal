-- =============================================================================
-- Jadwal piket siswa per kelas.
--
-- - Siswa dibagi rata Senin–Jumat (selisih jumlah per hari paling banyak 1),
--   laki-laki & perempuan juga tersebar rata, urutan diacak.
-- - Mode per kelas: 'semester' (tetap satu semester) atau 'bulanan' (diacak
--   ulang otomatis tiap bulan). Pembagian satu periode dibuat sekali (saat
--   pertama dibuka) lalu tetap, sampai wali kelas menekan "Acak ulang" atau
--   memindahkan siswa ke hari lain.
-- - Siswa baru otomatis masuk ke hari yang paling sedikit; siswa yang sudah
--   keluar tidak tampil (mengikuti daftar kelas pada tanggal itu).
-- - Yang mengubah: wali kelas & admin. Yang melihat: guru kelas itu, kepala
--   sekolah, admin.
-- =============================================================================

create table if not exists public.class_piket_settings (
    class_id   uuid        primary key references public.classes (id) on delete cascade,
    mode       text        not null default 'bulanan',
    updated_at timestamptz not null default now(),
    updated_by uuid        references auth.users (id) on delete set null,
    constraint class_piket_settings_mode check (mode in ('semester', 'bulanan'))
);

create table if not exists public.class_piket (
    class_id   uuid     not null references public.classes (id) on delete cascade,
    periode    text     not null,
    student_id uuid     not null references public.student_records (id) on delete cascade,
    hari       smallint not null,
    primary key (class_id, periode, student_id),
    constraint class_piket_hari check (hari between 1 and 5),
    constraint class_piket_periode check (periode ~ '^(S[12]|B\d{4}-\d{2})$')
);

alter table public.class_piket_settings enable row level security;
alter table public.class_piket_settings force row level security;
alter table public.class_piket enable row level security;
alter table public.class_piket force row level security;
revoke all on table public.class_piket_settings, public.class_piket from public, anon, authenticated;
grant all on table public.class_piket_settings, public.class_piket to service_role;

-- -----------------------------------------------------------------------------
-- Internal
-- -----------------------------------------------------------------------------
/** Kunci periode: 'S1' / 'S2' (mode semester) atau 'B2026-11' (mode bulanan). */
create or replace function public.piket__periode(p_class_id uuid, p_tanggal date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select case when coalesce((select mode from public.class_piket_settings where class_id = p_class_id), 'bulanan') = 'semester'
                then case when extract(month from p_tanggal) >= 7 then 'S1' else 'S2' end
                else 'B' || to_char(p_tanggal, 'YYYY-MM') end;
$$;

/** Bagi rata seluruh siswa kelas (daftar pada p_tanggal) ke Senin–Jumat; menimpa pembagian periode itu. */
create or replace function public.piket__acak(p_class_id uuid, p_tanggal date, p_periode text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_off int := floor(random() * 5)::int;
begin
    delete from public.class_piket where class_id = p_class_id and periode = p_periode;
    insert into public.class_piket (class_id, periode, student_id, hari)
    select p_class_id, p_periode, o.student_id, ((o.i + v_off) % 5) + 1
    from (
        select r.student_id,
               row_number() over (order by case when r.jenis_kelamin = 'L' then 0 when r.jenis_kelamin = 'P' then 1 else 2 end, random()) - 1 as i
        from public.get_class_roster(p_class_id, p_tanggal) r) o;
end;
$$;

/** Pastikan pembagian periode ada; siswa baru dimasukkan ke hari paling sedikit (lalu jenis kelamin yang sama paling sedikit). */
create or replace function public.piket__ensure(p_class_id uuid, p_tanggal date, p_periode text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_s record;
    v_h smallint;
begin
    if not exists (select 1 from public.class_piket where class_id = p_class_id and periode = p_periode) then
        perform public.piket__acak(p_class_id, p_tanggal, p_periode);
        return;
    end if;
    for v_s in
        select r.student_id, r.jenis_kelamin from public.get_class_roster(p_class_id, p_tanggal) r
        where not exists (select 1 from public.class_piket k where k.class_id = p_class_id and k.periode = p_periode and k.student_id = r.student_id)
        order by r.no_urut
    loop
        select d.h into v_h
        from generate_series(1, 5) as d(h)
        order by (select count(*) from public.class_piket k
                  join public.get_class_roster(p_class_id, p_tanggal) r on r.student_id = k.student_id
                  where k.class_id = p_class_id and k.periode = p_periode and k.hari = d.h),
                 (select count(*) from public.class_piket k
                  join public.get_class_roster(p_class_id, p_tanggal) r on r.student_id = k.student_id
                  where k.class_id = p_class_id and k.periode = p_periode and k.hari = d.h and r.jenis_kelamin is not distinct from v_s.jenis_kelamin),
                 d.h
        limit 1;
        insert into public.class_piket (class_id, periode, student_id, hari) values (p_class_id, p_periode, v_s.student_id, v_h);
    end loop;
end;
$$;

revoke all on function public.piket__periode(uuid, date) from public, anon, authenticated;
revoke all on function public.piket__acak(uuid, date, text) from public, anon, authenticated;
revoke all on function public.piket__ensure(uuid, date, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPC
-- -----------------------------------------------------------------------------
/**
 * Jadwal piket kelas untuk periode yang memuat p_tanggal (default hari ini).
 * { kelas, can_edit, mode, periode, bulan, semester, wali, kepala_sekolah, siswa[{id,no,nama,jk,hari}] }
 */
create or replace function public.get_class_piket(p_class_id uuid, p_tanggal date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_tgl  date := coalesce(p_tanggal, public.jakarta_today());
    v_per  text;
    v_class record;
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke kelas ini.' using errcode = '42501';
    end if;
    select c.id, c.grade, c.section, c.name, y.name as tahun into v_class
    from public.classes c join public.academic_years y on y.id = c.academic_year_id where c.id = p_class_id;
    if v_class.id is null then raise exception 'Kelas tidak ditemukan.' using errcode = '22023'; end if;
    v_per := public.piket__periode(p_class_id, v_tgl);
    perform public.piket__ensure(p_class_id, v_tgl, v_per);
    return jsonb_build_object(
        'kelas', jsonb_build_object('id', v_class.id, 'nama', v_class.name, 'tingkat', v_class.grade, 'rombel', v_class.section, 'tahun_ajaran', v_class.tahun),
        'can_edit', (public.att_is_admin() or public.is_homeroom_of(p_class_id)),
        'mode', coalesce((select mode from public.class_piket_settings where class_id = p_class_id), 'bulanan'),
        'periode', v_per,
        'tanggal', v_tgl,
        'semester', case when extract(month from v_tgl) >= 7 then 1 else 2 end,
        'wali', coalesce((select jsonb_agg(jsonb_build_object('nama', s.name, 'posisi', h.position,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), '')) order by h.position)
                          from public.homeroom_assignments h join public.staff s on s.id = h.staff_id where h.class_id = p_class_id), '[]'::jsonb),
        'kepala_sekolah', (select jsonb_build_object('nama', s.name,
                                 'nip', nullif(btrim(regexp_replace(coalesce(s.nip, ''), '^\s*NIP\.?\s*', '', 'i')), ''))
                           from public.staff s where split_part(s.role, '|', 1) = 'Kepala Sekolah'
                           order by s.order_index nulls last, s.name limit 1),
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object('id', r.student_id, 'no', r.no_urut, 'nama', r.nama, 'jk', r.jenis_kelamin, 'hari', k.hari) order by r.no_urut)
            from public.get_class_roster(p_class_id, v_tgl) r
            join public.class_piket k on k.class_id = p_class_id and k.periode = v_per and k.student_id = r.student_id), '[]'::jsonb));
end;
$$;

create or replace function public.set_piket_mode(p_class_id uuid, p_mode text, p_tanggal date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.is_homeroom_of(p_class_id)) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengatur piket kelas ini.' using errcode = '42501';
    end if;
    if p_mode not in ('semester', 'bulanan') then raise exception 'Mode harus semester atau bulanan.' using errcode = '22023'; end if;
    insert into public.class_piket_settings (class_id, mode, updated_by) values (p_class_id, p_mode, (select auth.uid()))
    on conflict (class_id) do update set mode = excluded.mode, updated_at = now(), updated_by = excluded.updated_by;
    return public.get_class_piket(p_class_id, p_tanggal);
end;
$$;

/** Acak ulang pembagian periode yang memuat p_tanggal. */
create or replace function public.shuffle_piket(p_class_id uuid, p_tanggal date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_tgl date := coalesce(p_tanggal, public.jakarta_today());
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.is_homeroom_of(p_class_id)) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengatur piket kelas ini.' using errcode = '42501';
    end if;
    perform public.piket__acak(p_class_id, v_tgl, public.piket__periode(p_class_id, v_tgl));
    return public.get_class_piket(p_class_id, v_tgl);
end;
$$;

/** Pindahkan satu siswa ke hari lain (periode yang memuat p_tanggal). */
create or replace function public.set_piket_day(p_class_id uuid, p_student_id uuid, p_hari smallint, p_tanggal date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_tgl date := coalesce(p_tanggal, public.jakarta_today());
    v_per text;
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.is_homeroom_of(p_class_id)) then
        raise exception 'Hanya wali kelas atau admin yang bisa mengatur piket kelas ini.' using errcode = '42501';
    end if;
    if p_hari not between 1 and 5 then raise exception 'Hari harus Senin–Jumat.' using errcode = '22023'; end if;
    v_per := public.piket__periode(p_class_id, v_tgl);
    perform public.piket__ensure(p_class_id, v_tgl, v_per);
    update public.class_piket set hari = p_hari where class_id = p_class_id and periode = v_per and student_id = p_student_id;
    if not found then raise exception 'Siswa tidak ada di kelas ini.' using errcode = '22023'; end if;
    return public.get_class_piket(p_class_id, v_tgl);
end;
$$;

revoke all on function public.get_class_piket(uuid, date) from public, anon;
revoke all on function public.set_piket_mode(uuid, text, date) from public, anon;
revoke all on function public.shuffle_piket(uuid, date) from public, anon;
revoke all on function public.set_piket_day(uuid, uuid, smallint, date) from public, anon;
grant execute on function public.get_class_piket(uuid, date), public.set_piket_mode(uuid, text, date),
    public.shuffle_piket(uuid, date), public.set_piket_day(uuid, uuid, smallint, date)
    to authenticated, service_role;
