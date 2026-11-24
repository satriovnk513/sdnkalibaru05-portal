-- =============================================================================
-- Mengurangi jumlah UH selalu memotong kolom terakhir, padahal yang batal bisa
-- saja ulangan di tengah. delete_subject_uh membuang satu kolom UH tertentu,
-- lalu kolom sesudahnya naik supaya tidak ada nomor yang bolong:
-- hapus UH 3 dari 5 kolom → UH 4 jadi UH 3, UH 5 jadi UH 4, sisa 4 kolom.
--
-- Nilai di kolom yang dibuang hilang, jadi dikonfirmasi dulu (p_force) dan
-- setiap nilai dicatat di riwayat, berikut satu baris 'hapus_uh' yang
-- menerangkan kolom ke berapa yang dibuang.
-- =============================================================================

alter table public.grade_changes drop constraint if exists grade_changes_field;
alter table public.grade_changes add constraint grade_changes_field check (
    field in ('uh1', 'uh2', 'uh3', 'uh4', 'uh5', 'uh6', 'uh7', 'uh8', 'uh9', 'uh10',
              'sts', 'sas', 'kktp', 'jumlah_uh', 'hapus_uh'));

/**
 * Buang kolom UH ke-p_ke; kolom sesudahnya naik satu dan jumlah UH berkurang satu.
 *   - p_force = false -> kalau kolom itu masih ada nilainya, ditolak dan dilaporkan jumlahnya
 *   - p_force = true  -> nilai dibuang, tiap penghapusan dicatat di riwayat
 * Kembali: {jumlah, sebelumnya, dihapus_ke, terhapus}
 */
create or replace function public.delete_subject_uh(p_class_id uuid, p_subject_id uuid, p_ke smallint,
                                                    p_semester smallint, p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_lama   smallint;
    v_isi    int := 0;
    v_hapus  int := 0;
    v_who    text := public.grade__nama_pengubah();
    v_src    text := case when public.att_is_admin() and public.current_staff_id() is null then 'admin' else 'portal' end;
begin
    if not public.grade_can_edit(p_class_id, p_subject_id) then
        raise exception 'Anda tidak berhak mengubah kolom UH mapel ini.' using errcode = '42501';
    end if;
    if p_semester not in (1, 2) then
        raise exception 'Semester harus 1 atau 2.' using errcode = '22023';
    end if;
    v_lama := public.grade__uh_count(p_class_id, p_subject_id, p_semester);
    if v_lama <= 1 then
        raise exception 'Mapel ini tinggal satu kolom UH, tidak bisa dihapus lagi.' using errcode = '22023';
    end if;
    if p_ke is null or p_ke not between 1 and v_lama then
        raise exception 'Kolom UH ke-% tidak ada; mapel ini punya % kolom.', p_ke, v_lama using errcode = '22023';
    end if;

    select count(*) into v_isi
    from public.student_grades g,
         unnest(array[g.uh1, g.uh2, g.uh3, g.uh4, g.uh5,
                      g.uh6, g.uh7, g.uh8, g.uh9, g.uh10]) with ordinality u(nilai, ke)
    where g.class_id = p_class_id and g.subject_id = p_subject_id and g.semester = p_semester
      and u.ke = p_ke and u.nilai is not null;
    if v_isi > 0 and not p_force then
        raise exception 'Kolom UH % masih terisi untuk % siswa.', p_ke, v_isi using errcode = '23514';
    end if;

    insert into public.grade_changes (class_id, student_id, subject_id, semester, field, old_value, new_value, source, changed_by_name)
    select g.class_id, g.student_id, g.subject_id, g.semester, 'uh' || p_ke, u.nilai, null, v_src, v_who
    from public.student_grades g,
         unnest(array[g.uh1, g.uh2, g.uh3, g.uh4, g.uh5,
                      g.uh6, g.uh7, g.uh8, g.uh9, g.uh10]) with ordinality u(nilai, ke)
    where g.class_id = p_class_id and g.subject_id = p_subject_id and g.semester = p_semester
      and u.ke = p_ke and u.nilai is not null;
    get diagnostics v_hapus = row_count;

    -- Geser: kolom ke-p_ke diisi kolom berikutnya, dan seterusnya; kolom terakhir dikosongkan.
    update public.student_grades g
    set uh1  = geser.n[1],  uh2 = geser.n[2],  uh3 = geser.n[3],  uh4 = geser.n[4],  uh5 = geser.n[5],
        uh6  = geser.n[6],  uh7 = geser.n[7],  uh8 = geser.n[8],  uh9 = geser.n[9],  uh10 = geser.n[10],
        updated_at = now(), updated_by = (select auth.uid())
    from (
        select g2.student_id as sid,
               array(select u.nilai
                     from unnest(array[g2.uh1, g2.uh2, g2.uh3, g2.uh4, g2.uh5,
                                       g2.uh6, g2.uh7, g2.uh8, g2.uh9, g2.uh10]) with ordinality u(nilai, ke)
                     where u.ke <> p_ke
                     order by u.ke) || array[null]::smallint[] as n
        from public.student_grades g2
        where g2.class_id = p_class_id and g2.subject_id = p_subject_id and g2.semester = p_semester
    ) geser
    where g.class_id = p_class_id and g.subject_id = p_subject_id and g.semester = p_semester
      and g.student_id = geser.sid;

    insert into public.class_subject_uh (class_id, subject_id, semester, uh_count, updated_by)
    values (p_class_id, p_subject_id, p_semester, (v_lama - 1)::smallint, (select auth.uid()))
    on conflict (class_id, subject_id, semester) do update
    set uh_count = excluded.uh_count, updated_at = now(), updated_by = excluded.updated_by;

    insert into public.grade_changes (class_id, subject_id, semester, field, old_value, new_value, source, changed_by_name)
    values (p_class_id, p_subject_id, p_semester, 'hapus_uh', p_ke, null, v_src, v_who),
           (p_class_id, p_subject_id, p_semester, 'jumlah_uh', v_lama, (v_lama - 1)::smallint, v_src, v_who);

    return jsonb_build_object('jumlah', v_lama - 1, 'sebelumnya', v_lama, 'dihapus_ke', p_ke, 'terhapus', v_hapus);
end;
$$;

revoke all on function public.delete_subject_uh(uuid, uuid, smallint, smallint, boolean) from public, anon;
grant execute on function public.delete_subject_uh(uuid, uuid, smallint, smallint, boolean) to authenticated, service_role;
