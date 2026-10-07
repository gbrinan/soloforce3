# ASCII 구성도와 짧은 요약

Wiki를 신규 생성하거나 구조·소유 관계·분류를 바꿀 때 Wiki와 별도로 `STRUCTURE.md`를 생성한다. 이것은 contracts.md 및 실제 manifest/정본 관계에서 만든 읽기용 뷰다. 설계 ERD와 구현된 저장 엔진을 혼동하지 않는다.

## 논리 ERD

ASCII 도형과 영문 엔터티/키를 쓰고 한글 설명은 도형 아래에 둔다. `1`, `N`, `0..1`은 관계 수다. DB 도입을 요구하는 ERD가 아니라 Markdown 지식의 논리 관계다.

```text
[ORGANIZATION] 1 ---- N [PROJECT] 1 ---- N [KNOWLEDGE]
 org_id PK              project_id PK     knowledge_id PK
                        org_id FK         project_id FK
       |                                       |
       1                                       1
       |                                       |
       N                                       N
[DEPARTMENT] 1 -- N [KNOWLEDGE_DEPT] N -- 1 [KNOWLEDGE_REV]
 dept_id PK                                (knowledge_id, rev) PK
 org_id FK                                      |
                                                1
                                                |
                                                N
                                           [DETAIL]
                                            detail_id PK
                                            knowledge_id, rev FK
                                                |
                                                1
                                                |
                                                N
[SOURCE_REV] 1 --------------------------- N [EVIDENCE]
 (source_id, rev) PK                         evidence_id PK
 source_hash                                detail_id FK
 locator_scheme                             source_id, rev FK
                                            locator

[PATTERN] 1 -- N [PATTERN_MEMBER] N -- 1 [KNOWLEDGE_REV]
 pattern_id PK    pattern_id FK             |
                  knowledge_id, rev FK      N
                  detail_refs              |
                  match_reason             1
                                         [KNOWLEDGE]

[MODE] 1 -- N [VIEW_REF] N -- 1 [KNOWLEDGE_REV]

[PRINCIPAL] 1 -- N [GRANT] N -- 1 [PROJECT]
                   |                        |
                   +--- filter first -------+
                            |
                  [AUTHORIZED CONTEXT PACKET]
```

knowledge_id는 판이 바뀌어도 유지한다. 상세 조건은 DETAIL에, 명시된 근거는 EVIDENCE에 남긴다. 패턴은 여러 기업의 정본을 참조하는 묶음이다. GRANT는 접근 계약을 표현하며 실제 서비스의 권한 검증 구현 여부는 별도로 적는다. domain도 department와 동일한 다대다 연결이며 편집 값은 contracts.md에 정의한다.

## 배치별 구성 요약

생성된 STRUCTURE.md에는 다음만 짧게 쓴다.

- 이 구성도의 revision과 사용한 manifest/관계 파일.
- 기업·프로젝트·부서와 정본의 실제 구성. 여러 회사가 한 원본에 있으면 각각 표시.
- 원본 파일 수, 원본 요구 블록 수, 분리한 하위 절 수를 서로 다른 단위로 표시. 이를 모두 '니즈 수'로 부르지 않음.
- 공통/유사 패턴의 정본 참조 방식과 네 활용 모드.
- 승인 범위·보류 자료·미검증 기능.

실제 ERD의 엔터티와 멤버십도 출력 사용자의 권한으로 제한한다. 권한이 없는 기업을 ERD나 통계에서 노출하지 않는다. 정본 갱신에 맞춰 이 뷰를 재생성한다.

## 저장된 이미지 참조

```text
PROJECT 1 --- N STORED_REFERENCE N --- 1 ASSET_REV
TASK N --- N REFERENCE_POINTER (read only when needed)
```

이미지 등록 단계는 최소 정보와 원본 참조만 저장한다. 관찰·평가 기준은 필요에 따라 별도 요청한 작업의 산출물이다.

## 부서별 ASCII 워크플로우

모든 ingest 전달 배치에는 `WORKFLOW.md`를 저장한다. STRUCTURE.md는 지식의 구조·참조 관계, WORKFLOW.md는 부서/담당 기능 사이의 업무 진행·전달·판단·반복을 표현한다. 둘은 같은 산출물이 아니다.

WORKFLOW.md에는 기업/프로젝트, workflow revision, 근거로 사용한 source/knowledge ID와 revision, ASCII 코드 블록, 간략 설명, 미확인 연결을 넣는다. 부서명은 원문 명시 여부를 표시하고 이름이 없으면 '담당 기능, 부서명 미확인'으로 쓴다.

ASCII 선은 `-->` = 원문에서 확인된 순서/전달, `..>` = 해석 또는 연결 제안으로 범례를 붙인다. 노드가 원문에 있다고 노드 사이 화살표도 확인된 것으로 간주하지 않는다. 판단 분기·예외·사람의 최종 결정을 보존한다. 단계별로 근거 ID 또는 원문 좌표를 연결한다. 관계 근거가 부족하면 억지로 선을 만들지 말고 독립 노드와 '연결 미확인'을 저장한다. 이미지 저장 전용 배치도 분석 생략과 저장→필요 시 참조 경로만 표시한다.

WORKFLOW.md를 로컬·Drive 전달 목록과 manifest에 포함하고 목차에서 연결한다. 원문·니즈·관계 변경 시 영향받는 workflow revision을 갱신하고 이전판을 보존한다. 저장 후 코드 블록/범례/출처/미확인 상태와 원격 readback을 확인한다. 통합 자동 생성기는 아직 없으며 현재는 호스트가 의미 관계를 검토해 만들고 스크립트/도구가 저장·비교한다.
