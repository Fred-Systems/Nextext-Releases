-- RPC function to toggle the active storage provider.
-- SECURITY DEFINER: runs as the super-admin who created it, bypassing RLS.
-- Only callable by authenticated users whose role is 'admin' in the users table.
--
-- Deploy with: supabase db push  (or run this SQL in the Supabase SQL editor)

create or replace function toggle_active_storage_provider(new_provider text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  calling_user_role text;
begin
  -- Verify the caller has admin role
  select role into calling_user_role
  from public.users
  where uid = auth.uid();

  if calling_user_role is null or calling_user_role != 'admin' then
    raise exception 'Only admins can change the storage provider';
  end if;

  -- Validate the provider value
  if new_provider not in ('supabase', 'cloudinary') then
    raise exception 'Invalid provider: %', new_provider;
  end if;

  -- Upsert the setting
  insert into public.system_settings (key, value, description, updated_at, updated_by)
  values ('active_storage_provider', new_provider, 'Active media storage provider: supabase or cloudinary', now(), auth.uid())
  on conflict (key) do update
    set value = new_provider,
        updated_at = now(),
        updated_by = auth.uid();

  return new_provider;
end;
$$;

-- Allow authenticated users to invoke this function
grant execute on function toggle_active_storage_provider(text) to authenticated;

-- Optional: add a comment for documentation
comment on function toggle_active_storage_provider(text) is
  'Admin-only: switches the active media storage provider between supabase and cloudinary.';
