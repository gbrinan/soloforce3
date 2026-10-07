// 드라이브 미팅 녹음 일괄 다운로드 → 미팅노트 전사 큐잉 (순차)
// 시크릿은 브로커 내부에서만 복호화되어 메모리에 머물며 출력되지 않는다.
import { EncryptedConnectionSecretBroker } from "../src/server/connection-secret-broker.js";
import { GoogleReadonlyHttpProvider } from "../src/server/google-readonly-provider.js";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONN_DIR = "C:/mycrew/mycrew-works/education/.connections";
const OUT_DIR = "C:/mycrew/mycrew-program/history/recordings/drive";
const AUDIO_RE = /\.(m4a|mp3|wav|aac|ogg|webm)$/i;
const EXCLUDE = /freight elevator|groovy-ambient/i; // 음악·효과음 제외

const records = JSON.parse(readFileSync(join(CONN_DIR, "records", (await import("node:fs")).readdirSync(join(CONN_DIR, "records")).sort().reverse()[0]), "utf8"));
const key = Buffer.from(process.env.SOLOFORCE_CONNECTION_ENCRYPTION_KEY!, "base64");
const broker = new EncryptedConnectionSecretBroker({ rootDirectory: join(CONN_DIR, "secrets"), encryptionKey: key });
const secret = broker.read(records.credentialHandle);
if (!secret) throw new Error("credential unavailable");

const provider = new GoogleReadonlyHttpProvider({
  clientId: process.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET!,
  redirectUri: process.env.GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL!,
});
const files = await provider.listMetadata(secret.refreshToken);
const targets = files.filter((f: any) => AUDIO_RE.test(f.name || "") && !EXCLUDE.test(f.name || ""));
// 이름 중복 제거 (동일 파일명 2건이면 첫 건만)
const seen = new Set<string>(); const uniq = targets.filter((f: any) => seen.has(f.name) ? false : (seen.add(f.name), true));
console.log(`대상 ${uniq.length}건:`, uniq.map((f: any) => f.name).join(" | "));

// access token (스크립트 내부에서만 사용)
async function accessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_ID!, client_secret: process.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET!, refresh_token: secret!.refreshToken, grant_type: "refresh_token" }) });
  const j: any = await r.json(); if (!j.access_token) throw new Error("token refresh failed: " + JSON.stringify(j).slice(0, 100)); return j.access_token;
}

mkdirSync(OUT_DIR, { recursive: true });
const at = await accessToken();
for (const f of uniq as any[]) {
  const safe = f.name.replace(/[\/:*?"<>|]/g, "_");
  const dest = join(OUT_DIR, safe);
  if (!existsSync(dest)) {
    process.stdout.write(`[다운로드] ${f.name} ... `);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers: { authorization: `Bearer ${at}` } });
    if (!r.ok) { console.log(`실패 HTTP ${r.status}`); continue; }
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    console.log(`${(await import("node:fs")).statSync(dest).size} bytes`);
  } else console.log(`[스킵-존재] ${f.name}`);
  // 전사 큐잉 → 완료 대기 (순차)
  const q = await fetch("http://localhost:3456/api/meetings/summarize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordingPath: dest, title: `드라이브 전사: ${f.name}`, language: "ko" }) });
  const qj: any = await q.json(); if (!qj.token) { console.log(`[큐잉 실패] ${f.name}:`, JSON.stringify(qj).slice(0, 120)); continue; }
  let status = "processing";
  while (status !== "ready" && status !== "failed") {
    await new Promise((res) => setTimeout(res, 20000));
    const s: any = await (await fetch(`http://localhost:3456/api/meetings/${qj.token}`)).json();
    status = s.status;
  }
  console.log(`[전사 ${status}] ${f.name} (token=${qj.token})`);
}
console.log("DRIVE BATCH DONE");
