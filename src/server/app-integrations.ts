// 앱 외부 서비스 연동 마법사 — 서버 로직.
// 연동 정의(어떤 앱이 어떤 키를 필요로 하는지) + 상태 조회 + apps/<dir>/.env.local 안전 저장.
// 키 값은 절대 로그에 남기지 않으며, 저장은 정의된 envName 화이트리스트만 허용한다.

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SELF_DIR } from "../config.js";
import { maskKeyValue } from "./key-vault.js";

export interface IntegrationField {
  envName: string;
  label: string;
  required: boolean;
  secret: boolean;          // true면 UI에서 PasswordInput + 마스킹
  placeholder?: string;
}

export interface IntegrationDef {
  appId: string;            // 매니페스트 id (재시작 API 키)
  appDir: string;           // apps/ 하위 디렉토리명 (id와 다를 수 있음 — sign→isenssign)
  appName: string;
  summary: string;          // 키 없을 때 동작 요약
  docsUrl: string;          // 발급처
  steps: string[];          // 마법사 1단계 안내 문구
  note?: string;            // 추가 주의사항
  fields: IntegrationField[];
}

// 연동 정의 — .env.example과 1:1 정합 유지 (수정 시 양쪽 함께 갱신)
export const INTEGRATION_DEFS: IntegrationDef[] = [
  {
    appId: "bookshelf", appDir: "bookshelf", appName: "책장",
    summary: "키 없으면 무료 공개 검색 폴백 (한국어 도서 검색 품질 저하)",
    docsUrl: "https://developers.naver.com/apps",
    steps: [
      "developers.naver.com/apps 에서 애플리케이션 등록 (검색 API 선택)",
      "발급된 Client ID / Client Secret을 아래에 입력",
      "(선택) developers.kakao.com 에서 REST API 키 발급 — 네이버 실패 시 폴백",
    ],
    fields: [
      { envName: "NAVER_CLIENT_ID", label: "Naver Client ID", required: false, secret: false },
      { envName: "NAVER_CLIENT_SECRET", label: "Naver Client Secret", required: false, secret: true },
      { envName: "KAKAO_REST_KEY", label: "Kakao REST API 키 (선택)", required: false, secret: true },
    ],
  },
  {
    appId: "design", appDir: "design", appName: "디자인",
    summary: "키 없으면 이미지 생성 기능 비활성",
    docsUrl: "https://platform.openai.com/api-keys",
    steps: [
      "platform.openai.com/api-keys 에서 API 키 생성",
      "sk-로 시작하는 키를 아래에 입력",
    ],
    fields: [
      { envName: "OPENAI_API_KEY", label: "OpenAI API Key", required: true, secret: true, placeholder: "sk-..." },
    ],
  },
  {
    appId: "mail", appDir: "mail", appName: "메일",
    summary: "키 없으면 발송 비활성 (로그만 기록)",
    docsUrl: "https://resend.com",
    steps: [
      "resend.com 가입 후 발신 도메인 인증",
      "API Keys 메뉴에서 키 발급 (re_로 시작)",
      "(수신 기능 사용 시) 웹훅 시크릿을 이메일 워커와 동일 값으로 설정",
    ],
    fields: [
      { envName: "RESEND_API_KEY", label: "Resend API Key", required: true, secret: true, placeholder: "re_..." },
      { envName: "INBOUND_WEBHOOK_SECRET", label: "수신 웹훅 시크릿 (선택)", required: false, secret: true },
    ],
  },
  {
    appId: "booking", appDir: "booking", appName: "예약",
    summary: "미설정 시 예약 저장·메일 발송 비활성",
    docsUrl: "https://supabase.com",
    steps: [
      "supabase.com 에서 무료 프로젝트 생성",
      "Dashboard → Settings → API 에서 Project URL과 service_role 키 복사",
      "(선택) resend.com API 키 — 예약 확인 메일 발송용",
    ],
    note: "Supabase 테이블 스키마는 apps/booking/.env.example 상단 안내 참조",
    fields: [
      { envName: "SUPABASE_URL", label: "Supabase Project URL", required: true, secret: false, placeholder: "https://xxxx.supabase.co" },
      { envName: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase service_role Key", required: true, secret: true },
      { envName: "RESEND_API_KEY", label: "Resend API Key (선택)", required: false, secret: true, placeholder: "re_..." },
      { envName: "BOOKING_FROM_EMAIL", label: "발신 이메일 (선택)", required: false, secret: false },
      { envName: "BOOKING_HOST_EMAIL", label: "호스트 알림 이메일 (선택)", required: false, secret: false },
    ],
  },
  {
    appId: "mymaps", appDir: "mymaps", appName: "지도",
    summary: "키 없으면 무료 지도·검색 폴백 (검색 결과 빈약)",
    docsUrl: "https://cloud.maptiler.com",
    steps: [
      "cloud.maptiler.com 에서 무료 키 발급 (지도 타일)",
      "(선택) GCP Console에서 Maps JavaScript API + Places API(New) 활성화 후 키 발급",
    ],
    note: "지도 앱은 빌드 시점에 키가 반영되므로 저장 후 재시작 시 자동 재빌드될 수 있음 (수 분 소요)",
    fields: [
      { envName: "VITE_MAPTILER_KEY", label: "MapTiler Key", required: false, secret: true },
      { envName: "VITE_GOOGLE_MAPS_API_KEY", label: "Google Maps API Key (선택)", required: false, secret: true },
    ],
  },
  {
    appId: "pdf", appDir: "pdf", appName: "PDF",
    summary: "미설정 시 고급 변환 기능만 비활성 (기본 뷰어 정상)",
    docsUrl: "https://github.com/Stirling-Tools/Stirling-PDF",
    steps: [
      "docker run -d -p 8080:8080 stirlingtools/stirling-pdf:latest 로 로컬 서버 실행",
      "기본 주소(http://127.0.0.1:8080)와 다르면 아래에 입력",
    ],
    fields: [
      { envName: "STIRLING_PDF_URL", label: "Stirling-PDF 서버 주소 (선택)", required: false, secret: false, placeholder: "http://127.0.0.1:8080" },
    ],
  },
];

// baseDir 오버라이드는 테스트 격리용 (기본: 실제 프로젝트 루트)
function appEnvPath(def: IntegrationDef, baseDir: string = PROJECT_SELF_DIR): string {
  return join(baseDir, "apps", def.appDir, ".env.local");
}

// .env.local 파싱 — app-registry.readDotEnvLocal과 동일 규격 (KEY=VALUE, # 주석 무시)
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch { /* 읽기 실패 → 빈 상태 취급 */ }
  return out;
}

