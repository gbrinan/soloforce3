// 삭제는 무조건 OS 휴지통 이동만 수행한다. fs.unlink/fs.rm으로 영구 삭제 금지 (안전장치 필수 요건).
import trash from "trash";
import { isDenied } from "../safety";
import { appendAudit } from "./audit";

export interface TrashResult {
  moved: string[];
  denied: string[];
  failed: { path: string; error: string }[];
}

export async function moveToTrash(paths: string[], opts: { dryRun?: boolean } = {}): Promise<TrashResult> {
  const moved: string[] = [];
  const denied: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const dryRun = !!opts.dryRun;

  for (const p of paths) {
    if (isDenied(p)) {
      denied.push(p);
      await appendAudit({ path: p, action: "denied", reason: "protected path (deny-list)", dryRun });
      continue;
    }
    if (dryRun) {
      moved.push(p);
      await appendAudit({ path: p, action: "dry-run", reason: "simulated (dryRun=true)", dryRun: true });
      continue;
    }
    try {
      await trash(p);
      moved.push(p);
      await appendAudit({ path: p, action: "trashed", reason: "user requested", dryRun: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ path: p, error: message });
      await appendAudit({ path: p, action: "failed", reason: message, dryRun: false });
    }
  }

  return { moved, denied, failed };
}
