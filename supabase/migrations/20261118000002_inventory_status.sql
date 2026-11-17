-- =============================================================================
-- Inventaris: status barang jadi dua saja — Berfungsi ('baik') / Rusak ('rusak')
-- + keterangan kerusakan (opsional). Hanya admin yang menentukan status.
--
-- - Guru tidak lagi memilih kondisi saat mengembalikan; cukup catatan untuk
--   operator (mis. "lampu berkedip"). Admin yang memutuskan rusak / tidak.
-- - Barang rusak tidak bisa dipinjam. Saat guru scan barang rusak atau yang
--   sedang dipinjam orang lain, ditawarkan barang sejenis yang tersedia.
-- - inv_set_status: admin menandai rusak / berfungsi kapan saja.
-- =============================================================================

alter table public.inventory_items add column if not exists keterangan_rusak text;

alter table public.inventory_items drop constraint if exists inventory_items_kondisi_chk;
update public.inventory_items set kondisi = 'rusak' where kondisi in ('rusak_ringan', 'rusak_berat');
alter table public.inventory_items add constraint inventory_items_kondisi_chk check (kondisi in ('baik', 'rusak'));

alter table public.inventory_loans drop constraint if exists inventory_loans_kondisi_chk;
update public.inventory_loans set kondisi_kembali = 'rusak' where kondisi_kembali in ('rusak_ringan', 'rusak_berat');
alter table public.inventory_loans add constraint inventory_loans_kondisi_chk check (kondisi_kembali is null or kondisi_kembali in ('baik', 'rusak'));

-- Tanda tangan lama diganti (argumen kondisi guru dihapus).
drop function if exists public.inv_return(text, text, text);
drop function if exists public.inv_admin_return(uuid, text, text);
drop function if exists public.inv__return(uuid, uuid, text, text);

create or replace function public.inv__item_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', i.id, 'kode', i.kode, 'nama', i.nama, 'kategori', i.kategori, 'merk', i.merk,
        'nomor_seri', i.nomor_seri, 'lokasi', i.lokasi, 'kondisi', i.kondisi, 'keterangan_rusak', i.keterangan_rusak,
        'jenis_pinjam', i.jenis_pinjam, 'tahun_perolehan', i.tahun_perolehan, 'catatan', i.catatan, 'aktif', i.aktif,
        'qr_token', i.qr_token, 'updated_at', i.updated_at,
        'pinjaman', (
            select jsonb_build_object(
                'id', l.id, 'staff_id', l.staff_id, 'peminjam', s.name,
                'sejak', l.borrowed_at, 'sampai', l.due_date, 'keperluan', l.keperluan,
                'terlambat', l.due_date is not null and l.due_date < public.jakarta_today())
            from public.inventory_loans l
            join public.staff s on s.id = l.staff_id
            where l.item_id = i.id and l.returned_at is null))
    from public.inventory_items i
    where i.id = p_id;
$$;

