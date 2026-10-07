"use client"

import { MessageCircle } from "lucide-react"

// isenssign has no in-app AI. The FAB asks the MyCrew host (parent window) to
// open its shared chat panel via postMessage. "mycrew-isenssign" is whitelisted
// by the host's AppHostFrame message router.
export default function SignFab() {
  const openChat = () => {
    window.parent?.postMessage(
      { source: "mycrew-isenssign", type: "chat.open", payload: { context: {} } },
      "*",
    )
  }

  return (
    <button
      type="button"
      aria-label="MyCrew"
      onClick={openChat}
      style={{
        position: "fixed",
        right: 24,
        bottom: 96,
        width: 56,
        height: 56,
        borderRadius: "999px",
        background: "var(--primary)",
        color: "#fff",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        cursor: "pointer",
        zIndex: 1000,
      }}
    >
      <MessageCircle size={28} />
    </button>
  )
}
