// 결과 봉투 — «없음»과 «확인 못 함»을 구분한다.
// 규칙: 출처가 실패했으면 0건이라고 말하지 않는다. 일부만 얻었으면 일부라고 말한다.
//
// ok      — 조회 성공, 결과 있음
// empty   — 조회 성공, 결과 없음(조용한 게 정상)
// partial — 일부만 얻음(나머지는 error에 이유)
// failed  — 조회 실패, 결과를 모른다
// skipped — 이번 회차는 돌지 않았다(이미 실행 중 등)

export type ResultStatus = "ok" | "empty" | "partial" | "failed" | "skipped";

export interface ResultEnvelope<T> {
  status: ResultStatus;
  source: string;
  /** 조회 시각(ISO). */
  asOf: string;
  data?: T;
  /** failed·partial·skipped의 이유. 사람에게 보일 수 있으니 본문·개인정보를 넣지 않는다. */
  error?: string;
}

export function envelope<T>(status: ResultStatus, source: string, opts: { data?: T; error?: string; asOf?: Date } = {}): ResultEnvelope<T> {
  return {
    status,
    source,
    asOf: (opts.asOf ?? new Date()).toISOString(),
    ...(opts.data !== undefined ? { data: opts.data } : {}),
    ...(opts.error ? { error: opts.error } : {}),
  };
}

/** 여러 출처의 상태를 하나로 — 하나라도 실패·부분이 섞이면 전체는 partial, 전부 실패면 failed. */
export function combineStatus(statuses: ResultStatus[]): ResultStatus {
  const ran = statuses.filter((s) => s !== "skipped");
  if (ran.length === 0) return statuses.length ? "skipped" : "empty";
  if (ran.every((s) => s === "failed")) return "failed";
  if (ran.some((s) => s === "failed" || s === "partial")) return "partial";
  return ran.some((s) => s === "ok") ? "ok" : "empty";
}

/** 결과 요약 끝에 붙일 «확인 못 한 출처» 한 줄. 모두 정상이면 null. */
export function unavailableFooter(envs: Array<Pick<ResultEnvelope<unknown>, "status" | "source" | "error">>): string | null {
  const bad = envs.filter((e) => e.status === "failed" || e.status === "partial");
  if (bad.length === 0) return null;
  const parts = bad.map((e) => `${e.source}(${e.status === "failed" ? "확인 못 함" : "일부만"}${e.error ? `: ${e.error}` : ""})`);
  return `⚠️ 확인 못 한 출처: ${parts.join(", ")} — 없다는 뜻이 아닙니다.`;
}
