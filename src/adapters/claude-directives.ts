// Claude 어댑터(claude-cli·claude-print) 공용 워커 지시문 — 단일 출처.
// cli(상주 PTY)와 print(-p 단발)가 같은 위임/완료보고 계약을 쓰도록 여기서 한 번만 정의한다.
// (worker-pty.ts·agent.ts에 중복 인라인되어 드리프트 나던 것을 통합. 코어와 무관, 어댑터 도메인.)
import { SUBMIT_RESPONSE_DIRECTIVE } from "../server/agent-pty.js";

const askDirective = "작업 중 정말 막혀서 사람의 결정·정보가 꼭 필요하면 ask MCP 툴로 질문하세요 (사소한 판단은 스스로). 대화형 질문 메뉴는 쓸 수 없으니 ask 툴을 쓰세요.";

const approvalDirective = "SafeWrite/SafeEdit/SafeDelete/SafeBash가 작업 범위 밖을 건드려 승인이 필요할 때는 reason 인자에 '왜 이 작업에 그게 필요한지'를 한 줄로 적으세요 (예: '회귀 테스트 결과를 보고서로 남기려고'). 도구 이름만 적지 마세요 — 사장님이 그 사유만 보고 승인/거부를 판단합니다.";

// 위임 작업은 '빈 응답' 금지 — 빈 submit_response는 지니가 '완료'로 오해해 무한 재위임을 부른다.
function reportDirective(agentId: string): string {
  return agentId === "orchestrator"
    ? "사용자에게 진행 상황을 알릴 때는 post_message를 사용하고, 최종 답변은 submit_response의 content에 담아 턴을 종료하세요."
    : "위임받은 작업은 끝나면 결과를 반드시 submit_response의 content에 담아 보고하세요 — 성공이면 한 일 요약, 실패·중단·불가면 '왜 못 했는지'와 '누가/어떻게 해야 하는지'를 적으세요. 최종 완료보고는 submit_response의 reportStatus를 반드시 \"final\"로 두세요. 완료 불가·사람 판단 필요는 \"blocked\", 팀장으로서 자기 팀원에게 DelegateTask/DelegatePlan 하위 위임 후 결과를 기다려야 하면 \"handoff\"입니다. 특히 도구나 권한이 없어 못 하는 작업이면 그 사실을 명확히 보고하세요(예: 'MCP 설치는 제 권한 밖입니다 — 지니가 manage_mcp 도구로 직접 해야 합니다'). Agent 알바는 누구나 사용할 수 있고 장려됩니다. 다만 결과가 필요한 작업에 run_in_background:true를 쓰지 말고, 알바 도구 결과를 받은 뒤 취합해 reportStatus:\"final\"로 최종 보고하세요. 팀장만 DelegateTask/DelegatePlan으로 자기 팀원에게 하위 위임할 수 있고, 일반 직원 또는 다른 팀 직원에게 넘기는 것은 금지입니다. 다른 직원·알바·DelegateTask에 하위 위임했다면 ACK만 받고 submit_response로 종료하지 마세요. 하위 작업 결과를 기다려 읽고 취합한 최종 결과를 보고하거나, 기다릴 수 없으면 reportStatus:\"blocked\"와 함께 사유를 보고하세요. '알바 3명에게 맡겼습니다/진행 중입니다' 같은 내용은 완료 보고가 아닙니다. 위임 작업에 빈 응답(빈 content)은 금지입니다 — 빈 응답을 보내면 지니가 '완료됐다'고 오해해 같은 일을 무한 재위임합니다. 그리고 submit_response의 summary 인자에 핵심 결과를 한두 줄로 요약해 넣으세요 — 카드·보고에 이 요약이 표시됩니다(머리만 자르지 말고 진짜 요약, 실패면 사유 요약).";
}

// dev-pm 전용 — self 프로젝트 자기수정 작업 시 재시작 트리거 명시 규약.
function restartDirective(agentId: string): string {
  return agentId === "dev-pm"
    ? "\n\n작업 결과가 반영되려면 서버 재시작이 필요한 경우 submit_response에 needsRestart: true를 함께 넣으세요. 재시작 없이도 결과가 반영되는 작업(조사·테스트·문서, 또는 즉시 적용되는 데이터 변경 등)은 생략하세요."
    : "";
}

/**
 * claude-cli(상주 PTY)용 지시문 — `config.systemPrompt` 뒤에 붙는다.
 * 기존 worker-pty.ts 인라인 조립과 byte-identical(회귀 방지).
 */
export function buildClaudeCliDirectives(agentId: string): string {
  return `${SUBMIT_RESPONSE_DIRECTIVE}\n\n${askDirective}\n\n${approvalDirective}\n\n${reportDirective(agentId)}${restartDirective(agentId)}`;
}

/**
 * claude-print(-p 단발)용 지시문.
 * 인터랙티브 전용은 제외: ask(중간질문 불가), SUBMIT_RESPONSE_DIRECTIVE(PTY 멀티턴 종료 의미).
 * 위임/완료보고 계약(reportStatus·팀장위임·알바·빈응답금지·summary)은 -p에도 동일 적용한다.
 *   주의: -p 결과 본문은 stdout(stream-json result)으로 회수되고, reportStatus/summary는
 *   submit_response 호출로 서버에 set된다(submit_response 도구는 -p allowedTools에 포함).
 */
export function buildClaudePrintDirectives(agentId: string): string {
  return `${approvalDirective}\n\n${reportDirective(agentId)}${restartDirective(agentId)}`;
}
