// Jev 로 보내기 전 입력 최소화·마스킹 (jev-decisions/docs/data-handling.md 4장).
// 원칙: 판단에 필요한 최소한만, 보내기 전에 가린다. 원문은 어디에도 남기지 않는다.

export type RedactionCounts = Record<"rrn" | "card" | "account" | "phone" | "email" | "secret" | "url", number>;
export type Redacted = { readonly text: string; readonly originalChars: number; readonly counts: RedactionCounts };

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 텍스트의 개인정보·비밀값을 대체 토큰으로 바꾼다. 적용 순서가 의미를 가진다(구체적인 것부터). */
export function maskSensitive(input: string): { text: string; counts: RedactionCounts } {
  const counts: RedactionCounts = { rrn: 0, card: 0, account: 0, phone: 0, email: 0, secret: 0, url: 0 };
  let text = input;
  const sub = (re: RegExp, key: keyof RedactionCounts, token: string, accept?: (m: string) => boolean) => {
    text = text.replace(re, (m) => {
      if (accept && !accept(m)) return m;
      counts[key]++;
      return token;
    });
  };
  // 비밀값: 흔한 키 접두와 Bearer 토큰
  sub(/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, "secret", "⟨SECRET⟩");
  sub(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "secret", "Bearer ⟨SECRET⟩");
  // 쿼리스트링이 붙은 URL은 호스트만 남긴다
  text = text.replace(/https?:\/\/([^\s/?#]+)[^\s?#]*\?[^\s]*/g, (_m, host: string) => { counts.url++; return "https://" + host + "/⟨URL⟩"; });
  sub(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "email", "⟨EMAIL⟩");
  // 주민등록번호: 6자리 + 1~4로 시작하는 7자리
  sub(/\b\d{6}-?[1-4]\d{6}\b/g, "rrn", "⟨RRN⟩");
  // 카드번호: 13~19자리, Luhn 통과만
  sub(/\b(?:\d[ -]?){12,18}\d\b/g, "card", "⟨CARD⟩", (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
  });
  // 휴대전화·유선전화
  sub(/\b01[016789]-?\d{3,4}-?\d{4}\b/g, "phone", "⟨PHONE⟩");
  sub(/\b0(?:2|[3-6][1-5])-\d{3,4}-\d{4}\b/g, "phone", "⟨PHONE⟩");
  // 계좌번호: 하이픈으로 묶인 숫자 10~16자리
  sub(/\b\d{2,6}(?:-\d{2,6}){1,4}\b/g, "account", "⟨ACCOUNT⟩", (m) => {
    const n = m.replace(/\D/g, "").length;
    return n >= 10 && n <= 16;
  });
  return { text, counts };
}

/** 앞쪽만 남긴다(요청문: 지시는 대개 앞에 있다). */
export function redactHead(input: string, maxChars: number): Redacted {
  const { text, counts } = maskSensitive(input);
  return { text: text.length > maxChars ? text.slice(0, maxChars) : text, originalChars: input.length, counts };
}

/** 앞뒤를 남긴다(보고서: 결론은 대개 끝에 있다). */
export function redactHeadTail(input: string, maxChars: number): Redacted {
  const { text, counts } = maskSensitive(input);
  if (text.length <= maxChars) return { text, originalChars: input.length, counts };
  const half = Math.floor((maxChars - 20) / 2);
  return { text: text.slice(0, half) + "\n⟨중략 " + (text.length - half * 2) + "자⟩\n" + text.slice(-half), originalChars: input.length, counts };
}
