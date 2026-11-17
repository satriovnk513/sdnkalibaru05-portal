-- =============================================================================
-- Inventaris sekolah + peminjaman lewat QR.
--
-- - inventory_items : satu baris = satu barang fisik (satu stiker QR).
-- - inventory_loans : riwayat pinjam. Satu barang hanya boleh punya satu
--   pinjaman terbuka (returned_at kosong) — dijaga unique index parsial.
-- - Guru/staf yang punya akun Portal Guru meminjam & mengembalikan sendiri
--   (scan QR → inv_scan → inv_borrow / inv_return). Tanpa persetujuan.
-- - Admin mengelola barang, impor dari Excel, mencatat pinjam/kembali atas nama
--   staf, dan melihat semua riwayat. Kepala sekolah boleh melihat.
-- - Semua tulis lewat RPC SECURITY DEFINER; tabel hanya bisa dibaca via RLS.
-- =============================================================================

create table if not exists public.inventory_items (
    id               uuid primary key default gen_random_uuid(),
    kode             text not null,
    nama             text not null,
    kategori         text,
    merk             text,
    nomor_seri       text,
    lokasi           text,
    kondisi          text not null default 'baik',
    jenis_pinjam     text not null default 'harian',
    tahun_perolehan  int,
    catatan          text,
    aktif            boolean not null default true,
    qr_token         text not null default substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint inventory_items_kondisi_chk check (kondisi in ('baik', 'rusak_ringan', 'rusak_berat')),
    constraint inventory_items_jenis_chk check (jenis_pinjam in ('harian', 'jangka_panjang', 'tidak_dipinjam')),
    constraint inventory_items_tahun_chk check (tahun_perolehan is null or tahun_perolehan between 1980 and 2100)
);
create unique index if not exists inventory_items_kode_key on public.inventory_items (upper(kode));
create unique index if not exists inventory_items_qr_key on public.inventory_items (qr_token);

create table if not exists public.inventory_loans (
    id               uuid primary key default gen_random_uuid(),
    item_id          uuid not null references public.inventory_items (id) on delete cascade,
    staff_id         uuid not null references public.staff (id) on delete restrict,
    borrowed_at      timestamptz not null default now(),
    due_date         date,
    keperluan        text,
    returned_at      timestamptz,
    kondisi_kembali  text,
    catatan_kembali  text,
    created_by       uuid default auth.uid(),
    returned_by      uuid,
    constraint inventory_loans_kondisi_chk check (kondisi_kembali is null or kondisi_kembali in ('baik', 'rusak_ringan', 'rusak_berat'))
);
create unique index if not exists inventory_loans_open_key on public.inventory_loans (item_id) where returned_at is null;
create index if not exists inventory_loans_staff_idx on public.inventory_loans (staff_id, borrowed_at desc);
create index if not exists inventory_loans_borrowed_idx on public.inventory_loans (borrowed_at desc);

alter table public.inventory_items enable row level security;
alter table public.inventory_items force row level security;
alter table public.inventory_loans enable row level security;
alter table public.inventory_loans force row level security;
revoke all on table public.inventory_items, public.inventory_loans from public, anon, authenticated;
grant select on table public.inventory_items, public.inventory_loans to authenticated;
grant all on table public.inventory_items, public.inventory_loans to service_role;

drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items
    for select to authenticated
    using ((select public.att_is_admin()) or (select public.current_staff_id()) is not null);

drop policy if exists inventory_loans_select on public.inventory_loans;
create policy inventory_loans_select on public.inventory_loans
    for select to authenticated
    using ((select public.att_is_admin()) or (select public.is_pimpinan()) or staff_id = (select public.current_staff_id()));

-- -----------------------------------------------------------------------------
-- Internal: bentuk JSON barang & pinjaman terbuka
-- -----------------------------------------------------------------------------
create or replace function public.inv__item_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', i.id, 'kode', i.kode, 'nama', i.nama, 'kategori', i.kategori, 'merk', i.merk,
        'nomor_seri', i.nomor_seri, 'lokasi', i.lokasi, 'kondisi', i.kondisi, 'jenis_pinjam', i.jenis_pinjam,
        'tahun_perolehan', i.tahun_perolehan, 'catatan', i.catatan, 'aktif', i.aktif, 'qr_token', i.qr_token,
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

