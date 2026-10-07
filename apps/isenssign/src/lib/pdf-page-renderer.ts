/**
 * PDF 페이지를 PNG 이미지로 렌더링 (서버 사이드)
 * pdfjs-dist + node-canvas를 child_process로 실행하여 Turbopack 번들링 문제 우회
 */
import { execFile } from "child_process"
import { promisify } from "util"
import { promises as fs } from "fs"
import path from "path"
import { getStorage } from "@/lib/storage"

const execFileAsync = promisify(execFile)

interface RenderedPage {
  pageIndex: number
  width: number
  height: number
  storageKey: string
  imageUrl: string
}

/**
 * PDF 렌더링 에러
 */
export class PdfRenderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = "PdfRenderError"
  }
}

/**
 * PDF 전체 페이지를 PNG 이미지로 렌더링 후 스토리지에 저장
 */
export async function renderPdfPages(
  pdfData: Uint8Array,
  storagePrefix: string,
  password?: string,
): Promise<RenderedPage[]> {
  const tmpPdfPath = path.join("/tmp", `isens-render-${Date.now()}.pdf`)
  const tmpOutputDir = path.join("/tmp", `isens-pages-${Date.now()}`)

  try {
    await fs.writeFile(tmpPdfPath, Buffer.from(pdfData))
    await fs.mkdir(tmpOutputDir, { recursive: true })

    const scriptPath = path.resolve(process.cwd(), "scripts/pdf-render.mjs")
    const args = [scriptPath, tmpPdfPath, tmpOutputDir]
    
    if (password) {
      args.push(password)
    }

    let stdout: string
    try {
      const result = await execFileAsync("node", args, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: process.cwd(),
      })
      stdout = result.stdout
    } catch (execError: any) {
      // execFile 실패 시 stdout/stderr 모두 확인
      const output = (execError.stdout || execError.stderr || "").toString()

      // 구조화된 에러 JSON 파싱 시도 (pdf-render.mjs가 stdout으로 반환)
      let errorData: { error?: string; message?: string } | null = null
      try {
        errorData = JSON.parse(output)
      } catch {
        errorData = null
      }

      if (errorData?.error) {
        throw new PdfRenderError(errorData.error, errorData.message ?? "PDF 렌더링에 실패했습니다.")
      }

      // JSON이 아니면 raw 에러 메시지에서 의미 추출
      if (output.includes("Incorrect password") || output.includes("PASSWORD_REQUIRED")) {
        throw new PdfRenderError(
          "PASSWORD_REQUIRED",
          "비밀번호로 보호된 PDF입니다. 비밀번호를 해제한 후 다시 업로드해 주세요.",
        )
      }

      if (output.includes("PDFTOPPM_NOT_FOUND")) {
        throw new PdfRenderError(
          "PDFTOPPM_NOT_FOUND",
          "PDF 렌더링 도구가 설치되지 않았습니다. 관리자에게 문의하세요.",
        )
      }

      throw new PdfRenderError(
        "RENDER_FAILED",
        `PDF 렌더링 중 오류가 발생했습니다: ${output.slice(0, 200)}`,
      )
    }

    const rawPages: Array<{
      pageIndex: number
      width: number
      height: number
      filename: string
      filePath: string
    }> = JSON.parse(stdout)

    const storage = getStorage()
    const pages: RenderedPage[] = []

    for (const rp of rawPages) {
      const pngBuffer = await fs.readFile(rp.filePath)
      const storageKey = `${storagePrefix}/page-${rp.pageIndex + 1}.png`
      await storage.upload(storageKey, pngBuffer, "image/png")

      pages.push({
        pageIndex: rp.pageIndex,
        width: rp.width,
        height: rp.height,
        storageKey,
        imageUrl: storage.getUrl(storageKey),
      })
    }

    return pages
  } finally {
    fs.unlink(tmpPdfPath).catch(() => {})
    fs.rm(tmpOutputDir, { recursive: true, force: true }).catch(() => {})
  }
}
