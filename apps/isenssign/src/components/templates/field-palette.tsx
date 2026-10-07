"use client"

import { useDraggable } from "@dnd-kit/core"
import { useTranslations } from "next-intl"
import {
  PenTool,
  Type,
  CalendarDays,
  CheckSquare,
  Pen,
  Stamp,
} from "lucide-react"
import type { ReactNode } from "react"

export type FieldType = "signature" | "text" | "date" | "checkbox" | "initials" | "stamp"

interface PaletteItem {
  type: FieldType
  icon: ReactNode
  color: string
}

const PALETTE_ITEMS: PaletteItem[] = [
  { type: "signature", icon: <PenTool className="size-5" />, color: "text-blue-600" },
  { type: "text", icon: <Type className="size-5" />, color: "text-green-600" },
  { type: "date", icon: <CalendarDays className="size-5" />, color: "text-purple-600" },
  { type: "checkbox", icon: <CheckSquare className="size-5" />, color: "text-orange-500" },
  { type: "initials", icon: <Pen className="size-5" />, color: "text-cyan-600" },
  { type: "stamp", icon: <Stamp className="size-5" />, color: "text-red-600" },
]

interface DraggablePaletteItemProps {
  item: PaletteItem
}

function DraggablePaletteItem({ item }: DraggablePaletteItemProps) {
  const t = useTranslations("templates")
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.type}`,
    data: {
      type: "palette-item",
      fieldType: item.type,
    },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent active:cursor-grabbing ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      <div className={`flex size-9 items-center justify-center rounded-md bg-muted ${item.color}`}>
        {item.icon}
      </div>
      <span className="text-sm font-medium">{t(`fields.${item.type}`)}</span>
    </div>
  )
}

export function FieldPalette() {
  const t = useTranslations("templates")
  return (
    <div className="flex w-64 shrink-0 flex-col border-r bg-background">
      <div className="border-b p-4">
        <h3 className="text-sm font-semibold">{t("fieldPalette")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("fieldPaletteHint")}
        </p>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto p-3">
        {PALETTE_ITEMS.map((item) => (
          <DraggablePaletteItem key={item.type} item={item} />
        ))}
      </div>
    </div>
  )
}

export { PALETTE_ITEMS }
