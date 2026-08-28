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

// Set the active media storage provider via Supabase RPC.
// The database function `toggle_active_storage_provider` is SECURITY DEFINER
// (runs as the super-admin who created it), so it bypasses RLS and only allows
// the call when the authenticated user has role = 'admin' in the users table.
export async function setActiveStorageProviderDb(provider) {
  const normalized = provider === "cloudinary" ? "cloudinary" : "supabase";

  // Primary path: Supabase RPC (database function with SECURITY DEFINER).
  try {
    const { data, error } = await supabase.rpc("toggle_active_storage_provider", {
      new_provider: normalized,
    });
    if (error) throw error;
    // RPC returns the new value on success.
    return data || normalized;
  } catch (rpcError) {
    console.warn("RPC unavailable, trying Edge Function fallback:", rpcError);
  }

  // Fallback 1: Edge Function (service_role key bypasses RLS).
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
    if (response.ok) return normalized;
    throw new Error(result?.error || "Edge function rejected request");
  } catch (edgeError) {
    console.warn("Edge function unavailable, trying direct write:", edgeError);
  }

  // Fallback 2: direct client write (will fail if RLS blocks it).
  try {
    await writeSystemSetting("active_storage_provider", normalized, {
      description: "Active media storage provider: supabase or cloudinary",
    });
    return normalized;
  } catch (writeError) {
    throw new Error(
      `Failed to update storage provider: ${writeError.message}. ` +
      `Ensure the toggle_active_storage_provider RPC exists (run sql/toggle_storage_rpc.sql) ` +
      `and you have admin privileges.`
    );
  }
}

// Delete a setting (admin only).
export async function deleteSystemSetting(key) {
  const { error } = await supabase.from(SETTINGS_TABLE).delete().eq("key", key);
  if (error) throw new Error(error.message || "Failed to delete system setting");
}
