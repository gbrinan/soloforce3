"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconDownload,
  IconListDetails,
  IconMessageCircle,
  IconTable,
  IconForms,
} from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { extractPdfText, renderPdfPageToPng } from "@/lib/pdf-ai";
import type { ExtractedTable } from "@/app/api/pdf/extract-table/route";
import type { ExtractedFields } from "@/app/api/pdf/extract-fields/route";
import type { AskResult } from "@/app/api/pdf/ask/route";

interface OutlineResult {
  summary: string;
  toc: { title: string; page?: number }[];
}

interface PdfAiPanelProps {
  file: File;
  pageNumber: number;
  onPageChange: (page: number) => void;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const err = (await res.json()) as { error?: string; detail?: string };
    return err.detail || err.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Excel-friendly CSV (BOM prefix for Korean text).
function tableToCsv(t: ExtractedTable): string {
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [t.headers.map(esc).join(","), ...t.rows.map((r) => r.map(esc).join(","))];
  return "\uFEFF" + lines.join("\n");
}

export default function PdfAiPanel({ file, pageNumber, onPageChange }: PdfAiPanelProps) {
  const { t } = useI18n();
  const [outline, setOutline] = useState<OutlineResult | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const [tables, setTables] = useState<ExtractedTable[] | null>(null);
  const [tablesPage, setTablesPage] = useState<number | null>(null);
  const [tablesLoading, setTablesLoading] = useState(false);

  const [fields, setFields] = useState<ExtractedFields | null>(null);
  const [fieldsPage, setFieldsPage] = useState<number | null>(null);
  const [fieldsLoading, setFieldsLoading] = useState(false);

  // Document Q&A — conversation history lives only in client state.
  const [qaHistory, setQaHistory] = useState<({ question: string } & AskResult)[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  // Cache extracted document text per file (extraction is expensive).
  const textCache = useRef<{ file: File; text: string } | null>(null);

  useEffect(() => {
    setOutline(null);
    setTables(null);
    setTablesPage(null);
    setFields(null);
    setFieldsPage(null);
    setQaHistory([]);
    setQuestion("");
    textCache.current = null;
  }, [file]);

  const getDocumentText = async (): Promise<string> => {
    if (textCache.current?.file === file) return textCache.current.text;
    const text = await extractPdfText(file);
    textCache.current = { file, text };
    return text;
  };

  const fail = (title: string, message: string) =>
    notifications.show({ color: "red", title, message });

  const runOutline = async () => {
    setOutlineLoading(true);
    try {
      const documentText = await getDocumentText();
      const res = await fetch(apiUrl("/api/pdf/outline"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentText }),
      });
      if (!res.ok) {
        fail(t("ai.summaryFailed"), await readErrorDetail(res));
        return;
      }
      setOutline((await res.json()) as OutlineResult);
    } catch (e) {
      fail(t("ai.summaryFailed"), e instanceof Error ? e.message : String(e));
    } finally {
      setOutlineLoading(false);
    }
  };

  const postPageImage = async (endpoint: string): Promise<Response> => {
    const png = await renderPdfPageToPng(file, pageNumber);
    const form = new FormData();
    form.append("image", png, "page.png");
    return fetch(apiUrl(endpoint), { method: "POST", body: form });
  };

  const runTables = async () => {
    setTablesLoading(true);
    const page = pageNumber;
    try {
      const res = await postPageImage("/api/pdf/extract-table");
      if (!res.ok) {
        fail(t("ai.tableFailed"), await readErrorDetail(res));
        return;
      }
      const data = (await res.json()) as { tables: ExtractedTable[] };
      setTables(data.tables);
      setTablesPage(page);
      if (data.tables.length === 0) {
        notifications.show({ color: "yellow", message: t("ai.noTablesFound") });
      }
    } catch (e) {
      fail(t("ai.tableFailed"), e instanceof Error ? e.message : String(e));
    } finally {
      setTablesLoading(false);
    }
  };

  const runFields = async () => {
    setFieldsLoading(true);
    const page = pageNumber;
    try {
      const res = await postPageImage("/api/pdf/extract-fields");
      if (!res.ok) {
        fail(t("ai.fieldFailed"), await readErrorDetail(res));
        return;
      }
      setFields((await res.json()) as ExtractedFields);
      setFieldsPage(page);
    } catch (e) {
      fail(t("ai.fieldFailed"), e instanceof Error ? e.message : String(e));
    } finally {
      setFieldsLoading(false);
    }
  };

