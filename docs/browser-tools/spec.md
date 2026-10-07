# Feature Specification: 브라우저 도구층 + aside 패널 (D3)

## Overview
브라우저는 직원이 아니라 공유 도구층이다. 직원별 allowedTools로 선별 부여한다.

## 3형태와 착수 순서 (②→①→③)
1. ② 헤드리스 수집: scouts용 브라우저 도구(플레이라이트류) — 세션 격리 프로필
2. ① aside 관전 패널: 주기 스크린샷 캡처 → 기존 대시보드 WebSocket push → 사이드 패널 표시. 개입은 기존 승인 시스템 재사용: 민감 액션(제출·결제·전송 셀렉터/URL 분류) 직전 승인 요청 후 블록
3. ③ 실브라우저(확장) 연동: 별도 SPEC + 위험 검토 필수. 결제·전송류는 항상 사장님 개입

## 부여 계획 (allowedTools)
- scouts(ax/trend/repo/spf-news): ② | tester·CQO: ①② (실표면 증거) | Jarvis: ① (단건 링크 확인)

## Requirements
- FR-1: 브라우저 도구 어댑터 1종(헤드리스) + allowedTools 키 정의
- FR-2: 스크린샷 push 채널(기존 WS 재사용) + aside UI
- FR-3: 승인 게이트 연동(민감 액션 분류는 승인 시스템의 기존 분류 확장)

## Out of Scope
③ 실브라우저 연동(별도 SPEC), 모바일.
