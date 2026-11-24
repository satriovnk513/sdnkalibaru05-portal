-- =============================================================================
-- Angka statistik di halaman publik (Beranda & Profil) dulu ditulis tangan di
-- HTML, jadi ketinggalan setiap kali data berubah. Sekarang diambil dari
-- database lewat satu fungsi yang boleh dipanggil pengunjung (anon).
--
-- Yang keluar hanya empat angka. Tidak ada satu pun data pribadi siswa atau
-- pegawai yang ikut.
-- =============================================================================

/** Empat angka untuk kartu statistik halaman publik. Aman untuk anon: hanya jumlah. */
create or replace function public.get_public_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_ekskul integer := 0;
begin
    -- Tabel isi website dibuat di luar migrasi, jadi keberadaannya diperiksa dulu.
    if to_regclass('public.extracurricular') is not null then
        execute 'select count(*) from public.extracurricular' into v_ekskul;
    end if;
    return jsonb_build_object(
        'siswa', (select count(*) from public.student_records s
                  where s.archived_at is null
                    and exists (select 1 from public.classes c
                                join public.academic_years y on y.id = c.academic_year_id and y.is_active
                                where upper(btrim(c.name)) = upper(btrim(coalesce(s.kelas, ''))))),
        'guru',  (select count(*) from public.staff),
        'rombel', (select count(*) from public.classes c
                   join public.academic_years y on y.id = c.academic_year_id and y.is_active),
        'ekskul', v_ekskul);
end;
$$;

comment on function public.get_public_stats() is
    'Jumlah siswa aktif, guru & tendik, rombel, dan ekskul untuk kartu statistik halaman publik.';

revoke all on function public.get_public_stats() from public;
grant execute on function public.get_public_stats() to anon, authenticated, service_role;
