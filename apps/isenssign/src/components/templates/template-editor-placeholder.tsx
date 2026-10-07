"use client"

import { useTranslations } from "next-intl"
import {
  PenTool,
  Type,
  CalendarDays,
  CheckSquare,
  Fingerprint,
  FileText,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

interface FieldPaletteItem {
  id: string
  icon: React.ReactNode
}

const FIELD_PALETTE: FieldPaletteItem[] = [
  { id: "signature", icon: <PenTool className="size-5" /> },
  { id: "text", icon: <Type className="size-5" /> },
  { id: "date", icon: <CalendarDays className="size-5" /> },
  { id: "checkbox", icon: <CheckSquare className="size-5" /> },
  { id: "initials", icon: <Fingerprint className="size-5" /> },
]

function TemplateEditorPlaceholder() {
  const t = useTranslations("templates")
  return (
    <div className="flex h-full min-h-[600px] gap-0 overflow-hidden rounded-lg border">
      {/* Left: Field Palette */}
      <div className="flex w-60 shrink-0 flex-col border-r bg-background">
        <div className="border-b p-4">
          <h3 className="text-sm font-semibold">{t("fieldPalette")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("fieldPaletteHint")}
          </p>
        </div>
        <div className="flex flex-col gap-2 p-3">
          {FIELD_PALETTE.map((field) => (
            <div
              key={field.id}
              className="flex cursor-grab items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent active:cursor-grabbing"
              draggable
            >
              <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {field.icon}
              </div>
              <span className="text-sm font-medium">{t(`fields.${field.id}`)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Center: PDF Canvas */}
      <div className="flex flex-1 flex-col bg-muted/30">
        <div className="flex items-center justify-between border-b bg-background px-4 py-2">
          <span className="text-sm font-medium">{t("documentEditor")}</span>
          <span className="text-xs text-muted-foreground">
            {t("pageProgress", { current: 1, total: 1 })}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex aspect-[210/297] w-full max-w-[595px] flex-col items-center justify-center rounded-sm border-2 border-dashed border-muted-foreground/20 bg-white shadow-sm dark:bg-zinc-900">
            <FileText className="size-16 text-muted-foreground/30" />
            <p className="mt-4 text-lg font-medium text-muted-foreground/50">
              {t("pdfPreview")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground/40">
              {t("dragFieldHere")}
            </p>
          </div>
        </div>
      </div>

      {/* Right: Field Properties */}
      <div className="flex w-64 shrink-0 flex-col border-l bg-background">
        <div className="border-b p-4">
          <h3 className="text-sm font-semibold">{t("fields.fieldProperties")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("fields.selectFieldHint")}
          </p>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <Card>
            <CardHeader className="p-3 pb-0">
              <CardTitle className="text-xs text-muted-foreground">
                {t("fields.noFieldSelected")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">
                {t("fields.clickFieldHint")}
              </p>
            </CardContent>
          </Card>

          <Separator />

          {/* Placeholder property inputs */}
          <div className="flex flex-col gap-3 opacity-50">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("fields.fieldName")}</Label>
              <Input placeholder={t("fields.fieldNamePlaceholder")} disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("fields.assignSigner")}</Label>
              <Input placeholder={t("fields.selectSigner")} disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("fields.xCoord")}</Label>
              <Input type="number" placeholder="0" disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("fields.yCoord")}</Label>
              <Input type="number" placeholder="0" disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("fields.width")}</Label>
              <Input type="number" placeholder="200" disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("fields.height")}</Label>
              <Input type="number" placeholder="60" disabled />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { TemplateEditorPlaceholder }
