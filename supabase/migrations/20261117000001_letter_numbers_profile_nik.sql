-- =============================================================================
-- Portal Guru — nomor surat berurut & NIK di profil siswa — SDN Kalibaru 05
--
--   1. letter_register + take_letter_number(): nomor surat berurut per tahun
--      (001–999), dengan format <nomor>/<kode>, mis. 005/PK.0101. Setiap nomor
--      yang diambil tercatat (siapa, kapan, surat apa) supaya tidak dobel.
--   2. get_student_profile(): menyertakan NIK siswa (keputusan sekolah). No. KK,
--      NIK orang tua, dan penghasilan tetap tidak disertakan di profil.
-- Satu transaksi.
-- =============================================================================

begin;

create table if not exists public.letter_register (
    id          bigint generated always as identity primary key,
    tahun       int  not null,
    nomor       int  not null check (nomor between 1 and 999),
    kode        text not null,
    jenis       text not null,
    perihal     text,
    staff_id    uuid references public.staff (id) on delete set null,
    created_by  uuid default auth.uid(),
    created_at  timestamptz not null default now(),
    unique (tahun, nomor)
);

alter table public.letter_register enable row level security;
alter table public.letter_register force row level security;
revoke all on table public.letter_register from public, anon, authenticated;
grant select on table public.letter_register to authenticated;
grant all on table public.letter_register to service_role;

-- Buku nomor surat boleh dibaca admin & pimpinan; guru melihat nomor yang diambilnya sendiri.
drop policy if exists letter_register_select on public.letter_register;
create policy letter_register_select on public.letter_register
    for select to authenticated
    using ((select public.att_is_admin()) or (select public.is_pimpinan()) or created_by = (select auth.uid()));

-- Ambil nomor surat berikutnya untuk tahun berjalan. Aman bila dua guru menekan bersamaan.
create or replace function public.take_letter_number(p_jenis text, p_perihal text default null, p_kode text default 'PK.0101')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_tahun int := extract(year from public.jakarta_today())::int;
    v_kode  text := nullif(btrim(coalesce(p_kode, '')), '');
    v_nomor int;
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.current_staff_id() is not null) then
        raise exception 'Hanya guru dan admin yang bisa mengambil nomor surat.' using errcode = '42501';
    end if;
    if nullif(btrim(coalesce(p_jenis, '')), '') is null then
        raise exception 'Jenis surat wajib diisi.' using errcode = '22023';
    end if;
    if v_kode is null or length(v_kode) > 30 or v_kode !~ '^[A-Za-z0-9./-]+$' then
        raise exception 'Kode surat tidak valid.' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('public.letter_register'), v_tahun);
    select coalesce(max(nomor), 0) + 1 into v_nomor from public.letter_register where tahun = v_tahun;
    if v_nomor > 999 then
        raise exception 'Nomor surat tahun % sudah mencapai 999.', v_tahun using errcode = '22023';
    end if;

    insert into public.letter_register (tahun, nomor, kode, jenis, perihal, staff_id, created_by)
    values (v_tahun, v_nomor, v_kode, left(btrim(p_jenis), 80), nullif(left(btrim(coalesce(p_perihal, '')), 200), ''),
            public.current_staff_id(), (select auth.uid()));

    return jsonb_build_object('tahun', v_tahun, 'nomor', v_nomor,
        'teks', lpad(v_nomor::text, 3, '0') || '/' || v_kode);
end;
$$;

revoke all on function public.take_letter_number(text, text, text) from public, anon;
grant execute on function public.take_letter_number(text, text, text) to authenticated, service_role;

