import { supabase } from "../supabase/config";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase system_settings read/write helpers.
//
// The `system_settings` table is RLS-protected: any authenticated user can
// SELECT (so the app can check the active provider), but only admins can
// UPDATE. The admin panel uses writeSystemSetting() which relies on the RLS
// admin policy (row filtered by the users.role == 'admin' check).
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_TABLE = "system_settings";

// Read a single setting value by key. Returns null on missing/error so callers
// fall back to their default.
export async function getSystemSetting(key) {
  try {
    const { data, error } = await supabase
      .from(SETTINGS_TABLE)
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
  } catch {
    return null;
  }
}

// Read all settings into a plain object { key: value }.
export async function getAllSystemSettings() {
  try {
    const { data, error } = await supabase.from(SETTINGS_TABLE).select("key, value");
    if (error) throw error;
    const out = {};
    (data || []).forEach((row) => { out[row.key] = row.value; });
    return out;
  } catch {
    return {};
  }
}

// Write/update a setting. Only succeeds for admins (RLS policy). On failure we
// still return the result so the caller can surface an error to the admin.
export async function writeSystemSetting(key, value, { description = null } = {}) {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert({ key, value, description, updated_at: new Date().toISOString() })
    .select();
  if (error) {
    throw new Error(error.message || "Failed to write system setting");
  }
  return data;
}

// Convenience: get/set the active media storage provider.
export async function getActiveStorageProviderFromDb() {
  return (await getSystemSetting("active_storage_provider")) || "supabase";
}

export async function setActiveStorageProviderDb(provider) {
  const normalized = provider === "cloudinary" ? "cloudinary" : "supabase";
  await writeSystemSetting("active_storage_provider", normalized, {
    description: "Active media storage provider: supabase or cloudinary",
  });
  return normalized;
}

// Delete a setting (admin only).
export async function deleteSystemSetting(key) {
  const { error } = await supabase.from(SETTINGS_TABLE).delete().eq("key", key);
  if (error) throw new Error(error.message || "Failed to delete system setting");
}
