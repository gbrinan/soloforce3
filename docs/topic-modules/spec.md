# Feature Specification: 주제 모듈

## Overview

사업 주제(business line) 하나를 정하면 영업·소통·물류·뉴스 정찰이 그 주제로 돌아가게 하는 모듈. 지금까지 SPF 전용으로 손으로 엮었던 에이전트·스킬·루프를 «역할 + 주제 설정»으로 바꾸고, SPF는 그 첫 사용 예가 된다. 이후 영업·마케팅·고객 지원·운영·브리핑 모듈(knowledge-work-plugins 이식)이 같은 틀에 올라간다.

## User Scenarios & Testing (mandatory)

### User Story 1: 새 주제 시작

- As: 아난은
- I: 주제 설정 파일 하나(이름·지식 파일·저장 위치·입력·일정)를 쓰면 그 주제의 아침 브리핑·뉴스 정찰·메일 스캔이 돈다
- So: 사업마다 에이전트를 새로 만들지 않기 위해

#### Acceptance Scenarios

Scenario 1: **설정 검사**

- Given: `history/topics/<id>.yaml`을 썼을 때
- When: 검사기를 돌리면
- Then: 형식 오류는 필드 경로와 이유로 알려 주고(값은 출력하지 않음), 업무 맥락의 사업 단위에 없는 주제 id는 경고한다

Scenario 2: **주제별 루프**

- Given: 주제 설정에서 루프 템플릿을 켰을 때
- When: 루프 로더가 돌면
- Then: `<주제>-<템플릿>` 루프가 생기고, 프롬프트에 그 주제의 저장 위치·입력·지식 파일이 들어간다

### User Story 2: SPF를 예시로 옮김

- As: 아난은
- I: SPF가 모듈 + SPF 주제 설정으로 지금과 같은 결과를 내는 것을 확인할 수 있다
- So: 일반화가 기존 업무를 깨지 않았음을 믿기 위해

#### Acceptance Scenarios

Scenario 1: **등가 검증**

- Given: 모듈과 SPF 주제 설정이 있을 때
- When: SPF 루프 5개의 프롬프트를 만들면
- Then: 지금 라이브 루프 프롬프트와 비교한 차이는 의도한 것(주제 블록 위치·역할 이름)만 남는다

### User Story 3: 일정을 에이전트가 읽음

- As: 모듈 역할 에이전트는
- I: soloforce 일정과 아난다라 교육 일정을 읽기 전용 도구 하나로 조회한다
- So: 미팅 제안이 기존 일정과 겹치지 않게 하기 위해

## Requirements

- 공개 리포에는 사업 실제 값(거래처·경쟁사·Notion ID·메일 라벨)을 두지 않는다. 값은 `history/topics/`(gitignore).
- 외부로 영향을 주는 동작은 Stage 4 승인 계약을 따른다.

## Success Criteria

- 주제 설정 검사기·모듈 로더·등가 검증이 모두 종료 코드로 판정된다.
