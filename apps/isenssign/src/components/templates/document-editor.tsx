"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Table } from "@tiptap/extension-table"
import TableRow from "@tiptap/extension-table-row"
import TableCellBase from "@tiptap/extension-table-cell"
import TableHeaderBase from "@tiptap/extension-table-header"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import { TextStyle } from "@tiptap/extension-text-style"
import Color from "@tiptap/extension-color"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Table2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react"

import { mergeAttributes } from "@tiptap/core"
import { cn } from "@/lib/utils"

// Custom TableCell that preserves inline style (especially border)
const TableCell = TableCellBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute("style"),
        renderHTML: (attributes) => {
          if (!attributes.style) return {}
          return { style: attributes.style }
        },
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["td", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
})

// Custom TableHeader that preserves inline style
const TableHeader = TableHeaderBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute("style"),
        renderHTML: (attributes) => {
          if (!attributes.style) return {}
          return { style: attributes.style }
        },
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["th", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
})
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

// A4 dimensions at 96dpi
const A4_WIDTH_PX = 794
const A4_MIN_HEIGHT_PX = 1123
const A4_PADDING_PX = 96

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10
const ZOOM_DEFAULT = 100

interface DocumentEditorProps {
  initialContent?: string
  onChange?: (html: string) => void
  readOnly?: boolean
  className?: string
}

