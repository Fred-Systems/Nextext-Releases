import React from "react";
import { Download, X, Sparkles, Save } from "lucide-react";

export default function UpdatePrompt({ update, onDownload, onDismiss, downloading, saving, onSaveToDevice, error, progress }) {
  if (!update) return null;

  const changelogLines = update.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return (
    <div
      onClick={onDismiss}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1a1a2e",
          width: "100%",
          maxWidth: 340,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "18px 18px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              background: "linear-gradient(135deg, #10B981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Sparkles size={18} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>
              Update Available
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              {update.name}
            </div>
          </div>
          <X
            size={20}
            color="rgba(255,255,255,0.4)"
            onClick={onDismiss}
            style={{ cursor: "pointer" }}
          />
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 18px",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            What's New
          </div>
          {changelogLines.map((line, i) => (
            <div
              key={i}
              style={{
                fontSize: 13.5,
                color: "rgba(255,255,255,0.8)",
                lineHeight: 1.6,
                marginBottom: 4,
              }}
            >
              {line}
            </div>
          ))}
          {saving && (
            <div style={{ fontSize: 12.5, color: "#4FC3E8", fontWeight: 600, marginTop: 10, textAlign: "center" }}>
              Saving APK to your Downloads folder…
            </div>
          )}
          {(downloading || saving) && progress && progress.total > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.round((progress.loaded / progress.total) * 100))}%`, background: "linear-gradient(135deg, #10B981, #059669)", transition: "width 0.2s" }} />
              </div>
              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.75)", fontWeight: 600, marginTop: 4, textAlign: "center" }}>
                {Math.min(100, Math.round((progress.loaded / progress.total) * 100))}% · {(progress.loaded / 1048576).toFixed(1)} / {(progress.total / 1048576).toFixed(1)} MB
              </div>
            </div>
          )}
          {(downloading || saving) && progress && !(progress.total > 0) && progress.loaded > 0 && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", fontWeight: 600, marginTop: 10, textAlign: "center" }}>
              {(progress.loaded / 1048576).toFixed(1)} MB received…
            </div>
          )}
          {error && (
            <div style={{ fontSize: 12.5, color: "#FFB74D", fontWeight: 600, marginTop: 10, textAlign: "center", lineHeight: 1.5 }}>
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "14px 18px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            onClick={downloading || saving ? undefined : onSaveToDevice}
            style={{
              padding: "11px 0",
              textAlign: "center",
              fontSize: 13.5,
              fontWeight: 600,
              color: "rgba(255,255,255,0.75)",
              cursor: downloading || saving ? "default" : "pointer",
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Save size={14} color="rgba(255,255,255,0.6)" />
            {saving ? "Saving…" : "Save APK to device"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div
              onClick={onDismiss}
              style={{
                flex: 1,
                padding: "12px 0",
                textAlign: "center",
                fontSize: 14,
                fontWeight: 600,
                color: "rgba(255,255,255,0.5)",
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Do It Later
            </div>
            <div
              onClick={downloading ? undefined : onDownload}
              style={{
                flex: 1.5,
                padding: "12px 0",
                textAlign: "center",
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                background: downloading ? "rgba(255,255,255,0.12)" : "linear-gradient(135deg, #10B981, #059669)",
                cursor: downloading ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Download size={15} color="#fff" />
              {downloading ? "Downloading…" : "Update Now"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
