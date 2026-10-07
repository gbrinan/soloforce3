import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getManifest, listManifests } from "../app-registry.js";
import { HISTORY_DIR } from "../../config.js";
import { storeCorsMiddleware } from "./store-cors.js";

export const storeCatalogRoutes = new Hono();

// store.dooitspace.com 브라우저가 직접 fetch하는 라우트 — CORS/PNA 헤더 필수.
storeCatalogRoutes.use("*", storeCorsMiddleware());

interface CatalogItem {
  id: string;
  kind: "skill" | "plugin" | "app";
  name: string;
  description: string;
  owner: string;
  visibility: "public" | "private";
  version: string;
  iconUrl: string;
  entryUrl: string;
  screenshots: string[];
  readme: string;
  permissions: string[];
  releases: { version: string; notes: string; publishedAt: string }[];
  stats: { installs: number; likes: number; forks: number };
}

// navSettings.ts NAV_ITEMS 미러 (서버는 클라이언트 라벨 i18n 키에 접근 불가하므로 한국어 표시명으로 고정)
const PLUGIN_ITEMS: { id: string; name: string; description: string }[] = [
  { id: "inbox", name: "인박스", description: "친구/동료 요청함" },
  { id: "notifications", name: "알림", description: "시스템 알림 목록" },
  { id: "todos", name: "할일", description: "태스크/투두 관리" },
  { id: "schedules", name: "일정", description: "캘린더/스케줄 관리" },
  { id: "meeting", name: "회의", description: "회의록/미팅 관리" },
  { id: "notes", name: "노트", description: "위키/메모 관리" },
  { id: "files", name: "파일", description: "파일 탐색기" },
  { id: "staff", name: "팀원", description: "에이전트 팀원 관리" },
  { id: "costs", name: "비용", description: "토큰/비용 사용량" },
  { id: "contacts", name: "연락처", description: "명함/연락처 관리" },
];

// app-registry.ts KNOWN_APPS 미러 (고정 목록, manifest 캐시 로드 여부와 무관하게 개수 보장)
const APP_ITEMS: { id: string; name: string; description: string }[] = [
  { id: "photos", name: "포토", description: "사진 갤러리 앱" },
  { id: "sign", name: "사인", description: "전자서명 앱" },
  { id: "movie", name: "무비", description: "영상 편집 앱" },
  { id: "design", name: "디자인", description: "디자인 툴" },
  { id: "pdf", name: "PDF", description: "PDF 편집/뷰어" },
  { id: "booking", name: "예약", description: "예약 관리 앱" },
  { id: "mail", name: "메일", description: "이메일 클라이언트" },
  { id: "approval", name: "전자결재", description: "결재 문서 관리" },
  { id: "mymaps", name: "마이맵", description: "지도/위치 앱" },
  { id: "notes", name: "노트앱", description: "독립 노트 앱" },
  { id: "calc", name: "계산기", description: "계산기 앱" },
  { id: "hd-cleaner", name: "HD 클리너", description: "디스크 정리 유틸리티 — 캐시/로그/다운로드/대용량 파일 스캔 및 휴지통 이동" },
  { id: "bookshelf", name: "책장", description: "개인 서재 관리 — 표지 검색·읽기 상태·별점" },
  { id: "ledger", name: "재무설계", description: "가계부(수입·지출·예산·구독) + 자산관리(예금·적금·주식·ETF·코인·외환·금 시세 자동 추적)" },
  { id: "diary", name: "내 일기", description: "날짜별 일기·무드 기록, AI 감정 분석·성찰 질문, 데일리 회고 자동 작성 (로컬 저장)" },
  { id: "learn", name: "학습", description: "텍스트·파일·링크·책·노트로 AI 학습 자료(요약·핵심개념·플래시카드·퀴즈) 생성 + SM-2 간격반복 암기" },
  { id: "projects", name: "프로젝트", description: "교육·컨설팅 등 고객사 프로젝트(회차·교안·현장피드백·후속제안·산출물)를 카테고리별로 열람 (읽기 전용)" },
];

// history/skills/ 스킬-알바 라이브 풀 미러 (src/server/skills.ts 시드와 동일 5종).
// 스킬은 파일 아티팩트가 리포에 내장(artifact_type=local)이라 설치 = 기록 활성화.
const SKILL_ITEMS: { id: string; name: string; description: string }[] = [
  { id: "backend-dev", name: "백엔드 개발자", description: "서버 API 및 데이터베이스 구현 전문 서브에이전트 (Node.js/TypeScript/Hono)" },
  { id: "frontend-dev", name: "프론트엔드 개발자", description: "React/Tailwind 프론트엔드 컴포넌트 구현 전문 서브에이전트" },
  { id: "data-collector", name: "데이터 수집 리서처", description: "웹 검색 기반 정보 수집·정리 전문 서브에이전트 (WebSearch/WebFetch)" },
  { id: "doc-writer", name: "문서/기획 작성자", description: "기획서·기술 문서·사용자 가이드 작성 전문 서브에이전트" },
  { id: "tester", name: "QA/테스트 엔지니어", description: "기능 테스트 및 품질 검증 전문 서브에이전트 (빌드·타입체크·API 검증)" },
];

