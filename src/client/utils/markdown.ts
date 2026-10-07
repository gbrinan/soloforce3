import { marked, type Token } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import markdownLang from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('md', markdownLang);

// 산출물 디렉토리 prefix + 알려진 확장자만 클릭 가능 링크로 변환
// [2026-08-10] 확장자 누락 보강 — jsonl/.posted/ts/yaml/py 등이 빠져 실재 산출물이 링크가 안 됐다.
//   ^…$ 전체 매칭이라 서버(jobs.ts) 같은 '절단→유령 경로' 피해는 없었고, 미검출만 발생했다.
//   정본 목록은 src/server/utils/artifact-ext.ts OUTPUT_EXT.
//   ★ 의도적 중복: 클라이언트 번들은 src/server를 import하지 않는다(경계 유지). 목록 변경 시 양쪽 같이 고칠 것.
const FILE_PATH_RE = /^(?:history\/(?:outputs|external-reports|attachments)|agentTeam|outputs)\/[^\s]+\.(?:jsonl|json|pptx|xlsx|docx|pdf|csv|mdx|md|txt|yaml|yml|html|htm|css|svg|zip|tsx|ts|jsx|mjs|cjs|js|py|sh|pl|awk|png|jpeg|jpg|gif|webp|webm|mp4)(?:\.posted)?$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

// h1~h3 토큰에 id 부여. extractTOC와 renderer 양쪽에서 동일 규칙 공유.
function assignHeadingIds(tokens: Token[]): void {
  const counts = new Map<string, number>();
  let autoIdx = 0;
  const walk = (ts: Token[]): void => {
    for (const t of ts) {
      if (t.type === 'heading' && (t as any).depth <= 3) {
        const base = slugify((t as any).text || '') || `heading-${++autoIdx}`;
        const n = (counts.get(base) || 0) + 1;
        counts.set(base, n);
        (t as any).id = n === 1 ? base : `${base}-${n - 1}`;
      }
      const nested = (t as any).tokens as Token[] | undefined;
      if (Array.isArray(nested)) walk(nested);
    }
  };
  walk(tokens);
}

// Mark 앱 차용 — 위키링크 `[[target]]` 또는 `[[target|label]]` (Obsidian 호환).
// 자료실 내부 파일 참조용. 클릭 핸들러 통합은 후속 작업, 본 extension은 출력 anchor만 보장.
const wikilinkExtension = {
  name: 'wikilink',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('[['); },
  tokenizer(src: string) {
    const m = /^\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    return {
      type: 'wikilink',
      raw: m[0],
      target: m[1].trim(),
      label: (m[2] || m[1]).trim(),
    };
  },
  renderer(token: { target: string; label: string }) {
    const t = escapeHtml(token.target);
    const l = escapeHtml(token.label);
    return `<a class="wikilink" data-wikilink="true" data-target="${t}" href="#wikilink:${t}">${l}</a>`;
  },
};

// Mark 앱 차용 — 스포일러 `||content||` (Discord/Reddit 호환). 클릭/포커스 시 reveal.
const spoilerExtension = {
  name: 'spoiler',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('||'); },
  tokenizer(src: string) {
    const m = /^\|\|([^\n|][^\n]*?)\|\|/.exec(src);
    if (!m) return undefined;
    return {
      type: 'spoiler',
      raw: m[0],
      text: m[1],
    };
  },
  renderer(token: { text: string }) {
    return `<span class="spoiler" tabindex="0" role="button" aria-label="스포일러 표시">${escapeHtml(token.text)}</span>`;
  },
};

// 수식 — $$...$$(블록) / $...$(인라인). 렌더는 placeholder로 두고 mountMath가 KaTeX를
// 동적 import해 치환한다 (mermaid와 동일 패턴 — 수식 없는 문서는 번들 영향 0).
// 인라인 $는 통화 표기($5, $100) 오탐 방지: 여는 $ 뒤·닫는 $ 앞 공백 금지, 닫는 $ 뒤 숫자 금지.
const blockMathExtension = {
  name: 'blockMath',
  level: 'block' as const,
  start(src: string) { return src.indexOf('$$'); },
  tokenizer(src: string) {
    const m = /^\$\$\n?([\s\S]+?)\n?\$\$(?:\n+|$)/.exec(src);
    if (!m) return undefined;
    return { type: 'blockMath', raw: m[0], tex: m[1].trim() };
  },
  renderer(token: { tex: string }) {
    return `<div class="math math-block" data-tex="${escapeHtml(token.tex)}"><code>${escapeHtml(token.tex)}</code></div>`;
  },
};

const inlineMathExtension = {
  name: 'inlineMath',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('$'); },
  tokenizer(src: string) {
    const m = /^\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?!\d)/.exec(src);
    if (!m) return undefined;
    return { type: 'inlineMath', raw: m[0], tex: m[1] };
  },
  renderer(token: { tex: string }) {
    return `<span class="math math-inline" data-tex="${escapeHtml(token.tex)}"><code>${escapeHtml(token.tex)}</code></span>`;
  },
};

