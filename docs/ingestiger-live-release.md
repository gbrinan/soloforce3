# IngesTiger 실제 호출·소스 배포 검사

2026-09-14 KST, Mac에서 기존 Claude 로그인으로 합성 주문 규칙을 실제 호출했다. 실제 고객 자료는 사용하지 않았다. upstream pin은 `2c4a74b6c9a40cb747c8e24b2a535b4457cdf3f2`, 버전은 `1.0.0-draft.6`이다.

## 호출 결과

1. draft.5 실제 Claude Haiku 호출과 인용 검사가 성공했다. 한국어 입력이 영어 후보로 반환되고 미정 담당이 decision으로 분류되는 점을 관찰했다.
2. 원문 주언어, 적용 조건, 미정 상태 보존 지시를 upstream에 보완했다. 첫 보완판 호출은 약 13초 후 `wiki_model_failed`로 종료됐다. 실패 시 후보·정본을 만들지 않았다. 이 실패의 구체 원인은 확인하지 못했다.
3. 같은 보완판으로 명시적 재호출해 한국어 후보 5개와 인용 검사를 통과했다. 미정 부서는 unknown으로 유지됐다. 기록된 성공 호출의 비용 값은 0.017106 USD이며 구독 청구액을 뜻하지 않는다.
4. 제약 후보에는 적용일 결합과 금지 주체 표현이 부족해 보류했고, 보류 후보의 commit 거절을 확인했다. 원문과 일치하는 `적용 시작일은 2026-10-01이다` 후보는 합성 검증용 결정으로 반영하고 같은 ID·판으로 재조회했다.

재조회 ID는 `K-b12406e1-c614-42e7-854f-e79efed91037`, revision은 1이다. 검토자는 `codex:synthetic-test`로 기록했으며 실제 인간의 업무 승인이나 고객 정본으로 표시하지 않았다. claim_status는 source_reported다.

## 배포 검증

- 제품 흐름 10그룹, 기존 Wiki HTTP 9그룹, bundle/role 검사와 전체 빌드가 통과했다.
- 기존 프로그램 ZIP 패키저의 목록에는 vendor와 신규 직원·검사 스크립트가 빠져 있다. 이번 배포는 `release:source`의 커밋 기반 소스 ZIP을 사용한다.
- `release:source`는 `.env`·history·node_modules·인증키 경로를 거부하고, ZIP을 다시 읽어 IngesTiger 18개 파일의 SHA-256과 Python bridge·직원·로컬 패키지·Windows README를 확인한다. ZIP과 함께 commit·파일 수·SHA-256 기록을 제공한다.
- Windows 사용자는 main을 fast-forward로 갱신하거나 소스 ZIP을 새 폴더에 풀고 해당 OS에서 npm 의존성을 설치·빌드한다. [Windows 절차](../README-WINDOWS.md).

실제 Windows 접속·서비스 재시작, Drive 쓰기, 일반 직원의 Wiki MCP 자동 인계는 이 Mac 실호출 검증에 포함하지 않는다. 적용 조건의 완전성은 모델 프롬프트만으로 보장되지 않으므로 의미 검토 단계를 유지한다.

## Windows 운영 후속 검사

2026-09-15 KST Windows 호스트의 WSL2 운영 인스턴스에서 별도로 확인했다. QA 직원의 `bwrap: loopback: Failed to create NETLINK_ROUTE socket` 오류는 Soloforce2 API 응답이나 Git·TypeScript 실패가 아니라 해당 Claude 세션의 격리 셸 초기화 실패였다. 호스트에서 같은 대상에 대해 Git 상태 조회, `node node_modules/typescript/bin/tsc --noEmit`, `/api/health`를 직접 실행해 각각 성공 여부를 판정한다. 격리 셸 실패를 제품 실패 또는 인증 실패로 변환하지 않는다.

`outputs_missing`을 루프 성공으로 접던 경로는 오류로 바꾼다. `completed`는 계속 `done`, `failed`와 `outputs_missing`은 `error`여야 한다. OAuth 401 본문이 보고 마커 없이 끝난 경우에도 루프가 성공으로 기록되지 않아야 한다.

systemd 운영에서는 자체 재시작이 detached 자식 프로세스를 만든 뒤 정상 종료하면 unit이 정지할 수 있다. `INVOCATION_ID` 또는 `JOURNAL_STREAM`이 있는 프로세스는 종료 코드 75로 supervisor에 재시작을 맡기고, 직접 실행한 프로세스만 기존 detached 재시작을 사용한다. 릴리즈 판정은 빌드 성공만으로 끝내지 않고, 재시작 뒤 unit의 active 상태와 `/api/health` 응답을 함께 확인한다.
