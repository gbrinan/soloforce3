"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

let mermaidSeq = 0;

// codeBlock 커스텀 뷰 — language가 mermaid면 다이어그램 미리보기를 코드 위에 렌더.
// mermaid 라이브러리는 다이어그램 블록이 실제로 존재할 때만 동적 로드(번들 영향 없음).
export default function CodeBlockView({ node }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "";
  const code = node.textContent;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (language !== "mermaid" || !code.trim()) {
      setSvg(null);
      return;
    }
    // 타이핑 중 과도한 재렌더 방지 (400ms 디바운스)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const { svg } = await mermaid.render(`note-mmd-${++mermaidSeq}`, code);
        setSvg(svg);
        setError(false);
      } catch {
        setSvg(null);
        setError(true);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [language, code]);

  return (
    <NodeViewWrapper>
      {language === "mermaid" && svg && (
        <div
          contentEditable={false}
          style={{
            background: "var(--mantine-color-dark-8, #16181d)",
            border: "1px solid var(--mantine-color-dark-5, #2a2d34)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 4,
            overflowX: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {language === "mermaid" && error && (
        <div contentEditable={false} style={{ fontSize: 12, color: "#f87171", marginBottom: 4 }}>
          다이어그램 문법 오류 — 아래 코드를 확인하세요
        </div>
      )}
      <pre>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
