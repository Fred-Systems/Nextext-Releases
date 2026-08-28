-- system_settings table for global app configuration
-- Run this in your Supabase SQL editor

create table if not exists system_settings (
    key text primary key,
    value text not null,
    description text,
    updated_at timestamp with time zone default now(),
    updated_by text
);

-- Enable RLS
alter table system_settings enable row level security;

-- Policy: Authenticated users can read all settings
create policy "Authenticated users can read system settings"
    on system_settings
    for select
    using (auth.role() = 'authenticated');

-- Policy: Only admins can insert/update/delete settings
-- Assumes you have an is_admin() function or check user role
create policy "Admins can manage system settings"
    on system_settings
    for all
    using (
        exists (
            select 1 from users
            where uid = auth.uid()
            and role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from users
            where uid = auth.uid()
            and role = 'admin'
        )
    );

-- Insert initial default setting for storage provider
insert into system_settings (key, value, description, updated_by)
values ('active_storage_provider', 'supabase', 'Active media storage provider: supabase or cloudinary', 'system')
on conflict (key) do nothing;

-- Insert other system settings with defaults
insert into system_settings (key, value, description, updated_by)
values
    ('media_auto_delete_enabled', 'false', 'Enable automatic media deletion after expiry', 'system'),
    ('media_expiry_days', '3', 'Days before media expires'),
    ('max_upload_size_mb', '50', 'Maximum upload size in MB'),
    ('enable_video_compression', 'true', 'Enable video compression on upload'),
    ('video_max_resolution', '720p', 'Maximum video resolution for uploads'),
    ('video_compression_quality', '70', 'Video compression quality (0-100)'),
    ('image_compression_quality', '70', 'Image compression quality (0-100)'),
    ('enable_thumbnail_generation', 'true', 'Generate thumbnails for videos'),
    ('thumbnail_format', 'jpg', 'Thumbnail format (jpg/webp)'),
    ('thumbnail_quality', '80', 'Thumbnail quality (0-100)'),
    ('cloudinary_cloud_name', 'lsfhbqod', 'Cloudinary cloud name'),
    ('cloudinary_upload_preset', 'app_unsigned_preset', 'Cloudinary unsigned upload preset'),
    ('enable_cloudinary_backup', 'false', 'Enable Cloudinary as backup storage')
on conflict (key) do nothing;

-- Function to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger update_system_settings_updated_at
    before update on system_settings
    for each row
    execute function update_updated_at_column();

-- Optional: Create a view for easy admin access
create or replace view system_settings_view as
select key, value, description, updated_at, updated_by
from system_settings
order by key;

grant select on system_settings_view to authenticated;
grant all on system_settings to service_role;