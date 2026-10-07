"use client"

import { create } from "zustand"
import type { TemplateField, FieldPosition } from "@/lib/pdf"
import type { TextBlock, DocumentPage } from "@/lib/text-block"

interface EditorState {
  fields: TemplateField[]
  selectedFieldId: string | null
  pageCount: number
  setPageCount: (count: number) => void
  addField: (field: TemplateField) => void
  updateField: (id: string, updates: Partial<Omit<TemplateField, "id">>) => void
  removeField: (id: string) => void
  selectField: (id: string | null) => void
  moveField: (id: string, position: Pick<FieldPosition, "x" | "y">) => void
  resizeField: (id: string, size: Pick<FieldPosition, "width" | "height">) => void
  clearFields: () => void

  // 문서 페이지 이미지
  pageImages: DocumentPage[]
  setPageImages: (pages: DocumentPage[]) => void

  // 텍스트 블록
  textBlocks: TextBlock[]
  selectedTextBlockId: string | null
  setTextBlocks: (blocks: TextBlock[]) => void
  addTextBlock: (block: TextBlock) => void
  updateTextBlock: (id: string, updates: Partial<Omit<TextBlock, "id">>) => void
  removeTextBlock: (id: string) => void
  selectTextBlock: (id: string | null) => void
  moveTextBlock: (id: string, pos: { x: number; y: number }) => void
  resizeTextBlock: (id: string, size: { width: number; height: number }) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  fields: [],
  selectedFieldId: null,
  pageCount: 2,

  setPageCount: (count) => set({ pageCount: count }),

  addField: (field) =>
    set((state) => ({
      fields: [...state.fields, field],
      selectedFieldId: field.id,
      selectedTextBlockId: null,
    })),

  updateField: (id, updates) =>
    set((state) => ({
      fields: state.fields.map((f) =>
        f.id === id ? { ...f, ...updates } : f
      ),
    })),

  removeField: (id) =>
    set((state) => ({
      fields: state.fields.filter((f) => f.id !== id),
      selectedFieldId: state.selectedFieldId === id ? null : state.selectedFieldId,
    })),

  selectField: (id) => set({ selectedFieldId: id, selectedTextBlockId: null }),

  moveField: (id, position) =>
    set((state) => ({
      fields: state.fields.map((f) =>
        f.id === id
          ? { ...f, position: { ...f.position, x: position.x, y: position.y } }
          : f
      ),
    })),

  resizeField: (id, size) =>
    set((state) => ({
      fields: state.fields.map((f) =>
        f.id === id
          ? {
              ...f,
              position: {
                ...f.position,
                width: size.width,
                height: size.height,
              },
            }
          : f
      ),
    })),

  clearFields: () => set({ fields: [], selectedFieldId: null }),

  // 문서 페이지 이미지
  pageImages: [],
  setPageImages: (pages) => set({ pageImages: pages, pageCount: pages.length }),

  // 텍스트 블록
  textBlocks: [],
  selectedTextBlockId: null,

  setTextBlocks: (blocks) => set({ textBlocks: blocks }),

  addTextBlock: (block) =>
    set((state) => ({
      textBlocks: [...state.textBlocks, block],
      selectedTextBlockId: block.id,
      selectedFieldId: null,
    })),

  updateTextBlock: (id, updates) =>
    set((state) => ({
      textBlocks: state.textBlocks.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    })),

  removeTextBlock: (id) =>
    set((state) => ({
      textBlocks: state.textBlocks.filter((b) => b.id !== id),
      selectedTextBlockId:
        state.selectedTextBlockId === id ? null : state.selectedTextBlockId,
    })),

  selectTextBlock: (id) =>
    set({ selectedTextBlockId: id, selectedFieldId: null }),

  moveTextBlock: (id, pos) =>
    set((state) => ({
      textBlocks: state.textBlocks.map((b) =>
        b.id === id ? { ...b, x: pos.x, y: pos.y } : b
      ),
    })),

  resizeTextBlock: (id, size) =>
    set((state) => ({
      textBlocks: state.textBlocks.map((b) =>
        b.id === id ? { ...b, width: size.width, height: size.height } : b
      ),
    })),
}))
