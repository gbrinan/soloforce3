"use client";

import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { marked } from "marked";
import CodeBlockView from "./CodeBlockView";
import { useEffect, useState } from "react";
import { Textarea, Button, Alert, Badge, Group } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import { plainTextFromHtml, type Note } from "@/lib/storage";
import { useI18n } from "@/lib/i18n";

interface NoteEditorProps {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
}

interface AiResult {
  summary?: string;
  title?: string;
  tags?: string[];
}

// 레거시 노트(ko 하드코딩 시절) 기본 제목 — 현재 로케일 기본 제목과 함께 "빈 제목"으로 취급
const LEGACY_EMPTY_TITLE = "제목 없음";

// 붙여넣은 평문이 마크다운으로 보이는가 — 표(|...|), 헤딩, 리스트, 코드펜스 등 구조 신호 감지.
// 일반 문장 붙여넣기는 그대로 두고, md 문서일 때만 HTML 변환해 표·코드블록 UI를 유지한다.
function looksLikeMarkdown(text: string): boolean {
  if (!text.includes("\n")) return false;
  return (
    /^\s{0,3}#{1,6}\s/m.test(text) || // 헤딩
    /^\s{0,3}\|.+\|\s*$/m.test(text) || // 표 행
    /^\s{0,3}```/m.test(text) || // 코드펜스
    /^\s{0,3}[-*+]\s+\S/m.test(text) || // 불릿 리스트
    /^\s{0,3}\d+\.\s+\S/m.test(text) // 번호 리스트
  );
}

// GitHub alerts 라벨 — tiptap엔 콜아웃 노드가 없어 blockquote 첫 줄을 굵은 라벨로 승격
const ALERT_LABELS: Record<string, string> = {
  NOTE: "ℹ️ 참고", TIP: "💡 팁", IMPORTANT: "📌 중요", WARNING: "⚠️ 주의", CAUTION: "🚨 경고",
};

// md 붙여넣기 전처리 — (1) 선두 frontmatter를 key/value 표로, (2) `> [!NOTE]` 마커를 굵은 라벨로.
// tiptap 스키마(표·blockquote)만으로 표현해 편집·재저장에도 구조가 유지된다.
function preprocessMarkdown(text: string): string {
  let out = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(out);
  if (fm) {
    const rows = fm[1].split(/\r?\n/)
      .map((l) => /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null);
    if (rows.length > 0) {
      const table = ["| 항목 | 값 |", "| --- | --- |", ...rows.map((m) => `| ${m[1]} | ${m[2] || ""} |`)].join("\n");
      out = `${table}\n\n${out.slice(fm[0].length)}`;
    }
  }
  return out.replace(
    /^(\s{0,3}>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim,
    (_, prefix: string, kind: string) => `${prefix}**${ALERT_LABELS[kind.toUpperCase()]}**`,
  );
}

export default function NoteEditor({ note, onChange }: NoteEditorProps) {
  const { t } = useI18n();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [titleSuggestion, setTitleSuggestion] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      // codeBlock 커스텀 뷰 — mermaid 코드펜스를 다이어그램으로 미리보기
      CodeBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockView);
        },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: note.content,
    immediatelyRender: false,
    editorProps: {
      // md 파일/텍스트 붙여넣기 — 표·코드블록·리스트 구조를 렌더된 UI로 유지
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const hasHtml = (event.clipboardData?.getData("text/html") ?? "").trim().length > 0;
        if (hasHtml || !looksLikeMarkdown(text)) return false; // 기본 동작
        try {
          const html = marked.parse(preprocessMarkdown(text), { gfm: true, breaks: true, async: false }) as string;
          // insertContent가 HTML을 tiptap 노드로 파싱 — Table 확장 덕분에 표가 실제 표로 유지
          editor?.commands.insertContent(html);
          return true;
        } catch {
          return false;
        }
      },
    },
    onUpdate: ({ editor }) => {
      onChange({ content: editor.getHTML() });
    },
  });

  // 노트 전환 시 에디터 내용 + AI 표시 상태 동기화 (다른 노트 클릭)
  useEffect(() => {
    if (editor && editor.getHTML() !== note.content) {
      editor.commands.setContent(note.content, false);
    }
    setSummary(null);
    setTitleSuggestion(null);
    setAiError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const runAi = async () => {
    const text = plainTextFromHtml(note.content);
    if (!text) {
      setAiError(t("editor.aiEmpty"));
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(apiUrl("/api/notes/ai"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode: "all" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(data?.detail || t("editor.requestFail", { status: res.status }));
      }
      const data = (await res.json()) as AiResult;
      setSummary(data.summary ?? null);
      if (Array.isArray(data.tags)) onChange({ tags: data.tags });
      // 제목이 비었거나 기본값일 때만 자동 제목을 제안한다.
      const trimmed = note.title.trim();
      const titleEmpty = !trimmed || trimmed === t("note.untitled") || trimmed === LEGACY_EMPTY_TITLE;
      setTitleSuggestion(titleEmpty && data.title ? data.title : null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : t("editor.aiFail"));
    } finally {
      setAiLoading(false);
    }
  };

  const applyTitle = () => {
    if (titleSuggestion) onChange({ title: titleSuggestion });
    setTitleSuggestion(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <style>{`
        .ProseMirror {
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
        }
        .ProseMirror:focus,
        .ProseMirror:focus-visible {
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
        }
        /* md 표 렌더 — GFM 표 붙여넣기 시 표 UI 유지 */
        .ProseMirror table {
          border-collapse: collapse;
          margin: 12px 0;
          width: 100%;
          overflow-x: auto;
          display: block;
        }
        .ProseMirror table tr { border-bottom: 1px solid var(--mantine-color-dark-4, #373a40); }
        .ProseMirror table th, .ProseMirror table td {
          border: 1px solid var(--mantine-color-dark-4, #373a40);
          padding: 6px 10px;
          min-width: 60px;
          vertical-align: top;
        }
        .ProseMirror table th {
          background: var(--mantine-color-dark-6, #25262b);
          font-weight: 600;
          text-align: left;
        }
        .ProseMirror pre {
          background: var(--mantine-color-dark-8, #16181d);
          border-radius: 8px;
          padding: 10px 12px;
          overflow-x: auto;
        }
      `}</style>
      <div style={{ minWidth: 0, maxWidth: "100%", padding: "24px 24px 0" }}>
        <Textarea
          value={note.title}
          onChange={(e) => onChange({ title: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              editor?.commands.focus();
            }
          }}
          placeholder={t("note.untitled")}
          variant="unstyled"
          size="xl"
          autosize
          minRows={1}
          maxRows={4}
          styles={{
            input: {
              fontWeight: 700,
              fontSize: 28,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
              resize: "none",
            },
          }}
        />
        <Group gap={8} mt={8} mb={4} wrap="wrap">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconSparkles size={14} />}
            loading={aiLoading}
            onClick={runAi}
          >
            {t("editor.aiButton")}
          </Button>
          {(note.tags ?? []).map((t) => (
            <Badge key={t} variant="light" color="grape" size="sm">
              {t}
            </Badge>
          ))}
        </Group>
        {aiError && (
          <Alert color="red" mt={8} p="xs" variant="light">
            {aiError}
          </Alert>
        )}
        {titleSuggestion && (
          <Alert color="blue" mt={8} p="xs" variant="light">
            <Group justify="space-between" gap={8} wrap="nowrap">
              <span>{t("editor.titleSuggestion", { title: titleSuggestion })}</span>
              <Button size="compact-xs" variant="subtle" onClick={applyTitle}>
                {t("editor.apply")}
              </Button>
            </Group>
          </Alert>
        )}
        {summary && (
          <Alert color="teal" mt={8} p="xs" variant="light" title={t("editor.summary")}>
            {summary}
          </Alert>
        )}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px", minWidth: 0 }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
