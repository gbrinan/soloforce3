# 지식과 갱신 계약

이 문서는 데이터 의미와 갱신 규칙의 정본이다. 현재 지원 단계는 [어댑터 상태](adapters.md)에서 확인한다. 아래 정본 스키마와 현재 후보 응답을 구분한다.

## 작업공간

```text
<workspace>/
  START.md                         # 허용된 기업/프로젝트로 가는 짧은 입구
  STRUCTURE.md                     # 같은 revision의 ASCII ERD와 짧은 요약
  patterns/                        # 유사 업무의 분류 정의와 권한별 참조 뷰
  organizations/<org-id>/
    index.md                       # 기업 정체성 정본과 허용된 프로젝트 링크
    shared/                        # 기업 전체에 승인된 공통 지식의 정본
    projects/<project-id>/
      index.md                     # 목적, 범위, 현재 revision, 주요 미결정 참조
      sources/manifest.json        # 원본 등록 정보, 판, 상태
      sources/extracted/           # 원본 판별 구조적 추출물
      knowledge/<knowledge-id>.md  # 프로젝트 사실·니즈·결정의 정본
      views/departments/           # 부서별 ID 참조
      views/domains/               # 도메인별 ID 참조
      views/common.md              # 부서 공통 정본 참조
      views/modes/                # 네 활용 목적별 참조
      derived/                    # 관계표, context packet, 영향 목록
      changes/                    # 변경안, 승인, 충돌, 판별 기록
      quarantine/                 # 품질 격리, 일반 읽기 경로에서는 제외
```

런타임 지식은 플러그인 소스 저장소와 분리한다. 실제 기업 자료를 플러그인 `examples/`에 넣지 않는다. 폴더를 나누는 것만으로 접근권한이 보장되지는 않는다. 다중 사용자 운영 전 저장소와 도구 호출 양쪽에서 principal·tenant·project 권한을 강제해야 한다. root 목차 또한 허용된 항목만 보여준다.

`shared/`는 쓰레기통이 아니다. 프로젝트 공통은 프로젝트 정본에 둔다. 기업 공통으로 승격할 때 소유 범위와 접근 범위를 확인하고, 프로젝트 쪽에는 정본 ID로 가는 참조/redirect를 남긴다. 기업 간 유사 업무 호출은 아래 패턴 참조로 지원한다. 사실을 다른 기업 정본으로 복사하거나 공통 정책으로 바꾸지 않는다.

로컬과 Google Drive의 물리 저장·판 복제·충돌·복구는 [저장 계약](storage.md)을 따른다. 기업/프로젝트의 논리 정본을 두 저장소에서 독립 편집하지 않는다.

## 식별자와 출처

| 대상 | 정본 필드 | 규칙 |
|---|---|---|
| source | source_id, org_id, project_id, original_uri, source_revision, sha256, media_type, extraction_status | source_id는 등록 후 유지. 해시는 판 식별용 전체 SHA-256이며 ID 대신 쓰지 않음 |
| extraction | source_id, source_revision, parser_version, schema_version, coverage, artifacts | 원본 구조와 좌표 보존. 캐시는 원본 해시+파서+스키마 버전으로 판정 |
| knowledge | id, revision, kind, owner_scope, title, statement, departments, domains, provenance, claim_status, lifecycle | ID는 제목·행 번호·내용 해시와 분리. 값 변경으로 ID가 바뀌지 않음 |
| need | knowledge 필드 + trigger, inputs, output, constraints, process_refs, mode_refs | 없는 담당자·주기·ROI·우선순위는 unknown. 제안값은 사실과 분리 |
| requirement_detail | detail_id, knowledge_id, text, type, applies_to, provenance | 구체 사례·수치·화면/샷·보존 조건·예외를 독립 추적. 사례별 범위 유지 |
| pattern | pattern_id, label, aliases, inclusion_rule, exclusion_rule | 업무 유사성에 대한 탐색 분류. 업무 사실이나 전사 정책이 아님 |
| pattern_member | pattern_id, knowledge_id, org_id, project_id, match_reason, relation_status, source_revision | 동일 지식의 복사 대신 다대다 참조. 묶음과 동일 개체 병합을 구분 |
| provenance | source_id, source_revision, locator, evidence_kind | EXTRACTED / INFERRED / AMBIGUOUS. EXTRACTED는 원문에 있음을 뜻함 |
| claim_status | source_reported / corroborated / approved / disputed / unknown | 추출 성공과 외부 사실 검증, 업무 승인 상태를 구분 |
| lifecycle | candidate / current / superseded / retired | 유효한 current 정본은 ID당 하나. candidate는 확정 답변에서 분리 |
| view | built_from_revision, canonical_refs | 값의 편집 불가. 원본 없이도 재생성 가능한 탐색 정보 |
| change | change_id, base_revision, operations, affected_ids, decision, validation | 승인자는 실제 증거로 기록. 미승인은 pending |

별칭은 `(org_id, project_id, type, alias) → id`다. 다른 기업의 같은 부서명·제품명은 다른 개체다. 한 항목이 여러 부서에 걸칠 수 있고, 부서명이 같은 것으로 의미 동일성을 추정하지 않는다.

