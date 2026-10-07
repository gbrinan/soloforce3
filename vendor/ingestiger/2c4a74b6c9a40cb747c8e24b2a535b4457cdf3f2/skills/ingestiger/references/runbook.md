# 현재 구현의 운영 명령

이 문서는 실행 환경에 종속된 명령을 관리한다. 상위 절차는 [실행 스킬](../SKILL.md), 구현 상태는 [어댑터 상태](adapters.md)를 따른다.

## 실행 가능한 최소 경로

호스트 직원의 역할은 agent/role-directive.md에서 등록하고 스킬의 절차를 연결한다. 아래 prepare 프롬프트는 선택한 원문 단위의 후보 생성 단계만 지시한다. 역할의 조회·저장·전달 지시를 후보 JSON 응답에 섞지 않으며, 역할 등록과 후보 요청 전달은 각각 확인한다. 적용 기간·관계 판단·미확인 범위를 보존하도록 프롬프트를 보완해도 실제 모델의 준수 여부는 별도 검증한다.

스킬 폴더 기준 `scripts/pipeline.py`는 Python 표준 라이브러리로 실행한다.

```sh
python3 scripts/pipeline.py extract-xlsx input.xlsx extracted.json --source-id S01 --org company-id --project project-id
python3 scripts/pipeline.py prepare scoped-units.json requests.json --model host-agent --max-chars 12000
python3 scripts/pipeline.py build request.json response.json fresh-candidate-directory
```

