-- =============================================================================
-- "Kelas" dan "Status Daftar Kelas" sebenarnya mengatakan hal yang sama: siswa
-- yang sudah punya rombel ya tercantum di daftar kelas. Dulu keduanya diisi
-- terpisah, jadi bisa tidak cocok (kelas terisi tapi status masih "Perlu
-- verifikasi"). Sekarang status mengikuti kelas secara otomatis, dari jalur
-- mana pun (form admin, impor, penulisan server-side).
--
-- Nama trigger diawali "auto" supaya berjalan sebelum student_records_guard_write,
-- yang menurunkan kolom status_daftar dari payload.
-- =============================================================================

create or replace function public.student_status_from_class()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_nama text := nullif(btrim(regexp_replace(coalesce(new.payload ->> 'kelas', ''), '\s+', ' ', 'g')), '');
    v_ada  boolean;
begin
    -- Arsip / pulihkan tidak boleh sekaligus mengubah biodata (lihat guard).
    if tg_op = 'UPDATE' and (old.archived_at is null) <> (new.archived_at is null) then return new; end if;

    v_ada := v_nama is not null and exists (
        select 1 from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active
        where upper(btrim(c.name)) = upper(v_nama));

    if v_ada then
        new.payload := new.payload || jsonb_build_object('status_daftar', 'Tercantum di daftar kelas');
    elsif v_nama is null then
        new.payload := new.payload || jsonb_build_object('status_daftar', 'Perlu verifikasi lebih lanjut');
    end if;
    -- Nama kelas terisi tapi tidak dikenal (mis. impor tahun ajaran yang belum
    -- dibuat): status dibiarkan apa adanya.
    return new;
end;
$$;

revoke all on function public.student_status_from_class() from public, anon, authenticated;

drop trigger if exists student_records_auto_status on public.student_records;
create trigger student_records_auto_status
    before insert or update of payload on public.student_records
    for each row
    execute function public.student_status_from_class();

-- Samakan data yang sudah ada.
update public.student_records s
set payload = s.payload || jsonb_build_object('status_daftar', 'Tercantum di daftar kelas'),
    status_daftar = 'Tercantum di daftar kelas'
where s.archived_at is null
  and coalesce(s.payload ->> 'status_daftar', '') <> 'Tercantum di daftar kelas'
  and exists (
      select 1 from public.classes c join public.academic_years y on y.id = c.academic_year_id and y.is_active
      where upper(btrim(c.name)) = upper(btrim(coalesce(s.payload ->> 'kelas', '')))
        and nullif(btrim(coalesce(s.payload ->> 'kelas', '')), '') is not null);
