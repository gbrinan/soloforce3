import type { ReactNode } from "react";

// 주간 회고 마크다운 렌더러 — 외부 의존성 없이 필요한 문법만 지원:
// 제목(#~####), 목록(-, *, 1.), 구분선(---), 굵게(**), 인라인 코드(`)
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else nodes.push(<code key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const out: ReactNode[] = [];
  let list: string[] | null = null;
  let key = 0;
  const flushList = () => {
    if (!list) return;
    const items = list;
    out.push(
      <ul key={key++}>
        {items.map((li, i) => (
          <li key={i}>{inline(li, `li${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^[-*]\s+(.*)$/) ?? line.match(/^\d+\.\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const content = inline(h[2], `h${key}`);
      if (level === 1) out.push(<h1 key={key++}>{content}</h1>);
      else if (level === 2) out.push(<h2 key={key++}>{content}</h2>);
      else out.push(<h3 key={key++}>{content}</h3>);
    } else if (li) {
      (list ??= []).push(li[1]);
    } else if (/^-{3,}$/.test(line)) {
      flushList();
      out.push(<hr key={key++} />);
    } else if (!line.trim()) {
      flushList();
    } else {
      flushList();
      out.push(<p key={key++}>{inline(line, `p${key}`)}</p>);
    }
  }
  flushList();
  return <div className="md">{out}</div>;
}
