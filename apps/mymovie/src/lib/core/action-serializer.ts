// OpenReel core — Action[] 직렬화 (스텁).
// 실 코어 fetch 시 OpenReel-video의 packages/core/action-serializer로 교체.

import type { Action } from "./action-types";

const SCHEMA_VERSION = 1;

export interface SerializedTimeline {
  schemaVersion: number;
  createdAt: number;
  actions: Action[];
}

export function serialize(actions: Action[]): string {
  const payload: SerializedTimeline = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    actions,
  };
  return JSON.stringify(payload);
}

export function deserialize(json: string): SerializedTimeline {
  const parsed = JSON.parse(json) as Partial<SerializedTimeline>;
  if (!parsed || typeof parsed.schemaVersion !== "number") {
    throw new Error("invalid timeline: missing schemaVersion");
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `unsupported timeline schemaVersion ${parsed.schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(parsed.actions)) {
    throw new Error("invalid timeline: actions must be an array");
  }
  return {
    schemaVersion: parsed.schemaVersion,
    createdAt: parsed.createdAt ?? 0,
    actions: parsed.actions,
  };
}