function DocumentEditor({
  initialContent = "",
  onChange,
  readOnly = false,
  className,
}: DocumentEditorProps) {
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pageContainerRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Table.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            style: {
              default: null,
              parseHTML: (element) => element.getAttribute("style"),
              renderHTML: (attributes) => {
                if (!attributes.style) return {}
                return { style: attributes.style }
              },
            },
          }
        },
      }).configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Image.configure({ inline: false }),
    ],
    content: initialContent,
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getHTML())
    },
    editorProps: {
      attributes: {
        style: `outline: none; min-height: ${A4_MIN_HEIGHT_PX - A4_PADDING_PX * 2}px;`,
      },
    },
  })

  // Zoom helpers
  const clampZoom = useCallback(
    (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)),
    [],
  )

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => clampZoom(prev + ZOOM_STEP))
  }, [clampZoom])

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => clampZoom(prev - ZOOM_STEP))
  }, [clampZoom])

  const handleZoomReset = useCallback(() => {
    setZoom(ZOOM_DEFAULT)
  }, [])

  const handleFitToWidth = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const availableWidth = container.clientWidth - 48 // 24px padding each side
    const fitZoom = Math.round((availableWidth / A4_WIDTH_PX) * 100)
    setZoom(clampZoom(fitZoom))
  }, [clampZoom])

  // Keyboard shortcuts for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (!isMod) return

      if (e.key === "=" || e.key === "+") {
        e.preventDefault()
        handleZoomIn()
      } else if (e.key === "-") {
        e.preventDefault()
        handleZoomOut()
      } else if (e.key === "0") {
        e.preventDefault()
        handleZoomReset()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleZoomIn, handleZoomOut, handleZoomReset])

  // Toolbar button helper
  const ToolbarButton = useCallback(
    ({
      onClick,
      isActive = false,
      disabled = false,
      title,
      children,
    }: {
      onClick: () => void
      isActive?: boolean
      disabled?: boolean
      title: string
      children: React.ReactNode
    }) => (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          isActive && "bg-muted text-foreground",
        )}
      >
        {children}
      </Button>
    ),
    [],
  )

  if (!editor) return null

  const scaleFactor = zoom / 100

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-background px-2 py-1">
        {/* Formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive("underline")}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          isActive={editor.isActive({ textAlign: "left" })}
          title="Align left"
        >
          <AlignLeft className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          isActive={editor.isActive({ textAlign: "center" })}
          title="Align center"
        >
          <AlignCenter className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          isActive={editor.isActive({ textAlign: "right" })}
          title="Align right"
        >
          <AlignRight className="size-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title="Ordered list"
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Table */}
        <ToolbarButton
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          title="Insert table (3x3)"
        >
          <Table2 className="size-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Undo / Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="size-4" />
        </ToolbarButton>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton onClick={handleZoomOut} title="Zoom out (Ctrl+-)">
            <ZoomOut className="size-4" />
          </ToolbarButton>

          <button
            onClick={handleZoomReset}
            title="Reset zoom (Ctrl+0)"
            className="h-7 min-w-[3.5rem] rounded-md px-3 text-center text-xs font-medium text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
          >
            {zoom}%
          </button>

          <ToolbarButton onClick={handleZoomIn} title="Zoom in (Ctrl+=)">
            <ZoomIn className="size-4" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <ToolbarButton onClick={handleFitToWidth} title="Fit to width">
            <Maximize2 className="size-4" />
          </ToolbarButton>
        </div>
      </div>

      {/* Editor area with gray background */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto bg-muted"
      >
        <div className="flex justify-center px-6 py-8">
          {/* Scaled page wrapper */}
          <div
            style={{
              transform: `scale(${scaleFactor})`,
              transformOrigin: "top center",
              width: A4_WIDTH_PX,
              // Reserve layout space for the scaled content
              marginBottom: `${(scaleFactor - 1) * A4_MIN_HEIGHT_PX}px`,
            }}
          >
            {/* A4 page */}
            <div
              ref={pageContainerRef}
              className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
              style={{
                width: A4_WIDTH_PX,
                minHeight: A4_MIN_HEIGHT_PX,
                padding: A4_PADDING_PX,
              }}
            >
              <div className="tiptap-editor">
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TipTap content styles */}
      <style>{`
        .tiptap-editor .ProseMirror {
          outline: none;
          min-height: ${A4_MIN_HEIGHT_PX - A4_PADDING_PX * 2}px;
          font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 11pt;
          line-height: 1.6;
          color: #04070F;
        }

        .tiptap-editor .ProseMirror p {
          margin: 0.5em 0;
        }

        .tiptap-editor .ProseMirror h1 {
          font-size: 1.75em;
          font-weight: 700;
          margin: 0.75em 0 0.5em;
        }

        .tiptap-editor .ProseMirror h2 {
          font-size: 1.4em;
          font-weight: 700;
          margin: 0.65em 0 0.45em;
        }

        .tiptap-editor .ProseMirror h3 {
          font-size: 1.15em;
          font-weight: 600;
          margin: 0.6em 0 0.4em;
        }

        .tiptap-editor .ProseMirror table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.75em 0;
        }

        .tiptap-editor .ProseMirror td,
        .tiptap-editor .ProseMirror th {
          padding: 8px;
          vertical-align: top;
          position: relative;
        }

        .tiptap-editor .ProseMirror th {
          font-weight: 600;
        }

        .tiptap-editor .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
        }

        .tiptap-editor .ProseMirror ul,
        .tiptap-editor .ProseMirror ol {
          padding-left: 1.5em;
          margin: 0.5em 0;
        }

        .tiptap-editor .ProseMirror ul {
          list-style-type: disc;
        }

        .tiptap-editor .ProseMirror ol {
          list-style-type: decimal;
        }

        .tiptap-editor .ProseMirror li {
          margin: 0.15em 0;
        }

        .tiptap-editor .ProseMirror blockquote {
          border-left: 3px solid #DFE1E5;
          padding-left: 1em;
          margin: 0.75em 0;
          color: #6E7278;
        }

        .tiptap-editor .ProseMirror code {
          background-color: #F0F2F5;
          border-radius: 4px;
          padding: 0.15em 0.3em;
          font-size: 0.9em;
        }

        .tiptap-editor .ProseMirror .tableWrapper {
          overflow-x: auto;
        }

        .tiptap-editor .ProseMirror .selectedCell::after {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(79, 70, 229, 0.1);
          pointer-events: none;
        }

        .tiptap-editor .ProseMirror .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: -2px;
          width: 4px;
          background-color: #4F46E5;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

export { DocumentEditor }
export type { DocumentEditorProps }
