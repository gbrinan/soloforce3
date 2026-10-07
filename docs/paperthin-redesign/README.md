# soloforce paperthin 철학 재설계

## Background

soloforce(라이브: gbrinan/soloforce, PR 대상: gbrinan/soloforce2)는 기능이 누적되며 구조·문서·스킬이 비대해졌다. LilMGenius/paperthin은 "clean and true" 위생 반사(hygiene reflex) 스킬 스위트로, 아티팩트를 항상 최신·최소·검증된 상태로 유지하는 철학을 제시한다.

## Goal

paperthin의 철학(작성자가 아닌 아티팩트를 신뢰, SSOT, 절제, 재귀적 자기검증, negatives-as-corpus)으로 soloforce를 재설계한다.

## How it works

- ahastudio/file-based-planning-workflow 구조를 따른다: 기능 폴더당 spec → plan → tasks → findings → progress 문서로 계획과 진행을 파일로 관리한다.
- paperthin 28개 스킬 정독 결과는 [findings.md](findings.md)에 기록한다.

## Related Documents

- [spec.md](spec.md): 요구사항 및 상세 스펙
- [plan.md](plan.md): 기술 구현 계획
- [tasks.md](tasks.md): 작업 계획 및 추적
- [findings.md](findings.md): 기술적 발견사항 및 결정
- [progress.md](progress.md): 세션별 작업 내역
