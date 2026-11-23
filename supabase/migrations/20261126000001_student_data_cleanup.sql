-- =============================================================================
-- Merapikan nilai warisan di data siswa supaya seragam dengan daftar pilihan baku
-- (dropdown di Panel Admin). Yang dirapikan hanya nilai yang artinya sudah jelas:
--   1. Rentang penghasilan format lama + karakter rusak ("â€“") -> format baku.
--   2. Pendidikan "SD"/"SMP"/"SMA" -> "... / sederajat".
--   3. Pekerjaan "Lain-lain" -> "Lainnya"; status Dukcapil "Belum Verifikasi"
--      -> "Belum diverifikasi".
--   4. Nilai bawaan yang bukan isian ("Pilih Kecamatan", "(tidak diisi)", dsb.)
--      dihapus supaya terbaca kosong, bukan terisi salah.
-- Payload sebelum dirapikan disimpan di student_payload_backup.
-- Dijalankan sebagai service_role/postgres, jadi trigger guard & audit dilewati;
-- kolom turunan karena itu disetel ulang di akhir.
-- =============================================================================

create table if not exists public.student_payload_backup (
    student_id   uuid primary key references public.student_records (id) on delete cascade,
    payload      jsonb       not null,
    alasan       text        not null,
    disimpan_at  timestamptz not null default now()
);
alter table public.student_payload_backup enable row level security;
alter table public.student_payload_backup force row level security;
revoke all on table public.student_payload_backup from public, anon, authenticated;
grant all on table public.student_payload_backup to service_role;

do $$
declare
    v_row   record;
    v_key   text;
    v_val   text;
    v_new   jsonb;
    v_fix   text;
    v_n     int := 0;
begin
    for v_row in select id, payload from public.student_records where archived_at is null loop
        v_new := v_row.payload;
        for v_key, v_val in select key, value #>> '{}' from jsonb_each(v_row.payload) where jsonb_typeof(value) = 'string' loop
            v_fix := v_val;
            if v_key like '%penghasilan' then
                v_fix := case btrim(v_fix)
                    when 'Rp1.000.001 â€“ Rp3.000.000'    then 'Rp1.000.001 - Rp3.000.000'
                    when 'Rp1.000.001 – Rp3.000.000'      then 'Rp1.000.001 - Rp3.000.000'
                    when 'Rp. 1,000,000 - Rp. 1,999,999'  then 'Rp1.000.001 - Rp3.000.000'
                    when 'Rp. 2,000,000 - Rp. 4,999,999'  then 'Rp3.000.001 - Rp5.000.000'
                    when 'Rp. 5,000,000 - Rp. 20,000,000' then 'Rp5.000.001 - Rp20.000.000'
                    else v_fix end;
            elsif v_key like '%pendidikan_nama' then
                v_fix := case btrim(v_fix) when 'SD' then 'SD / sederajat'
                                           when 'SMP' then 'SMP / sederajat'
                                           when 'SMA' then 'SMA / sederajat'
                                           else v_fix end;
            elsif v_key like '%pekerjaan_nama' and btrim(v_fix) = 'Lain-lain' then
                v_fix := 'Lainnya';
            elsif v_key = 'status_dukcapil' and btrim(v_fix) = 'Belum Verifikasi' then
                v_fix := 'Belum diverifikasi';
            end if;

            -- nilai bawaan dropdown yang terlanjur ikut tersimpan: bukan isian
            if v_fix ilike 'Pilih' or v_fix ilike 'Pilih %' or btrim(v_fix) = '(tidak diisi)' then
                v_new := v_new - v_key;
            elsif v_fix <> v_val then
                v_new := jsonb_set(v_new, array[v_key], to_jsonb(v_fix));
            end if;
        end loop;

        if v_new is distinct from v_row.payload then
            insert into public.student_payload_backup (student_id, payload, alasan)
            values (v_row.id, v_row.payload, 'Sebelum perapian nilai baku 2026-11-23')
            on conflict (student_id) do nothing;
            update public.student_records
            set payload = v_new,
                nik = v_new ->> 'nik_siswa', nama_siswa = v_new ->> 'nama_siswa',
                nipd = v_new ->> 'siswa_nipd', nisn = v_new ->> 'siswa_nisn',
                kelas = v_new ->> 'kelas', nama_ibu_kandung = v_new ->> 'siswa_nama_ibu_kandung',
                status_daftar = v_new ->> 'status_daftar', status_dukcapil = v_new ->> 'status_dukcapil',
                updated_at = now()
            where id = v_row.id;
            v_n := v_n + 1;
        end if;
    end loop;
    raise notice 'Perapian nilai data siswa: % baris diperbarui.', v_n;
end;
$$;
