-- =============================================================================
-- Portal Guru — data untuk menu "Cetak & Dokumen" — SDN Kalibaru 05
--
-- get_class_document_data(class): kop (kelas, tahun ajaran, wali kelas, kepala
-- sekolah) + daftar siswa rombel itu dengan satu versi data yang sudah
-- dirapikan: identitas, NIK, No. KK, orang tua, alamat, No. HP.
--
-- NIK dan No. KK ikut disertakan atas keputusan sekolah (guru membuat sendiri
-- biodata/surat). Penghasilan orang tua, akta, koordinat, dan data keluarga lain
-- TIDAK disertakan. Hak akses: can_view_class (wali kelas & guru mapel rombel
-- itu, pimpinan, admin). Hanya menambah satu fungsi.
-- =============================================================================

begin;

create or replace function public.get_class_document_data(p_class_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_today date := public.jakarta_today();
begin
    if (select auth.uid()) is null or not public.can_view_class(p_class_id) then
        raise exception 'Tidak punya akses ke rombel ini.' using errcode = '42501';
    end if;

    return public.get_class_report_header(p_class_id) || jsonb_build_object(
        'tanggal', v_today,
        'siswa', coalesce((
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                'student_id', r.student_id,
                'no', r.no_urut,
                'nama', r.nama,
                'jk', r.jenis_kelamin,
                'nis', r.nis,
                'nisn', r.nisn,
                'nik', nullif(btrim(x ->> 'nik_siswa'), ''),
                'no_kk', nullif(btrim(x ->> 'siswa_no_kk'), ''),
                'tempat_lahir', nullif(btrim(x ->> 'siswa_tempat_lahir'), ''),
                'tanggal_lahir', nullif(btrim(x ->> 'siswa_tanggal_lahir'), ''),
                'agama', nullif(btrim(x ->> 'siswa_agama'), ''),
                'anak_ke', nullif(btrim(x ->> 'lain_anak_ke'), ''),
                'ayah', nullif(btrim(x ->> 'ayah_nama'), ''),
                'ibu', coalesce(nullif(btrim(x ->> 'ibu_nama'), ''), nullif(btrim(x ->> 'siswa_nama_ibu_kandung'), '')),
                'wali', nullif(btrim(x ->> 'wali_nama'), ''),
                'hp', (select ph from unnest(array[
                            x ->> 'kontak_no_hp', x ->> 'ibu_no_hp', x ->> 'ayah_no_hp', x ->> 'wali_no_hp',
                            x ->> 'wali_no_telp', x ->> 'lain_hp_orang_tua_ppdb', x ->> 'siswa_no_hp', x ->> 'siswa_no_telepon'])
                            with ordinality u(raw, ord)
                       cross join lateral (select public.normalize_phone(u.raw) as ph) n
                       where n.ph is not null order by u.ord limit 1),
                'alamat', nullif(btrim(concat_ws(', ',
                    nullif(btrim(x ->> 'siswa_alamat'), ''),
                    case when nullif(btrim(x ->> 'siswa_rt'), '') is not null or nullif(btrim(x ->> 'siswa_rw'), '') is not null
                         then 'RT ' || coalesce(nullif(btrim(x ->> 'siswa_rt'), ''), '-') || '/RW ' || coalesce(nullif(btrim(x ->> 'siswa_rw'), ''), '-') end,
                    'Kel. ' || nullif(btrim(x ->> 'siswa_kelurahan_nama'), ''),
                    'Kec. ' || nullif(btrim(x ->> 'siswa_kecamatan_nama'), ''))), '')
            )) order by r.no_urut)
            from public.get_class_roster(p_class_id, v_today) r
            join public.student_records s on s.id = r.student_id
            cross join lateral (select s.payload as x) p), '[]'::jsonb));
end;
$$;

revoke all on function public.get_class_document_data(uuid) from public, anon;
grant execute on function public.get_class_document_data(uuid) to authenticated, service_role;

commit;
