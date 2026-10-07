# MyMovie — 영상 편집 앱

마이크루 옵셔널 앱. yt-dlp(YouTube → 파일) + ffmpeg(프록시 트랜스코드/렌더) + OpenReel 코어 + AI 디렉터(Claude CLI / 로컬 OSS 폴백).

## 상태 (2026-06-17)

- **Step 1** ✅ OpenReel core 벤더링 (`src/lib/core/COMMIT_PIN.txt`)
- **Step 2** ✅ 인제스트 어댑터 (yt-dlp + ffmpeg + 업로드)
- **Step 3** ✅ 시그널 수집 (씬컷·무음 감지·메타) + STT (whisper.cpp / HyperFrames 폴백 / 스텁)
- **Step 4** ✅ AI 디렉터 (Claude CLI ↔ 로컬 OSS 라우팅, 액션 생성·검증)
- **Step 5** ✅ 렌더 파이프라인 — `executeMany`(ffmpeg)로 cut/trim/reframe/caption(burn-in)/bgm/transition(xfade) chain 적용 → 단일 mp4 + 다운로드 스트리밍
- **Step 6** 🟡 진행 중 — 수동 타임라인 편집
  - ✅ 백엔드: `injectActions` 경로 (director 우회 직접 렌더) + `/api/actions/validate` 검증 헬퍼
  - 🟡 프론트엔드 UI (Paul 담당 진행 중): 좌측 도구바(cut/trim/reframe/caption/bgm/transition) + 타임라인 + undo(`inverseOf` 활용)
- **Step 7+** ⏸ 잡 레지스트리 Supabase 영구화 / 멀티클립 합성

> 참고: `src/lib/director/dispatch.ts`·`hyperframes-bridge.ts`는 그래픽 액션을 HyperFrames 컴포지션으로 보내는 **대체 경로(현재 dry-run 스텁, 렌더 라우트 미사용)**. 실 렌더는 `/api/render/[id]`가 모든 액션을 `executeMany`로 직접 처리한다.

## 실행

```bash
# 의존성 설치 (저장소 루트에서 1회)
npm install --prefix apps/mymovie

# 개발 서버 (포트 3203)
npm run dev --prefix apps/mymovie

# 빌드
npm run build --prefix apps/mymovie

# 타입체크
npm run typecheck --prefix apps/mymovie
```

## 통합 (마이크루 호스트)

- manifest: `apps/mymovie/manifest.json` (id `movie`, port 3203, proxyMode `passthrough`)
- 호스트 등록: `src/server/app-registry.ts` `KNOWN_APPS` 배열의 `movie` 항목
- 런처 표시명: `src/client/components/Apps/AppLauncherModal.tsx` 의 id→표시명 매핑에서 `movie: "영상 편집"`
- 헬스체크: `/api/health`

## 외부 의존성 (전부 무료/로컬)

- `yt-dlp` (PATH 필요, `brew install yt-dlp`)
- `ffmpeg` / `ffprobe` (PATH 필요, `brew install ffmpeg`)

## API

| 메서드 | 경로 | 본문 | 응답 |
|--------|------|------|------|
| GET | `/api/health` | — | `{ok:true, app:"mymovie", version}` |
| POST | `/api/ingest/youtube` | `{url, acknowledgeRights:true}` | `{ok, jobId}` |
| POST | `/api/ingest/upload` | multipart `file` | `{ok, jobId}` |
| GET | `/api/ingest/jobs/[id]` | — | `{ok, job}` |
| POST | `/api/director/run` | `{inputPath?, intent?, prefer?}` | `{ok, finalActions, signals, llm}` |
| POST | `/api/render/[id]` | `{intent?, prefer?, skipTranscribe?, injectActions?}` | `{ok, finalPath, sizeBytes, appliedActionIds, warnings}` |
| POST | `/api/actions/validate` | `{jobId, actions}` | `{ok, validation}` |
| GET | `/api/render/[id]` | `?download=1` | `video/mp4` 스트림 |

### `injectActions` 동작 (Step 6)
- `POST /api/render/[id]`에 `injectActions: Action[]` 포함 → **director 우회** 후 주입 액션을 직접 검증·렌더.
- 빈 배열(`[]`) → 원본 passthrough (director 미호출, 원본을 그대로 `finals/{id}.mp4`로 복사).
- 비배열(객체/문자열) → `400 {ok:false, error:"injectActions must be an array"}`.
- 검증 실패(예: trim.end > durationMs) → `422 {ok:false, error:"action validation failed", validation}`.
- 성공 응답은 director 경로와 동일 형태(`appliedActionIds`/`failedActionIds`/`warnings`), 단 `llmProvider:null, llmAttempts:[]`.
- `injectActions` 키 미포함 시 기존 director 경로 그대로 동작(회귀 없음).

### `/api/actions/validate` (검증 헬퍼)
- ffmpeg 미실행, 스키마·범위 검증만. UI 타임라인 편집 즉시 피드백용.
- `jobId` 미존재 시 404, body 형식 오류 시 400.

`acknowledgeRights`: YouTube ToS 준수를 위해 사용자가 본인 콘텐츠/권리 보유분임을 명시적으로 동의해야 다운로드 가능.

## MCP 서버 (P1-1)

`bin/mcp-server.mjs` — stdio 기반 MCP 서버. 외부 LLM/에이전트가 MyMovie API에 안전하게 접속할 수 있게 한다.

### 도구 목록
| name | 설명 |
|------|------|
| `mymovie_list_projects` | 저장된 프로젝트(jobId) 요약 목록 |
| `mymovie_get_project` | 단일 프로젝트(job + actions + clips) |
| `mymovie_validate_actions` | Action[] 스키마/범위 검증 (ffmpeg 미실행) |
| `mymovie_run_director` | AI 디렉터 1회 실행 → 추천 Action[] |
| `mymovie_inject_actions` | Action[] 직접 주입 후 렌더 (다중 클립이면 concat+xfade 체인 자동 적용) |

### 실행
```bash
# Next.js 서버를 먼저 띄운다(포트 3203)
npm run dev --prefix apps/mymovie

# 별도 터미널에서 MCP 서버 시작 (stdio)
npm run mcp --prefix apps/mymovie
```

환경변수 `MYMOVIE_BASE_URL`(기본 `http://localhost:3203`) 로 베이스 URL 변경 가능.

### Claude Code/Desktop 등록 예
```json
{
  "mcpServers": {
    "mymovie": {
      "command": "node",
      "args": ["/absolute/path/to/apps/mymovie/bin/mcp-server.mjs"],
      "env": { "MYMOVIE_BASE_URL": "http://localhost:3203" }
    }
  }
}
```

> 보안: 모든 도구는 HTTP만 사용하며 임의 경로/파일을 직접 노출하지 않는다. `jobId`는 ingest를 거친 값만 유효.

## 제약

- **무료 OSS/로컬만** 사용 — Supabase·Vercel·유료 STT API 없음.
- 잡 레지스트리는 In-memory (서버 재시작 시 휘발). Step 6 영구화 예정 — 재시작 시 인제스트 잡 소실로 렌더 불가하니 같은 세션 내에서 인제스트→렌더를 수행할 것.
- transition은 단일 입력 chain 적용까지 동작. 멀티클립 합성은 Step 6 범위.
- AI 디렉터가 시그널 0건 등으로 액션을 못 내면 원본 passthrough로 결과물을 보장한다(렌더 실패 방지).