export interface IntegrationFieldStatus extends IntegrationField {
  hasValue: boolean;
  masked: string;
}

export interface IntegrationStatus extends Omit<IntegrationDef, "fields"> {
  fields: IntegrationFieldStatus[];
  configured: boolean;      // 필수 필드가 전부 설정됨 (필수 없으면 아무 필드 1개 이상)
}

export function getIntegrationStatus(baseDir?: string): IntegrationStatus[] {
  return INTEGRATION_DEFS.map((def) => {
    const env = parseEnvFile(appEnvPath(def, baseDir));
    const fields = def.fields.map((f) => {
      const raw = env[f.envName] ?? "";
      return { ...f, hasValue: !!raw, masked: raw ? maskKeyValue(raw) : "" };
    });
    const required = fields.filter((f) => f.required);
    const configured = required.length > 0
      ? required.every((f) => f.hasValue)
      : fields.some((f) => f.hasValue);
    return { ...def, fields, configured };
  });
}

/**
 * apps/<dir>/.env.local에 값 머지 저장.
 * - 정의에 없는 envName은 거부 (임의 env 주입 차단)
 * - 기존 파일의 다른 키·주석 라인은 보존, 대상 키만 교체/추가
 * - 빈 문자열 값은 해당 키 삭제
 */
export function saveAppIntegration(
  appId: string,
  values: Record<string, string>,
  baseDir?: string,
): { ok: boolean; error?: string } {
  const def = INTEGRATION_DEFS.find((d) => d.appId === appId);
  if (!def) return { ok: false, error: `알 수 없는 앱: ${appId}` };
  const allowed = new Set(def.fields.map((f) => f.envName));
  for (const k of Object.keys(values)) {
    if (!allowed.has(k)) return { ok: false, error: `허용되지 않은 키: ${k}` };
    if (/[\n\r]/.test(values[k] ?? "")) return { ok: false, error: `줄바꿈 포함 값 거부: ${k}` };
  }
  const path = appEnvPath(def, baseDir);
  const lines = existsSync(path) ? readFileSync(path, "utf-8").split("\n") : [];
  const remaining = new Map(Object.entries(values));

  const nextLines = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    const eq = t.indexOf("=");
    if (eq <= 0) return line;
    const key = t.slice(0, eq).trim();
    if (!remaining.has(key)) return line;
    const val = remaining.get(key)!;
    remaining.delete(key);
    return val === "" ? null : `${key}=${val}`;   // 빈 값 → 라인 삭제
  }).filter((l): l is string => l !== null);

  for (const [key, val] of remaining) {
    if (val !== "") nextLines.push(`${key}=${val}`);
  }

  try {
    const body = nextLines.join("\n").replace(/\n*$/, "\n");
    writeFileSync(path, body, "utf-8");
    try { chmodSync(path, 0o600); } catch { /* 권한 설정 실패 무시 (Windows 등) */ }
    console.log(`[AppIntegrations] ${appId}: ${Object.keys(values).length}개 키 저장 (값 미출력)`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `저장 실패: ${err instanceof Error ? err.message : String(err)}` };
  }
}
