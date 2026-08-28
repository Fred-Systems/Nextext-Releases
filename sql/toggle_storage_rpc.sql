-- RPC function to toggle the active storage provider.
-- SECURITY DEFINER: runs as the super-admin who created it, bypassing RLS.
-- Only callable by authenticated users whose role is 'admin' in the users table,
-- AND who provide the correct admin secret token.
--
-- Deploy with: supabase db push  (or run this SQL in the Supabase SQL editor)

create or replace function toggle_active_storage_provider_v2(
  new_provider text,
  admin_secret text default ''
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  calling_user_role text;
begin
  -- 1. Verify the secret token matches
  if admin_secret != 'NexText07' then
    raise exception 'Invalid admin secret';
  end if;

  -- 2. Verify the caller has admin role
  select role into calling_user_role
  from public.users
  where uid = auth.uid();

  if calling_user_role is null or calling_user_role != 'admin' then
    raise exception 'Only admins can change the storage provider';
  end if;

  -- 3. Validate the provider value
  if new_provider not in ('supabase', 'cloudinary') then
    raise exception 'Invalid provider: %', new_provider;
  end if;

  -- 4. Upsert the setting
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
grant execute on function toggle_active_storage_provider_v2(text, text) to authenticated;

-- Documentation
comment on function toggle_active_storage_provider_v2(text, text) is
  'Admin-only: switches the active media storage provider between supabase and cloudinary. Requires secret token.';
