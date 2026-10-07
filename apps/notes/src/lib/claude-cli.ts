// 공용 AI 클라이언트로 통합됨 (packages/ai-client). 앱별 복제를 제거하고 재export만 유지.
// import 경로(@/lib/claude-cli)는 다른 앱과 동일하게 두어 호출부 이식을 쉽게 한다.
export * from "@mycrew/ai-client";
