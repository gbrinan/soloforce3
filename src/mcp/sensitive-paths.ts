// 셀프 권한 변경 등 위험 경로 - SafeFS writePaths 매칭 통과해도 사장님 승인 강제.
// safefs-server.ts (가드) + approval-genie.ts (마이크루 의견 skip) 둘 다 사용.
// 변경 시 테스트(scripts/approval-genie-test.ts SENSITIVE_PATHS_V2)와 동기.
//
// 2026-06-10 보강: env(MCP_READ_SENSITIVE/MCP_WRITE_SENSITIVE) 누락 또는 base 불일치로
// 직원 분기에서 sensitive 매칭이 실패하는 경로가 라이브에서 확인됨 (.env 평문 노출, role-directive.md 직접 쓰기).
// 코드 고정 SENSITIVE_PATHS를 시크릿 + 운영 핵심 전부 포괄하도록 확장하여 env 흐름과 무관하게 무조건 매칭.

import picomatch from "picomatch";
import { resolve as pathResolve } from "node:path";

// 공통 SENSITIVE — 코드 고정, 수정 불가
// 마이크루: IS_GENIE 분기에서 사용 + 자기 wiki 외 전부 승인
// 직원: isReadSensitive/isWriteSensitive 직원 분기에서도 매칭 (env sensitive와 독립적으로 무조건 적용)
export const SENSITIVE_PATHS = [
  // 운영 핵심 — 직무·권한 정의 파일
  "/history/genie-config.json",
  "/history/genie/wiki/role-directive.md",
  "/history/agents/**/wiki/role-directive.md",
  "/history/agents.json",
  // 운영 인증 데이터
  "/history/staff-hash.json",
  "/history/auth-sessions.json",
  "/history/partners.json",
  "/history/external/partners.json",
  // 시크릿 — 환경설정
  "/.env",
  "/.env.*",
  "/**/.env",
  "/**/.env.*",
  // 시크릿 — SSH / AWS / GPG (홈디렉토리)
  "/.ssh/**",
  "/.aws/**",
  "/.gnupg/**",
  "/**/.ssh/**",
  "/**/.aws/**",
  "/**/.gnupg/**",
  // 시크릿 — 키/인증서 파일명·확장자
  "/**/id_rsa*",
  "/**/id_ed25519*",
  "/**/id_ecdsa*",
  "/**/*.pem",
  "/**/*.key",
  "/**/*.crt",
  "/**/*.p12",
  "/**/*.pfx",
  "/**/*.jks",
  "/**/*.keychain-db",
  // 시크릿 — 일반 명명 패턴 (credentials.json, secret.txt 등).
  // 소스확장자(.ts/.js/.tsx/.go/.py/.rs 등)는 credentials.ts 같은 정상소스라 제외 — 시크릿 담기는 확장자만.
  // (감사 2026-06-24: secrets.ts/credentials.ts read-block 오탐 제거)
  "/**/credentials",
  "/**/credentials.{txt,json,yml,yaml,env,conf,cfg,ini,csv,dat,bak,enc,gpg,asc,xml,properties,toml}",
  "/**/*credentials.json",
  "/**/secret",
  "/**/secrets",
  "/**/secret.{txt,json,yml,yaml,env,conf,cfg,ini,csv,dat,bak,enc,gpg,asc,xml,properties,toml}",
  "/**/secrets.{txt,json,yml,yaml,env,conf,cfg,ini,csv,dat,bak,enc,gpg,asc,xml,properties,toml}",
  "/**/*secrets.json",
  // password 파일 (감사 2026-06-24 — bare-name 시크릿 보강).
  // 소스확장자(.ts/.js/.tsx 등)는 password.ts 같은 정상소스라 제외하고, 시크릿이 담기는 확장자만 매칭.
  "/**/password",
  "/**/password.{txt,json,yml,yaml,env,conf,cfg,ini,csv,dat,bak,enc,gpg,asc,key,pem}",
  "/**/passwords.{txt,json,yml,yaml,env,conf,cfg,ini,csv,dat,bak,enc,gpg,asc}",
  "/**/*.password",
  // Claude/codex 등 외부 CLI 인증 디렉토리
  "/**/.claude/auth*",
  "/**/.codex/auth*",
];

// base 기준 절대 패턴 매처 — req.path를 base 기준 resolve한 절대경로 입력 시 사용.
export function buildSensitiveMatcher(base: string): (abs: string) => boolean {
  const matchers = SENSITIVE_PATHS.map((p) => {
    const rel = p.replace(/^\//, "");
    const absPattern = pathResolve(base, rel).replace(/\\/g, "/");
    return picomatch(absPattern, { dot: true });
  });
  return (abs: string) => {
    const normAbs = abs.replace(/\\/g, "/");
    return matchers.some((m) => m(normAbs));
  };
}
