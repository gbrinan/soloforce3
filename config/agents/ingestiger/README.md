# IngesTiger 직원 등록

이 디렉터리의 meta.json과 role-directive.md는 고정 번들에서 생성한 배포 뷰입니다. 역할 내용의 정본은 [번들 manifest](../../../vendor/ingestiger/manifest.json)가 지정하는 agent/role-directive.md입니다. 절차와 계약은 같은 번들의 skills/ingestiger 안에 있습니다. 생성된 역할 본문을 이곳에서 독립 편집하지 않습니다.

직원 ID는 `ingestiger`, 표시 이름은 `인제스트타이거`입니다. 서버 시작 후 config/agents를 읽는 기존 직원 레지스트리가 등록합니다. 실행 역할은 해당 실행 인스턴스의 `history/agents/ingestiger/wiki/role-directive.md`로 생성됩니다. MYCREW_HOME이 별도 위치여도 스킬 링크를 설치 위치의 절대 경로로 바꿔 연결합니다.

기존 ingest-crab의 이력과 개인 수정본은 유지합니다. `supersedes`는 출처 메타데이터이며 직원·작업 기록을 자동 이전하는 기능이 아닙니다. 호스트는 신규 배정·라우팅·기본 담당의 ingest-crab ID를 ingestiger로 연결합니다. 기존 작업에서 getWorkerAgent로 조회한 ID는 유지합니다. Wiki 화면의 구조화된 분석은 [호스트 실행기](../../../src/server/wiki/execution.ts)를 사용합니다. 과거 직원의 작업을 이어서 실행하는 경우 자동으로 새 역할이 적용된다고 가정하지 않습니다.

원본 역할 수정 → upstream 로컬 commit → `npm run sync:ingestiger -- <upstream checkout>` → `npm run verify:ingestiger` 순서로 갱신합니다. 동기화 스크립트는 원본이 clean일 때만 commit 바이트를 복사하고, manifest·직원 메타·역할 링크·호스트 pin을 생성합니다. 과거 번들과 실행 중인 개인 역할은 수정하지 않습니다. 갱신 후 서버 재시작과 실행 역할 검사가 필요합니다.

검사와 Windows 절차는 [역할 반영 확인](../../../docs/ingestiger-role-verification.md)을 따릅니다. 코드 전달은 현재 Git checkout 기준입니다. 기존 프로그램 ZIP 패키저의 새 직원·vendor 포함 여부는 아직 검증하지 않았습니다.
