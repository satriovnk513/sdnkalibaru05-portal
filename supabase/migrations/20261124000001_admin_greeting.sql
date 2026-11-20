-- =============================================================================
-- Sapaan di Panel Admin ("Selamat Pagi, Paroji."): nama akun admin/operator yang
-- sedang login — nama staf bila akunnya tertaut ke data guru/staf, selain itu
-- bagian depan email. Hanya untuk admin.
-- =============================================================================
create or replace function public.get_admin_name()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is null or not public.att_is_admin() then
        raise exception 'Hanya admin/operator.' using errcode = '42501';
    end if;
    return public.admin__nama();
end;
$$;

revoke all on function public.get_admin_name() from public, anon;
grant execute on function public.get_admin_name() to authenticated, service_role;