create or replace function public.inv__lend(p_item uuid, p_staff uuid, p_keperluan text, p_sampai date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_item   public.inventory_items%rowtype;
    v_today  date := public.jakarta_today();
    v_due    date;
    v_holder text;
begin
    select * into v_item from public.inventory_items where id = p_item for update;
    if not found or not v_item.aktif then
        raise exception 'Barang tidak ditemukan.' using errcode = 'P0002';
    end if;
    if v_item.jenis_pinjam = 'tidak_dipinjam' then
        raise exception '% tidak untuk dipinjam.', v_item.nama using errcode = '22023';
    end if;
    if v_item.kondisi = 'rusak' then
        raise exception '% sedang rusak, tidak bisa dipinjam.%', v_item.nama,
            coalesce(' Keterangan: ' || v_item.keterangan_rusak, '') using errcode = '22023';
    end if;
    select s.name into v_holder
    from public.inventory_loans l join public.staff s on s.id = l.staff_id
    where l.item_id = p_item and l.returned_at is null;
    if found then
        raise exception '% sedang dipinjam oleh %.', v_item.nama, v_holder using errcode = '23505';
    end if;
    if p_staff is null or not exists (select 1 from public.staff where id = p_staff) then
        raise exception 'Peminjam tidak dikenal.' using errcode = '22023';
    end if;

    v_due := case when v_item.jenis_pinjam = 'harian' then coalesce(p_sampai, v_today) else p_sampai end;
    if v_due is not null and v_due < v_today then
        raise exception 'Tanggal kembali tidak boleh sebelum hari ini.' using errcode = '22023';
    end if;
    if v_item.jenis_pinjam = 'harian' and v_due > v_today + 30 then
        raise exception 'Pinjaman harian paling lama 30 hari. Untuk lebih lama, ubah barang menjadi pinjaman jangka panjang.' using errcode = '22023';
    end if;
    if v_due is not null and v_due > v_today + 400 then
        raise exception 'Tanggal kembali terlalu jauh.' using errcode = '22023';
    end if;

    insert into public.inventory_loans (item_id, staff_id, due_date, keperluan, created_by)
    values (p_item, p_staff, v_due, nullif(left(btrim(coalesce(p_keperluan, '')), 200), ''), (select auth.uid()));
    return public.inv__item_json(p_item);
end;
$$;

/** Normalisasi status: berfungsi/baik → 'baik'; rusak (apa pun tingkatnya) → 'rusak'; selain itu null. */
create or replace function public.inv__status(p text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when lower(btrim(coalesce(p, ''))) in ('', 'baik', 'berfungsi', 'normal', 'ok', 'bagus') then 'baik'
        when lower(replace(btrim(p), ' ', '_')) in ('rusak', 'rusak_ringan', 'rusak_berat', 'tidak_berfungsi', 'mati') then 'rusak'
    end;
$$;

/**
 * Tutup pinjaman terbuka.
 * p_staff null = admin (boleh menutup milik siapa pun) dan boleh sekalian
 * menentukan status barang (p_set_kondisi). Guru hanya menitip catatan.
 */
create or replace function public.inv__return(p_item uuid, p_staff uuid, p_catatan text, p_set_kondisi text, p_ket_rusak text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_loan  public.inventory_loans%rowtype;
    v_kond  text;
begin
    select * into v_loan from public.inventory_loans where item_id = p_item and returned_at is null for update;
    if not found then
        raise exception 'Barang ini tidak sedang dipinjam.' using errcode = 'P0002';
    end if;
    if p_staff is not null and v_loan.staff_id is distinct from p_staff then
        raise exception 'Barang ini dipinjam orang lain. Hanya peminjam atau admin yang bisa mengembalikan.' using errcode = '42501';
    end if;
    if p_set_kondisi is not null then
        v_kond := public.inv__status(p_set_kondisi);
        if v_kond is null then
            raise exception 'Status barang harus Berfungsi atau Rusak.' using errcode = '22023';
        end if;
        update public.inventory_items
        set kondisi = v_kond,
            keterangan_rusak = case when v_kond = 'rusak' then nullif(left(btrim(coalesce(p_ket_rusak, '')), 300), '') end,
            updated_at = now()
        where id = p_item;
    end if;
    update public.inventory_loans
    set returned_at = now(), returned_by = (select auth.uid()), kondisi_kembali = v_kond,
        catatan_kembali = nullif(left(btrim(coalesce(p_catatan, '')), 300), '')
    where id = v_loan.id;
    return public.inv__item_json(p_item);
end;
$$;
revoke all on function public.inv__status(text) from public, anon, authenticated;
revoke all on function public.inv__return(uuid, uuid, text, text, text) from public, anon, authenticated;

/** Barang sejenis (kategori sama) yang bisa dipinjam sekarang — ditawarkan saat barang yang di-scan tidak bisa dipakai. */
create or replace function public.inv__alternatives(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object('kode', a.kode, 'nama', a.nama, 'lokasi', a.lokasi) order by a.kode), '[]'::jsonb)
    from (
        select o.kode, o.nama, o.lokasi
        from public.inventory_items i
        join public.inventory_items o
          on o.id <> i.id and o.aktif and o.kondisi = 'baik' and o.jenis_pinjam <> 'tidak_dipinjam'
         and coalesce(lower(o.kategori), '') = coalesce(lower(i.kategori), '') and i.kategori is not null
        where i.id = p_id
          and not exists (select 1 from public.inventory_loans l where l.item_id = o.id and l.returned_at is null)
        order by o.kode
        limit 5) a;
$$;
revoke all on function public.inv__alternatives(uuid) from public, anon, authenticated;

create or replace function public.inv_scan(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_id   uuid;
    v_me   uuid := public.current_staff_id();
    v_j    jsonb;
    v_mine boolean;
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or v_me is not null) then
        raise exception 'Masuk dengan akun Portal Guru dulu.' using errcode = '42501';
    end if;
    v_id := public.inv__find(p_code);
    if v_id is null or not (select aktif from public.inventory_items where id = v_id) then
        raise exception 'Barang dengan kode itu tidak ditemukan.' using errcode = 'P0002';
    end if;
    v_j := public.inv__item_json(v_id);
    -- Guru tidak perlu tahu nomor seri / catatan internal; cukup identitas & status.
    if not public.att_is_admin() then
        v_j := v_j - 'nomor_seri' - 'catatan';
    end if;
    v_mine := coalesce((v_j -> 'pinjaman' ->> 'staff_id')::uuid = v_me, false);
    return v_j || jsonb_build_object(
        'milik_saya', v_mine,
        'alternatif', case
            when not v_mine and (v_j ->> 'kondisi' = 'rusak' or jsonb_typeof(v_j -> 'pinjaman') = 'object')
            then public.inv__alternatives(v_id) else '[]'::jsonb end);
end;
$$;

create or replace function public.inv_return(p_code text, p_catatan text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_me uuid := public.current_staff_id();
    v_id uuid;
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or v_me is not null) then
        raise exception 'Masuk dengan akun Portal Guru dulu.' using errcode = '42501';
    end if;
    v_id := public.inv__find(p_code);
    if v_id is null then
        raise exception 'Barang dengan kode itu tidak ditemukan.' using errcode = 'P0002';
    end if;
    return public.inv__return(v_id, case when public.att_is_admin() then null else v_me end, p_catatan, null, null);
end;
$$;

create or replace function public.inv_admin_return(p_item uuid, p_kondisi text default null, p_catatan text default null, p_keterangan_rusak text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    perform public.inv__require_admin();
    return public.inv__return(p_item, null, p_catatan, p_kondisi, p_keterangan_rusak);
end;
$$;

/** Admin menandai barang Berfungsi / Rusak (+ keterangan kerusakan). */
create or replace function public.inv_set_status(p_item uuid, p_kondisi text, p_keterangan text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_kond text := public.inv__status(p_kondisi);
begin
    perform public.inv__require_admin();
    if v_kond is null or nullif(btrim(coalesce(p_kondisi, '')), '') is null then
        raise exception 'Status barang harus Berfungsi atau Rusak.' using errcode = '22023';
    end if;
    update public.inventory_items
    set kondisi = v_kond,
        keterangan_rusak = case when v_kond = 'rusak' then nullif(left(btrim(coalesce(p_keterangan, '')), 300), '') end,
        updated_at = now()
    where id = p_item;
    if not found then raise exception 'Barang tidak ditemukan.' using errcode = 'P0002'; end if;
    return public.inv__item_json(p_item);
end;
$$;

create or replace function public.inv__clean(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_nama   text := nullif(btrim(coalesce(p ->> 'nama', '')), '');
    v_kode   text := nullif(upper(btrim(coalesce(p ->> 'kode', ''))), '');
    v_kond   text := public.inv__status(p ->> 'kondisi');
    v_jenis  text := lower(replace(btrim(coalesce(p ->> 'jenis_pinjam', '')), ' ', '_'));
    v_tahun  text := nullif(btrim(coalesce(p ->> 'tahun_perolehan', '')), '');
begin
    if v_nama is null then raise exception 'Nama barang wajib diisi.' using errcode = '22023'; end if;
    if length(v_nama) > 120 then raise exception 'Nama barang terlalu panjang (maks. 120 huruf).' using errcode = '22023'; end if;
    if v_kode is not null and (length(v_kode) > 30 or v_kode !~ '^[A-Z0-9][A-Z0-9./-]*$') then
        raise exception 'Kode "%" tidak valid. Pakai huruf, angka, titik, garis miring, atau strip.', v_kode using errcode = '22023';
    end if;
    if v_kond is null then raise exception 'Status harus Berfungsi atau Rusak.' using errcode = '22023'; end if;
    v_jenis := case when v_jenis in ('', 'harian', 'sekali_pakai') then 'harian'
                    when v_jenis in ('jangka_panjang', 'panjang') then 'jangka_panjang'
                    when v_jenis in ('tidak_dipinjam', 'tidak', 'tidak_dipinjamkan') then 'tidak_dipinjam' else null end;
    if v_jenis is null then raise exception 'Jenis pinjam harus Harian, Jangka panjang, atau Tidak dipinjam.' using errcode = '22023'; end if;
    if v_tahun is not null and (v_tahun !~ '^[0-9]{4}$' or v_tahun::int not between 1980 and 2100) then
        raise exception 'Tahun perolehan "%" tidak valid.', v_tahun using errcode = '22023';
    end if;
    return jsonb_build_object(
        'kode', v_kode, 'nama', v_nama,
        'kategori', nullif(left(btrim(coalesce(p ->> 'kategori', '')), 60), ''),
        'merk', nullif(left(btrim(coalesce(p ->> 'merk', '')), 80), ''),
        'nomor_seri', nullif(left(btrim(coalesce(p ->> 'nomor_seri', '')), 80), ''),
        'lokasi', nullif(left(btrim(coalesce(p ->> 'lokasi', '')), 80), ''),
        'kondisi', v_kond,
        'keterangan_rusak', case when v_kond = 'rusak' then nullif(left(btrim(coalesce(p ->> 'keterangan_rusak', '')), 300), '') end,
        'jenis_pinjam', v_jenis, 'tahun_perolehan', v_tahun::int,
        'catatan', nullif(left(btrim(coalesce(p ->> 'catatan', '')), 300), ''));
end;
$$;
revoke all on function public.inv__clean(jsonb) from public, anon, authenticated;

create or replace function public.inv_save_item(p_item jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    c     jsonb;
    v_id  uuid := nullif(p_item ->> 'id', '')::uuid;
    v_kode text;
begin
    perform public.inv__require_admin();
    c := public.inv__clean(p_item);
    v_kode := c ->> 'kode';
    if v_kode is not null and exists (select 1 from public.inventory_items where upper(kode) = v_kode and id is distinct from v_id) then
        raise exception 'Kode % sudah dipakai barang lain.', v_kode using errcode = '23505';
    end if;
    if v_id is null then
        insert into public.inventory_items (kode, nama, kategori, merk, nomor_seri, lokasi, kondisi, keterangan_rusak, jenis_pinjam, tahun_perolehan, catatan)
        values (coalesce(v_kode, public.inv__next_kode(c ->> 'kategori')), c ->> 'nama', c ->> 'kategori', c ->> 'merk', c ->> 'nomor_seri',
                c ->> 'lokasi', c ->> 'kondisi', c ->> 'keterangan_rusak', c ->> 'jenis_pinjam', (c ->> 'tahun_perolehan')::int, c ->> 'catatan')
        returning id into v_id;
    else
        update public.inventory_items
        set kode = coalesce(v_kode, kode), nama = c ->> 'nama', kategori = c ->> 'kategori', merk = c ->> 'merk',
            nomor_seri = c ->> 'nomor_seri', lokasi = c ->> 'lokasi', kondisi = c ->> 'kondisi', keterangan_rusak = c ->> 'keterangan_rusak',
            jenis_pinjam = c ->> 'jenis_pinjam', tahun_perolehan = (c ->> 'tahun_perolehan')::int, catatan = c ->> 'catatan',
            aktif = coalesce((p_item ->> 'aktif')::boolean, aktif), updated_at = now()
        where id = v_id;
        if not found then raise exception 'Barang tidak ditemukan.' using errcode = 'P0002'; end if;
    end if;
    return public.inv__item_json(v_id);
end;
$$;

create or replace function public.inv_import_items(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    r       jsonb;
    c       jsonb;
    v_no    int := 0;
    v_n     int;
    v_k     int;
    v_kode  text;
    v_id    uuid;
    v_add   int := 0;
    v_upd   int := 0;
    v_ids   uuid[] := array[]::uuid[];
begin
    perform public.inv__require_admin();
    if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
        raise exception 'Tidak ada baris untuk diimpor.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_rows) > 1000 then
        raise exception 'Maksimal 1000 baris sekali impor.' using errcode = '22023';
    end if;
    for r in select * from jsonb_array_elements(p_rows) loop
        v_no := v_no + 1;
        begin
            c := public.inv__clean(r);
            v_n := coalesce(nullif(btrim(coalesce(r ->> 'jumlah', '')), '')::int, 1);
        exception when others then
            raise exception 'Baris %: %', v_no, sqlerrm using errcode = '22023';
        end;
        if v_n < 1 or v_n > 200 then
            raise exception 'Baris %: jumlah harus 1–200.', v_no using errcode = '22023';
        end if;
        for v_k in 1 .. v_n loop
            v_kode := case when c ->> 'kode' is null then null
                           when v_n = 1 then c ->> 'kode'
                           else (c ->> 'kode') || '-' || lpad(v_k::text, 2, '0') end;
            v_id := null;
            if v_kode is not null then
                select id into v_id from public.inventory_items where upper(kode) = v_kode;
            end if;
            if v_id is not null then
                if v_id = any (v_ids) then
                    raise exception 'Baris %: kode % muncul dua kali di file.', v_no, v_kode using errcode = '22023';
                end if;
                update public.inventory_items
                set nama = c ->> 'nama', kategori = c ->> 'kategori', merk = c ->> 'merk', nomor_seri = c ->> 'nomor_seri',
                    lokasi = c ->> 'lokasi', kondisi = c ->> 'kondisi', keterangan_rusak = c ->> 'keterangan_rusak',
                    jenis_pinjam = c ->> 'jenis_pinjam', tahun_perolehan = (c ->> 'tahun_perolehan')::int, catatan = c ->> 'catatan',
                    aktif = true, updated_at = now()
                where id = v_id;
                v_upd := v_upd + 1;
            else
                insert into public.inventory_items (kode, nama, kategori, merk, nomor_seri, lokasi, kondisi, keterangan_rusak, jenis_pinjam, tahun_perolehan, catatan)
                values (coalesce(v_kode, public.inv__next_kode(c ->> 'kategori')), c ->> 'nama', c ->> 'kategori', c ->> 'merk',
                        case when v_n = 1 then c ->> 'nomor_seri' end, c ->> 'lokasi', c ->> 'kondisi', c ->> 'keterangan_rusak',
                        c ->> 'jenis_pinjam', (c ->> 'tahun_perolehan')::int, c ->> 'catatan')
                returning id into v_id;
                v_add := v_add + 1;
            end if;
            v_ids := v_ids || v_id;
        end loop;
    end loop;
    return jsonb_build_object('ditambah', v_add, 'diperbarui', v_upd);
end;
$$;

revoke all on function public.inv_return(text, text) from public, anon;
revoke all on function public.inv_admin_return(uuid, text, text, text) from public, anon;
revoke all on function public.inv_set_status(uuid, text, text) from public, anon;
grant execute on function public.inv_return(text, text), public.inv_admin_return(uuid, text, text, text),
    public.inv_set_status(uuid, text, text) to authenticated, service_role;