// GitHub alerts (`> [!NOTE]` 등) — open-knowledge UX 차용, 자체 구현 (GPL 코드 미사용).
const CALLOUT_META: Record<string, { icon: string; label: string }> = {
  note: { icon: 'ℹ️', label: '참고' },
  tip: { icon: '💡', label: '팁' },
  important: { icon: '📌', label: '중요' },
  warning: { icon: '⚠️', label: '주의' },
  caution: { icon: '🚨', label: '경고' },
};

marked.use({
  extensions: [wikilinkExtension as any, spoilerExtension as any, blockMathExtension as any, inlineMathExtension as any],
  hooks: {
    processAllTokens(tokens) {
      assignHeadingIds(tokens as Token[]);
      return tokens;
    },
  },
  renderer: {
    blockquote({ tokens }): string {
      const body = this.parser.parse(tokens);
      // 첫 문단 선두의 [!TYPE] 마커 감지 — 마커 제거 후 콜아웃 박스로 승격
      const m = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i.exec(body);
      if (m) {
        const kind = m[1].toLowerCase();
        const meta = CALLOUT_META[kind];
        const rest = body.slice(m[0].length);
        // 마커 단독 문단(<p>[!NOTE]</p>)이면 닫는 태그만 남으므로 제거, 아니면 문단 재개방
        const inner = rest.startsWith('</p>') ? rest.slice(4) : `<p>${rest}`;
        return `<div class="md-callout md-callout-${kind}"><p class="md-callout-title">${meta.icon} ${meta.label}</p>${inner}</div>`;
      }
      return `<blockquote>${body}</blockquote>`;
    },
    heading(token) {
      const { tokens, depth } = token;
      const id = (token as any).id as string | undefined;
      const inline = this.parser.parseInline(tokens);
      if (id && depth <= 3) return `<h${depth} id="${escapeHtml(id)}">${inline}</h${depth}>`;
      return `<h${depth}>${inline}</h${depth}>`;
    },
    code({ text, lang }): string {
      const langKey = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      // mermaid는 hljs 미등록 — mountMermaid가 pre>code.language-mermaid 셀렉터로 SVG 치환하므로
      // 클래스가 반드시 붙어야 한다. raw text 보존(escape만), highlight 건너뜀.
      if (langKey === 'mermaid') {
        return `<pre><code class="language-mermaid">${escapeHtml(text)}</code></pre>`;
      }
      if (langKey && hljs.getLanguage(langKey)) {
        try {
          const out = hljs.highlight(text, { language: langKey, ignoreIllegals: true });
          return `<pre><code class="hljs language-${escapeHtml(langKey)}">${out.value}</code></pre>`;
        } catch {
          // fallthrough
        }
      }
      return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
    },
    codespan({ text }): string {
      // marked의 codespan token.text는 raw(미이스케이프)다. 엔티티가 섞여 올 수 있어
      // FILE_PATH 매칭 전 디코드해 검사하고, 출력은 반드시 escape해 raw HTML(예: `<img>`) 주입을 막는다.
      const decoded = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (FILE_PATH_RE.test(decoded)) {
        const path = escapeHtml(decoded);
        return `<a class="file-path-link" data-path="${path}" href="#" title="클릭하여 산출물 열기"><code>${escapeHtml(decoded)}</code></a>`;
      }
      return `<code>${escapeHtml(text)}</code>`;
    },
    link({ href, tokens }): string {
      const text = this.parser.parseInline(tokens);
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      return `<a href="${escapeHtml(href || '')}">${text}</a>`;
    },
  },
});

// 미치환 템플릿 리터럴(예: {mycrewLogo})이나 빈 src를 가진 <img>는 깨진 이미지로 렌더되므로
// sanitize 단계에서 노드째 제거한다. 정상 src(http/https/상대경로/data:)는 {…} 패턴이 없어 영향 없음.
// 모듈 로드 시 1회만 등록(renderMarkdown 호출마다 누적 방지).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'IMG') return;
  const src = node.getAttribute('src') ?? '';
  // {mycrewLogo}, {logo-url} 같은 미치환 식별자 토큰만 차단. CSS 중괄호({color:red})·정상 URL은 비매칭.
  if (!src.trim() || /\{[A-Za-z_][\w-]*\}/.test(src)) node.remove();
});

// 문서 선두 YAML frontmatter(`---`)를 메타 카드로 렌더. 단순 `key: value`·`- 리스트`만 파싱하고
// 그 외 형태(중첩 등)는 값 원문을 그대로 표시한다 (YAML 라이브러리 미도입 — 뷰어 용도로 충분).
function extractFrontmatter(src: string): { body: string; html: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
  if (!m) return { body: src, html: '' };
  const rows: Array<{ key: string; value: string }> = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) { rows.push({ key: kv[1], value: kv[2] }); continue; }
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li && rows.length > 0) {
      const last = rows[rows.length - 1];
      last.value = last.value ? `${last.value}, ${li[1]}` : li[1];
      continue;
    }
    return { body: src, html: '' }; // 파싱 불가 라인 → frontmatter로 취급하지 않음 (원문 그대로)
  }
  if (rows.length === 0) return { body: src, html: '' };
  const tr = rows.map((r) =>
    `<tr><th>${escapeHtml(r.key)}</th><td>${escapeHtml(r.value)}</td></tr>`).join('');
  return {
    body: src.slice(m[0].length),
    html: `<div class="md-frontmatter"><table>${tr}</table></div>`,
  };
}