interface InstalledLog {
  itemId: string;
  kind: string;
  action: "install" | "uninstall";
  at: string;
}

// installed.jsonl을 리플레이해 (kind,itemId)별 순 install 수 + 최초 install 시각 반환.
// v1.13에서 stats.installs / releases 초기값이 0/빈 배열로 렌더링돼 상세 화면이 "죽어 보이는" 문제 해결.
function computeInstallStats(): Map<string, { installs: number; firstAt: string | null }> {
  const file = join(HISTORY_DIR, "store", "installed.jsonl");
  const stats = new Map<string, { installs: number; firstAt: string | null }>();
  if (!existsSync(file)) return stats;
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const activeKeys = new Set<string>();
  const firstInstallAt = new Map<string, string>();
  for (const line of lines) {
    let rec: InstalledLog;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const key = `${rec.kind}:${rec.itemId}`;
    if (rec.action === "install") {
      activeKeys.add(key);
      if (!firstInstallAt.has(key)) firstInstallAt.set(key, rec.at);
    } else if (rec.action === "uninstall") {
      activeKeys.delete(key);
    }
  }
  for (const key of activeKeys) {
    stats.set(key, { installs: 1, firstAt: firstInstallAt.get(key) ?? null });
  }
  return stats;
}

function toItem(
  kind: CatalogItem["kind"],
  id: string,
  fallbackName: string,
  fallbackDescription: string,
  installStats: Map<string, { installs: number; firstAt: string | null }>,
): CatalogItem {
  const manifest = kind === "app" ? getManifest(id) : undefined;
  const version = manifest?.version || "1.0.0";
  const stat = installStats.get(`${kind}:${id}`);
  const installedAt = stat?.firstAt ?? null;
  // 릴리스 데이터가 별도 메타에 없으므로 현재 version을 "Initial release"로 시딩해 탭이 비어 보이지 않게.
  // installedAt이 있으면 최초 설치 시각을 publishedAt으로 사용, 없으면 오늘 날짜.
  const releases = [
    {
      version,
      notes: "초기 릴리스",
      publishedAt: (installedAt ?? new Date().toISOString()).slice(0, 10),
    },
  ];
  return {
    id,
    kind,
    name: manifest?.name || fallbackName,
    description: manifest?.description || fallbackDescription,
    owner: "mycrew-core",
    visibility: "public",
    version,
    iconUrl: manifest?.icon || "",
    entryUrl: manifest?.entry?.url || "",
    screenshots: [],
    readme: manifest?.description || fallbackDescription,
    permissions: manifest?.capabilities || [],
    releases,
    stats: { installs: stat?.installs ?? 0, likes: 0, forks: 0 },
  };
}

storeCatalogRoutes.get("/", (c) => {
  const kind = c.req.query("kind");
  if (kind !== "skill" && kind !== "plugin" && kind !== "app") {
    return c.json({ error: "kind must be skill|plugin|app" }, 400);
  }
  const installStats = computeInstallStats();
  if (kind === "skill") {
    const items = SKILL_ITEMS.map((s) => toItem(kind, s.id, s.name, s.description, installStats));
    return c.json({ kind, items });
  }
  if (kind === "plugin") {
    const items = PLUGIN_ITEMS.map((s) => toItem(kind, s.id, s.name, s.description, installStats));
    return c.json({ kind, items });
  }
  // app: 정적 미러(APP_ITEMS) + 런처 앱 레지스트리(app-registry) 자동 등록.
  // toItem()이 이미 getManifest(id)로 실데이터를 우선 적용하므로 정적 항목도 런처 정보가 우선 반영된다.
  // 정적 미러에 없는 앱(동적 스캔 ~/mycrew-apps/*)만 레지스트리에서 자동 추가.
  // category: "core"(내장 앱, 설치 불필요)는 스토어 노출 대상에서 제외 → "optional"만 자동 등록.
  const staticIds = new Set(APP_ITEMS.map((s) => s.id));
  const staticItems = APP_ITEMS.map((s) => toItem(kind, s.id, s.name, s.description, installStats));
  const autoItems = listManifests()
    .filter((m) => m.category !== "core" && !staticIds.has(m.id))
    .map((m) => toItem(kind, m.id, m.name, m.description ?? "", installStats));
  return c.json({ kind, items: [...staticItems, ...autoItems] });
});
