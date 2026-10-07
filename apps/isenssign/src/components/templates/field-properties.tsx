"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useEditorStore } from "@/lib/template-editor-store"

const FIELD_TYPE_KEYS = new Set([
  "signature",
  "text",
  "date",
  "checkbox",
  "initials",
  "stamp",
])

interface PositionSizeInputsProps {
  fieldId: string
  position: { x: number; y: number; width: number; height: number; page: number }
  moveField: (id: string, pos: { x: number; y: number }) => void
  resizeField: (id: string, size: { width: number; height: number }) => void
}

function PositionSizeInputs({
  fieldId,
  position,
  moveField,
  resizeField,
}: PositionSizeInputsProps) {
  const t = useTranslations("templates")
  const [localX, setLocalX] = useState(String(position.x))
  const [localY, setLocalY] = useState(String(position.y))
  const [localW, setLocalW] = useState(String(position.width))
  const [localH, setLocalH] = useState(String(position.height))

  // Sync from store to local state when the field or its position changes
  useEffect(() => {
    setLocalX(String(position.x))
  }, [fieldId, position.x])

  useEffect(() => {
    setLocalY(String(position.y))
  }, [fieldId, position.y])

  useEffect(() => {
    setLocalW(String(position.width))
  }, [fieldId, position.width])

  useEffect(() => {
    setLocalH(String(position.height))
  }, [fieldId, position.height])

  const commitX = () => {
    const val = Number(localX)
    if (!Number.isNaN(val)) {
      moveField(fieldId, { x: val, y: position.y })
    } else {
      setLocalX(String(position.x))
    }
  }

  const commitY = () => {
    const val = Number(localY)
    if (!Number.isNaN(val)) {
      moveField(fieldId, { x: position.x, y: val })
    } else {
      setLocalY(String(position.y))
    }
  }

  const commitW = () => {
    const val = Number(localW)
    if (!Number.isNaN(val) && val > 0) {
      resizeField(fieldId, { width: val, height: position.height })
    } else {
      setLocalW(String(position.width))
    }
  }

  const commitH = () => {
    const val = Number(localH)
    if (!Number.isNaN(val) && val > 0) {
      resizeField(fieldId, { width: position.width, height: val })
    } else {
      setLocalH(String(position.height))
    }
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    commitFn: () => void,
  ) => {
    if (e.key === "Enter") {
      commitFn()
      e.currentTarget.blur()
    }
  }

  return (
    <div>
      <Label className="mb-2 block text-xs font-medium text-muted-foreground">
        {t("fields.positionSize")}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">X</Label>
          <Input
            type="number"
            value={localX}
            onChange={(e) => setLocalX(e.target.value)}
            onBlur={commitX}
            onKeyDown={(e) => handleKeyDown(e, commitX)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Y</Label>
          <Input
            type="number"
            value={localY}
            onChange={(e) => setLocalY(e.target.value)}
            onBlur={commitY}
            onKeyDown={(e) => handleKeyDown(e, commitY)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">{t("fields.width")}</Label>
          <Input
            type="number"
            value={localW}
            onChange={(e) => setLocalW(e.target.value)}
            onBlur={commitW}
            onKeyDown={(e) => handleKeyDown(e, commitW)}
            min={1}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">{t("fields.height")}</Label>
          <Input
            type="number"
            value={localH}
            onChange={(e) => setLocalH(e.target.value)}
            onBlur={commitH}
            onKeyDown={(e) => handleKeyDown(e, commitH)}
            min={1}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {t("pageNumber", { page: position.page + 1 })}
      </p>
    </div>
  )
}

export function FieldProperties() {
  const t = useTranslations("templates")
  const signerRoles = [
    { value: "signer-1", label: t("signers.signerN", { n: 1 }) },
    { value: "signer-2", label: t("signers.signerN", { n: 2 }) },
    { value: "signer-3", label: t("signers.signerN", { n: 3 }) },
    { value: "viewer", label: t("signers.viewer") },
  ]
  const fields = useEditorStore((s) => s.fields)
  const selectedFieldId = useEditorStore((s) => s.selectedFieldId)
  const updateField = useEditorStore((s) => s.updateField)
  const moveField = useEditorStore((s) => s.moveField)
  const resizeField = useEditorStore((s) => s.resizeField)
  const removeField = useEditorStore((s) => s.removeField)
  const selectField = useEditorStore((s) => s.selectField)

  const selectedField = selectedFieldId
    ? fields.find((f) => f.id === selectedFieldId) ?? null
    : null

  return (
    <div className="flex w-64 min-w-64 shrink-0 flex-col border-l bg-background">
      <div className="border-b p-4">
        <h3 className="text-sm font-semibold">{t("fields.fieldProperties")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedField
            ? t("fields.editSelectedField")
            : t("fields.selectFieldHint")}
        </p>
      </div>

      {!selectedField ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
          <p className="text-center text-sm text-muted-foreground">
            {t("fields.clickFieldHint")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {/* Field Name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("fields.fieldName")}</Label>
            <Input
              value={selectedField.name}
              onChange={(e) =>
                updateField(selectedField.id, { name: e.target.value })
              }
              placeholder={t("fields.fieldNamePlaceholder")}
            />
          </div>

          {/* Field Type (readonly) */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("fields.fieldType")}</Label>
            <Input
              value={
                FIELD_TYPE_KEYS.has(selectedField.type)
                  ? t(`fields.${selectedField.type}`)
                  : selectedField.type
              }
              readOnly
              className="bg-muted"
            />
          </div>

          <Separator />

          {/* Required toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("fields.requiredInput")}</Label>
            <Switch
              checked={selectedField.required}
              onCheckedChange={(checked) =>
                updateField(selectedField.id, { required: checked })
              }
            />
          </div>

          {/* Signer Role */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("fields.assignSigner")}</Label>
            <Select
              value={selectedField.signerRole}
              onValueChange={(value) => {
                if (value != null) {
                  updateField(selectedField.id, { signerRole: value })
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("fields.selectSigner")} />
              </SelectTrigger>
              <SelectContent>
                {signerRoles.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Default Value (for text / date) */}
          {(selectedField.type === "text" || selectedField.type === "date") && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("fields.defaultValue")}</Label>
              <Input
                value={selectedField.defaultValue ?? ""}
                onChange={(e) =>
                  updateField(selectedField.id, {
                    defaultValue: e.target.value,
                  })
                }
                placeholder={
                  selectedField.type === "date"
                    ? "YYYY-MM-DD"
                    : t("fields.textInputPlaceholder")
                }
              />
            </div>
          )}

          <Separator />

          {/* Position & Size */}
          <PositionSizeInputs
            fieldId={selectedField.id}
            position={selectedField.position}
            moveField={moveField}
            resizeField={resizeField}
          />

          <Separator />

          {/* Delete */}
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => {
              removeField(selectedField.id)
              selectField(null)
            }}
          >
            <Trash2 className="size-4" />
            {t("fields.removeField")}
          </Button>
        </div>
      )}
    </div>
  )
}
