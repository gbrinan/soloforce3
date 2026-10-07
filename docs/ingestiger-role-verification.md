> 아래는 draft.4 역할 연결 검증의 당시 기록입니다. draft.5의 분석·검토·정본·재조회 구현과 현재 pin은 [제품 운영 안내](../config/wiki/README.md)를 따릅니다.

# IngesTiger 역할 반영 확인

2026-09-14, 역할·계약과 직원 등록 경로를 연결했습니다. 고정 버전은 `1.0.0-draft.4`, upstream commit은 `510f23fcf1ed30a3202e16a072332e6adc8e81aa`입니다. 정확한 배포 파일과 해시는 [manifest](../vendor/ingestiger/manifest.json)에 있습니다.

## Markdown에서 확인한 내용

| 요구 | 현재 정본 | 반영 내용 |
|---|---|---|
| 종류에 따른 첫 분기 | [역할](../vendor/ingestiger/510f23fcf1ed30a3202e16a072332e6adc8e81aa/agent/role-directive.md), [스킬](../vendor/ingestiger/510f23fcf1ed30a3202e16a072332e6adc8e81aa/skills/ingestiger/SKILL.md) | 자료 종류·읽기 범위, 작업 종류·활용 목적 분리 유지 |
| 필수 조건 확인 | [데이터 계약](../vendor/ingestiger/510f23fcf1ed30a3202e16a072332e6adc8e81aa/skills/ingestiger/references/contracts.md) | 등록된 적용 관계의 조건·금지·미결정을 검색과 별도로 확인. 미등록·미판독 범위 표시 |
| 시간과 상태 | 같은 데이터 계약 | 기록 시점·적용 기간, current·의미 검토·업무 승인 구분 |
| 사실·관계·평가 | [모드](../vendor/ingestiger/510f23fcf1ed30a3202e16a072332e6adc8e81aa/skills/ingestiger/references/modes.md)와 데이터 계약 | 요청된 목적과 범위에서 관계·가치 판단. 판단을 사실과 구분 |
| 완료 기준 | [저장 계약](../vendor/ingestiger/510f23fcf1ed30a3202e16a072332e6adc8e81aa/skills/ingestiger/references/storage.md)과 역할 | 조회·후보 저장·정본 반영·원격 전달 분리. 일반 조회에 Drive 업로드 불필요 |
| 다음 작업의 사용 | 데이터 계약의 작업 사용과 변경 영향 | provided와 applied_verified 구분. 실제 산출물 위치를 확인한 경우에만 사용 확인 |
| 정본과 색인 | 데이터 계약과 저장 계약 | 지식 Markdown·관계·검토 기록의 snapshot이 정본. DB·벡터·그래프 검색 색인은 재생성 |
| 구현 경계 | [어댑터 상태](../vendor/ingestiger/510f23fcf1ed30a3202e16a072332e6adc8e81aa/skills/ingestiger/references/adapters.md) | 자동 조건 조회·정본 승격·사용 추적·Drive 동기화는 여전히 미구현 |

## 실행 연결과 검증 범위

1. 고정 번들 → [직원 등록 역할](../config/agents/ingestiger/role-directive.md)은 상대 링크만 설치 경로에 맞춰 생성합니다. 본문과 메타데이터의 일치를 검사합니다.
2. [레지스트리](../src/agent-registry.ts)는 `ingestiger`를 발견하고 역할 사본을 만듭니다. [역할 동기화 함수](../src/role-directive.ts)가 스킬 링크를 실행 위치에 종속되지 않도록 바꿉니다. 기존 최신 개인 수정본은 유지하며 오래된 사본을 바꿀 때는 .bak을 보존합니다.
3. [identity loader](../src/server/worker-identity.ts)가 실행 역할을 읽고 [작업 프롬프트](../src/server/jobs.ts)가 이를 포함합니다. 별도 임시 MYCREW_HOME에서 실제 등록·복사·identity 생성을 실행해 확인했습니다. 고객 자료나 기존 운영 이력은 사용하지 않았습니다.
4. Wiki 후보 화면의 [단계 프롬프트](../vendor/ingestiger/510f23fcf1ed30a3202e16a072332e6adc8e81aa/skills/ingestiger/scripts/pipeline.py)는 응답 스키마와 선택 단위 분석을 맡습니다. 적용 날짜·조건 보존, 사실과 판단 구분, 문서 다른 부분의 미확인 범위를 보완했습니다. 전체 역할을 후보 응답 지시로 삽입하지 않습니다. 기존 후보·보류·인용·권한 HTTP 회귀 검사를 통과했습니다.

