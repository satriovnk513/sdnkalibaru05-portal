-- =============================================================================
-- Pindah kelas siswa yang benar: mengubah label "Kelas" di data siswa saja tidak
-- memindahkan keanggotaan rombel (student_enrollments), sehingga absensi, nilai,
-- jadwal dan piket masih memakai kelas lama. Fungsi ini mengubah keduanya
-- sekaligus: menutup keanggotaan lama (riwayat absensi tetap di kelas lama) dan
-- membuka keanggotaan baru mulai tanggal pindah.
-- =============================================================================

/** Pindahkan siswa ke rombel lain pada tahun ajaran aktif. p_kelas kosong = keluar dari rombel. */
create or replace function public.set_student_class(p_student_id uuid, p_kelas text default null, p_tanggal date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_tgl    date := coalesce(p_tanggal, public.jakarta_today());
    v_nama   text := nullif(btrim(regexp_replace(coalesce(p_kelas, ''), '\s+', ' ', 'g')), '');
    v_siswa  public.student_records;
    v_target uuid;
    v_tname  text;
    v_old    public.student_enrollments;
    v_oname  text;
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin/operator yang bisa memindahkan kelas siswa.' using errcode = '42501';
    end if;

    select * into v_siswa from public.student_records where id = p_student_id for update;
    if v_siswa.id is null then raise exception 'Siswa tidak ditemukan.' using errcode = '22023'; end if;
    if v_siswa.archived_at is not null then
        raise exception 'Siswa sudah diarsipkan. Pulihkan dulu sebelum memindahkan kelas.' using errcode = '22023';
    end if;
    if v_tgl > public.jakarta_today() then
        raise exception 'Tanggal pindah tidak boleh di masa depan.' using errcode = '22023';
    end if;

    if v_nama is not null then
        select c.id, c.name into v_target, v_tname
        from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active
        where upper(btrim(c.name)) = upper(v_nama);
        if v_target is null then
            raise exception 'Kelas "%" tidak ada di tahun ajaran aktif.', v_nama using errcode = '22023';
        end if;
    end if;

    select * into v_old from public.student_enrollments where student_id = p_student_id and end_date is null for update;
    select c.name into v_oname from public.classes c where c.id = v_old.class_id;

    if v_old.class_id is not distinct from v_target then
        -- sudah di kelas itu: cukup samakan label di data siswa
        if v_tname is not null and coalesce(v_siswa.payload ->> 'kelas', '') <> v_tname then
            update public.student_records set payload = payload || jsonb_build_object('kelas', v_tname) where id = p_student_id;
        end if;
        return jsonb_build_object('pindah', false, 'dari', v_oname, 'ke', v_tname, 'tanggal', v_tgl);
    end if;

    if v_old.id is not null then
        if v_old.start_date >= v_tgl then
            -- keanggotaan baru itu belum sempat berjalan, jadi dihapus saja
            delete from public.student_enrollments where id = v_old.id;
        else
            update public.student_enrollments set end_date = v_tgl - 1 where id = v_old.id;
        end if;
    end if;

    if v_target is not null then
        insert into public.student_enrollments (student_id, class_id, start_date, created_by)
        values (p_student_id, v_target, v_tgl, (select auth.uid()));
    end if;

    update public.student_records
    set payload = case when v_tname is null then (payload - 'kelas') else payload || jsonb_build_object('kelas', v_tname) end
                  || case when v_oname is null then '{}'::jsonb else jsonb_build_object('kelas_lama', v_oname) end
    where id = p_student_id;

    insert into public.admin_audit_log (entitas, entitas_id, aksi, ringkasan, data_lama, oleh_nama)
    values ('siswa_kelas', p_student_id, 'ubah',
            format('%s: %s → %s', v_siswa.nama_siswa, coalesce(v_oname, 'tanpa kelas'), coalesce(v_tname, 'tanpa kelas')),
            jsonb_build_object('kelas', v_oname, 'tanggal', v_tgl), public.admin__nama());

    return jsonb_build_object('pindah', true, 'dari', v_oname, 'ke', v_tname, 'tanggal', v_tgl);
end;
$$;

/** Siswa yang label kelasnya tidak sama dengan keanggotaan rombelnya (sisa data lama). */
create or replace function public.get_class_mismatch()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin/operator.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'nama', s.nama_siswa,
                   'label', nullif(btrim(coalesce(s.payload ->> 'kelas', '')), ''), 'rombel', c.name) order by s.nama_siswa)
        from public.student_records s
        left join public.student_enrollments e on e.student_id = s.id and e.end_date is null
        left join public.classes c on c.id = e.class_id
        where s.archived_at is null
          and coalesce(s.payload ->> 'status_daftar', '') = 'Tercantum di daftar kelas'
          and nullif(btrim(coalesce(s.payload ->> 'kelas', '')), '') is distinct from c.name), '[]'::jsonb);
end;
$$;

revoke all on function public.set_student_class(uuid, text, date) from public, anon;
revoke all on function public.get_class_mismatch() from public, anon;
grant execute on function public.set_student_class(uuid, text, date), public.get_class_mismatch() to authenticated, service_role;
