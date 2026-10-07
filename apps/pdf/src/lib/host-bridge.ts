// Outbound postMessage helpers for the PDF iframe app talking to the MyCrew
// host shell. The host listens for asset.handoff and routes the payload through
// openAppWithAsset to launch the target app (e.g. mail) with the artifact
// prefilled as an attachment.

export interface AssetHandoffPayload {
  targetAppId: string;
  kind: "image" | "video" | "file";
  /** base64 data: URL — self-contained so the receiving app can fetch from any origin */
  dataUrl: string;
  name: string;
}

export function postAssetHandoffToHost(payload: AssetHandoffPayload): void {
  if (typeof window === "undefined") return;
  if (window.parent === window) return;
  window.parent.postMessage(
    { source: "mycrew-pdf", type: "asset.handoff", payload },
    "*",
  );
}
