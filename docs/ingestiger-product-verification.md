# IngesTiger 제품 흐름 반영 검사

2026-09-14 KST. 대상은 `codex/ingestiger-wiki-adapter`의 Soloforce2 호스트와 [manifest](../vendor/ingestiger/manifest.json)에 고정한 IngesTiger `2b253de4de45c6ca844bbb5bb6aa3624bf6ee58a` (`1.0.0-draft.5`)다. 실제 사용 절차와 지원 범위는 [운영 안내](../config/wiki/README.md)를 따른다.

## 반영한 동작

| 점검 항목 | 실제 코드 경로와 결과 |
|---|---|
| 신규 담당자 | [agent-registry](../src/agent-registry.ts)의 신규 ID 해석을 createJob·라우팅·기본 담당에 적용. 요구사항 적재 API 기본값은 ingestiger. 기존 작업의 ingest-crab ID 조회는 유지 |
| 코퍼스키퍼 | [역할](../config/agents/corpus-keeper/role-directive.md)의 필수 직렬 인계를 제거. 조인·집계가 요청된 경우만 정본 ID·판·근거를 받도록 정리 |
| 모델 실행 | [호스트 실행기](../src/server/wiki/execution.ts)가 선택 요청 하나를 기존 Claude 게이트웨이에 전달. 역할과 단위 프롬프트를 적용하고 도구·MCP·세션 저장·워밍 호출을 비활성화. 이미 저장된 요청은 재호출하지 않음 |
| 인간 검토 | [정본 서비스](../src/server/wiki/knowledge.ts)가 후보 해시·단위·순번·대상 ID·기준 snapshot·원문 범위와 실제 호스트 인증 주체를 결합해 수용/보류/반려 기록. 최신 검토 여부는 head 포인터로 판정 |
| 정본 파일 | upstream knowledge.py가 기존 ID의 다음 판 또는 신규 UUID와 Markdown·검토 JSON·manifest를 구성. current는 제공 판 선택이고 source_reported·unknown 기간·미확인 의존 조건을 보존 |
| 갱신 안전성 | 원본·권한·기준 판을 다시 확인. writer lock, 준비 journal, 파일 해시 readback 후 current 교체. 이전 snapshot 보존. 교체 실패와 응답 유실 재시도 검사 |
| 화면 | [WikiPanel](../src/client/components/Settings/WikiPanel.tsx)에서 분석 실행, [WikiKnowledgePanel](../src/client/components/Settings/WikiKnowledgePanel.tsx)에서 검토·반영·ID 조회. 수동 JSON 경로도 유지 |
| 문서 | 운영·Windows README와 전체 설계의 현재 범위를 수정. draft.4 역할 검사는 당시 기록으로 명시 |

## 실행한 검증

- `npm run build`: 서버·클라이언트 TypeScript 및 Vite 빌드 통과. 500 kB 초과 번들 경고는 남아 있다.
- `npm run verify:ingestiger`: 고정 commit, 18개 배포 파일 해시, 등록 역할·원본 링크 일치.
- `npm run test:ingestiger-role`: 5그룹 통과. 실제 레지스트리·identity 로더, 기존 역할 수정본 보존, stale 사본 검사.
- `npm run test:wiki`: 9그룹 통과. 실제 Python, 구조 단위, 인용·누락·중복·원본 변경·권한 회수, localhost HTTP 준비·제출·조회·백업. 로컬 소켓 권한이 필요한 검사는 허용된 별도 실행에서 완료했다.
- `npm run test:wiki-product`: 10그룹 통과. 합성 원본 → 요청 → 주입한 모델 응답 → 후보 → 합성 인간 결정 → 정본 → 같은 ID 조회. 판 1→2→3→4, 이전 판 보존, 보류/반려 차단, 오래된 검토 차단, 포인터 교체 실패·응답 유실 복구, 해시 변조·범위 오류·권한 철회, 모델 JSON 오류·요청 ID 오류, 두 writer의 동시 갱신 충돌과 재검토 후 두 지식 보존.
- upstream `python3 scripts/validate_layout.py`: 스킬 1개, 레이아웃과 링크 통과.
- 갱신한 안내 Markdown 6개, 로컬 링크 60개 확인. `git diff --check` 통과.

## 브라우저 확인

`npm run preview:wiki`로 임시 폴더에 원본과 실행 이력을 분리하고 실제 Wiki 화면·HTTP API·Python을 연결했다. 모델 응답만 고정 합성 값으로 주입했다. 브라우저에서 기업·프로젝트와 구조 단위 선택 → 분석 실행 → 후보 선택 → 전체 원문 확인 → 조건 검토 기록 → 정본 반영 → ID·판 재조회까지 확인했다. 새로고침 후 같은 범위의 저장 작업과 정본도 다시 불러왔다.

원문의 `001200원`, 사람의 최종 주문, 자동 주문 금지와 미확인 범위가 후보·정본 화면에 유지됐다. 의미 검토·업무 승인 상태는 구분해 표시했다. 임시 미리보기는 검증 후 종료하며 실제 사용자 history나 원본을 테스트 입력으로 쓰지 않는다.

## 남은 범위

이번 구현은 단일 설치 소유자의 단일 후보 검토·정본 갱신 경로다. 실제 Claude 로그인/유료 호출, 실제 회사 문서의 의미 정확성, Windows 실기기·NTFS 중간 종료·정전 내구성, Drive 쓰기는 검증하지 않았다. 일반 직원 대화의 MCP Wiki 도구·자동 인계, 기존 Ask의 정본 검색, 관계·필수 조건 엔진, 리랭킹 고도화, 실제 작업 사용 추적은 구현하지 않았다. 폴더 구분만으로 다중 사용자 ACL을 보장하지 않는다.

원격 push와 Windows 설치는 이번 로컬 코드 반영에 포함되지 않는다. 원격에 해당 commit이 반영되기 전에는 Windows의 git pull만으로 설치되지 않는다.
