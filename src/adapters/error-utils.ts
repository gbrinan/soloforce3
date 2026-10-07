import type { RuntimeError } from "./types.js";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function unknownRuntimeError(error: unknown): RuntimeError {
  const message = errorMessage(error);
  if (message === "aborted") return { kind: "cancelled", message, retryable: false };
  return { kind: "unknown", message, retryable: true };
}
