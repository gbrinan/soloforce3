import type { Action } from "./action-types";

export interface ClipMeta {
  jobId: string;
  title: string;
}

export interface ClipOption {
  value: string;
  label: string;
}

// Split a clip with N cuts into N+1 labeled parts. Synthetic "#part2.." suffix
// keeps Mantine Select values unique; resolveClipId() strips it before submit
// so the action contract still references the base jobId.
export function buildClipOptions(clips: ClipMeta[], actions: Action[]): ClipOption[] {
  const out: ClipOption[] = [];
  for (const c of clips) {
    const cutCount = actions.filter((a) => a.type === "cut" && a.clipId === c.jobId).length;
    if (cutCount === 0) {
      out.push({ value: c.jobId, label: c.title });
    } else {
      const parts = cutCount + 1;
      for (let i = 1; i <= parts; i++) {
        out.push({
          value: i === 1 ? c.jobId : `${c.jobId}#part${i}`,
          label: `${c.title} (${i})`,
        });
      }
    }
  }
  return out;
}

export function resolveClipId(value: string): string {
  const i = value.indexOf("#part");
  return i >= 0 ? value.slice(0, i) : value;
}

export function clipLabel(clipId: string, clips: ClipMeta[]): string {
  const found = clips.find((c) => c.jobId === clipId);
  return found ? found.title : clipId;
}
