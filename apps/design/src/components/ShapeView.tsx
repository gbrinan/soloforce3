"use client";

import type { Shape } from "@/lib/design/types";

interface Props {
  shape: Shape;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

export default function ShapeView({ shape, selected, onPointerDown }: Props) {
  if (!shape.visible) return null;

  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const transform = shape.rotation
    ? `rotate(${shape.rotation} ${cx} ${cy})`
    : undefined;

  const filterId = shape.shadow ? `shadow_${shape.id}` : undefined;
  const filterAttr = filterId ? `url(#${filterId})` : undefined;

  const common = {
    opacity: shape.opacity,
    filter: filterAttr,
    onPointerDown: (e: React.PointerEvent) => onPointerDown(e, shape.id),
    style: { cursor: shape.locked ? "not-allowed" : "move" } as React.CSSProperties,
  };

  const fill = shape.fill === "none" ? "none" : shape.fill;
  const stroke = shape.stroke === "none" ? "none" : shape.stroke;

  let body: React.ReactNode = null;

  switch (shape.type) {
    case "rect":
    case "frame":
      body = (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.radius || 0}
          ry={shape.radius || 0}
          fill={fill}
          stroke={stroke}
          strokeWidth={shape.strokeWidth}
          {...common}
        />
      );
      break;
    case "ellipse":
      body = (
        <ellipse
          cx={cx}
          cy={cy}
          rx={shape.width / 2}
          ry={shape.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={shape.strokeWidth}
          {...common}
        />
      );
      break;
    case "line":
      body = (
        <line
          x1={shape.x}
          y1={shape.y}
          x2={shape.x2}
          y2={shape.y2}
          stroke={stroke === "none" ? "#e8e8e8" : stroke}
          strokeWidth={shape.strokeWidth || 2}
          strokeLinecap="round"
          {...common}
        />
      );
      break;
    case "text":
      body = (
        <text
          x={
            shape.align === "center"
              ? cx
              : shape.align === "right"
                ? shape.x + shape.width
                : shape.x
          }
          y={shape.y + shape.fontSize}
          fontSize={shape.fontSize}
          fontFamily={shape.fontFamily}
          fontWeight={shape.fontWeight}
          fill={shape.color}
          textAnchor={
            shape.align === "center"
              ? "middle"
              : shape.align === "right"
                ? "end"
                : "start"
          }
          {...common}
        >
          {shape.text}
        </text>
      );
      break;
    case "path":
      body = (
        <g transform={`translate(${shape.x} ${shape.y})`}>
          <path
            d={shape.d}
            fill={fill}
            stroke={stroke}
            strokeWidth={shape.strokeWidth}
            {...common}
          />
        </g>
      );
      break;
    case "image":
      body = (
        <image
          href={shape.href}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          preserveAspectRatio="xMidYMid slice"
          {...common}
        />
      );
      break;
    case "group":
      // Group renders as an invisible interactive hit area.
      // Children are rendered separately in z-order.
      body = (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          fill="transparent"
          stroke="none"
          {...common}
        />
      );
      break;
  }

  return (
    <g transform={transform} data-shape-id={shape.id}>
      {shape.shadow && filterId && (
        <defs>
          <filter
            id={filterId}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feDropShadow
              dx={shape.shadow.x}
              dy={shape.shadow.y}
              stdDeviation={shape.shadow.blur / 2}
              floodColor={shape.shadow.color}
              floodOpacity="0.8"
            />
          </filter>
        </defs>
      )}
      {body}
      {selected && (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          fill="none"
          stroke="#6366F1"
          strokeWidth={1}
          strokeDasharray={shape.type === "group" ? "4 2" : undefined}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </g>
  );
}
