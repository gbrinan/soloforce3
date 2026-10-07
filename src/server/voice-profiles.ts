// Jarvis 음성 뷰 — 에이전트별 목소리 프로필 해석.
// config/agents/{id}/voice.json 이 있으면 사용, 없으면 agentId 해시 기반 결정론적 기본값을 반환한다.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PROJECT_SELF_DIR } from "../config.js";
import { getWorkerAgent, getAllWorkerAgents, type WorkerAgentDef } from "../agent-registry.js";
import { getGenieName } from "./chat.js";

export interface VoiceProfile {
  agentId: string;
  name: string;
  engine: "supertonic";
  voice: string;
  speed?: number;
  pitchSemitones?: number;
  lang: string;
  fillers: string[];
  color?: string;
}

const AGENTS_CONFIG_DIR = join(PROJECT_SELF_DIR, "config", "agents");

// M4/F3/F4 프리셋은 품질 이슈로 제외 — 나머지 7종 중 하나를 agentId 해시로 결정론적 선택.
const VOICE_PRESETS = ["M1", "M2", "M3", "M5", "F1", "F2", "F5"] as const;

interface CacheEntry {
  mtimeMs: number;
  profile: VoiceProfile;
  /** voice.json 이 name 을 명시했는지. 아니면 표시명은 레지스트리에서 매번 새로 해석한다. */
  explicitName: boolean;
}

const cache = new Map<string, CacheEntry>();

function hashToIndex(id: string, mod: number): number {
  const digest = createHash("sha1").update(id).digest();
  return digest[0] % mod;
}

// chat.ts의 getGenieName()을 참조하고 싶었으나 순환 import 위험이 있어(chat.ts -> jobs.ts 등 다수 의존)
// 여기서는 안전한 정적 fallback을 사용한다. 실제 지니 표시명은 라우트 레벨에서 필요 시 별도 조회한다.
// 온보딩에서 지은 비서 이름을 그대로 쓴다 (미완료면 SoloForce).
function getGenieDisplayName(): string {
  try {
    const n = getGenieName();
    return n && n !== "MyCrew" ? n : "SoloForce";
  } catch {
    return "SoloForce";
  }
}

function defaultProfileFor(agentId: string, displayName?: string): VoiceProfile {
  const idx = hashToIndex(agentId, VOICE_PRESETS.length);
  return {
    agentId,
    name: displayName ?? getGenieDisplayName(),
    engine: "supertonic",
    voice: VOICE_PRESETS[idx],
    speed: 1.0,
    lang: "ko",
    fillers: ["네, 확인하겠습니다."],
  };
}

export function getVoiceProfile(agentId: string): VoiceProfile {
  const filePath = join(AGENTS_CONFIG_DIR, agentId, "voice.json");
  const worker: WorkerAgentDef | undefined = agentId === "genie" ? undefined : getWorkerAgent(agentId);
  const displayName = agentId === "genie" ? getGenieDisplayName() : (worker?.name ?? agentId);

  if (existsSync(filePath)) {
    try {
      const stat = statSync(filePath);
      const cached = cache.get(agentId);
      // 이름은 레지스트리(런타임 변경 가능)에서 오므로 캐시 히트에도 매번 갱신한다.
      // voice.json mtime에 묶어 캐시하면 직원 이름을 바꿔도 음성 UI에 반영되지 않는다.
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        if (cached.explicitName || cached.profile.name === displayName) return cached.profile;
        return { ...cached.profile, name: displayName };
      }

      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<VoiceProfile>;
      const merged: VoiceProfile = {
        agentId,
        name: parsed.name ?? displayName,
        engine: "supertonic",
        voice: parsed.voice ?? VOICE_PRESETS[hashToIndex(agentId, VOICE_PRESETS.length)],
        speed: parsed.speed ?? 1.0,
        pitchSemitones: parsed.pitchSemitones,
        lang: parsed.lang ?? "ko",
        fillers: parsed.fillers?.length ? parsed.fillers : ["네, 확인하겠습니다."],
        color: parsed.color,
      };
      cache.set(agentId, { mtimeMs: stat.mtimeMs, profile: merged, explicitName: parsed.name !== undefined });
      return merged;
    } catch (err) {
      console.error(`[voice-profiles] voice.json 로드 실패 (${agentId}), 기본값 사용:`, err);
    }
  }

  return defaultProfileFor(agentId, displayName);
}

export function listVoiceProfiles(): VoiceProfile[] {
  const profiles: VoiceProfile[] = [getVoiceProfile("genie")];
  for (const agent of getAllWorkerAgents()) {
    profiles.push(getVoiceProfile(agent.id));
  }
  return profiles;
}
