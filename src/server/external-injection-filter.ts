// 외부 메시지 prompt-injection 사전 스캔.
// 자동 차단 X — 발견 시 injectionFlags에 기록 + 사장님 저강도 알림.
// 권한 격리(Authorization > Authentication)가 최후 방어선이고, 본 필터는 가시성 도구.

import type { ExternalInjectionFlag } from "../types.js";

interface PatternDef {
  name: string;
  re: RegExp;
}

const PATTERNS: PatternDef[] = [
  { name: "ignore_previous", re: /ignore\s+(previous|all|the\s+above|prior)/i },
  { name: "disregard_above", re: /(disregard|forget)\s+(the\s+)?(above|previous|prior)/i },
  { name: "system_prompt", re: /system\s*prompt/i },
  { name: "you_are_now", re: /you\s+are\s+now\s+(a|an|the)/i },
  { name: "owner_approved_kr", re: /(사장님|사용자|관리자)(이|께서)?\s*(허가|승인|허락)/ },
  { name: "owner_approved_en", re: /(owner|admin|administrator)\s+(approved|authorized|authorised|allow)/i },
  { name: "admin_override", re: /admin\s+override/i },
  { name: "im_start", re: /<\|(im_start|im_end|system|user|assistant)\|>/i },
  { name: "inst_marker", re: /\[INST\]|\[\/INST\]/i },
  { name: "chatml_marker", re: /###\s*(Instruction|System|User|Assistant)\s*:/i },
  { name: "ignore_kr", re: /(이전|위)\s*(지시|명령|규칙|프롬프트)\s*(은|는|를|을)?\s*(무시|취소|잊)/ },
  { name: "system_change_kr", re: /(시스템\s*프롬프트|system\s*prompt)\s*(변경|수정|업데이트)/i },
  { name: "role_change_kr", re: /지금부터\s*너는|이제부터\s*당신은/ },
  { name: "exfil_files", re: /(send|export|exfiltrate|leak|dump)\s+(all\s+)?(files|outputs|directory|database|secrets)/i },
];

export function scanInjection(body: string): ExternalInjectionFlag[] {
  if (!body) return [];
  const flags: ExternalInjectionFlag[] = [];
  const at = new Date().toISOString();
  for (const p of PATTERNS) {
    if (p.re.test(body)) {
      flags.push({ pattern: p.name, detectedAt: at });
    }
  }
  return flags;
}

export function getInjectionPatternCount(): number {
  return PATTERNS.length;
}
