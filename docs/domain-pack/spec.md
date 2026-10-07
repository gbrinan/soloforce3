# Feature Specification: 도메인 팩 포맷 (SPF 역설계)

## Overview
고객·업무 도메인 단위 기능 묶음을 팩으로 정의한다. 포맷은 SPF의 현재 실물에서 역설계했다. 물리 분리는 둘째 도메인(교육 팩 — 이월 결정 2026-08-31) 착수 시.

## 팩 구조 (SPF 실물 대응)
```text
<pack>/
├ manifest.json      # id·이름·버전·필요 권한·의존 앱
├ agents/<id>/       # meta.json + role-directive.md  (SPF: sales·logistics·news-scout·comms 4명)
├ loops/*.yaml       # cron 루프                        (SPF: 5개, retired 1)
├ app/               # 대시보드 앱                       (SPF: apps/spf)
└ skills/            # 팩 전용 스킬 (SKILL.md 규약, validateSkillSpec 통과 필수)
```

## Requirements
- FR-1: 팩 설치 = 동적 스캔 확장(~/mycrew-apps 방식)을 agents/·loops/까지 적용
- FR-2: 팩별 형상관리 repo(fbpw 구조) + paperthin 재작성 + /shower→/hate + 스킬 검증 훅 (P2 절차)
- FR-3: 팩 제거는 삭제가 아니라 비활성(negatives-as-corpus)
- NFR-1: 팩은 본체 직원 id와 충돌 금지(레지스트리 id 미충돌 규칙 재사용)

## Out of Scope
동적 스캔 코드 구현(별도 사이클), 교육 팩 실제 작성(이월).
