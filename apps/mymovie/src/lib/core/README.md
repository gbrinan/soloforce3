# OpenReel Core (Vendored Stub)

이 디렉토리는 MyMovie 프로젝트의 영상 편집 JSON Action Bus 인터페이스 정의입니다.

## 상태: 스텁 (Step 1 — Vendoring Pending)

기획서(`history/outputs/planner-researcher/2026-06-16-video-editor-design-build-plan.md`)는 OpenReel-video 리포의 `packages/core` (action-serializer / action-executor / action-validator / inverse-action-generator)를 벤더링하라고 명시했습니다. 

**현실**: 2026-06-16 기준 CTO가 다음 URL을 시도했으나 모두 `Repository not found`로 실패:
- `https://github.com/openreel/openreel-video.git` ❌ 404
- `https://github.com/openreel-video/openreel-video.git` ❌ 404

**조치**: 실제 코어 fetch 가능한 정확한 리포 식별 전까지 **스텁 인터페이스만** 제공. 4개 파일의 시그니처/타입은 기획서·OpenReel 일반 패턴에 따라 정의했으나, 실 편집 로직은 NotImplementedError를 던집니다.

## 다음 단계
1. 정확한 OpenReel-video 리포 URL 확인 (기획자/사용자)
2. `git clone <repo>` 후 `packages/core/` 4 파일 본 디렉토리로 복사
3. 사용한 commit 해시를 `COMMIT_PIN.txt` 에 기록
4. 본 README의 "상태"를 "활성"으로 갱신

## 파일 목록

| 파일 | 책임 |
|------|------|
| `action-types.ts` | `Action` 유니온 타입(cut/trim/reframe/caption/...) + 메타 |
| `action-serializer.ts` | `Action[]` ↔ JSON (영구 저장·전송) |
| `action-validator.ts` | 스키마·범위·시간 충돌 검증 |
| `action-executor.ts` | `Action[]` 실 영상 데이터에 적용 (executeMany) |
| `inverse-action-generator.ts` | Undo 위한 역연산 자동 생성 |

## 사용 예 (의도)

```typescript
import { validateActions } from "@/lib/core/action-validator";
import { executeMany } from "@/lib/core/action-executor";
import { serialize } from "@/lib/core/action-serializer";
import { inverseOf } from "@/lib/core/inverse-action-generator";

const actions: Action[] = await aiDirector(signals);
const valid = validateActions(actions);
if (!valid.ok) throw new Error(valid.reason);
const result = await executeMany(actions, footage);
const undoStack = actions.map(inverseOf);
await persist(serialize(actions));
```
