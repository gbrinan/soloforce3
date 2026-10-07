// 공용 AI 클라이언트로 통합됨 (packages/ai-client). 앱별 복제를 제거하고 재export만 유지.
// 기존 import 경로(@/lib/claude-cli)는 그대로 두어 호출부 변경 없이 동작한다.
// (director/llm/claude-cli.ts 의 ClaudeCodeCLIProvider 는 시그니처가 근본적으로 달라 별도 유지.)
export * from "@mycrew/ai-client";
