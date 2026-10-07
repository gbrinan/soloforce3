import { existsSync, readFileSync } from "node:fs";

export function parseLatestAgentModels(content: string): Record<string, string> {
  const latest = new Map<string, { model: string; timestamp: number; order: number }>();
  let order = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    order += 1;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof record.agentId !== "string" || !record.agentId.trim()) continue;
      if (typeof record.model !== "string" || !record.model.trim()) continue;
      const parsedTimestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
      const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
      const previous = latest.get(record.agentId);
      if (!previous || timestamp > previous.timestamp || (timestamp === previous.timestamp && order > previous.order)) {
        latest.set(record.agentId, { model: record.model.trim(), timestamp, order });
      }
    } catch {
      // 손상된 비용 로그 레코드는 무시한다.
    }
  }
  return Object.fromEntries(Array.from(latest, ([agentId, value]) => [agentId, value.model]));
}

export function readLatestAgentModels(costLogFile: string): Record<string, string> {
  if (!existsSync(costLogFile)) return {};
  try {
    return parseLatestAgentModels(readFileSync(costLogFile, "utf-8"));
  } catch {
    return {};
  }
}
