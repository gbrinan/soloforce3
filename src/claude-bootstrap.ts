import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { PROJECT_SELF_DIR, WORKSPACE_ROOT, PROJECTS_DIR, CLAUDE_PATH } from "./config.js";

// Claude Code의 "첫 실행 인터랙티브 관문"은 PTY로 띄우는 지니 세션을 입력 대기로
// 멈추게 한다(= 비서 무응답). 세 가지:
//   1) 테마 선택 마법사   — hasCompletedOnboarding 미설정 시
//   2) "이 폴더를 신뢰?"   — 작업 폴더가 trust 목록에 없을 때
//   3) "새 MCP 서버 발견"  — 프로젝트 .mcp.json 서버가 enabled/disabled 어디에도 없을 때
// -p(print) 워커는 이 화면들을 건너뛰므로 영향 없음 — 오직 인터랙티브 지니만 막힌다.
//
// 이 부트스트랩은 서버 부팅 시(지니 spawn 전에) 위 관문을 멱등하게 통과 처리한다.
// 서버와 지니 claude는 같은 HOME을 공유하므로(agent.ts safeChildEnv가 HOME 전달),
// 여기서 쓰는 설정 위치 = 지니가 실제로 읽는 설정 위치다.
// → Windows claude / WSL claude 설정 경로가 엇갈리는 혼동이 구조적으로 사라진다
//   (WSL에서 돌면 /root/.claude, mac에서 돌면 ~/.claude — 실행 컨텍스트를 그대로 따라감).

// claude 설정 디렉토리: CLAUDE_CONFIG_DIR 우선, 없으면 ~/.claude (claude CLI와 동일 규칙)
function claudeConfigDir(): string {
  const custom = process.env.CLAUDE_CONFIG_DIR?.trim();
  return custom ? custom : join(homedir(), ".claude");
}
// 메인 설정 파일: CLAUDE_CONFIG_DIR 사용 시 그 안의 .claude.json, 아니면 ~/.claude.json
function claudeJsonPath(): string {
  const custom = process.env.CLAUDE_CONFIG_DIR?.trim();
  return custom ? join(custom, ".claude.json") : join(homedir(), ".claude.json");
}

function readJson(path: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>; }
  catch { return {}; }
}

/** 부팅 시 1회 호출. claude 인터랙티브 관문을 통과 처리. 실패해도 부팅은 계속한다. */
export function ensureClaudeInteractiveReady(): void {
  try {
    const changes: string[] = [];

    // ── 1) ~/.claude.json — 온보딩(테마) 완료 + 작업 폴더 신뢰 ──
    const jsonPath = claudeJsonPath();
    const json = readJson(jsonPath);
    const jsonBefore = JSON.stringify(json);

    if (json.hasCompletedOnboarding !== true) {
      json.hasCompletedOnboarding = true;
      changes.push("온보딩(테마) 완료");
    }

    // 지니 PTY는 PROJECT_SELF_DIR에서 돈다. 워커/프로젝트 루트도 함께 신뢰 처리해 둔다.
    const trustPaths = [...new Set([PROJECT_SELF_DIR, WORKSPACE_ROOT, PROJECTS_DIR].filter(Boolean))];
    const projects = (json.projects ??= {}) as Record<string, Record<string, unknown>>;
    for (const p of trustPaths) {
      const entry = (projects[p] ??= {});
      if (entry.hasTrustDialogAccepted !== true) {
        entry.hasTrustDialogAccepted = true;
        changes.push(`폴더 신뢰: ${p}`);
      }
    }

    if (JSON.stringify(json) !== jsonBefore) {
      writeFileSync(jsonPath, JSON.stringify(json, null, 2));
    }

    // ── 2) ~/.claude/settings.json — 프로젝트 .mcp.json 자동 활성(발견 프롬프트 제거) ──
    const dir = claudeConfigDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const settingsPath = join(dir, "settings.json");
    const settings = readJson(settingsPath);
    const settingsBefore = JSON.stringify(settings);
    if (settings.enableAllProjectMcpServers !== true) {
      settings.enableAllProjectMcpServers = true;
      changes.push("프로젝트 MCP 자동 활성");
    }
    if (JSON.stringify(settings) !== settingsBefore) {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    if (changes.length) {
      console.log(`[ClaudeBootstrap] 인터랙티브 관문 통과 설정 적용: ${changes.join(" / ")}`);
    } else {
      console.log("[ClaudeBootstrap] claude 인터랙티브 설정 이미 정상 — 변경 없음");
    }

    // ── 3) (감지/경고) CLAUDE_PATH가 Windows용이면 PTY에서 깨짐 ──
    // WSL은 Windows PATH를 상속해 /mnt/c/.../claude(윈도우 바이너리)가 잡히기 쉽다.
    // 그 바이너리는 PTY(지니 터미널)에서 동작하지 않으므로 네이티브 claude여야 한다.
    if (process.platform !== "win32" && /^\/mnt\/[a-z]\//i.test(CLAUDE_PATH)) {
      console.warn(`[ClaudeBootstrap] ⚠️ CLAUDE_PATH가 Windows용 claude로 보입니다: ${CLAUDE_PATH}`);
      console.warn("[ClaudeBootstrap]    WSL에선 네이티브 claude(~/.npm-global/bin/claude)를 써야 지니 터미널이 동작합니다. setup을 다시 실행하세요.");
    }

    // ── 4) (감지/안내) 로그인 정보 부재 — 자동 로그인은 start-wsl이 담당 ──
    // mac은 자격증명을 Keychain에 저장(.credentials.json 없음)하므로 검사 제외.
    if (process.platform === "linux") {
      const credPath = join(dir, ".credentials.json");
      if (!existsSync(credPath)) {
        console.warn("[ClaudeBootstrap] ⚠️ Claude 로그인 정보가 없습니다 (.credentials.json 없음).");
        console.warn("[ClaudeBootstrap]    start-wsl 실행 시 자동 인증됩니다. 그 전엔 비서가 응답하지 않을 수 있습니다.");
      }
    }
  } catch (err) {
    console.warn(`[ClaudeBootstrap] 설정 보장 실패(무시하고 계속): ${(err as Error).message}`);
  }
}