export function renderMarkdown(src: string): string {
  try {
    const fm = extractFrontmatter(src);
    const raw = fm.html + (marked.parse(fm.body) as string);
    const clean = DOMPurify.sanitize(raw, {
      ADD_ATTR: [
        'data-path', 'target', 'rel', 'id', 'class',
        'viewBox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
        'transform', 'fill', 'stroke', 'stroke-width',
        'width', 'height', 'points', 'cx', 'cy', 'r', 'dy', 'dx', 'open',
        // wikilink / spoiler extension용
        'data-wikilink', 'data-target', 'tabindex', 'role', 'aria-label',
      ],
      ADD_TAGS: [
        'details', 'summary',
        'svg', 'g', 'path', 'rect', 'circle', 'line',
        'text', 'tspan', 'title', 'defs', 'marker', 'foreignObject',
      ],
      ALLOW_DATA_ATTR: true,
    });
    // 넓은 테이블은 칸을 찌그러뜨리지 않고 가로 스크롤로: <table>을 스크롤 컨테이너로 감싼다.
    return clean
      .replace(/<table/g, '<div class="md-table-wrap"><table')
      .replace(/<\/table>/g, '</table></div>');
  } catch {
    return src;
  }
}

// 동적 mermaid 마운트: pre>code.language-mermaid 노드를 찾아 SVG로 치환.
// mermaid 블록이 없으면 import도 하지 않아 번들 영향 0.
// 안전: 같은 노드를 두 번 처리하지 않도록 data-mermaid-rendered 마킹.
export async function mountMermaid(root: HTMLElement): Promise<void> {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  ).filter((n) => !n.dataset.mermaidRendered);
  if (nodes.length === 0) return;

  let mermaidApi: { render: (id: string, src: string) => Promise<{ svg: string }>; initialize: (cfg: object) => void };
  try {
    const mod = await import('mermaid');
    mermaidApi = (mod.default ?? mod) as typeof mermaidApi;
    mermaidApi.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
  } catch (err) {
    console.warn('[mermaid] dynamic import failed:', err);
    return;
  }

  for (let i = 0; i < nodes.length; i++) {
    const code = nodes[i];
    const pre = code.parentElement;
    if (!pre) continue;
    const src = code.textContent ?? '';
    const id = `mermaid-${Date.now()}-${i}`;
    try {
      const { svg } = await mermaidApi.render(id, src);
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-rendered';
      wrapper.dataset.mermaidRendered = '1';
      wrapper.innerHTML = svg;
      pre.replaceWith(wrapper);
    } catch (err) {
      code.dataset.mermaidRendered = 'error';
      console.warn('[mermaid] render failed:', err);
    }
  }
}

// 동적 KaTeX 마운트: .math[data-tex] 노드를 수식 SVG/HTML로 치환.
// 수식 블록이 없으면 import도 하지 않아 번들 영향 0. 렌더 실패 시 원본 코드 표시 유지.
export async function mountMath(root: HTMLElement): Promise<void> {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>('.math[data-tex]'),
  ).filter((n) => !n.dataset.mathRendered);
  if (nodes.length === 0) return;

  let katex: { renderToString: (tex: string, opts?: object) => string };
  try {
    const mod = await import('katex');
    katex = (mod.default ?? mod) as typeof katex;
    await import('katex/dist/katex.min.css');
  } catch (err) {
    console.warn('[katex] dynamic import failed:', err);
    return;
  }

  for (const node of nodes) {
    const tex = node.dataset.tex ?? '';
    const displayMode = node.classList.contains('math-block');
    try {
      node.innerHTML = katex.renderToString(tex, { displayMode, throwOnError: true });
      node.dataset.mathRendered = '1';
    } catch {
      node.dataset.mathRendered = 'error'; // 문법 오류 — 원본 코드 스팬 유지
    }
  }
}

export interface TocEntry {
  level: 2 | 3;
  text: string;
  id: string;
}

export function extractTOC(src: string): TocEntry[] {
  try {
    const tokens = marked.lexer(src);
    assignHeadingIds(tokens);
    const out: TocEntry[] = [];
    const walk = (ts: Token[]): void => {
      for (const t of ts) {
        if (t.type === 'heading') {
          const depth = (t as any).depth as number;
          const id = (t as any).id as string | undefined;
          const text = ((t as any).text || '').trim();
          if ((depth === 2 || depth === 3) && id && text) {
            out.push({ level: depth as 2 | 3, text, id });
          }
        }
        const nested = (t as any).tokens as Token[] | undefined;
        if (Array.isArray(nested)) walk(nested);
      }
    };
    walk(tokens);
    return out;
  } catch {
    return [];
  }
}

export async function loadMarked(): Promise<void> {
  // marked는 이미 import됨, 별도 로드 불필요
}
