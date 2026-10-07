# Vendored: OpenReel core (Action schema)

이 디렉토리는 [Augani/openreel-video](https://github.com/Augani/openreel-video) v0.5.0 (`97b50a8c27508e316ccd5a442382bafa458a1914`)에서 sparse-vendored됨.

- **라이선스**: MIT (원본 LICENSE는 `./LICENSE` 참조)
- **용도**: Action 스키마 reference 전용
- **주의**: OpenReel은 WebCodecs/WebGPU 기반 브라우저 전용 에디터. 서버사이드 Node 실행은 직접 호환되지 않음.
  - 본 벤더링 파일은 **Action 타입/검증/직렬화 구조 reference**로만 사용됨
  - 실제 서버사이드 executor는 `apps/mymovie/src/lib/core/action-executor.ts`에서 ffmpeg 기반으로 자체 구현됨

## 벤더링 범위
- `actions/action-executor.ts`
- `actions/inverse-action-generator.ts`
- `actions/action-validator.ts`
- `actions/action-serializer.ts`
- `types/actions.ts`

## 핀 정보
상위 `apps/mymovie/COMMIT_PIN.txt` 참조.
