// WS bus: host (mycrew-system) <-> photos app
// Token validation: host issues token via /api/apps/photos/pair; app receives via env MYCREW_PHOTOS_BUS_TOKEN
export class Bus {
  constructor() {
    this.clients = new Set();
    this.expectedToken = process.env.MYCREW_PHOTOS_BUS_TOKEN || '';
  }
  clientCount() { return this.clients.size; }
  attach(ws, token) {
    if (this.expectedToken && token !== this.expectedToken) {
      ws.close(4401, 'invalid token');
      return;
    }
    this.clients.add(ws);
    ws.on('message', (raw) => this.handle(ws, raw));
    ws.on('close', () => this.clients.delete(ws));
    ws.send(JSON.stringify({ type: 'bus.hello', payload: { from: 'photos' } }));
  }
  handle(_ws, raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    this.broadcast(msg);
  }
  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      try { c.send(data); } catch {}
    }
  }
}
