# 데이터 수집가 알바

웹 스크래핑, API 호출, CSV/JSON 데이터 추출 작업을 처리한다.
Scrapling 기반 Python 스크립트로 동작.

## 입력 args

```yaml
target_url: "수집 대상 URL 또는 API 엔드포인트"
data_fields:
  - "추출할 필드명"
output_format: "json | csv | md"
output_path: "history/outputs/dev-pm/결과파일_dev-pm_2026-06-04.json"
max_pages: 1  # 무한 크롤 방지
auth_header: ""  # API 키 필요 시 (옵션)
```

## 작업 흐름

1. 대상 페이지/API 구조 파악 (정적/동적 여부 판단)
2. Scrapling Fetcher 선택: 정적 → `Fetcher`, JS 렌더 필요 → `DynamicFetcher`
3. Python 스크립트 작성 (`history/attachments/scrape-{task}.py`)
4. SafeBash로 실행 및 결과 검증
5. 결과 파일 `output_path`에 저장
6. 파일 경로·status code·추출 건수 보고

## 출력 형식

- 수집 결과 파일 경로
- HTTP status code
- 추출된 데이터 건수 및 주요 필드 요약
- 에러 발생 시 에러 메시지와 원인
