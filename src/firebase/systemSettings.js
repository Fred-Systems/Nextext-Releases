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

// Local cache for the storage provider so it persists across panel re-opens.
// This prevents the "reverts to supabase" issue when the DB read is slow or
// blocked by RLS. The cache is written on every successful toggle and loaded
// on startup.
const STORAGE_PROVIDER_CACHE_KEY = "nextext_active_storage_provider";

function getCachedStorageProvider() {
  try {
    return localStorage.getItem(STORAGE_PROVIDER_CACHE_KEY) || null;
  } catch { return null; }
}

function setCachedStorageProvider(provider) {
  try {
    localStorage.setItem(STORAGE_PROVIDER_CACHE_KEY, provider);
  } catch {}
}

// Convenience: get the active media storage provider.
// Three-tier read for maximum reliability:
// 1. Local localStorage cache (instant, never reverts)
// 2. Firestore globalSettings (primary source, same doc the admin panel reads)
// 3. Supabase system_settings (legacy fallback)
export async function getActiveStorageProviderFromDb() {
  const cached = getCachedStorageProvider();
  if (cached) return cached;

  // Try Firestore globalSettings first (same doc the admin panel reads from)
  try {
    const { default: configSettings } = await import("./config-settings.js");
    const globalSettings = configSettings.getSnapshot?.() || {};
    if (globalSettings?.active_storage_provider) {
      setCachedStorageProvider(globalSettings.active_storage_provider);
      return globalSettings.active_storage_provider;
    }
  } catch {}

  // Fallback to Supabase system_settings
  const dbValue = (await getSystemSetting("active_storage_provider")) || "supabase";
  setCachedStorageProvider(dbValue);
  return dbValue;
}

// Set the active media storage provider via Supabase RPC v2.
// The database function `toggle_active_storage_provider_v2` is SECURITY DEFINER
// and requires a secret admin token ('NexText07') in addition to the admin role check.
export async function setActiveStorageProviderDb(provider) {
  const normalized = provider === "cloudinary" ? "cloudinary" : "supabase";
  const ADMIN_SECRET = "NexText07";

  // Primary path: Supabase RPC v2 with secret token validation.
  try {
    const { data, error } = await supabase.rpc("toggle_active_storage_provider_v2", {
      new_provider: normalized,
      admin_secret: ADMIN_SECRET,
    });
    if (error) throw error;
    // RPC returns the new value on success. Persist to local cache.
    setCachedStorageProvider(normalized);
    return data || normalized;
  } catch (rpcError) {
    console.warn("RPC v2 unavailable, trying Edge Function fallback:", rpcError);
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
      body: JSON.stringify({ provider: normalized, admin_secret: ADMIN_SECRET }),
    });

    const result = await response.json();
    if (response.ok) {
      setCachedStorageProvider(normalized);
      setCachedStorageProvider(normalized);
      return normalized;
    }
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
      `Ensure the toggle_active_storage_provider_v2 RPC exists ` +
      `(run sql/toggle_storage_rpc_v2.sql) and you have admin privileges.`
    );
  }
}

// Delete a setting (admin only).
export async function deleteSystemSetting(key) {
  const { error } = await supabase.from(SETTINGS_TABLE).delete().eq("key", key);
  if (error) throw new Error(error.message || "Failed to delete system setting");
}
