// Rule-based deletion-safety rating (1st pass of the hybrid pipeline).
// Only labels ratings for display — never touches actual deletion logic.
import os from "node:os";

export type SafetyRating = "safe" | "caution" | "danger";
export type SafetySource = "rule" | "ai" | "fallback";

export interface SafetyResult {
  path: string;
  rating: SafetyRating;
  source: SafetySource;
}

// Common project source-code extensions — treated as danger (protect user work).
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".java", ".c", ".cpp",
  ".cc", ".h", ".hpp", ".swift", ".go", ".rs", ".rb", ".php", ".kt", ".cs",
  ".vue", ".svelte", ".sql", ".sh",
]);

// Cache/temp-like extensions — safe to remove.
const SAFE_EXTS = new Set([".log", ".tmp", ".cache", ".dmp"]);

const HOME = os.homedir();

function extOf(p: string): string {
  const base = p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * Rule-based rating. Returns null when rules are not confident —
 * those items are escalated to the Claude CLI batch judgement.
 * Multi-path category items may carry a "Key: /path" prefix; it is stripped.
 */
export function ruleBasedRating(rawPath: string): SafetyRating | null {
  const stripped = rawPath.replace(/^[^/\\]+:\s+(?=[/\\~])/, "");
  // Normalize separators for substring matching (Windows paths included).
  const p = stripped.replace(/\\/g, "/");
  const lower = p.toLowerCase();
  const homeLower = HOME.replace(/\\/g, "/").toLowerCase();

  // --- danger rules first (protect user data over convenience) ---
  const dangerDirs = ["/documents", "/desktop"];
  for (const d of dangerDirs) {
    const prefix = homeLower + d;
    if (lower === prefix || lower.startsWith(prefix + "/")) return "danger";
  }
  if (lower.includes("/.git/") || lower.endsWith("/.git")) return "danger";
  const ext = extOf(p);
  if (SOURCE_EXTS.has(ext)) return "danger";

  // --- safe rules (well-known regenerable / disposable locations) ---
  if (lower.includes("/node_modules/") || lower.endsWith("/node_modules")) return "safe";
  if (lower.includes("/library/caches/") || lower.endsWith("/library/caches")) return "safe";
  if (lower.includes("/library/logs/") || lower.endsWith("/library/logs")) return "safe";
  if (lower.includes("/.trash/") || lower.endsWith("/.trash")) return "safe";
  if (SAFE_EXTS.has(ext)) return "safe";

  // Not confident — escalate to AI batch.
  return null;
}
