"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { useState } from "react"
import {
  PenTool,
  Type,
  CalendarDays,
  CheckSquare,
  Pen,
  Stamp,
} from "lucide-react"

import { FieldPalette, type FieldType } from "@/components/templates/field-palette"
import { PdfCanvas, PAGE_WIDTH, PAGE_HEIGHT } from "@/components/templates/pdf-canvas"
import { FieldProperties } from "@/components/templates/field-properties"
import { useEditorStore } from "@/lib/template-editor-store"
import type { TemplateField } from "@/lib/pdf"

const FIELD_ICON_MAP: Record<FieldType, React.ReactNode> = {
  signature: <PenTool className="size-4" />,
  text: <Type className="size-4" />,
  date: <CalendarDays className="size-4" />,
  checkbox: <CheckSquare className="size-4" />,
  initials: <Pen className="size-4" />,
  stamp: <Stamp className="size-4" />,
}

const DEFAULT_FIELD_SIZE: Record<FieldType, { width: number; height: number }> = {
  signature: { width: 200, height: 60 },
  text: { width: 180, height: 30 },
  date: { width: 140, height: 30 },
  checkbox: { width: 24, height: 24 },
  initials: { width: 80, height: 40 },
  stamp: { width: 100, height: 100 },
}

const CANVAS_SCALE = 0.85

interface TemplateEditorProps {
  templateId: string
  templateName: string
}

export function TemplateEditor({ templateId, templateName }: TemplateEditorProps) {
  const t = useTranslations("templates")
  const addField = useEditorStore((s) => s.addField)
  const fields = useEditorStore((s) => s.fields)
  const [activeDragType, setActiveDragType] = useState<FieldType | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    if (data?.type === "palette-item") {
      setActiveDragType(data.fieldType as FieldType)
    }
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragType(null)
      const { over, active, delta } = event

      if (!over) return

      const activeData = active.data.current
      if (!activeData || activeData.type !== "palette-item") return

      const overData = over.data.current
      if (!overData || overData.type !== "page") return

      const fieldType = activeData.fieldType as FieldType
      const pageIndex = overData.pageIndex as number

      // Calculate drop position relative to the page droppable area
      // active.rect.current.translated = the dragged element's final position
      // over.rect = the droppable page area
      const activeRect = active.rect.current.translated
      const overRect = over.rect
      const fieldSize = DEFAULT_FIELD_SIZE[fieldType]

      let dropX: number
      let dropY: number

      if (activeRect && overRect) {
        // Center of the dragged item relative to the page droppable
        const centerX = (activeRect.left + activeRect.width / 2 - overRect.left) / CANVAS_SCALE
        const centerY = (activeRect.top + activeRect.height / 2 - overRect.top) / CANVAS_SCALE
        dropX = Math.round(centerX - fieldSize.width / 2)
        dropY = Math.round(centerY - fieldSize.height / 2)
      } else {
        // Fallback: center of the page
        dropX = Math.round(PAGE_WIDTH / 2 - fieldSize.width / 2)
        dropY = Math.round(PAGE_HEIGHT / 2 - fieldSize.height / 2)
      }

      // Clamp within page bounds
      dropX = Math.max(0, Math.min(dropX, PAGE_WIDTH - fieldSize.width))
      dropY = Math.max(0, Math.min(dropY, PAGE_HEIGHT - fieldSize.height))

      const existingCount = fields.filter((f) => f.type === fieldType).length
      const fieldName = `${t(`fields.${fieldType}`)} ${existingCount + 1}`

      const newField: TemplateField = {
        id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: fieldType,
        name: fieldName,
        required: fieldType === "signature",
        signerRole: "signer-1",
        position: {
          x: dropX,
          y: dropY,
          width: DEFAULT_FIELD_SIZE[fieldType].width,
          height: DEFAULT_FIELD_SIZE[fieldType].height,
          page: pageIndex,
        },
      }

      addField(newField)
    },
    [addField, fields, t]
  )

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-[600px] gap-0 overflow-hidden rounded-lg border">
        <FieldPalette />
        <PdfCanvas />
        <FieldProperties />
      </div>

      {/* Drag overlay for visual feedback */}
      <DragOverlay>
        {activeDragType ? (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-lg">
            {FIELD_ICON_MAP[activeDragType]}
            <span className="text-sm font-medium">
              {t(`fields.${activeDragType}`)}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
