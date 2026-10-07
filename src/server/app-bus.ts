// app-bus: outbound WebSocket client to external app servers (e.g. ~/mycrew-photos/server/bus).
// The host connects out to each discovered app's bus URL — apps are the ws server, host is the client.
// Pairing token is still issued by the host (POST /api/apps/:id/pair) and appended to the connect URL.
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocket } from "ws";
import { listManifests } from "./app-registry.js";

const RECONNECT_INTERVAL_MS = 5000;

const tokens = new Map<string, string>(); // appId -> token
const outbound = new Map<string, WebSocket>(); // appId -> single outbound socket
const reconnectTimers = new Map<string, NodeJS.Timeout>();
const lastBusUrl = new Map<string, string>();
let pollTimer: NodeJS.Timeout | null = null;

export function issuePairingToken(appId: string): string {
  let t = tokens.get(appId);
  if (!t) {
    t = randomBytes(24).toString("hex");
    tokens.set(appId, t);
  }
  return t;
}

export function verifyPairingToken(appId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  return tokens.get(appId) === token;
}

export function revokePairingToken(appId: string): void {
  tokens.delete(appId);
  disconnectFromAppServer(appId);
}

export function broadcastToApp(appId: string, type: string, payload: unknown): number {
  const ws = outbound.get(appId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return 0;
  try {
    ws.send(JSON.stringify({ type, payload, appId }));
    return 1;
  } catch {
    return 0;
  }
}

export function connectToAppServer(appId: string, busUrl: string): void {
  lastBusUrl.set(appId, busUrl);
  const prev = outbound.get(appId);
  if (prev && (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = appendToken(busUrl, appId);
  const ws = new WebSocket(url);
  // CONNECTING 단계에서 즉시 등록해야 매 tick(30s)마다 중복 소켓이 생성되지 않는다.
  // 앱이 /bus WS를 구현하지 않으면 open이 안 나 outbound에 영영 등록되지 않고,
  // 그 사이 tick마다 새 소켓이 CONNECTING 상태로 fd를 점유해 누수(→ spawn EBADF)된다.
  outbound.set(appId, ws);
  ws.on("open", () => {
    outbound.set(appId, ws);
    try { ws.send(JSON.stringify({ type: "bus.hello", payload: { from: "host", appId } })); } catch {}
  });
  ws.on("close", () => {
    if (outbound.get(appId) === ws) outbound.delete(appId);
    scheduleReconnect(appId);
  });
  ws.on("error", () => { /* close will follow */ });
  ws.on("message", (raw) => {
    let msg: { type?: string; payload?: unknown };
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    // App→host bus messages observable here; UI bridge wired in subsequent task.
  });
}

export function disconnectFromAppServer(appId: string): void {
  const t = reconnectTimers.get(appId);
  if (t) { clearTimeout(t); reconnectTimers.delete(appId); }
  const ws = outbound.get(appId);
  if (ws) {
    try { ws.close(); } catch {}
    outbound.delete(appId);
  }
  lastBusUrl.delete(appId);
}

export function startAppBusClient(intervalMs = 30_000): void {
  const tick = () => {
    const seen = new Set<string>();
    for (const m of listManifests()) {
      const port = m.ports?.http;
      if (!port) continue;
      const busPath = m.ws || "/bus";
      const busUrl = `ws://127.0.0.1:${port}${busPath}`;
      seen.add(m.id);
      connectToAppServer(m.id, busUrl);
    }
    // Drop sockets for apps no longer in the registry.
    for (const id of Array.from(outbound.keys())) {
      if (!seen.has(id)) disconnectFromAppServer(id);
    }
    for (const id of Array.from(lastBusUrl.keys())) {
      if (!seen.has(id)) lastBusUrl.delete(id);
    }
  };
  tick();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, intervalMs);
}

export function stopAppBusClient(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

export function closeAppBus(): void {
  stopAppBusClient();
  for (const [, t] of reconnectTimers) clearTimeout(t);
  reconnectTimers.clear();
  for (const [, ws] of outbound) { try { ws.close(); } catch {} }
  outbound.clear();
  lastBusUrl.clear();
  tokens.clear();
}

// Legacy no-op — the host no longer accepts inbound /ws/app-bus connections.
// Kept so existing callers (index.ts upgrade router) don't need a coordinated change.
export function handleAppBusUpgrade(_req: IncomingMessage, sock: Socket, _head: Buffer): void {
  try { sock.destroy(); } catch {}
}

function scheduleReconnect(appId: string): void {
  if (reconnectTimers.has(appId)) return;
  const busUrl = lastBusUrl.get(appId);
  if (!busUrl) return;
  const t = setTimeout(() => {
    reconnectTimers.delete(appId);
    connectToAppServer(appId, busUrl);
  }, RECONNECT_INTERVAL_MS);
  reconnectTimers.set(appId, t);
}

function appendToken(busUrl: string, appId: string): string {
  const token = tokens.get(appId);
  if (!token) return busUrl;
  const sep = busUrl.includes("?") ? "&" : "?";
  return `${busUrl}${sep}app=${encodeURIComponent(appId)}&token=${encodeURIComponent(token)}`;
}
