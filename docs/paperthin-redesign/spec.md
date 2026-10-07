# Feature Specification: soloforce paperthin 재설계

<!--
제품 요구사항을 정의하는 문서입니다. PRD 수준으로 작성하며,
기술적인 세부사항(도메인 모델, 코드 예시)은 plan.md, findings.md에서 다룹니다.
-->

## Overview

soloforce(MyCrew)는 개인 AI 비서 + 에이전트 팀 시스템으로, src 238개 파일, 앱 20개,
config 템플릿·prompts·loops·ops 디렉토리가 릴리스를 거듭하며 누적되었다. 문서(README 4종),
스펙(.moai/specs), 이터레이션 기록(.re0)이 서로 다른 시기의 진실을 담고 있어 어느 것이
현재인지 알 수 없다.

이 재설계는 기능 추가가 아니라 **paperthin의 5축 철학을 soloforce의 운영 체계로 이식**하는
것이다: ① 아티팩트 신뢰(작성자 판단 배제) ② SSOT ③ 절제(개선 없으면 무변경)
④ 재귀적 자기검증 ⑤ negatives-as-corpus.

## User Scenarios & Testing (mandatory)

### User Story 1: 한 곳의 진실

- As: soloforce 유지보수자는
- I: 어떤 사실(포트, 환경변수, 앱 목록, 설치 절차)이든 정본 위치 하나를 찾을 수 있다
- So: 문서 간 모순을 어느 쪽이 맞는지 추측하지 않기 위해

#### Acceptance Scenarios

Scenario 1: **README 4종 정합**

- Given: README, README-USER, README-WINDOWS, README-DISTRIBUTION이 같은 사실을 다르게 서술할 때
- When: ssotize 감사를 실행하면
- Then: 사실별 정본 1곳이 지정되고 나머지는 참조로 치환된다 (모순은 인간 판단 목록으로 분리)

Scenario 2: **설정값의 단일 홈**

- Given: 포트·경로 같은 값이 코드 기본값, .env.example, README 표에 각각 존재할 때
- When: 값이 한 곳에서 바뀌면
- Then: 나머지 표면은 참조이거나 자동 유도라서 드리프트가 발생하지 않는다

### User Story 2: 문서가 clean v0로 읽힌다

- As: 새로 합류한 세션(사람 또는 에이전트)은
- I: 현재 문서만 읽고 시스템의 지금 상태를 파악할 수 있다
- So: 과거 변경 이력과 낡은 델타를 걸러내는 비용을 없애기 위해

#### Acceptance Scenarios

Scenario 1: **re0 패스**

- Given: 패치 흔적·changelog 어투가 남은 문서가 있을 때
- When: re0 패스를 돌리면
- Then: "무엇이 바뀌었나"가 "지금 무엇이 참인가"로 재서술되고, 개선할 게 없는 문서는 무변경으로 남는다

Scenario 2: **콜드리드 통과**

- Given: 재작성된 핵심 문서(README, 온보딩)가 있을 때
- When: zero-context 서브세션이 콜드리드하면
- Then: 사전 맥락 없이 설치·실행·개념을 오해 없이 따라갈 수 있다 (shower 기준)

### User Story 3: 죽은 코드는 아카이브로

- As: 유지보수자는
- I: 사용 중단된 앱·루프·프롬프트를 삭제 대신 아카이브로 옮긴다
- So: 실패한 가지를 다음 사이클의 학습 데이터(negative corpus)로 보존하기 위해

#### Acceptance Scenarios

Scenario 1: **앱 생사 판정**

- Given: apps/ 하위 20개 앱의 실사용 여부가 불명일 때
- When: 생사 판정 기준(진입점 연결·최근 수정·의존 관계)으로 분류하면
- Then: live / archive 판정이 근거와 함께 기록되고, archive 대상은 삭제가 아니라 이동된다

### User Story 4: 위생 반사가 운영에 내장된다

- As: soloforce에서 작업하는 에이전트는
- I: 산출물 완성 직후 자기검증 루프(sip 상당)를 관례로 수행한다
- So: 품질이 작성자의 세션 내 판단에 의존하지 않기 위해

#### Acceptance Scenarios

Scenario 1: **스킬 설치와 규약 문서화**

- Given: paperthin 스킬(hate, re0-plan, ssotize 등)이 프로젝트에 설치되어 있을 때
- When: 사이클을 개시·마감하면
- Then: re0-plan으로 열고, 변경 후 검증 패스를 거치고, 릴리스 전 체크리스트를 지키는 관례가 CLAUDE.md에 명문화되어 있다

## Requirements (mandatory)

### Functional Requirements

- FR-1: 사실 단위 SSOT 감사 결과물(발생 위치 · 종류 · 조치 표)이 존재해야 한다
- FR-2: README 4종은 역할이 겹치지 않게 재정의되고, 겹치는 사실은 정본 참조로 바뀐다
- FR-3: apps/ 전 항목의 live/archive 판정표가 근거와 함께 기록된다
- FR-4: 아카이브는 이동이며, 이동 사유(cause of death)가 함께 기록된다
- FR-5: 핵심 문서는 콜드리드 검증을 통과한다
- FR-6: 사이클 운영 규약(개시→검증→릴리스)이 CLAUDE.md에 반영된다

### Non-functional / 원칙 제약

- NFR-1(절제): 개선이 증명되지 않는 표면은 건드리지 않는다 — 재설계 ≠ 전면 재작성
- NFR-2(감사 우선): 모든 변이는 읽기 전용 감사 → 계획 보고 → 승인 후 실행 순서를 지킨다
- NFR-3(edit-safety): 타깃 존재 확인, 발생 위치별 치환, 대규모 구조 이동은 스크립트로
- NFR-4(동작 보존): 재설계 중 기능 동작은 변하지 않는다 (문서·구조·규약의 재설계)

## Out of Scope

- 신규 기능 추가, UI 개편, 성능 개선
- src 코드의 아키텍처 리팩토링 (2차 사이클 후보 — 이번 스코프는 문서·구조·운영 규약)
- soloforce2와의 코드 병합 전략 (별도 결정)

## Success Criteria

1. 임의의 운영 사실 5개를 골랐을 때 각각 정본이 1곳으로 답해진다
2. 콜드리드 서브세션이 README만으로 설치~실행을 오해 없이 재서술한다
3. apps/ 판정표에 미분류 항목이 없다
4. 재설계 커밋들이 감사→승인→실행 흔적을 남긴다 (NFR-2 준수 증명)

## Open Questions

- [ ] README 4종 중 정본 후보(README.md 유지 vs 재편) — ssotize 감사 후 결정
- [ ] .moai/specs와 .re0/iteration의 이중 계획 체계 통합 여부
- [ ] 아카이브 위치 규약: `archive/` 루트 vs `ops/archive/`

## Scope Decision (2026-08-28)

- 진실 기준은 **리포 기준 정본화**로 확정: 라이브 시스템/형제 리포와의 대조는 스코프 아웃, 별도 사이클로 이월.
- 한계 명기: 본 재설계의 콜드리드·SSOT 성공 기준은 리포 내적 일관성을 검증하며, 운영 현실과의 일치는 보증하지 않는다.
