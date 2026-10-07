# 로컬 + Google Drive 저장 계약

이 문서는 두 저장소의 정본·판·동기화 규칙을 관리한다. 단계별 구현 여부는 [어댑터 상태](adapters.md)를 확인한다.

## 하나의 지식, 두 저장 위치

정본의 정체성은 `(workspace_id, knowledge_id, revision)`이다. 로컬 파일명이나 Drive 제목은 식별자가 아니다. 기본 방식은 **지정된 로컬 작업공간에서 변경을 확정하고 같은 판을 Drive에 복제**하는 것이다. 양쪽에서 독립적인 정본을 만들지 않는다. 기본 실행과 Soloforce2 모두 같은 방식이다.

로컬은 작업·오프라인 읽기·검증 위치다. Drive는 공유·보관·복구 위치다. Drive에서 받은 원본도 원격 파일 ID·판과 읽기용 로컬 사본을 연결한다. 원본이 Google 문서이면 export는 원본 자체가 아닌 변환 사본이다. 기본 원격 표현은 MD/JSON/원본 바이너리이며 Google Docs 자동 변환은 하지 않는다. 사람용 문서 변환은 별도 파생 뷰다.

## 저장 대상과 배치

```text
local workspace                         approved Drive folder (folderId)
  sources/originals/<source>/<revision>  sources/ 같은 source/revision
  sources/extracted/...                 extracted/ 같은 판
  candidates/<batch>/...                candidates/ (승인된 대상 범위만)
  snapshots/<revision>/                 snapshots/<revision>/
    knowledge/ + views/ + STRUCTURE.md + WORKFLOW.md     같은 내용과 manifest
  current.json                          current.json (완성된 snapshot 참조)
  sync/outbox + receipts                전달 영수증은 로컬, 비밀은 호스트 보관
```

이는 물리 저장 추가 규칙이며 기업·프로젝트 논리 배치는 contracts.md를 따른다. 같은 파일을 부서별로 복제하지 않는다. 이미지 golden sample은 원본과 최소 메타만 저장하고 자동 분석하지 않는다. 원본과 후보는 민감 자료를 포함할 수 있으므로 선택된 목적 폴더와 소유 범위 안에서만 복제한다. 공개 권한 생성이나 링크 공개는 기본 동작이 아니다.

## 전달 대상

설계서·역할 지시서 업로드는 실제 ingest 결과 저장을 대체하지 않는다.

확정한 범위의 원본 또는 원본 식별자/판/좌표, 읽기용 추출물, 분해된 니즈, 원문 인용, 처리·보류 목록, 목차, ASCII ERD, 부서별 ASCII 워크플로우(WORKFLOW.md), manifest를 같은 배치로 보관한다. 원본 전체에 다른 기업/개인 자료가 섞이면 범위 밖 원본을 자동 공유하지 않고 로컬 원본의 식별자·판과 범위 내 추출물을 전달한다. 원본 미복제와 추출물 저장을 구분해 manifest에 쓴다.

원격용 목차는 실제 생성된 Drive fileId/URL로 만든다. 로컬 상대 링크를 원격에서 그대로 사용할 수 있다고 가정하지 않는다. 두 목차는 같은 지식 ID/판을 참조하되 저장 위치에 맞는 링크를 가진다.


## 전달 게이트

1. 입력 해시를 다시 계산해 출처 판을 확인한다. 발견 범위와 분석 범위를 분리하고 대상 외 단위를 이월로 정산한다.
2. 후보의 인용을 원문 위치에서 다시 읽고 의미를 대조한다. 저장 상태는 candidate/current를 명시한다.
3. 로컬 manifest에 전달 파일별 SHA-256·크기·원본 판·배치 ID를 기록한다. manifest 자체와 사후 영수증은 자기 참조 해시 대상에서 제외한다.
4. 승인된 Drive 폴더에 ingest 파일을 저장하고 반환된 ID로 목차를 만든다. 업로드된 파일을 다시 읽어 비교한다. 텍스트 readback 비교와 바이너리 원본 검증을 구분한다.
5. 영수증에 로컬/원격 위치, 검사 방식, 파일별 비교 결과, 미전달 항목을 남긴다. 요청한 대상 파일이 모두 검증돼야 해당 범위에 한해 전달 완료다. 이 결과는 자동 동기화·장애 복구·다른 호스트 구현 완료가 아니다.


