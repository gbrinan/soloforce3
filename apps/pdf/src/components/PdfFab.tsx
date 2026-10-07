"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Drawer,
  Group,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconMessageCircle, IconSearch } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { TOOLS, getTool } from "@/lib/stirling";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";
import { extractPdfText } from "@/lib/pdf-ai";

// Local keyword → tool routing. No backend call; picks the best matching tool
// from a free-text description and selects it in the main screen.
const KEYWORDS: Record<string, string[]> = {
  merge: ["합치", "병합", "결합", "merge", "combine", "join", "結合", "まとめ"],
  split: ["분할", "나누", "쪼개", "split", "separate", "分割", "分ける"],
  "remove-pages": ["페이지 삭제", "페이지 제거", "remove page", "delete page", "ページ削除"],
  compress: ["압축", "용량", "줄이", "작게", "compress", "smaller", "reduce", "size", "圧縮", "縮小"],
  rotate: ["회전", "돌리", "rotate", "turn", "回転"],
  flatten: ["평탄화", "flatten", "고정", "フラット"],
  repair: ["복구", "수리", "repair", "fix", "broken", "corrupt", "修復"],
  watermark: ["워터마크", "watermark", "도장", "ウォーターマーク"],
  "add-page-numbers": ["페이지 번호", "page number", "번호 추가", "ページ番号"],
  "add-password": ["비밀번호 추가", "암호화", "잠금", "password", "encrypt", "lock", "パスワード追加"],
  "remove-password": ["비밀번호 제거", "잠금 해제", "unlock", "decrypt", "パスワード削除"],
  ocr: ["ocr", "텍스트 인식", "문자 인식", "스캔", "scan", "recognize", "文字認識"],
  "extract-images": ["이미지 추출", "extract image", "画像抽出"],
  "pdf-to-img": ["이미지로", "사진으로", "png", "jpg", "to image", "변환", "image", "画像に"],
  "img-to-pdf": ["이미지를", "사진을", "image to", "img to", "pdf로", "to pdf", "画像から", "pdfに"],
  "pdf-to-word": ["word로", "워드로", "docx", "to word", "pdf to word", "Wordに"],
  "office-to-pdf": ["office", "word를", "excel을", "ppt를", "워드를", "엑셀을", "파워포인트", "docx to", "xlsx to", "pptx to", "Officeから"],
};

function matchTool(text: string): string | null {
  const q = text.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const [id, words] of Object.entries(KEYWORDS)) {
    const score = words.reduce((n, w) => (q.includes(w.toLowerCase()) ? n + 1 : n), 0);
    if (score > 0 && (!best || score > best.score)) best = { id, score };
  }
  return best?.id ?? null;
}

export default function PdfFab({
  opened,
  onClose,
  onPick,
  file,
}: {
  opened: boolean;
  onClose: () => void;
  onPick: (toolId: string) => void;
  file: File | null;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");

  // Document Q&A state (Claude CLI backed)
  const [qa, setQa] = useState<{ q: string; a: string; snippets: string[] }[]>([]);
  const [asking, setAsking] = useState(false);
  // Cache extracted document text per file (extraction is expensive).
  const textCache = useRef<{ file: File; text: string } | null>(null);

  useEffect(() => {
    setQa([]);
    textCache.current = null;
  }, [file]);

  const submit = () => {
    const intent = text.trim();
    if (!intent) return;
    const id = matchTool(intent);
    if (id) {
      const tool = getTool(id);
      onPick(id);
      onClose();
      setText("");
      notifications.show({
        color: "jarvis",
        title: t("fab.matched"),
        message: tool ? `${tool.icon} ${t(tool.labelKey)}` : id,
      });
    } else {
      notifications.show({ color: "yellow", message: t("fab.noMatch") });
    }
  };

  const ask = async () => {
    const question = text.trim();
    if (!question || !file || asking) return;
    setAsking(true);
    setText("");
    try {
      let documentText: string;
      if (textCache.current?.file === file) {
        documentText = textCache.current.text;
      } else {
        documentText = await extractPdfText(file);
        textCache.current = { file, text: documentText };
      }
      const res = await fetch(apiUrl("/api/pdf/ask"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, documentText }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const err = (await res.json()) as { error?: string; detail?: string };
          detail = err.detail || err.error || detail;
        } catch { /* non-json */ }
        notifications.show({ color: "red", title: t("qa.askFailed"), message: detail });
        return;
      }
      const data = (await res.json()) as { answer: string; sourceSnippets?: string[] };
      setQa((list) => [
        ...list,
        { q: question, a: data.answer, snippets: data.sourceSnippets ?? [] },
      ]);
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("qa.askFailed"),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAsking(false);
    }
  };

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        position="right"
        size="md"
        title={t("fab.title")}
        styles={{ content: { background: "#070D1A" }, header: { background: "#070D1A" } }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t("fab.hint")}
          </Text>

          <Group gap={6}>
            {TOOLS.map((tl) => (
              <Button
                key={tl.id}
                size="compact-sm"
                variant="light"
                color="jarvis"
                onClick={() => {
                  onPick(tl.id);
                  onClose();
                }}
              >
                {tl.icon} {t(tl.labelKey)}
              </Button>
            ))}
          </Group>

          {/* Document Q&A history */}
          {qa.length > 0 && (
            <Stack gap="xs" style={{ maxHeight: 280, overflowY: "auto" }}>
              {qa.map((item, i) => (
                <Box key={i}>
                  <Text size="sm" fw={600} c="indigo.3">Q. {item.q}</Text>
                  <Text size="sm" c="gray.3" style={{ whiteSpace: "pre-wrap" }}>
                    {item.a}
                  </Text>
                  {item.snippets.length > 0 && (
                    <Stack gap={4} mt={4}>
                      {item.snippets.map((snippet, j) => (
                        <Text
                          key={j}
                          size="xs"
                          c="dimmed"
                          style={{
                            borderLeft: "2px solid #1B2740",
                            paddingLeft: 8,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {snippet}
                        </Text>
                      ))}
                    </Stack>
                  )}
                </Box>
              ))}
            </Stack>
          )}
          {asking && (
            <Text size="xs" c="dimmed">{t("qa.generating")}</Text>
          )}

          <Textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            minRows={4}
            autosize
            placeholder={t("fab.placeholder")}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
          <Group justify="flex-end">
            <Button
              variant="light"
              disabled={text.trim().length === 0 || !file}
              loading={asking}
              leftSection={<IconMessageCircle size={14} />}
              title={file ? t("qa.askDocTitle") : t("qa.uploadFirst")}
              onClick={() => void ask()}
            >
              {t("qa.askDoc")}
            </Button>
            <Button variant="filled"
              disabled={text.trim().length === 0}
              leftSection={<IconSearch size={14} />}
              onClick={submit}
            >
              {t("fab.send")}
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
}
