import { supabase } from "../supabase/config";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase system_settings read/write helpers.
//
// The `system_settings` table is RLS-protected: any authenticated user can
// SELECT (so the app can check the active provider), but only admins can
// UPDATE. The admin panel uses writeSystemSetting() which relies on the RLS
// admin policy (row filtered by the users.role == 'admin' check).
//
// IMPORTANT: The storage provider toggle uses a Supabase Edge Function
// (update-storage-provider) that bypasses RLS with the service_role key.
// Direct client writes to system_settings may fail due to RLS restrictions.
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_TABLE = "system_settings";
const SUPABASE_URL = "https://hkpfojusvnnifvwkjbol.supabase.co";

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

// Write/update a setting via direct Supabase client (RLS-protected).
// May fail if RLS blocks the write. Use the Edge Function for critical writes.
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

// Convenience: get the active media storage provider.
export async function getActiveStorageProviderFromDb() {
  return (await getSystemSetting("active_storage_provider")) || "supabase";
}

// Set the active media storage provider via Supabase Edge Function.
// This bypasses RLS using the service_role key server-side.
// Falls back to direct client write if the edge function is unavailable.
export async function setActiveStorageProviderDb(provider) {
  const normalized = provider === "cloudinary" ? "cloudinary" : "supabase";

  // Try the Edge Function first (secure, bypasses RLS)
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("No active session");

    const response = await fetch(`${SUPABASE_URL}/functions/v1/update-storage-provider`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": supabase.supabaseKey,
      },
      body: JSON.stringify({ provider: normalized }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Edge function error:", result);
      // Fall back to direct write (may fail due to RLS, but worth trying)
      console.warn("Falling back to direct write (may fail due to RLS)");
      await writeSystemSetting("active_storage_provider", normalized, {
        description: "Active media storage provider: supabase or cloudinary",
      });
      return normalized;
    }

    return normalized;
  } catch (edgeError) {
    console.warn("Edge function unavailable, falling back to direct write:", edgeError);
    // Fall back to direct client write
    try {
      await writeSystemSetting("active_storage_provider", normalized, {
        description: "Active media storage provider: supabase or cloudinary",
      });
      return normalized;
    } catch (writeError) {
      throw new Error(`Failed to update storage provider: ${writeError.message}. Ensure you have admin privileges.`);
    }
  }
}

// Delete a setting (admin only).
export async function deleteSystemSetting(key) {
  const { error } = await supabase.from(SETTINGS_TABLE).delete().eq("key", key);
  if (error) throw new Error(error.message || "Failed to delete system setting");
}
