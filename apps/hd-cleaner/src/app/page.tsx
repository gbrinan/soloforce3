"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Container, Group, Stack, Title, Paper, Text, Divider, Checkbox, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import DonutChart from "@/components/DonutChart";
import CategoryList from "@/components/CategoryList";
import DeleteConfirm from "@/components/DeleteConfirm";
import CompleteToast from "@/components/CompleteToast";
import FilterBar from "@/components/FilterBar";
import type { ScanCategory, ScanFilter, ScanItem } from "@/lib/scanner/common";
import { useI18n, type MessageKey, type Translator } from "@/lib/i18n";

// Client-side mirror of the safety rating type (lib/ai/safety-rules imports node:os → server-only).
type SafetyRating = "safe" | "caution" | "danger";

// AI 정리 플랜 응답 형태 (api/ai/cleanup-plan 반환 스키마의 클라이언트 미러).
interface CleanupPlan {
  summary: string;
  totalReclaimMb: number;
  batches: Array<{ title: string; paths: string[]; reclaimMb: number; note: string }>;
}

const SAFETY_BADGE: Record<SafetyRating, { labelKey: MessageKey; color: string }> = {
  safe: { labelKey: "safety.safe", color: "teal" },
  caution: { labelKey: "safety.caution", color: "yellow" },
  danger: { labelKey: "safety.danger", color: "red" },
};

// Deletion-safety badge (display only — never affects deletion behavior).
function SafetyBadge({ rating }: { rating: SafetyRating | undefined }) {
  const { t } = useI18n();
  if (!rating) return null;
  const { labelKey, color } = SAFETY_BADGE[rating];
  return (
    <Badge size="sm" variant="light" color={color} style={{ flexShrink: 0 }}>
      {t(labelKey)}
    </Badge>
  );
}

// 상대경로 fetch("api/scan")는 iframe 문서 URL이 basePath 루트(trailing-slash 없는 상태로
// Next.js 308 리다이렉트됨)일 때 "/proxy" 세그먼트가 소실된 잘못된 절대경로로 resolve된다.
// basePath를 명시적으로 앞에 붙여 문서 URL 상태와 무관하게 항상 올바른 경로로 고정한다.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/api/apps/hd-cleaner/proxy";

// Large Files 우측 패널 최대 표시 개수 (사이즈 내림차순)
const LARGE_FILES_MAX = 30;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

type Phase = "idle" | "scanning" | "scanned" | "deleting" | "done";

