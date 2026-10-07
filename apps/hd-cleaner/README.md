# HD Cleaner

마이크루 대시보드에 iframe으로 임베드되는 디스크 정리 유틸리티 서브앱 (Next.js + Mantine, 포트 3260).

## 참조 문서
- 기획: `history/outputs/planner-researcher/hd-cleaner-spec-2026-07-03.md` (Harry, v0.1 MVP)
- 디자인: `history/outputs/designer/hd-cleaner-design-2026-07-03.md` (Henzel, 색상 토큰/7 와이어프레임)
- QA: `outputs/qa/hd-cleaner-qa-plan-2026-07-03.md` (Woods, Critical 리스크 5개 + 17 E2E)

## 스캔 카테고리 (v0.1, 8개)
Downloads / Caches / Logs / Trash / Browser Cache(Chrome·Safari·Edge·Firefox) / Mail Downloads / Old iOS Updates(macOS만) / Large Files(임계값 기본 500MB)

## 안전장치
- 삭제는 `trash` npm 패키지로 OS 휴지통 이동만 수행 (`fs.unlink`/`fs.rm` 영구 삭제 금지)
- `src/lib/safety.ts`: 시스템 보호 경로 deny-list (macOS: `/System /Library /Applications /usr /bin /sbin /etc /private`, Windows: `C:\Windows C:\Program Files C:\Program Files (x86) C:\ProgramData`) + 사용자 보호 폴더(Documents/Desktop/Pictures/Movies/Music)
- 심볼릭 링크(lstat)는 스캔에서 제외, 순회하지 않음
- 소스코드/버전관리 폴더(`.git`, `*.xcodeproj`, `*.sln`, `node_modules`, `.venv`, `.ipynb_checkpoints`)는 스캔 대상에서 제외
- `/api/trash`는 `dryRun` 파라미터로 시뮬레이션 지원
- 모든 삭제 액션은 `.data/audit.jsonl`에 append-only로 기록 (경로+크기+사유+시각)

## 테스트 모드
`HDCLEANER_TEST_MODE=1` 환경변수 설정 시 `src/lib/test-hooks.ts`의 훅(`injectFixture`, `mockPermission`, `mockDeleteResult`, `readAuditLog`, `resetState`)이 활성화됨. 미설정 시 전부 no-op.

## 개발
```bash
npm install
npm run dev      # http://localhost:3260
npm run build
npm start         # 127.0.0.1:3260
```
