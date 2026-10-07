"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Pen,
  Type,
  Upload,
  RotateCcw,
  Check,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

interface SignaturePadProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (signatureDataUrl: string) => void
}

export default function SignaturePad({
  open,
  onOpenChange,
  onConfirm,
}: SignaturePadProps) {
  const t = useTranslations("signing")
  const tc = useTranslations("common")
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = React.useState(false)
  const [typedName, setTypedName] = React.useState("")
  const [uploadedImage, setUploadedImage] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState("draw")
  const [hasDrawn, setHasDrawn] = React.useState(false)

  // 캔버스 초기화
  React.useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#000000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    setHasDrawn(false)
  }, [open])

  const getPosition = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()

    // CSS가 캔버스를 늘리므로 실제 좌표계로 스케일 보정
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    if ("touches" in e) {
      const touch = e.touches[0]
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!ctx) return
    const pos = getPosition(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
    setHasDrawn(true)
  }

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault()
    if (!isDrawing) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!ctx) return
    const pos = getPosition(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!ctx || !canvas) return
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#000000"
    ctx.lineWidth = 2
    setHasDrawn(false)
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setUploadedImage(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const getSignatureDataUrl = (): string | null => {
    if (activeTab === "draw") {
      if (!hasDrawn) return null
      return canvasRef.current?.toDataURL("image/png") ?? null
    }
    if (activeTab === "type") {
      if (!typedName.trim()) return null
      // 텍스트 기반 서명을 캔버스에 렌더링
      const canvas = document.createElement("canvas")
      canvas.width = 400
      canvas.height = 150
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "#000000"
      ctx.font = "italic 40px 'Georgia', serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(typedName, 200, 75)
      return canvas.toDataURL("image/png")
    }
    if (activeTab === "upload") {
      return uploadedImage
    }
    return null
  }

  const handleConfirm = () => {
    const dataUrl = getSignatureDataUrl()
    if (dataUrl) {
      onConfirm(dataUrl)
      onOpenChange(false)
    }
  }

  const canConfirm =
    (activeTab === "draw" && hasDrawn) ||
    (activeTab === "type" && typedName.trim().length > 0) ||
    (activeTab === "upload" && uploadedImage !== null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("typeSignature")}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="draw" className="flex-1">
              <Pen className="h-4 w-4 mr-1.5" />
              {t("tabs.draw")}
            </TabsTrigger>
            <TabsTrigger value="type" className="flex-1">
              <Type className="h-4 w-4 mr-1.5" />
              {t("tabs.type")}
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1">
              <Upload className="h-4 w-4 mr-1.5" />
              {t("tabs.upload")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draw" className="space-y-3">
            <div className="rounded-lg border bg-white overflow-hidden">
              <canvas
                ref={canvasRef}
                width={440}
                height={180}
                className="w-full cursor-crosshair touch-none"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>
            <Button variant="outline" size="sm" onClick={clearCanvas}>
              <RotateCcw className="h-4 w-4" data-icon="inline-start" />
              {t("clear")}
            </Button>
          </TabsContent>

          <TabsContent value="type" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="signature-name">{t("enterName")}</Label>
              <Input
                id="signature-name"
                placeholder={t("namePlaceholder")}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
              />
            </div>
            {typedName && (
              <div className="rounded-lg border bg-white p-6 text-center">
                <span
                  className="text-3xl italic"
                  style={{ fontFamily: "'Georgia', serif" }}
                >
                  {typedName}
                </span>
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="signature-upload">{t("uploadSignatureImage")}</Label>
              <Input
                id="signature-upload"
                type="file"
                accept="image/*"
                onChange={handleUpload}
              />
            </div>
            {uploadedImage && (
              <div className="rounded-lg border bg-white p-4 flex items-center justify-center">
                <img
                  src={uploadedImage}
                  alt={t("uploadedSignature")}
                  className="max-h-32 object-contain"
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            <Check className="h-4 w-4" data-icon="inline-start" />
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