create or replace function public.inv__find(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select i.id from public.inventory_items i
    where i.qr_token = btrim(coalesce(p_code, '')) or upper(i.kode) = upper(btrim(coalesce(p_code, '')))
    order by (i.qr_token = btrim(coalesce(p_code, ''))) desc
    limit 1;
$$;

/** Catat pinjam. Dipanggil oleh inv_borrow (guru) dan inv_admin_lend (admin). */
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
    if v_item.kondisi = 'rusak_berat' then
        raise exception '% sedang rusak berat, tidak bisa dipinjam.', v_item.nama using errcode = '22023';
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

/** Tutup pinjaman terbuka. p_staff null = admin (boleh menutup milik siapa pun). */
create or replace function public.inv__return(p_item uuid, p_staff uuid, p_kondisi text, p_catatan text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_loan    public.inventory_loans%rowtype;
    v_kondisi text := coalesce(nullif(btrim(coalesce(p_kondisi, '')), ''), 'baik');
begin
    if v_kondisi not in ('baik', 'rusak_ringan', 'rusak_berat') then
        raise exception 'Kondisi barang tidak valid.' using errcode = '22023';
    end if;
    select * into v_loan from public.inventory_loans where item_id = p_item and returned_at is null for update;
    if not found then
        raise exception 'Barang ini tidak sedang dipinjam.' using errcode = 'P0002';
    end if;
    if p_staff is not null and v_loan.staff_id is distinct from p_staff then
        raise exception 'Barang ini dipinjam orang lain. Hanya peminjam atau admin yang bisa mengembalikan.' using errcode = '42501';
    end if;
    update public.inventory_loans
    set returned_at = now(), returned_by = (select auth.uid()), kondisi_kembali = v_kondisi,
        catatan_kembali = nullif(left(btrim(coalesce(p_catatan, '')), 300), '')
    where id = v_loan.id;
    update public.inventory_items set kondisi = v_kondisi, updated_at = now()
    where id = p_item and kondisi is distinct from v_kondisi;
    return public.inv__item_json(p_item);
end;
$$;

revoke all on function public.inv__item_json(uuid) from public, anon, authenticated;
revoke all on function public.inv__find(text) from public, anon, authenticated;
revoke all on function public.inv__lend(uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.inv__return(uuid, uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Guru / staf
-- -----------------------------------------------------------------------------
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
    return v_j || jsonb_build_object('milik_saya', coalesce((v_j -> 'pinjaman' ->> 'staff_id')::uuid = v_me, false));
end;
$$;

create or replace function public.inv_borrow(p_code text, p_keperluan text default null, p_sampai date default null)
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
    if (select auth.uid()) is null or v_me is null then
        raise exception 'Hanya guru/staf dengan akun Portal Guru yang bisa meminjam.' using errcode = '42501';
    end if;
    v_id := public.inv__find(p_code);
    if v_id is null then
        raise exception 'Barang dengan kode itu tidak ditemukan.' using errcode = 'P0002';
    end if;
    return public.inv__lend(v_id, v_me, p_keperluan, p_sampai);
end;
$$;

create or replace function public.inv_return(p_code text, p_kondisi text default 'baik', p_catatan text default null)
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
    return public.inv__return(v_id, case when public.att_is_admin() then null else v_me end, p_kondisi, p_catatan);
end;
$$;

create or replace function public.inv_my_loans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_me uuid := public.current_staff_id();
begin
    if (select auth.uid()) is null or v_me is null then
        raise exception 'Masuk dengan akun Portal Guru dulu.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'aktif', coalesce((
            select jsonb_agg(jsonb_build_object(
                'kode', i.kode, 'nama', i.nama, 'kategori', i.kategori, 'qr_token', i.qr_token,
                'sejak', l.borrowed_at, 'sampai', l.due_date, 'keperluan', l.keperluan,
                'terlambat', l.due_date is not null and l.due_date < public.jakarta_today())
                order by l.borrowed_at)
            from public.inventory_loans l join public.inventory_items i on i.id = l.item_id
            where l.staff_id = v_me and l.returned_at is null), '[]'::jsonb),
        'riwayat', coalesce((
            select jsonb_agg(x order by x ->> 'kembali' desc)
            from (
                select jsonb_build_object('kode', i.kode, 'nama', i.nama, 'sejak', l.borrowed_at,
                                          'kembali', l.returned_at, 'kondisi', l.kondisi_kembali) as x
                from public.inventory_loans l join public.inventory_items i on i.id = l.item_id
                where l.staff_id = v_me and l.returned_at is not null
                order by l.returned_at desc
                limit 10) t), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin
-- -----------------------------------------------------------------------------
create or replace function public.inv__require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin yang bisa mengelola inventaris.' using errcode = '42501';
    end if;
end;
$$;
revoke all on function public.inv__require_admin() from public, anon, authenticated;

/** Kode otomatis dari kategori: Laptop → LAP-001, LAP-002, …; tanpa kategori → BRG-001. */
create or replace function public.inv__next_kode(p_kategori text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_prefix text := upper(left(regexp_replace(coalesce(p_kategori, ''), '[^A-Za-z]', '', 'g'), 3));
    v_n      int;
begin
    if length(v_prefix) < 2 then v_prefix := 'BRG'; end if;
    perform pg_advisory_xact_lock(hashtext('public.inventory_items.kode'), hashtext(v_prefix));
    select coalesce(max(substring(upper(kode) from '^' || v_prefix || '-([0-9]+)$')::int), 0) + 1 into v_n
    from public.inventory_items where upper(kode) ~ ('^' || v_prefix || '-[0-9]+$');
    return v_prefix || '-' || lpad(v_n::text, 3, '0');
end;
$$;
revoke all on function public.inv__next_kode(text) from public, anon, authenticated;

/** Validasi & normalisasi satu baris barang dari form / Excel. Mengembalikan baris bersih. */
create or replace function public.inv__clean(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_nama   text := nullif(btrim(coalesce(p ->> 'nama', '')), '');
    v_kode   text := nullif(upper(btrim(coalesce(p ->> 'kode', ''))), '');
    v_kond   text := lower(replace(btrim(coalesce(p ->> 'kondisi', '')), ' ', '_'));
    v_jenis  text := lower(replace(btrim(coalesce(p ->> 'jenis_pinjam', '')), ' ', '_'));
    v_tahun  text := nullif(btrim(coalesce(p ->> 'tahun_perolehan', '')), '');
begin
    if v_nama is null then raise exception 'Nama barang wajib diisi.' using errcode = '22023'; end if;
    if length(v_nama) > 120 then raise exception 'Nama barang terlalu panjang (maks. 120 huruf).' using errcode = '22023'; end if;
    if v_kode is not null and (length(v_kode) > 30 or v_kode !~ '^[A-Z0-9][A-Z0-9./-]*$') then
        raise exception 'Kode "%" tidak valid. Pakai huruf, angka, titik, garis miring, atau strip.', v_kode using errcode = '22023';
    end if;
    v_kond := case when v_kond in ('', 'baik') then 'baik'
                   when v_kond in ('rusak_ringan', 'rusak') then 'rusak_ringan'
                   when v_kond = 'rusak_berat' then 'rusak_berat' else null end;
    if v_kond is null then raise exception 'Kondisi harus Baik, Rusak ringan, atau Rusak berat.' using errcode = '22023'; end if;
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
        'kondisi', v_kond, 'jenis_pinjam', v_jenis, 'tahun_perolehan', v_tahun::int,
        'catatan', nullif(left(btrim(coalesce(p ->> 'catatan', '')), 300), ''));
end;
$$;

create or replace function public.inv_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.is_pimpinan()) then
        raise exception 'Hanya admin atau kepala sekolah yang bisa melihat inventaris.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'hari_ini', public.jakarta_today(),
        'items', coalesce((select jsonb_agg(public.inv__item_json(i.id) order by i.kategori nulls last, i.kode)
                           from public.inventory_items i), '[]'::jsonb));
end;
$$;

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
        insert into public.inventory_items (kode, nama, kategori, merk, nomor_seri, lokasi, kondisi, jenis_pinjam, tahun_perolehan, catatan)
        values (coalesce(v_kode, public.inv__next_kode(c ->> 'kategori')), c ->> 'nama', c ->> 'kategori', c ->> 'merk', c ->> 'nomor_seri',
                c ->> 'lokasi', c ->> 'kondisi', c ->> 'jenis_pinjam', (c ->> 'tahun_perolehan')::int, c ->> 'catatan')
        returning id into v_id;
    else
        update public.inventory_items
        set kode = coalesce(v_kode, kode), nama = c ->> 'nama', kategori = c ->> 'kategori', merk = c ->> 'merk',
            nomor_seri = c ->> 'nomor_seri', lokasi = c ->> 'lokasi', kondisi = c ->> 'kondisi', jenis_pinjam = c ->> 'jenis_pinjam',
            tahun_perolehan = (c ->> 'tahun_perolehan')::int, catatan = c ->> 'catatan',
            aktif = coalesce((p_item ->> 'aktif')::boolean, aktif), updated_at = now()
        where id = v_id;
        if not found then raise exception 'Barang tidak ditemukan.' using errcode = 'P0002'; end if;
    end if;
    return public.inv__item_json(v_id);
end;
$$;

/**
 * Impor banyak barang sekaligus (dari Excel). Semua atau tidak sama sekali.
 * Baris dengan kode yang sudah ada → diperbarui. "jumlah" > 1 → dibuat beberapa
 * barang (kode diberi akhiran -01, -02, … atau kode otomatis).
 */
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
                    lokasi = c ->> 'lokasi', kondisi = c ->> 'kondisi', jenis_pinjam = c ->> 'jenis_pinjam',
                    tahun_perolehan = (c ->> 'tahun_perolehan')::int, catatan = c ->> 'catatan', aktif = true, updated_at = now()
                where id = v_id;
                v_upd := v_upd + 1;
            else
                insert into public.inventory_items (kode, nama, kategori, merk, nomor_seri, lokasi, kondisi, jenis_pinjam, tahun_perolehan, catatan)
                values (coalesce(v_kode, public.inv__next_kode(c ->> 'kategori')), c ->> 'nama', c ->> 'kategori', c ->> 'merk',
                        case when v_n = 1 then c ->> 'nomor_seri' end, c ->> 'lokasi', c ->> 'kondisi', c ->> 'jenis_pinjam',
                        (c ->> 'tahun_perolehan')::int, c ->> 'catatan')
                returning id into v_id;
                v_add := v_add + 1;
            end if;
            v_ids := v_ids || v_id;
        end loop;
    end loop;
    return jsonb_build_object('ditambah', v_add, 'diperbarui', v_upd);
end;
$$;

/** Hapus barang. Kalau sudah punya riwayat pinjam → diarsipkan (aktif = false) supaya riwayat tetap ada. */
create or replace function public.inv_delete_item(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    perform public.inv__require_admin();
    if exists (select 1 from public.inventory_loans where item_id = p_id and returned_at is null) then
        raise exception 'Barang masih dipinjam. Tandai sudah kembali dulu.' using errcode = '22023';
    end if;
    if exists (select 1 from public.inventory_loans where item_id = p_id) then
        update public.inventory_items set aktif = false, updated_at = now() where id = p_id;
        return 'diarsipkan';
    end if;
    delete from public.inventory_items where id = p_id;
    if not found then raise exception 'Barang tidak ditemukan.' using errcode = 'P0002'; end if;
    return 'dihapus';
end;
$$;

create or replace function public.inv_admin_lend(p_item uuid, p_staff uuid, p_keperluan text default null, p_sampai date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    perform public.inv__require_admin();
    return public.inv__lend(p_item, p_staff, p_keperluan, p_sampai);
end;
$$;

create or replace function public.inv_admin_return(p_item uuid, p_kondisi text default 'baik', p_catatan text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    perform public.inv__require_admin();
    return public.inv__return(p_item, null, p_kondisi, p_catatan);
end;
$$;

create or replace function public.inv_loan_history(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not (public.att_is_admin() or public.is_pimpinan()) then
        raise exception 'Hanya admin atau kepala sekolah yang bisa melihat riwayat pinjam.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(x order by x ->> 'sejak' desc)
        from (
            select jsonb_build_object(
                'id', l.id, 'item_id', i.id, 'kode', i.kode, 'nama', i.nama, 'kategori', i.kategori,
                'peminjam', s.name, 'sejak', l.borrowed_at, 'sampai', l.due_date, 'keperluan', l.keperluan,
                'kembali', l.returned_at, 'kondisi', l.kondisi_kembali, 'catatan', l.catatan_kembali,
                'terlambat', l.returned_at is null and l.due_date is not null and l.due_date < public.jakarta_today()) as x
            from public.inventory_loans l
            join public.inventory_items i on i.id = l.item_id
            join public.staff s on s.id = l.staff_id
            where (p_from is null or (l.borrowed_at at time zone 'Asia/Jakarta')::date >= p_from)
              and (p_to is null or (l.borrowed_at at time zone 'Asia/Jakarta')::date <= p_to)
            order by l.borrowed_at desc
            limit 3000) t), '[]'::jsonb);
end;
$$;

revoke all on function public.inv__clean(jsonb) from public, anon, authenticated;
revoke all on function public.inv_scan(text) from public, anon;
revoke all on function public.inv_borrow(text, text, date) from public, anon;
revoke all on function public.inv_return(text, text, text) from public, anon;
revoke all on function public.inv_my_loans() from public, anon;
revoke all on function public.inv_admin_overview() from public, anon;
revoke all on function public.inv_save_item(jsonb) from public, anon;
revoke all on function public.inv_import_items(jsonb) from public, anon;
revoke all on function public.inv_delete_item(uuid) from public, anon;
revoke all on function public.inv_admin_lend(uuid, uuid, text, date) from public, anon;
revoke all on function public.inv_admin_return(uuid, text, text) from public, anon;
revoke all on function public.inv_loan_history(date, date) from public, anon;
grant execute on function public.inv_scan(text), public.inv_borrow(text, text, date), public.inv_return(text, text, text),
    public.inv_my_loans(), public.inv_admin_overview(), public.inv_save_item(jsonb), public.inv_import_items(jsonb),
    public.inv_delete_item(uuid), public.inv_admin_lend(uuid, uuid, text, date), public.inv_admin_return(uuid, text, text),
    public.inv_loan_history(date, date)
    to authenticated, service_role;
