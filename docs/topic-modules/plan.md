# Implementation Plan: 주제 모듈

## Summary

주제 설정(형식은 리포, 값은 `history/topics/`) + 모듈 선언(`modules/<id>/module.json`) + 역할 에이전트 4개로 SPF 전용 구성을 일반화하고, SPF를 첫 주제로 옮겨 기존 루프와 등가임을 확인한다.

## Requirements

1. 주제 설정 스키마·검사기 (T1)
2. 모듈 형식과 로더 — 루프 템플릿 × 활성 주제 (T2)
3. 역할 에이전트 `topic-sales`·`topic-comms`·`topic-logistics`·`topic-scout`, `spf-*` 별칭 (T3)
4. SPF 이전과 등가 검증 (T4)
5. 일정 조회 도구 `schedules_query` (T5)
6. 문서·정본 위치 (T6)

## Critical Files

### New Files

- `src/shared/topic-config.ts`, `scripts/topic-check.ts`, `config/topics/example.topic.yaml`
- `modules/topic-business/` (T2~)

### Modified Files

- `src/server/loops/loader.ts`, `src/server/loops/runner.ts` (T2)
- `src/agent-registry.ts`, `src/server/qa-trigger-policy.ts` (T3)
- `src/mcp/appdata-server.ts`, `src/agent.ts` (T5)

### Reference Files

- `docs/domain-pack/spec.md` — SPF를 역설계한 도메인 팩 명세
- 라이브 `C:/mycrew/mycrew-program/loops/spf-*.yaml`, `history/agents/spf-*/wiki/role-directive.md`, `history/skills/spf-*.md` (읽기 전용 기준)