1. `extract-xlsx`는 원본을 수정하지 않고 희소 셀과 병합 범위, 수식/저장된 값, 숨김 상태, 미판독 media 목록을 JSON으로 만든다. XLSX 전용이며 다른 형식은 어댑터 경로를 먼저 확인한다.
2. `scoped-units.json`은 추출물 중 **소유 기업/프로젝트가 확정된 구조 단위**다. 여러 기업이 한 파일에 있으면 분리한 뒤 prepare한다. LLM이 범위를 추론했으면 후보 상태를 표시하고 호스트의 허용 범위와 대조한다. 원문 전체 정산에서 제외한 단위·헤더·이미지도 별도로 남긴다.
3. 각 unit은 `unit_id, locator, text`를 가진다. 파일에는 `source_id, source_revision, org_id, project_id, units`가 필요하다. `structure`에는 단위를 이해하는 데 필요한 헤더 값·병합 anchor·부서 문맥을 명시한다. 자동 추출만으로 이 의미 문맥이 완성되지는 않는다.
4. prepare는 `requests` 배열을 만든다. 호스트 에이전트가 **각 요청을 LLM으로 읽고** `request_id, results` 응답을 작성한다. 기존 에이전트 LLM을 사용하므로 별도 API 키가 필요 없다. 이 CLI 자체에는 모델 API 호출/자동 재시도 기능이 없다. 응답 형식은 요청의 prompt를 따르고 필드 의미·선택 kind·이전 응답 호환성은 [후보 계약](contracts.md#현재-후보-응답-계약)을 따른다.

요청 전체 바이트 한도는 `--max-bytes 98304`로 지정한다. 큰 구조 단위를 제외하고 나머지부터 진행할 때만 `--defer-oversized`를 추가하고 결과의 `pending_units`를 처리 장부에 남긴다. requests만 복사하고 보류 목록을 버리면 전체 완료로 보고할 수 없다. LLM에는 요청 객체를 compact JSON으로 전달하며, 실제 모델의 토큰 한도와 추가 시스템 문맥은 호스트에서 별도로 확인한다.
5. build는 요청 ID, 전체 단위 정산, 중복, 인용문 실제 존재와 주장 상태를 검사한 뒤 후보 JSON과 참조 목차를 만든다. 실패는 현재 Wiki를 바꾸지 않는다. 후보 ID는 배치 내 ID이며 기존 Wiki의 안정 ID와 같다고 간주하지 않는다.
6. 의미 검토 후 기존 정본 ID와 대조해 승인된 변경 범위만 반영한다. build 출력 이후의 호스트 작업과 자동화 여부는 어댑터 상태를 확인한다.

요청 해시는 원문 단위·출처 판·범위·모델 표기·프롬프트·스키마를 포함한다. 같은 요청 ID의 검증된 응답만 재사용한다. 현재는 캐시 키만 제공하며 자동 캐시 저장·조회나 모델 버전 검증을 구현하지 않았다. 모델 표기에는 호스트가 확인한 버전/설정을 기록한다. 변경 원문은 재분석하고, 영향받지 않은 정본은 유지한다.

`max-chars`는 unit 본문 문자 예산이다. 토큰 예산이나 구조 문맥 포함 총 요청 크기 보장이 아니다. 큰 단위는 자동 절단 대신 분할을 요청하며, 헤더 문맥은 호스트가 별도 예산 안에서 붙인다.


## Windows와 한글 파일

명령은 `skills/ingestiger` 폴더에서 실행한다. Windows에서는 아래처럼 `python -X utf8`을 사용하고 실제 승인된 파일 경로로 바꾼다. 모든 JSON/Markdown 파일 입출력은 UTF-8을 명시한다. Python 경로 확인은 `python --version`으로 한다. `prepare`가 반환한 requests 배열에서 요청 하나를 `request.json`으로 분리하고, 호스트 LLM이 그 요청에 맞는 response.json을 만든 뒤 build한다.

```powershell
python -X utf8 scripts/pipeline.py extract-xlsx "C:\자료\입력.xlsx" extracted.json --source-id S01 --org company-id --project project-id
python -X utf8 scripts/pipeline.py prepare scoped-units.json requests.json --model host-agent --max-chars 12000
python -X utf8 scripts/pipeline.py build request.json response.json fresh-candidate-directory
```

기존 request.json은 기록된 프롬프트와 해시를 유지한 채 검증할 수 있다. 새 프롬프트로 요청을 다시 만들었다면 새 request_id로 응답을 작성해야 한다. 응답의 알 수 없는 필드는 거부되며 후보가 스스로 current나 승인 상태를 지정할 수 없다. `validation.json`의 구조 통과는 의미 검토·정본 반영 완료가 아니다.

## 링크와 발표자료 구조

```sh
python3 scripts/link_audit.py sanitized-sheet.json audit.json
python3 scripts/deck_inventory.py input.key inventory.json
python3 scripts/deck_inventory.py input.pptx inventory.json
```

시트의 선택 role 입력은 [원본 품질 계약](source-quality.md)을 따른다. role이 없으면 unknown이고 셀별 명시값이 시트 기본값보다 우선한다. Windows에서는 위 명령의 `python3`을 `python -X utf8`로 바꾼다.

## 이미지 레퍼런스

```sh
python3 scripts/golden.py register sample.jpg /approved/project/golden --id GS001 --org company --project project --selection-quote '실제 사용자 선정 발언'
python3 scripts/golden.py render /approved/project/golden/GS001
python3 scripts/golden.py packet /approved/project/golden/GS001 reference-pointer.json --org company --project project
```

사용자가 광고용으로 확인한 경우에만 register에 `--channel sns-ad`를 덧붙인다. 생략·재등록·판 변경은 [이미지 저장 계약](golden-samples.md)을 따른다. Windows에서는 `python -X utf8`과 승인된 Windows 경로를 사용한다.

## 검토된 후보의 정본 구성

`knowledge.py`의 `compose(previous, candidate, review)`는 검증된 입력에서 파일 문자열과 manifest 해시를 반환하는 공용 함수다. 독립 CLI로 current를 쓰지 않는다. Soloforce2는 `/api/wiki/reviews`에서 인간 결정을 기록하고 `/api/wiki/commit`에서 원본·기준 판을 재검사한 뒤 잠금 아래 반영한다. `/api/wiki/knowledge/:id`에서 같은 ID·판·조건·근거를 재조회한다. 실행·복구 절차는 호스트 운영 문서를 따른다.