create or replace function public.get_student_profile(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_rec        public.student_records%rowtype;
    x            jsonb;
    v_class_id   uuid;
    v_class_name text;
    v_full       boolean;
    v_phones     text[] := array[]::text[];
    v_phone      text;
    v_ayah       text;
    v_ibu        text;
    v_wali       text;
begin
    if (select auth.uid()) is null then
        raise exception 'Harus login.' using errcode = '42501';
    end if;

    select * into v_rec from public.student_records where id = p_student_id;
    if not found then
        raise exception 'Siswa tidak ditemukan.' using errcode = 'P0002';
    end if;

    select c.id, c.name into v_class_id, v_class_name
    from public.student_enrollments e
    join public.classes c on c.id = e.class_id
    where e.student_id = p_student_id
    order by (e.end_date is null) desc, e.start_date desc
    limit 1;

    if not (public.att_is_admin() or public.is_pimpinan()
            or (v_class_id is not null and public.can_view_class(v_class_id))) then
        raise exception 'Tidak punya akses ke siswa ini.' using errcode = '42501';
    end if;

    -- Catatan (kebutuhan khusus, KIP/PIP) hanya untuk wali kelas, pimpinan, admin.
    v_full := public.att_is_admin() or public.is_pimpinan()
              or (v_class_id is not null and public.is_homeroom_of(v_class_id));

    x := v_rec.payload;
    v_ayah := nullif(btrim(x ->> 'ayah_nama'), '');
    v_ibu  := coalesce(nullif(btrim(x ->> 'ibu_nama'), ''), nullif(btrim(x ->> 'siswa_nama_ibu_kandung'), ''));
    v_wali := nullif(btrim(x ->> 'wali_nama'), '');

    foreach v_phone in array array[
        x ->> 'kontak_no_hp', x ->> 'ibu_no_hp', x ->> 'ayah_no_hp', x ->> 'wali_no_hp',
        x ->> 'wali_no_telp', x ->> 'lain_hp_orang_tua_ppdb', x ->> 'siswa_no_hp', x ->> 'siswa_no_telepon']
    loop
        v_phone := public.normalize_phone(v_phone);
        if v_phone is not null and not (v_phone = any (v_phones)) and cardinality(v_phones) < 2 then
            v_phones := v_phones || v_phone;
        end if;
    end loop;

    return jsonb_strip_nulls(jsonb_build_object(
        'id', v_rec.id,
        'identitas', jsonb_build_object(
            'nama', v_rec.nama_siswa,
            'nis', v_rec.nipd,
            'nisn', v_rec.nisn,
            'nik', nullif(btrim(x ->> 'nik_siswa'), ''),
            'kelas', v_class_name,
            'jenis_kelamin', case x ->> 'siswa_jenis_kelamin_nama'
                                when 'Laki-laki' then 'L' when 'Perempuan' then 'P' end,
            'tempat_lahir', nullif(btrim(x ->> 'siswa_tempat_lahir'), ''),
            'tanggal_lahir', nullif(btrim(x ->> 'siswa_tanggal_lahir'), ''),
            'agama', nullif(btrim(x ->> 'siswa_agama'), ''),
            'anak_ke', nullif(btrim(x ->> 'lain_anak_ke'), '')),
        'orang_tua', jsonb_build_object(
            'ayah_nama', v_ayah,
            'ayah_pekerjaan', nullif(btrim(x ->> 'ayah_pekerjaan_nama'), ''),
            'ibu_nama', v_ibu,
            'ibu_pekerjaan', nullif(btrim(x ->> 'ibu_pekerjaan_nama'), '')),
        'wali', case
            when v_wali is not null
             and upper(v_wali) is distinct from upper(coalesce(v_ayah, ''))
             and upper(v_wali) is distinct from upper(coalesce(v_ibu, ''))
            then jsonb_build_object(
                'nama', v_wali,
                'pekerjaan', nullif(btrim(x ->> 'wali_pekerjaan_nama'), ''))
            end,
        'kontak', to_jsonb(v_phones),
        'alamat', jsonb_build_object(
            'jalan', nullif(btrim(x ->> 'siswa_alamat'), ''),
            'rt', nullif(btrim(x ->> 'siswa_rt'), ''),
            'rw', nullif(btrim(x ->> 'siswa_rw'), ''),
            'kelurahan', nullif(btrim(x ->> 'siswa_kelurahan_nama'), ''),
            'kecamatan', nullif(btrim(x ->> 'siswa_kecamatan_nama'), '')),
        'catatan', case when v_full then jsonb_build_object(
            'kebutuhan_khusus', nullif(btrim(x ->> 'lain_kebutuhan_khusus'), ''),
            'penerima_kip', nullif(btrim(x ->> 'lain_penerima_kip'), ''),
            'usulan_pip', nullif(btrim(x ->> 'lain_usulan_pip'), '')) end
    ));
end;
$$;

commit;