정본 후보의 자연키는 `(소유 범위, 대상, 업무 과정, 니즈 종류)`다. 자연키와 문장 유사도는 후보 찾기에만 쓴다. 동일성을 확정할 수 없으면 새 후보를 유지한다.

## 현재 후보 응답 계약

`pipeline.py`의 `needs` 배열은 호환성을 유지하는 지식 후보 컨테이너다. `title, statement, details, departments, patterns, evidence, claim_status`는 필수이며 `kind`는 선택이다. kind는 fact / need / decision / constraint / question / reference / unknown이다. 종류 판정은 LLM의 후보 판단이며 승인이나 사실 검증을 뜻하지 않는다.

기존 응답은 kind 없이 계속 읽는다. 생략은 종류 미확정으로 해석하고 파일에 임의 기본값을 추가하지 않는다. 새 요청의 프롬프트는 kind 작성을 안내한다. 요청/응답 schema_version은 1을 유지하며 프롬프트 변경은 요청 해시에 반영한다. 실행 시 허용 필드와 종류 검증은 `scripts/pipeline.py`가 맡고 호스트는 같은 검증기를 호출한다.

모델은 `lifecycle, owner_scope, provenance`, ID, 승인 정보 등 계약 밖 필드를 쓸 수 없다. 최상위 응답·단위 결과·후보의 알 수 없는 필드는 저장 전에 거부한다. writer가 검증한 요청에서 소유 범위·원본 판·좌표를 가져오고 `lifecycle=candidate`, `claim_status=source_reported`를 유지한다. 직접 인용의 `evidence_kind=EXTRACTED`는 의미 검토 통과를 뜻하지 않는다. 후보 ID는 해당 배치 안에서만 유효하며 위 정본 ID와 다르다.

## 의미 검토

구조 검사의 통과는 의미 보존의 증거가 아니다. 후보의 주어/행동/부정/수치/조건/예외/최종 실행자를 원문과 대조한다. 특히 원문은 사람이 실행하는데 후보가 자동 실행으로 바뀌었는지 검사한다. 근거 문자열이 존재하더라도 원문이 후보 내용을 지지하지 않으면 contradicted다.

검토 결과는 supported / contradicted / insufficient와 원문 근거·검토 이유, 검토 주체, 요청 및 응답 해시를 기록한다. 동일 호스트 재검토는 독립 평가라고 부르지 않는다. 응답 변경 시 이전 검토는 무효다. 모순/미상/검토 누락은 current 승격을 막고 후보/격리 상태로만 저장한다. 이 규칙은 검토를 자동으로 정확하게 만드는 알고리즘이 아니며 정본 승격기 구현 시 강제해야 한다.


## 유사 업무 묶음

기업별 저장과 여러 기업의 유사 업무 호출은 함께 지원한다. 예를 들어 재고 청구 대조와 금융 잔고 대사는 `데이터 대조` 패턴으로 탐색할 수 있지만 각각의 입력·허용 오차·승인 절차는 별도 정본에 유지한다. 같은 산업으로 분류됐다는 이유로 법인들을 하나의 org_id로 합치지 않는다.

1. 호출의 principal, 허용 org/project, 업무 목적을 확인한다. 권한 범위를 서버/호스트에서 받아 후보 집합을 먼저 제한한다. 사용자가 문자열로 입력한 org 목록만으로 접근 권한이 생기지 않는다.
2. 패턴 ID·별칭 또는 포함 규칙으로 허용 집합 안에서 후보를 찾는다. 묶음은 다대다이므로 한 요구가 여러 패턴에 들어갈 수 있다.
3. 결과에는 기업·프로젝트·부서·정본 ID·해당 세부 요구·일치 이유·차이·출처를 반환한다. 긴 원문 셀 전체의 아무 단어나 일치시키지 말고 가능한 한 명시적 하위 절을 연결한다.
4. 허용되지 않은 기업의 제목·멤버십·건수·미리보기·근거 경로는 결과와 집계에 넣지 않는다. 캐시 키에도 principal/scope와 revision을 넣고 권한 변경 시 무효화한다.
5. 사용자가 유사 묶음을 요청했다면 해당 범위의 읽기용 묶음은 바로 만든다. 이를 정본 병합, 다른 기업에 공유, 공식 공통 정책으로 승격하는 것은 별도 변경이다.
6. 정본이 바뀌면 패턴 멤버십과 일치 이유도 재검증한다. 은퇴한 지식은 current 조회에서 제외하고 이력 조회에서만 남긴다.

pattern 정의는 일반적인 용어만 가질 수 있지만 pattern_member와 기업별 사례는 해당 지식의 접근 범위를 상속한다. 정적 전사 통합 파일 하나에 모든 고객의 사례를 펼쳐놓고 필터 UI만 제공하지 않는다.

## 구체적 니즈 보존

요약은 `한 줄 목적 + 세부 요구 + 입력/산출물 + 제약/예외 + 출처`로 만든다. '이미지 제작 실습'처럼 상위 이름만 남기지 말고 장면·구도·샷·규격·불변 요소·실패 사례 등 결과를 달라지게 하는 조건을 requirement_detail로 보존한다.