의미 판단의 통과 조건은 [의미 검토](contracts.md#의미-검토)가 관리한다. 호스트가 이 게이트를 실행하고 모순 후보를 current로 표시하지 않는다. 실패는 이전 결과를 유지하고 부분완료/보류로 보고한다.

## 저장 절차

1. 서버/호스트가 principal·기업·프로젝트·로컬 root·Drive connection/folderId의 연결을 확인한다. 요청자가 보낸 경로·폴더명만으로 접근을 허용하지 않는다.
2. 구조 검증과 의미 검토를 별도 수행한다. 원문 인용이 있는 잘못된 해석은 구조 검사만 통과할 수 있으므로 의미 검토가 pending이면 후보로만 저장한다.
3. expected base revision을 확인하고 프로젝트 단위 writer lock을 잡는다. 임시 로컬 snapshot을 만들고 해시·참조를 검증한 뒤 같은 파일시스템에서 current 포인터를 전환한다. 확정된 판의 업로드 작업을 durable outbox에 남긴다. 포인터/장부 간 크래시를 복구할 journal이 필요하다.
4. Drive에 immutable revision 폴더와 파일을 업로드한다. 매핑 키는 `(workspace, source-or-knowledge-id, revision, artifact-kind)`이며 Drive fileId를 기록한다. 제목 검색으로 기존 파일을 덮어쓰지 않는다.
5. 파일별 크기·다운로드 바이트 해시를 확인하고 manifest 완성을 확인한다. 큰 파일은 재개 가능한 업로드와 영수증을 사용한다. 업로드 성공 응답만으로 원격 전체판 완료를 선언하지 않는다.
6. 완성된 manifest가 있는 판만 Drive current에서 가리킨다. Drive 여러 파일의 갱신은 트랜잭션이 아니므로 두 저장소를 원자적 동시 저장이라고 부르지 않는다. 초기 버전은 작업공간당 단일 쓰기 호스트만 허용한다. 다중 호스트 전환은 writer 인계/중앙 lock 검증 후 확장한다.
7. `local_saved`, `drive_pending`, `drive_syncing`, `synced`, `conflict`, `failed`를 별도 보고한다. 두 저장소 요청의 완료는 같은 판이 `synced`인 경우다. Drive 실패 시 로컬 결과를 잃지 않으며 완료 보고 대신 부분완료를 반환한다.

## 재시도·외부 변경·복구

업로드 키·fileId·관측 판·content hash·시도 수·사유를 저장한다. 응답 유실 시 이미 생성된 파일을 조정해 확인한 뒤 재시도하고 중복 파일을 새 정본으로 노출하지 않는다. 429/5xx는 백오프, 인증/권한 해제는 access_pending, 예상하지 않은 원격 변경은 conflict다. 더 최신 modifiedTime을 무조건 승자로 고르지 않는다.

Drive 직접 편집은 다음 수집에서 변경 후보로 등록한다. 로컬 정본을 자동 덮어쓰지 않는다. 원격 삭제도 삭제 전파가 아니라 변경/접근 보류 사건이다. 로컬 복구는 지정한 완성 snapshot의 manifest·모든 파일 해시·권한을 검증한 뒤 수행한다. 옛 접근권한 캐시로 다른 기업 자료를 복구하지 않는다.

Drive 단절 시 일반 에이전트는 로컬 유효판을 읽을 수 있고 로컬 판과 원격 마지막 동기화 판을 보고한다. 다른 컴퓨터에서 Drive를 읽는 경우 그 컴퓨터는 완성된 원격 snapshot만 사용한다.

## 권한과 현재 연결

Google Drive 쓰기는 기존 읽기 전용 연결만으로 가능하지 않다. 파일별 권한인 `drive.file`을 우선 검토하되 앱이 생성/사용자 선택으로 허용받은 파일 범위에 한정되므로 임의 기존 폴더 전체에 쓰기 가능하다고 가정하지 않는다. 연결된 목적 폴더의 실제 생성·읽기·갱신 시험을 해야 한다. 추가 OAuth 동의는 구현 후 호스트 연결 흐름에서 처리한다. [공식 scope 설명](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

대용량 원본은 resumable upload를 사용한다. [공식 업로드 방식](https://developers.google.com/workspace/drive/api/guides/manage-uploads). 인증 토큰·재개 세션 비밀은 LLM 문맥이나 Wiki에 저장하지 않는다.