  const runAsk = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setQuestion("");
    try {
      const documentText = await getDocumentText();
      const res = await fetch(apiUrl("/api/pdf/ask"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, documentText }),
      });
      if (!res.ok) {
        fail(t("qa.askFailed"), await readErrorDetail(res));
        return;
      }
      const data = (await res.json()) as AskResult;
      setQaHistory((list) => [...list, { question: q, ...data }]);
    } catch (e) {
      fail(t("qa.askFailed"), e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  const baseName = file.name.replace(/\.pdf$/i, "");

  return (
    <Box style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 16 }}>
      <Stack gap="md">
        {/* ── Summary + TOC ─────────────────────────── */}
        <Card withBorder padding="md" style={{ background: "#070D1A", borderColor: "#1B2740" }}>
          <Group justify="space-between" mb="xs">
            <Group gap={6}>
              <IconListDetails size={16} color="#818CF8" />
              <Text size="sm" fw={600} c="gray.2">{t("ai.outlineTitle")}</Text>
            </Group>
            <Button
              size="compact-xs"
              variant="light"
              loading={outlineLoading}
              onClick={() => void runOutline()}
            >
              {outline ? t("ai.regenerate") : t("ai.generateOutline")}
            </Button>
          </Group>
          {outlineLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">{t("ai.analyzingDoc")}</Text>
            </Group>
          )}
          {outline && !outlineLoading && (
            <Stack gap="xs">
              <Text size="sm" c="gray.3" style={{ whiteSpace: "pre-wrap" }}>
                {outline.summary}
              </Text>
              {outline.toc.length > 0 && (
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={600}>{t("ai.toc")}</Text>
                  {outline.toc.map((item, i) => (
                    <UnstyledButton
                      key={i}
                      disabled={!item.page}
                      onClick={() => item.page && onPageChange(item.page)}
                      style={{ cursor: item.page ? "pointer" : "default" }}
                    >
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" c={item.page ? "indigo.3" : "gray.4"} truncate>
                          {item.title}
                        </Text>
                        {item.page && (
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>p.{item.page}</Text>
                        )}
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
            </Stack>
          )}
          {!outline && !outlineLoading && (
            <Text size="xs" c="dimmed">{t("ai.outlineHint")}</Text>
          )}
        </Card>

        {/* ── Document Q&A ──────────────────────────── */}
        <Card withBorder padding="md" style={{ background: "#070D1A", borderColor: "#1B2740" }}>
          <Group gap={6} mb="xs">
            <IconMessageCircle size={16} color="#818CF8" />
            <Text size="sm" fw={600} c="gray.2">{t("qa.askDoc")}</Text>
          </Group>
          {qaHistory.length > 0 && (
            <Stack gap="sm" mb="xs" style={{ maxHeight: 320, overflowY: "auto" }}>
              {qaHistory.map((item, i) => (
                <Box key={i}>
                  <Text size="sm" fw={600} c="indigo.3">Q. {item.question}</Text>
                  <Text size="sm" c="gray.3" style={{ whiteSpace: "pre-wrap" }}>
                    {item.answer}
                  </Text>
                  {item.sourceSnippets.length > 0 && (
                    <Stack gap={4} mt={4}>
                      {item.sourceSnippets.map((snippet, j) => (
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
            <Group gap="xs" mb="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">{t("qa.generating")}</Text>
            </Group>
          )}
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
            minRows={2}
            autosize
            placeholder={t("qa.placeholder")}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void runAsk();
            }}
          />
          <Group justify="flex-end" mt="xs">
            <Button
              size="compact-sm"
              variant="light"
              loading={asking}
              disabled={question.trim().length === 0}
              leftSection={<IconMessageCircle size={14} />}
              onClick={() => void runAsk()}
            >
              {t("qa.ask")}
            </Button>
          </Group>
          {qaHistory.length === 0 && !asking && (
            <Text size="xs" c="dimmed" mt={6}>{t("qa.hint")}</Text>
          )}
        </Card>

        {/* ── Table extraction (current page) ───────── */}
        <Card withBorder padding="md" style={{ background: "#070D1A", borderColor: "#1B2740" }}>
          <Group justify="space-between" mb="xs">
            <Group gap={6}>
              <IconTable size={16} color="#818CF8" />
              <Text size="sm" fw={600} c="gray.2">{t("ai.tableExtract")}</Text>
              {tablesPage !== null && <Badge size="xs" variant="light">{t("ai.pageResult").replace("{n}", String(tablesPage))}</Badge>}
            </Group>
            <Button
              size="compact-xs"
              variant="light"
              loading={tablesLoading}
              onClick={() => void runTables()}
            >
              {t("ai.extractTableCurrent").replace("{n}", String(pageNumber))}
            </Button>
          </Group>
          {tablesLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">{t("ai.analyzingPage")}</Text>
            </Group>
          )}
          {tables && !tablesLoading && tables.length > 0 && (
            <Stack gap="sm">
              {tables.map((tbl, i) => (
                <Box key={i}>
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="gray.4" fw={600}>
                      {tbl.title || t("ai.tableN").replace("{n}", String(i + 1))} ({t("ai.rowCount").replace("{n}", String(tbl.rows.length))})
                    </Text>
                    <Group gap={4}>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        leftSection={<IconDownload size={12} />}
                        onClick={() =>
                          downloadBlob(
                            `${baseName}_table${i + 1}.csv`,
                            new Blob([tableToCsv(tbl)], { type: "text/csv;charset=utf-8" }),
                          )
                        }
                      >
                        CSV
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        leftSection={<IconDownload size={12} />}
                        onClick={() =>
                          downloadBlob(
                            `${baseName}_table${i + 1}.json`,
                            new Blob([JSON.stringify(tbl, null, 2)], {
                              type: "application/json;charset=utf-8",
                            }),
                          )
                        }
                      >
                        JSON
                      </Button>
                    </Group>
                  </Group>
                  <Box style={{ overflowX: "auto", border: "1px solid #1B2740", borderRadius: 4 }}>
                    <Table striped withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          {tbl.headers.map((h, j) => (
                            <Table.Th key={j} style={{ whiteSpace: "nowrap" }}>{h}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {tbl.rows.map((row, r) => (
                          <Table.Tr key={r}>
                            {row.map((cell, c) => (
                              <Table.Td key={c}>{cell}</Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
          {tables && !tablesLoading && tables.length === 0 && (
            <Group gap={6}>
              <IconTable size={16} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">{t("ai.noTablesRetry")}</Text>
            </Group>
          )}
          {!tables && !tablesLoading && (
            <Text size="xs" c="dimmed">{t("ai.tableHint")}</Text>
          )}
        </Card>

        {/* ── Scanned-document field extraction ─────── */}
        <Card withBorder padding="md" style={{ background: "#070D1A", borderColor: "#1B2740" }}>
          <Group justify="space-between" mb="xs">
            <Group gap={6}>
              <IconForms size={16} color="#818CF8" />
              <Text size="sm" fw={600} c="gray.2">{t("ai.fieldExtract")}</Text>
              {fieldsPage !== null && <Badge size="xs" variant="light">{t("ai.pageResult").replace("{n}", String(fieldsPage))}</Badge>}
            </Group>
            <Button
              size="compact-xs"
              variant="light"
              loading={fieldsLoading}
              onClick={() => void runFields()}
            >
              {t("ai.extractFieldCurrent").replace("{n}", String(pageNumber))}
            </Button>
          </Group>
          {fieldsLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">{t("ai.analyzingPage")}</Text>
            </Group>
          )}
          {fields && !fieldsLoading && (
            <Stack gap={6}>
              <Group gap={6}>
                <Text size="xs" c="dimmed" w={64}>{t("ai.docType")}</Text>
                <Badge variant="light" color="indigo">{fields.docType || t("ai.unknown")}</Badge>
              </Group>
              {(
                [
                  [t("ai.amount"), fields.amounts],
                  [t("ai.date"), fields.dates],
                  [t("ai.parties"), fields.parties],
                ] as [string, string[]][]
              ).map(([label, values]) => (
                <Group key={label} gap={6} align="flex-start" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={64} style={{ flexShrink: 0 }}>{label}</Text>
                  {values.length > 0 ? (
                    <Group gap={4}>
                      {values.map((v, i) => (
                        <Badge key={i} size="sm" variant="outline" color="gray">{v}</Badge>
                      ))}
                    </Group>
                  ) : (
                    <Text size="xs" c="dimmed">{t("ai.none")}</Text>
                  )}
                </Group>
              ))}
            </Stack>
          )}
          {!fields && !fieldsLoading && (
            <Text size="xs" c="dimmed">{t("ai.fieldHint")}</Text>
          )}
        </Card>
      </Stack>
    </Box>
  );
}