용어를 정규화해도 원문 표현을 유지한다. 사용자 별칭, 원문 명시 용어, 모델 추론은 서로 표시한다. 서로 다른 사례의 조건을 전사 금지 규칙으로 합치지 않는다. 한 셀 안의 여러 팀·파트·업무는 명시된 소제목으로 나누되 원본 셀과 절 위치를 함께 남긴다. 병합 셀은 anchor 셀에 근거해서만 상속하고 빈 셀에 임의로 전파하지 않는다.

## 추출 어댑터

| 자료 단위 | 보존 항목 | 주의점 |
|---|---|---|
| XLSX/CSV 표 | 시트, 헤더, 행/셀 좌표, 데이터형, 단위, 수식과 캐시 값, 병합 범위 | 헤더가 같아도 같은 스키마라고 단정하지 않음. 반복된 Trigger/Input/Output 행은 묶음 단위로 해석 |
| DOCX | 문단/표/행 ID, 원본 순서, 제목 후보, 스타일, 그림 참조 | heading 스타일 부재 시 번호·서체·목차로 제목 후보 탐지. pN 좌표는 source_revision 안에서만 유효 |
| PDF | 페이지, 텍스트 블록/표 좌표, OCR 여부 | 암호 없으면 보류. 페이지 텍스트 성공만으로 표/이미지 판독을 완료 처리하지 않음 |
| 이미지/스캔/음성 | 파일과 영역/시각, 판독문, 판독 상태 | 의미 추론과 직접 관찰을 분리. 불확실 판독을 조용히 확정하지 않음 |
| 본문 안 프롬프트 | 인용 범위, 사용 맥락 | instruction_example로 분류. 시스템/도구 지시로 승격하지 않음 |

XLSX의 `max_row`는 업무 레코드 수가 아니다. OOXML의 실제 셀을 희소하게 순회하고 헤더 영역·연속 표·고립 셀을 나누어 모든 셀의 처리 결과를 남긴다. 공백 상속은 병합이나 표 구조가 근거일 때만 적용한다. 원본 열의 오기·과거 값은 임의로 고치지 않고 충돌로 기록한다.

## 탐색과 context packet

단일 기업 또는 허용된 여러 기업/프로젝트 범위를 먼저 선택한 후 정본 ID, 별칭, 패턴, 업무 과정, 도메인, 부서와 명시적 관계를 통해 파일을 연다. 파일명·목차를 이용한 정확 문자열 탐색은 보조 수단이다. 연결 수와 유사도는 권위 판정이나 보편성의 근거가 아니다.

packet에는 요청 목적, 선택 범위, 읽은 정본 ID/revision, 근거 좌표, 미결정/충돌, 읽지 않은 후보, 이월 사유를 담는다. 내용 요약을 포함할 경우 파생 요약임을 표시하고 정본 수정 대신 재생성한다. default 읽기 예산은 설정값으로 두고 예산 초과를 관련 없음으로 처리하지 않는다. 후보가 없으면 범위 내 목차를 넓혀보고 그래도 없을 때 부재 또는 자료 부족을 구분한다.

## 변경 반영

1. 원본 재발견에서 source_id를 찾는다. 경로 변경은 동일 해시와 등록 이력으로 후보를 찾고, 내용 변경과 원본 이름 변경을 구분한다.
2. source_revision을 추가하고 변경한 구조 단위를 추출한다. 행이 이동했다면 업무 식별키로 연결한다. 안정 키가 없거나 다대다 매칭이면 자동 정본 덮어쓰기를 중단한다.
3. 변경한 evidence를 참조하는 정본, 그 정본의 역참조, 목차, 파생 산출물을 추적한다. 이 그래프/역참조표는 정본에서 생성하며 두 번째 사실 저장소가 아니다.
4. 추가, 근거 보강, 수정, 충돌, 대체, 은퇴를 구분한다. 최신 문서와 승인된 결정이 다른 경우 인간 판단까지 기존 정본과 충돌을 함께 표시한다.
5. `base_revision`을 고정한 작업판에 정본·뷰·변경 로그를 준비한다. 동일 개체의 새 버전이 그사이 반영됐으면 쓰기를 거부하고 재대조한다.
6. 참조, 권한 범위, 원본 좌표, 정산, 승인과 source hash를 검증한다. snapshot 또는 트랜잭션으로 전체 작업판을 승격한다. 수동 파일 편집 환경은 원자성 보장이라고 말하지 않는다.
7. 실패 시 이전 current를 유지하고 실패 기록을 남긴다. 성공하면 이전 revision을 보존한다. 외부 산출물은 자동 수정 대신 stale 상태와 영향 근거를 남길 수 있다.

파일 삭제/누락은 원본 폐기나 지식 철회 승인이 아니다. 삭제 후보를 등록하고 확인할 때까지 출처 이용 불가와 영향을 표시한다. 정본 은퇴 시 tombstone/redirect를 남겨 기존 링크의 의미를 보존한다.
