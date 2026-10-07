# 가이드 인덱스 (마이크루 참조용)

사용자 질문을 받았을 때 어떤 가이드를 읽어야 하는지 판단하기 위한 라우팅 테이블.

## 가이드 라우팅

| 파일 | 커버 범위 | 예상 질문 키워드 |
|------|-----------|-----------------|
| `getting-started.md` | 대시보드 구성, 첫 화면, UI 영역 | 처음, 시작, 대시보드, 화면 구성, 어떻게 써 |
| `chat-basics.md` | 메시지 전송, 이미지 첨부, 응답 중단, 대화 기록, 큐 | 메시지, 채팅, 이미지, 사진, 중단, 멈춰, 대화 기록 |
| `task-delegation.md` | 직원 구성, 작업 위임, 진행 상태, 채용/해고 | 직원, 위임, 작업, 개발, 기획, 감사, 채용, 해고, 진행 상황 |
| `schedule.md` | 리마인더, 반복 스케줄, cron | 알림, 리마인더, 스케줄, 반복, 매일, 매주, cron, 예약 |
| `anandara.md` | 아난다라 교육 일정 등록·조회 API, 데이터 작업 절차 | 아난다라, 교육 등록, 일정 등록, 교육 일정, 정산 앱, anandara |
| `loops.md` | 루프(자동 반복 작업), 완료까지 반복, 예산·안전장치 | 루프, 자동화, 완료까지, 반복 작업, 자동으로 고쳐줘, 야간 자동, loop |
| `friends.md` | 동료 통신, 친구 추가/메시지 | 친구, 동료, 외부, 메시지 보내, 동료, 친구 추가 |
| `telegram.md` | 텔레그램 봇 연동, 페어링, 명령어 | 텔레그램, telegram, 봇, 페어링, pair, 외부 지시 |
| `mcp.md` | MCP 서버 설치·할당·런타임 (마이크루 직접, 워커 위임 금지) | MCP, 설치, 깔아, 서버, manage_mcp, playwright, 도구 추가, PPT MCP |
| `approval.md` | 승인 요청/처리, 부재중 모드 | 승인, 거부, 부재중, 확인 요청, 허락 |
| `auto-mode.md` | 자동/수동 모드 전환, 자율성 조절 | 자동, 수동, 모드, 알아서, 확인하면서 |
| `network-setup.md` | 외부 접속, 도메인, 터널 설정 | 네트워크, 도메인, ngrok, 터널, 외부 접속, URL |
| `troubleshooting.md` | 서버 장애, 무응답, 로그 확인 | 안 돼, 에러, 멈춤, 안 뜸, 재시작, 로그, 문제 |
| `document-generation.md` | Word/Excel/PPT 산출물 생성 (docx/exceljs/pptxgenjs), 출력 경로 컨벤션, 전달 방법 | 워드, 엑셀, ppt, 파워포인트, 문서, 산출물, 보고서 파일, docx, xlsx, pptx, 만들어줘 |
| `output-saving.md` | 산출물 저장 경로·파일명 규칙, wiki 5KB 제한 | 산출물, 저장, outputs, 파일명, 네이밍, 어디 저장, history/outputs |
| `report-format.md` | 5단 보고 형식, 검증 규칙, 남은 리스크 작성법 | 보고, 5단, 검증, 원인, 수정, 리스크, 보고 형식, 완료 보고 |
| `report-style.md` | 압축 보고 문체(caveman full), 압축 금지 항목, 적용 대상 | 압축, 문체, caveman, 토큰 절감, 보고 문체, 간결하게 |
| `corpus-gates.md` | 코퍼스 직원 공통 게이트(정산·역추적·미상 보존)와 하드 룰, 민감 판정법 | 게이트, 정산, 역추적, 미상, 민감 판정, 코퍼스 공통 |
| `ingest-pitfalls.md` | 코퍼스 적재 함정 12종(셀 밀림·병합·날짜 serial·부동소수 식별자·NFD 파일명·중복 판본·수식 파생값·산출기준·이미지 판독·민감도 판정·Duration 오해석·오류값 통과). 1~5·12는 client-corpus 저장소의 `_shared/xlsx.py`가 코드로 잡는다 — 클라이언트 코퍼스 작업이면 산문보다 그쪽이 먼저다 | 적재, 변환 이상, 열 밀림, 병합셀, 날짜 숫자, 중복 파일, 민감정보 판정, 코퍼스, 코퍼스키퍼 |
| `safefs-usage.md` | SafeRead/Write/Edit/Glob/Grep 올바른 사용법, 허용 경로 | SafeRead, SafeWrite, SafeEdit, 파일, 경로, 권한, MCP 파일 |
| `script-execution.md` | SafeBash로 Node/Python 스크립트 실행, 인터프리터 절대경로, 인자 전달·실패 처리 | SafeBash, 스크립트, node, python, 절대경로, PATH, 엔진 실행, 타임아웃 |
| `crew-lounge.md` | 크루 라운지 게시 절차(어댑터별), 아웃박스 파일 · CREW_POST 마커 | 크루 라운지, 라운지, 게시, crew-post, CREW_POST, 토론 |
| `wiki-memory.md` | 위키 기억 저장·관리 절차, WIKI 태그, MEMORY.md 인덱스 | 위키, 기억, WIKI 태그, 저장, 메모리, 페이지, history/agents |
| `skill-usage.md` | 스킬-알바 활용법, 템플릿 호출, 결과 회수 | 알바, 스킬, 템플릿, 위임, Agent, skill-templates, 일회성 |
| `user-research.md` | 사용자 리서치 모듈, 빠른/심층 조사 모드, 자동 반응 예측 첨부 | 페르소나, 사용자 조사, JTBD, LMF, 고객 인사이트, 예상 반응, 타겟 고객, 상세페이지 반응 |
| `web-reader.md` | 차단된/일반 웹페이지 본문 텍스트 수집, ReadWebPage 도구, Jina Reader 폴백 | 웹페이지 읽어줘, 크롤링, 스크래핑, 차단된 사이트, 본문 추출, ReadWebPage, 403, 페이월 |
| `metrics.md` | 작업 지표(성공률/재시도율/작업당비용) 계측, 모델 티어 변경 효과 측정, 지표 패널 | 지표, 성공률, 재시도율, 작업당비용, 모델 비교, metrics, 모델 티어, 품질 측정 |

## 라우팅 규칙

1. 키워드가 여러 가이드에 걸치면, 가장 구체적인 가이드를 우선 참조한다.
2. 친구 기능 관련 네트워크 문제는 `friends.md` → `network-setup.md` 순서로 안내한다.
3. 부재중 모드는 `approval.md`와 `auto-mode.md` 양쪽에 관련되므로, 질문 맥락에 따라 선택한다.
