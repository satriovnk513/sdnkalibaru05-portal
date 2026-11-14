-- =============================================================================
-- Modul Absensi — peringatan alpa menyertakan No. HP orang tua/wali
-- (untuk tombol "Hubungi Orang Tua" via WhatsApp di dashboard guru).
--
-- Nomor diambil dengan urutan yang sama seperti profil siswa (get_student_profile),
-- yang sudah boleh dilihat wali kelas. Peringatan alpa sendiri hanya untuk wali
-- kelas (kelasnya), pimpinan, dan admin. Hanya mengganti satu fungsi.
-- =============================================================================

begin;

create or replace function public.get_alpha_alerts(p_min int default 4)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_today date := public.jakarta_today();
    v_start date;
    v_end   date;
    v_from  date;
    v_all   boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Belum login.' using errcode = '42501';
    end if;
    if p_min is null or p_min < 1 then
        raise exception 'Batas minimal tidak valid.' using errcode = '22023';
    end if;
    v_all := public.att_is_admin() or public.is_pimpinan();

    select y.start_date, y.end_date into v_start, v_end
    from public.academic_years y where y.is_active;
    if v_start is null then
        return jsonb_build_object('batas', p_min, 'dari', null, 'siswa', '[]'::jsonb);
    end if;
    -- Semester berjalan: ganjil = awal TA s.d. 31 Des; genap = 1 Jan s.d. akhir TA.
    v_from := case when v_today >= make_date(extract(year from v_start)::int + 1, 1, 1)
                   then make_date(extract(year from v_start)::int + 1, 1, 1) else v_start end;

    return jsonb_build_object(
        'batas', p_min,
        'dari', v_from,
        'siswa', coalesce((
            select jsonb_agg(jsonb_build_object(
                'class_id', x.class_id, 'kelas', x.kelas, 'student_id', x.student_id,
                'nama', x.nama, 'alpa', x.alpa, 'terakhir', x.terakhir, 'hp', x.hp)
                order by x.alpa desc, x.kelas, x.nama)
            from (
                select c.id as class_id, c.name as kelas, st.id as student_id, st.nama_siswa as nama,
                       count(*) as alpa, max(s.session_date) as terakhir,
                       -- No. HP orang tua/wali pertama yang valid (urutan sama dengan profil siswa)
                       (select ph from unnest(array[
                            st.payload ->> 'kontak_no_hp', st.payload ->> 'ibu_no_hp', st.payload ->> 'ayah_no_hp',
                            st.payload ->> 'wali_no_hp', st.payload ->> 'wali_no_telp', st.payload ->> 'lain_hp_orang_tua_ppdb',
                            st.payload ->> 'siswa_no_hp', st.payload ->> 'siswa_no_telepon']) with ordinality u(raw, ord)
                        cross join lateral (select public.normalize_phone(u.raw) as ph) n
                        where n.ph is not null order by u.ord limit 1) as hp
                from public.classes c
                join public.academic_years y on y.id = c.academic_year_id and y.is_active
                join public.attendance_sessions s on s.class_id = c.id and s.kind = 'harian' and s.archived_at is null
                     and s.session_date between v_from and v_today
                join public.attendance_records ar on ar.session_id = s.id and ar.status = 'A'
                join public.student_records st on st.id = ar.student_id and st.archived_at is null
                join public.student_enrollments e on e.student_id = st.id and e.class_id = c.id
                     and e.start_date <= v_today and (e.end_date is null or e.end_date >= v_today)
                where v_all or public.is_homeroom_of(c.id)
                group by c.id, c.name, st.id, st.nama_siswa, st.payload
                having count(*) >= p_min) x), '[]'::jsonb));
end;
$$;

commit;
