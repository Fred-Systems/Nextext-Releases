import React, { useState } from "react";
import { Download } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { getLatestApkUrl, saveApkToDevice } from "../updater/updateChecker";

// Downloads the newest published APK to the device. Always fetches the LATEST
// release regardless of the installed version, and works before sign-in (the
// Auth screen) as well as anywhere in the app. Native: saves to the Downloads
// folder; web: opens the download URL in a browser.
export default function DownloadApkButton({ subtle = false }) {
  const { t } = useTheme();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const handle = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const url = await getLatestApkUrl();
      if (!url) throw new Error("Couldn't find the latest APK. Check your connection and try again.");
      setStatus("Downloading…");
      await saveApkToDevice(url);
      setStatus("APK saved to your Downloads folder.");
    } catch (e) {
      setError(e?.message || "Couldn't download the APK.");
    } finally {
      setBusy(false);
    }
  };

  if (subtle) {
    return (
      <div style={{ textAlign: "center", marginTop: 18 }}>
        <button onClick={handle} disabled={busy} style={{ background: "transparent", border: "none", color: t.primary, fontWeight: 700, fontSize: 13.5, cursor: busy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Download size={14} />
          {busy ? "Downloading…" : "Download latest APK"}
        </button>
        {(status || error) && (
          <div style={{ fontSize: 12, color: error ? "#FF3B30" : t.textMuted, marginTop: 4 }}>{error || status}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      <button onClick={handle} disabled={busy} style={{ width: "100%", padding: "11px 16px", border: "none", background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 14, cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: busy ? 0.6 : 1 }}>
        <Download size={15} />
        {busy ? "Downloading…" : "Download Latest APK"}
      </button>
      {(status || error) && (
        <div style={{ fontSize: 12.5, color: error ? "#FF3B30" : t.primary, fontWeight: 600, marginTop: 6, textAlign: "center" }}>{error || status}</div>
      )}
    </div>
  );
}
