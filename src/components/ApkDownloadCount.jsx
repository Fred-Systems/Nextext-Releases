import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { useGlobalSettings } from "../firebase/config-settings";
import { getApkDownloadCount } from "../updater/updateChecker";

// "N+ downloads" line under the APK button on the login page. Reads the live
// GitHub per-asset download_count. Hides entirely when the admin turns on the
// `hideDownloadCount` global setting.
export default function ApkDownloadCount() {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const [count, setCount] = useState(null);

  useEffect(() => {
    let alive = true;
    getApkDownloadCount().then((n) => { if (alive) setCount(n); });
    return () => { alive = false; };
  }, []);

  if (globalSettings?.hideDownloadCount || typeof count !== "number" || count < 0) return null;

  const pretty = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);

  return (
    <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, color: t.textMuted }}>
      <Download size={13} />
      <span>
        <b style={{ color: t.text }}>{pretty}</b> downloads on Android — live from GitHub
      </span>
    </div>
  );
}
