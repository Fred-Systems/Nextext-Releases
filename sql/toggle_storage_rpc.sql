-- RPC function to toggle the active storage provider.
-- SECURITY DEFINER: runs as the super-admin who created it, bypassing RLS.
-- Only callable by authenticated users whose role is 'admin' in the users table,
-- AND who provide the correct admin secret token.
--
-- Also adds the status_preview_mode setting ('video_loop' or 'static_picture').
-- Deploy with: supabase db push  (or run this SQL in the Supabase SQL editor)

-- RPC function to toggle the active storage provider.

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

-- RPC function to set the status preview mode.
-- 'video_loop' = show animated preview clips (default)
-- 'static_picture' = show only poster JPEGs (saves maximum data)
create or replace function set_status_preview_mode(mode text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  calling_user_role text;
begin
  select role into calling_user_role
  from public.users
  where uid = auth.uid();

  if calling_user_role is null or calling_user_role != 'admin' then
    raise exception 'Only admins can change the status preview mode';
  end if;

  if mode not in ('video_loop', 'static_picture') then
    raise exception 'Invalid mode: %', mode;
  end if;

  insert into public.system_settings (key, value, description, updated_at, updated_by)
  values ('status_preview_mode', mode, 'Status feed preview mode: video_loop or static_picture', now(), auth.uid())
  on conflict (key) do update
    set value = mode,
        updated_at = now(),
        updated_by = auth.uid();

  return mode;
end;
$$;

grant execute on function set_status_preview_mode(text) to authenticated;

comment on function set_status_preview_mode(text) is
  'Admin-only: controls whether status feed shows video loops or static pictures.';
comment on function toggle_active_storage_provider_v2(text, text) is
  'Admin-only: switches the active media storage provider between supabase and cloudinary. Requires secret token.';
