"use client";
// 헨젤 디자인 §2 도넛 차트 명세: outerRadius 120, innerRadius = outer*0.62, butt cap, 세그먼트 순서 Used→Free→Reclaimable.
// 외부 차트 라이브러리 사용 금지 — 순수 SVG 구현.
import { useI18n } from "@/lib/i18n";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface DonutChartProps {
  used: number;
  free: number;
  reclaimable: number;
  scanning?: boolean;
  progress?: number; // 0-100
}

// 테마 토큰(라이트/다크 모두 정의됨)을 그대로 사용 — 하드코딩 금지
const COLOR_USED = "var(--color-used)";
const COLOR_FREE = "var(--color-free)";
const COLOR_RECLAIMABLE = "var(--color-reclaimable)";

export default function DonutChart({ used, free, reclaimable, scanning = false, progress = 0 }: DonutChartProps) {
  const { t } = useI18n();
  const size = 240;
  const outerRadius = 120;
  const strokeWidth = outerRadius * 0.38;
  const r = outerRadius - strokeWidth / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = used + free + reclaimable;

  if (scanning) {
    const dash = (Math.max(0, Math.min(100, progress)) / 100) * circumference;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("donut.scanProgress")}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-default)" strokeWidth={strokeWidth} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-action-primary)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="butt"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.25s ease" }}
        />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={28} fontWeight={700} fill="var(--text-primary)">
          {Math.round(progress)}%
        </text>
      </svg>
    );
  }

  if (total <= 0) {
    // 빈 상태 링은 공유 도넛 반지름(r)보다 크게 그려 내부 텍스트에 여백을 확보한다.
    const emptyR = size / 2 - 8; // viewBox 여유 최대(≈112)
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("donut.beforeScan")}>
        {/* 은은한 배경 디스크로 깊이감 */}
        <circle cx={cx} cy={cy} r={emptyR} fill="var(--bg-muted)" opacity={0.35} />
        {/* 준비 상태를 나타내는 점선 링(브랜드 액센트) */}
        <circle
          cx={cx}
          cy={cy}
          r={emptyR}
          fill="none"
          stroke="var(--color-action-primary)"
          strokeWidth={2.5}
          strokeDasharray="3 9"
          strokeLinecap="round"
          opacity={0.5}
        />
        {/* 스캔 글리프 + 안내 */}
        <text x={cx} y={cy - 18} textAnchor="middle" dominantBaseline="middle" fontSize={44}>
          🧹
        </text>
        <text x={cx} y={cy + 24} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={600} fill="var(--text-primary)">
          {t("donut.startPrompt")}
        </text>
        <text x={cx} y={cy + 46} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="var(--text-muted)">
          {t("donut.findHint")}
        </text>
      </svg>
    );
  }

  const segments = [
    { value: used, color: COLOR_USED, label: "Used" },
    { value: free, color: COLOR_FREE, label: "Free" },
    { value: reclaimable, color: COLOR_RECLAIMABLE, label: "Reclaimable" },
  ];
  let offset = 0;
  const arcs = segments.map((seg) => {
    const fraction = seg.value / total;
    const dash = fraction * circumference;
    const el = (
      <circle
        key={seg.label}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={seg.color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
        strokeLinecap="butt"
        transform={`rotate(-90 ${cx} ${cy})`}
      >
        <title>
          {seg.label}: {formatBytes(seg.value)}
        </title>
      </circle>
    );
    offset += dash;
    return el;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("donut.diskUsage")}>
      {arcs}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize={13} fontWeight={500} fill="var(--text-secondary)">
        Capacity
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        fontSize={28}
        fontWeight={700}
        fill="var(--text-primary)"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatBytes(total)}
      </text>
    </svg>
  );
}