function CategoryDetailList({
  category,
  safety,
}: {
  category: ScanCategory | null;
  safety: Map<string, SafetyRating>;
}) {
  const { t } = useI18n();
  if (!category) return <Text size="sm" c="dimmed">{t("detail.noData")}</Text>;
  if (!category.items.length) {
    return (
      <Text size="sm" c="dimmed">
        {category.available ? t("detail.empty") : t("detail.unsupported")}
      </Text>
    );
  }
  return (
    <Stack gap={6}>
      {category.items.slice(0, 100).map((item) => (
        <Group key={item.path} justify="space-between" wrap="nowrap" gap={8}>
          <Text
            size="sm"
            c="var(--text-muted)"
            style={{ direction: "rtl", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
          >
            {item.path}
          </Text>
          <SafetyBadge rating={safety.get(item.path)} />
          <Text size="sm" fw={700} c="var(--text-primary)" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {formatBytes(item.size)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

// 파일 위치를 OS 파일 관리자에서 연다(reveal).
async function revealFile(path: string, t: Translator): Promise<void> {
  try {
    const res = await fetch(`${BASE_PATH}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || t("reveal.openFail"));
  } catch (err) {
    notifications.show({ color: "red", message: t("reveal.folderFail", { msg: err instanceof Error ? err.message : String(err) }) });
  }
}

// Large Files 패널 — 사이즈 내림차순 상위 30개, 파일별 체크 선택 → 삭제 대상에 합산.
function LargeFilesPanel({
  items,
  checked,
  onToggle,
  thresholdBytes,
  safety,
  t,
}: {
  items: ScanItem[];
  checked: Set<string>;
  onToggle: (path: string) => void;
  thresholdBytes: number;
  safety: Map<string, SafetyRating>;
  t: Translator;
}) {
  // 기준 가이드 — 임계값 이상 · 크기순 상위 N개.
  const guide = (
    <Text size="xs" c="var(--text-muted)" style={{ lineHeight: 1.5, padding: "0 2px" }}>
      {t("large.guide", { size: formatBytes(thresholdBytes), max: LARGE_FILES_MAX })}
    </Text>
  );
  if (!items.length) {
    return (
      <Stack gap={12}>
        {guide}
        <Text size="sm" c="dimmed" ta="center" py={20}>{t("large.empty", { size: formatBytes(thresholdBytes) })}</Text>
      </Stack>
    );
  }
  const rows = [...items].sort((a, b) => b.size - a.size).slice(0, LARGE_FILES_MAX);
  // 파일명 = 경로 마지막 세그먼트, 나머지는 하위 폴더 경로로 보조 표기(좌측 카테고리 리스트 톤).
  const splitPath = (p: string) => {
    const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return idx >= 0 ? { name: p.slice(idx + 1), dir: p.slice(0, idx) } : { name: p, dir: "" };
  };
  return (
    <Stack gap={12}>
      {guide}
      <Stack gap={10}>
        {rows.map((item) => {
          const { name, dir } = splitPath(item.path);
          return (
            <Group
              key={item.path}
              justify="space-between"
              wrap="nowrap"
              gap={12}
              p="12px 14px"
              style={{ borderRadius: 10, background: "var(--bg-muted)" }}
            >
              <Group gap={12} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                <Checkbox
                  size="sm"
                  radius={6}
                  checked={checked.has(item.path)}
                  onChange={() => onToggle(item.path)}
                  aria-label={t("large.selectAria", { path: item.path })}
                  styles={{ input: { cursor: "pointer" } }}
                />
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} c="var(--text-primary)" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.path}>
                    {name}
                  </Text>
                  {dir && (
                    <Text size="xs" c="var(--text-muted)" style={{ direction: "rtl", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.path}>
                      {dir}
                    </Text>
                  )}
                </Stack>
              </Group>
              <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }}>
                <SafetyBadge rating={safety.get(item.path)} />
                <Text size="sm" fw={700} c="var(--text-primary)" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {formatBytes(item.size)}
                </Text>
                <UnstyledButton
                  onClick={() => void revealFile(item.path, t)}
                  title={t("large.openLocation")}
                  aria-label={t("large.openLocationAria", { path: item.path })}
                  style={{ fontSize: 15, lineHeight: 1, padding: 4, borderRadius: 6, flexShrink: 0, opacity: 0.75 }}
                >
                  📂
                </UnstyledButton>
              </Group>
            </Group>
          );
        })}
      </Stack>
      {items.length > LARGE_FILES_MAX && (
        <Text size="xs" c="dimmed" ta="center">
          {t("large.more", { n: items.length - LARGE_FILES_MAX, max: LARGE_FILES_MAX })}
        </Text>
      )}
    </Stack>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [phase, setPhase] = useState<Phase>("idle");
  const [categories, setCategories] = useState<ScanCategory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Large Files 개별 파일 선택 (path 기준) — 카테고리 선택과 별도로 삭제 대상에 합산
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [freedBytes, setFreedBytes] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Large Files 임계값(스캔 응답 기준) — 가이드 표시용. 기본 100MB.
  const [largeFileThreshold, setLargeFileThreshold] = useState(100 * 1024 * 1024);
  // 스캔 진행률 — 응답 스트리밍이 없으므로 0에서 시작해 점근적으로 90%까지 상승, 완료 시 100.
  const [scanProgress, setScanProgress] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // AI natural-language scan filter (applied to Large Files; empty object = no filter).
  const [scanFilter, setScanFilter] = useState<ScanFilter>({});
  // Deletion-safety ratings by path (display badges only).
  const [safety, setSafety] = useState<Map<string, SafetyRating>>(new Map());
  // AI 정리 플랜(자연어 브리핑) — 생성 결과/진행 상태.
  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  // Fire-and-forget hybrid safety rating for the scanned items (visible ones only).
  const fetchSafetyRatings = async (cats: ScanCategory[]) => {
    const largeFiles = cats.find((c) => c.id === "largeFiles");
    const largePaths = [...(largeFiles?.items ?? [])]
      .sort((a, b) => b.size - a.size)
      .slice(0, LARGE_FILES_MAX)
      .map((i) => i.path);
    const categoryPaths = cats
      .filter((c) => c.id !== "largeFiles")
      .flatMap((c) => c.items.slice(0, 100).map((i) => i.path));
    const paths = [...new Set([...largePaths, ...categoryPaths])];
    if (!paths.length) return;
    try {
      const res = await fetch(`${BASE_PATH}/api/ai/safety-rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "safety rating failed");
      const map = new Map<string, SafetyRating>();
      for (const r of data.ratings as Array<{ path: string; rating: SafetyRating }>) {
        map.set(r.path, r.rating);
      }
      setSafety(map);
    } catch {
      // Badge display is best-effort — scanning/deleting flows are unaffected.
    }
  };

  // 스캔 결과 + 안전도를 종합해 AI 정리 플랜을 생성한다.
  const generatePlan = async (cats: ScanCategory[]) => {
    const items = cats
      .flatMap((c) =>
        c.items.map((i) => ({
          path: i.path,
          size: i.size,
          category: c.label,
          safety: safety.get(i.path),
        })),
      )
      .filter((i) => i.size > 0);
    if (!items.length) {
      notifications.show({ color: "yellow", message: t("plan.noItems") });
      return;
    }
    setPlanLoading(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/ai/cleanup-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "plan failed");
      setPlan(data.plan as CleanupPlan);
    } catch (err) {
      notifications.show({ color: "red", message: t("plan.fail", { msg: err instanceof Error ? err.message : String(err) }) });
    } finally {
      setPlanLoading(false);
    }
  };

  const stopProgress = () => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  };
  useEffect(() => stopProgress, []);

  const runScan = async () => {
    setPhase("scanning");
    setScanProgress(0);
    stopProgress();
    progressTimer.current = setInterval(() => {
      setScanProgress((p) => Math.min(90, p + Math.max(0.5, (90 - p) * 0.08)));
    }, 200);
    try {
      const hasFilter = Object.values(scanFilter).some((v) => v !== undefined);
      const res = await fetch(`${BASE_PATH}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hasFilter ? { filter: scanFilter } : {}),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "scan failed");
      const cats: ScanCategory[] = data.categories;
      stopProgress();
      setScanProgress(100);
      setCategories(cats);
      if (typeof data.largeFileThreshold === "number") setLargeFileThreshold(data.largeFileThreshold);
      setSelected(
        new Set(cats.filter((c) => c.available && c.id !== "largeFiles").map((c) => c.id)),
      );
      setSelectedFiles(new Set());
      setSafety(new Map());
      setPlan(null);
      setPhase("scanned");
      void fetchSafetyRatings(cats);
    } catch (err) {
      stopProgress();
      notifications.show({ color: "red", message: t("scan.fail", { msg: err instanceof Error ? err.message : String(err) }) });
      setPhase("idle");
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const largeFilesCategory = categories.find((c) => c.id === "largeFiles") ?? null;
  const checkedLargeFiles = (largeFilesCategory?.items ?? []).filter((i) => selectedFiles.has(i.path));

  const selectedCategories = categories.filter((c) => selected.has(c.id));
  const totalSelectedSize =
    selectedCategories.reduce((s, c) => s + c.totalSize, 0) +
    checkedLargeFiles.reduce((s, i) => s + i.size, 0);
  const totalSelectedFiles =
    selectedCategories.reduce((s, c) => s + c.items.length, 0) + checkedLargeFiles.length;
  const reclaimableTotal = categories.filter((c) => c.id !== "largeFiles").reduce((s, c) => s + c.totalSize, 0);
  const nothingSelected = selected.size === 0 && checkedLargeFiles.length === 0;

  const runDelete = async () => {
    setConfirmOpen(false);
    setPhase("deleting");
    const candidates = [
      ...selectedCategories.flatMap((c) => c.items),
      ...checkedLargeFiles,
    ];
    const paths = candidates.map((i) => i.path);
    try {
      const res = await fetch(`${BASE_PATH}/api/trash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "delete failed");
      const movedSet = new Set<string>(data.moved ?? []);
      const movedSize = candidates
        .filter((i) => movedSet.has(i.path))
        .reduce((s, i) => s + i.size, 0);
      setFreedBytes(movedSize);
      setPhase("done");
      setSelected(new Set());
      setSelectedFiles(new Set());
      setCategories([]);
      setTimeout(() => setPhase("idle"), 4000);
    } catch (err) {
      notifications.show({ color: "red", message: t("delete.fail", { msg: err instanceof Error ? err.message : String(err) }) });
      setPhase("scanned");
    }
  };

  const detailCategory = categories.find((c) => c.id === detailId) ?? null;

  return (
    <Container fluid px={24} py={24} style={{ background: "var(--bg-canvas)", minHeight: "100vh" }}>
      <Stack gap={20}>
        {/* 라이트/다크는 마이크루 호스트 설정(동일 오리진 Mantine color-scheme 저장소)을 따르므로 별도 토글 없음 */}
        <Stack gap={2}>
          <Title order={3} c="var(--text-primary)">
            🧹 HD Cleaner
          </Title>
          <Text size="sm" c="var(--text-muted)">
            {t("app.tagline")}
          </Text>
        </Stack>

        {phase === "idle" && (
          <Paper p={32} radius="lg" style={{ border: "1px solid var(--border-default)", boxShadow: "none", background: "var(--bg-card)" }}>
            <Stack align="center" gap={24}>
              <DonutChart used={0} free={0} reclaimable={0} />
              <FilterBar basePath={BASE_PATH} filter={scanFilter} onFilterChange={setScanFilter} />
              <Button variant="filled" size="lg" onClick={runScan} style={{ minWidth: 200 }}>
                ▶ {t("scan.start")}
              </Button>
            </Stack>
          </Paper>
        )}

        {phase === "scanning" && (
          <Paper p={20} radius="lg" style={{ border: "1px solid var(--border-default)", boxShadow: "none", background: "var(--bg-card)" }}>
            <Stack align="center" gap={16}>
              <DonutChart used={0} free={0} reclaimable={0} scanning progress={scanProgress} />
              <Text size="sm" c="var(--text-muted)">
                {t("scan.scanning")}
              </Text>
            </Stack>
          </Paper>
        )}

        {(phase === "scanned" || phase === "deleting") && !detailCategory && (
          <Group align="stretch" gap={16} wrap={isMobile ? "wrap" : "nowrap"}>
            <Paper
              p={20}
              radius="lg"
              style={{
                flex: 1,
                minWidth: isMobile ? "100%" : 420,
                border: "1px solid var(--border-default)",
                boxShadow: "none",
                background: "var(--bg-card)",
              }}
            >
              <Stack gap={16}>
                <Group justify="center">
                  <DonutChart used={reclaimableTotal} free={0} reclaimable={0} />
                </Group>
                <CategoryList categories={categories} selected={selected} onToggle={toggle} onOpenDetail={setDetailId} />
                <Divider />
                <Button variant="filled"
                  fullWidth
                  disabled={nothingSelected || phase === "deleting"}
                  loading={phase === "deleting"}
                  onClick={() => setConfirmOpen(true)}
                >
                  ▶ {t("delete.button", { size: formatBytes(totalSelectedSize) })}
                </Button>
                <Button
                  variant="light"
                  fullWidth
                  loading={planLoading}
                  disabled={phase === "deleting"}
                  onClick={() => void generatePlan(categories)}
                >
                  🧭 {t("plan.generate")}
                </Button>
                {plan && (
                  <Paper p={16} radius="md" style={{ border: "1px solid var(--border-default)", background: "var(--bg-muted)" }}>
                    <Stack gap={10}>
                      <Text fw={700} c="var(--text-primary)">
                        {t("plan.title", { mb: plan.totalReclaimMb })}
                      </Text>
                      {plan.summary && (
                        <Text size="sm" c="var(--text-muted)" style={{ lineHeight: 1.5 }}>
                          {plan.summary}
                        </Text>
                      )}
                      {plan.batches.map((b, idx) => (
                        <Stack key={idx} gap={2}>
                          <Group justify="space-between" wrap="nowrap" gap={8}>
                            <Text size="sm" fw={600} c="var(--text-primary)">
                              {idx + 1}. {b.title}
                            </Text>
                            <Text size="sm" fw={700} c="var(--text-primary)" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                              {b.reclaimMb} MB
                            </Text>
                          </Group>
                          {b.note && (
                            <Text size="xs" c="var(--text-muted)" style={{ lineHeight: 1.4 }}>
                              {b.note}
                            </Text>
                          )}
                          <Text size="xs" c="var(--text-muted)">
                            {t("plan.items", { n: b.paths.length })}
                          </Text>
                        </Stack>
                      ))}
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </Paper>
            <Paper
              p={20}
              radius="lg"
              style={{
                flex: 1,
                minWidth: isMobile ? "100%" : 360,
                border: "1px solid var(--border-default)",
                boxShadow: "none",
                background: "var(--bg-card)",
              }}
            >
              <Group justify="space-between" mb={10}>
                <Text fw={600} c="var(--text-primary)">
                  Large Files
                </Text>
                {checkedLargeFiles.length > 0 && (
                  <Text size="sm" fw={700} c="var(--text-primary)" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {t("large.checkedSummary", { n: checkedLargeFiles.length, size: formatBytes(checkedLargeFiles.reduce((s, i) => s + i.size, 0)) })}
                  </Text>
                )}
              </Group>
              <LargeFilesPanel
                items={largeFilesCategory?.items ?? []}
                checked={selectedFiles}
                onToggle={toggleFile}
                thresholdBytes={largeFileThreshold}
                safety={safety}
                t={t}
              />
            </Paper>
          </Group>
        )}

        {detailCategory && (
          <Paper p={20} radius="lg" style={{ border: "1px solid var(--border-default)", boxShadow: "none", background: "var(--bg-card)" }}>
            <Group justify="space-between" mb={10}>
              <Button variant="subtle" onClick={() => setDetailId(null)}>
                ← {detailCategory.label}
              </Button>
              <Text fw={700} c="var(--text-primary)">
                {formatBytes(detailCategory.totalSize)}
              </Text>
            </Group>
            <CategoryDetailList category={detailCategory} safety={safety} />
          </Paper>
        )}
      </Stack>

      <DeleteConfirm
        opened={confirmOpen}
        totalSize={formatBytes(totalSelectedSize)}
        categoryCount={selectedCategories.length}
        fileCount={totalSelectedFiles}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={runDelete}
      />

      <CompleteToast freedBytes={freedBytes} visible={phase === "done"} />
    </Container>
  );
}
