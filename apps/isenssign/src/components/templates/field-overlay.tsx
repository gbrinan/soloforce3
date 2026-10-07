"use client"

import { useState, useCallback, useRef, type MouseEvent } from "react"
import {
  PenTool,
  Type,
  CalendarDays,
  CheckSquare,
  Pen,
  Stamp,
} from "lucide-react"
import type { TemplateField } from "@/lib/pdf"
import { useEditorStore } from "@/lib/template-editor-store"

const FIELD_COLORS: Record<TemplateField["type"], { border: string; bg: string; text: string }> = {
  signature: { border: "border-blue-400", bg: "bg-blue-50/80", text: "text-blue-700" },
  text: { border: "border-green-400", bg: "bg-green-50/80", text: "text-green-700" },
  date: { border: "border-purple-400", bg: "bg-purple-50/80", text: "text-purple-700" },
  checkbox: { border: "border-orange-400", bg: "bg-orange-50/80", text: "text-orange-700" },
  initials: { border: "border-cyan-400", bg: "bg-cyan-50/80", text: "text-cyan-700" },
  stamp: { border: "border-red-400", bg: "bg-red-50/80", text: "text-red-700" },
}

const FIELD_ICONS: Record<TemplateField["type"], React.ReactNode> = {
  signature: <PenTool className="size-3.5" />,
  text: <Type className="size-3.5" />,
  date: <CalendarDays className="size-3.5" />,
  checkbox: <CheckSquare className="size-3.5" />,
  initials: <Pen className="size-3.5" />,
  stamp: <Stamp className="size-3.5" />,
}

const MIN_WIDTH = 40
const MIN_HEIGHT = 24

interface FieldOverlayProps {
  field: TemplateField
  isSelected: boolean
  scale: number
}

export function FieldOverlay({ field, isSelected, scale }: FieldOverlayProps) {
  const { selectField, moveField, resizeField } = useEditorStore()
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; fieldX: number; fieldY: number } | null>(null)
  const resizeStartRef = useRef<{
    x: number
    y: number
    fieldW: number
    fieldH: number
    fieldX: number
    fieldY: number
    corner: string
  } | null>(null)

  const colors = FIELD_COLORS[field.type]

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (isResizing) return
      e.stopPropagation()
      e.preventDefault()
      selectField(field.id)
      setIsDragging(true)

      const startX = e.clientX
      const startY = e.clientY
      const fieldX = field.position.x
      const fieldY = field.position.y
      dragStartRef.current = { x: startX, y: startY, fieldX, fieldY }

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        if (!dragStartRef.current) return
        const dx = (moveEvent.clientX - dragStartRef.current.x) / scale
        const dy = (moveEvent.clientY - dragStartRef.current.y) / scale
        const newX = Math.max(0, dragStartRef.current.fieldX + dx)
        const newY = Math.max(0, dragStartRef.current.fieldY + dy)
        moveField(field.id, { x: Math.round(newX), y: Math.round(newY) })
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        dragStartRef.current = null
        window.removeEventListener("mousemove", handleMouseMove)
        window.removeEventListener("mouseup", handleMouseUp)
      }

      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    },
    [field.id, field.position.x, field.position.y, scale, isResizing, selectField, moveField]
  )

  const handleResizeMouseDown = useCallback(
    (corner: string) => (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setIsResizing(true)

      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        fieldW: field.position.width,
        fieldH: field.position.height,
        fieldX: field.position.x,
        fieldY: field.position.y,
        corner,
      }

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        if (!resizeStartRef.current) return
        const dx = (moveEvent.clientX - resizeStartRef.current.x) / scale
        const dy = (moveEvent.clientY - resizeStartRef.current.y) / scale
        const ref = resizeStartRef.current

        let newW = ref.fieldW
        let newH = ref.fieldH
        let newX = ref.fieldX
        let newY = ref.fieldY

        if (corner.includes("right")) {
          newW = Math.max(MIN_WIDTH, ref.fieldW + dx)
        }
        if (corner.includes("left")) {
          newW = Math.max(MIN_WIDTH, ref.fieldW - dx)
          newX = ref.fieldX + (ref.fieldW - newW)
        }
        if (corner.includes("bottom")) {
          newH = Math.max(MIN_HEIGHT, ref.fieldH + dy)
        }
        if (corner.includes("top")) {
          newH = Math.max(MIN_HEIGHT, ref.fieldH - dy)
          newY = ref.fieldY + (ref.fieldH - newH)
        }

        resizeField(field.id, { width: Math.round(newW), height: Math.round(newH) })
        moveField(field.id, { x: Math.round(newX), y: Math.round(newY) })
      }

      const handleMouseUp = () => {
        setIsResizing(false)
        resizeStartRef.current = null
        window.removeEventListener("mousemove", handleMouseMove)
        window.removeEventListener("mouseup", handleMouseUp)
      }

      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    },
    [field.id, field.position.width, field.position.height, field.position.x, field.position.y, scale, moveField, resizeField]
  )

  const resizeHandles = [
    { corner: "top-left", className: "-left-1 -top-1 cursor-nwse-resize" },
    { corner: "top-right", className: "-right-1 -top-1 cursor-nesw-resize" },
    { corner: "bottom-left", className: "-bottom-1 -left-1 cursor-nesw-resize" },
    { corner: "bottom-right", className: "-bottom-1 -right-1 cursor-nwse-resize" },
  ]

  return (
    <div
      className={`group absolute flex items-center gap-1 border-2 border-dashed ${colors.border} ${colors.bg} ${
        isSelected ? "ring-2 ring-blue-500 ring-offset-1" : ""
      } ${isDragging ? "cursor-grabbing opacity-75" : "cursor-grab"} select-none overflow-hidden rounded-sm transition-shadow`}
      style={{
        left: field.position.x * scale,
        top: field.position.y * scale,
        width: field.position.width * scale,
        height: field.position.height * scale,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={`flex h-full items-center gap-1 px-1.5 ${colors.text}`}>
        {FIELD_ICONS[field.type]}
        <span className="truncate text-xs font-medium">{field.name}</span>
      </div>

      {isSelected &&
        resizeHandles.map(({ corner, className }) => (
          <div
            key={corner}
            className={`absolute size-2.5 rounded-sm border border-white bg-blue-500 ${className}`}
            onMouseDown={handleResizeMouseDown(corner)}
          />
        ))}
    </div>
  )
}