로컬 검증: upstream 레이아웃 검사 통과(스킬 1개), 고정 파일 17개 해시 일치, 역할 등록·사용자 수정 보존·오래된 사본 검출 등 합성 검사 5그룹 통과, 서버 TypeScript 검사 통과, Wiki 회귀 검사 9그룹 통과. Markdown 문장 검토는 위 표로 대조했습니다. 이 결과는 실제 LLM의 지시 준수나 Windows 운영 검증이 아닙니다.

기존 ingest-crab 이력은 자동 이전하지 않습니다. 새 Wiki 작업의 직원 ID는 `ingestiger`입니다. [등록 안내](../config/agents/ingestiger/README.md)에서 생성 파일과 원본의 책임을 확인합니다.

## Windows에서 다시 확인

새 코드가 포함된 실제 Git checkout에서 실행합니다. 현재 변경이 원격에 공개되기 전에는 `git pull origin main`만으로 설치되지 않습니다. `.env`와 기존 사용자 데이터는 보존하며 이 검사기는 비밀 설정을 읽거나 출력하지 않습니다. 다른 MYCREW_HOME으로 실행하는 앱이면 동일한 값을 해당 PowerShell 세션에 지정합니다.

```powershell
# 의존성 설치가 완료된 Soloforce2 소스 폴더에서
npm.cmd run verify:ingestiger
if ($LASTEXITCODE -ne 0) { throw "번들 또는 직원 등록 검사 실패" }
npm.cmd run test:ingestiger-role
if ($LASTEXITCODE -ne 0) { throw "격리된 역할 연결 검사 실패" }
```

서버를 해당 checkout에서 다시 시작하고 직원 목록의 인제스트타이거를 확인합니다. 최초 설정이 완료되어 history/agents.json이 있어야 기존 레지스트리가 직원을 발견합니다. 이어서 같은 실행 인스턴스를 대상으로 아래 읽기 전용 검사를 실행합니다.

```powershell
# 별도 데이터 경로를 쓰는 경우에만 실제 앱과 같은 값으로 지정:
# $env:MYCREW_HOME = 'D:\MyCrewData'
$roleReport = Join-Path $PWD ("ingestiger-role-check-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.md')
npm.cmd run verify:ingestiger -- --runtime --report $roleReport
if ($LASTEXITCODE -ne 0) { throw "실행 역할 누락·불일치: 생성된 Markdown 보고서를 확인하세요" }
```

FAIL이면 역할 사본의 존재·선택한 실행 경로·개인 수정 여부를 확인합니다. 검사기는 역할 사본을 덮어쓰지 않습니다. 개인 수정본과 새 역할이 다르면 두 내용을 검토해 반영하고 다시 검사합니다.

마지막으로 인제스트타이거에게 다음 합성 자료로 조회를 요청합니다. 기존 등록 조건 조회 엔진이 없는 상황을 숨기지 않도록 범위를 명시합니다.

> 이번 자료만 읽어 교육 준비 조건을 답해줘. 추가 저장은 필요 없어. 자료: 교육 시간은 90분이다. 이 조건은 2026-10-01부터 적용한다. 자료 기록일은 2026-09-14이다. 실제 고객 명단 사용은 금지한다. 실습 도구는 아직 미정이다. 문서의 다른 절과 Wiki 적용 관계는 제공하지 않았다.

답변에서 90분·적용일·기록일·금지·미정을 보존하고, 미제공 범위를 확인했다고 주장하지 않으며, 조회 완료를 위해 Drive 업로드를 요구하지 않는지 확인합니다. 이 실제 모델 결과와 실행 OS를 보고서에 추가해야 Windows 역할 동작까지 확인했다고 말할 수 있습니다. 정본 승격·사용 기록·Drive 전달 성공은 별도 구현과 검증 대상입니다.
