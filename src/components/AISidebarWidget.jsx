import React from "react";
import { useSystemConfigHook } from "../firebase/ai";
import { useAIIconStyle, aiAvatarInner } from "../services/aiIcon";

export default function AISidebarWidget({ userDoc, onOpenAI, right = 16, bottom }) {
  const sysConfig = useSystemConfigHook();
  const aiStyle = useAIIconStyle();

  const aiApproved = userDoc?.aiApproved && !sysConfig?.aiGloballyDisabled && !sysConfig?.hideAiEverywhere && userDoc?.restrictions?.blockAI !== true;
  if (!aiApproved) return null;

  const inner = aiAvatarInner(aiStyle, 30, 13);

  const posStyle = bottom != null
    ? { bottom, right, transform: "none" }
    : { top: "50%", right, transform: "translateY(-50%)" };

  return (
    <div
      onClick={() => onOpenAI()}
      style={{
        position: "absolute",
        ...posStyle,
        width: 50,
        height: 50,
        borderRadius: "50%",
        background: "linear-gradient(135deg, rgba(124,92,255,0.30), rgba(83,189,235,0.30))",
        border: "1px solid rgba(255,255,255,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 16px rgba(124,92,255,0.20)",
        cursor: "pointer",
        zIndex: 30,
        transition: "transform 0.2s, background 0.2s",
      }}
    >
      <div style={inner.style}>{inner.label}</div>
    </div>
  );
}
