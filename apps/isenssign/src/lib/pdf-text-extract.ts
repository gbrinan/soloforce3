/**
 * PDF 텍스트 추출
 * pdfjs-dist를 child_process로 실행하여 Turbopack 번들링 문제 우회
 */
import { execFile } from "child_process"
import { promisify } from "util"
import { promises as fs } from "fs"
import path from "path"
import type { TextBlock } from "@/lib/text-block"

const execFileAsync = promisify(execFile)

interface ExtractResult {
  textBlocks: TextBlock[]
  pageCount: number
  pageDimensions: Array<{ width: number; height: number }>
}

/**
 * PDF 파일에서 텍스트 블록과 좌표를 추출
 * @param pdfPath PDF 파일 경로
 */
export async function extractTextBlocksFromFile(
  pdfPath: string,
): Promise<ExtractResult> {
  const scriptPath = path.resolve(process.cwd(), "scripts/pdf-extract.mjs")

  const { stdout } = await execFileAsync("node", [scriptPath, pdfPath], {
    timeout: 60_000,
    maxBuffer: 50 * 1024 * 1024, // 50MB
    cwd: process.cwd(),
  })

  return JSON.parse(stdout)
}

/**
 * PDF 바이너리 데이터에서 텍스트 블록 추출 (버퍼를 임시 파일로 저장 후 처리)
 */
export async function extractTextBlocks(
  pdfData: Uint8Array,
): Promise<ExtractResult> {
  const tmpPath = path.join("/tmp", `isens-extract-${Date.now()}.pdf`)

  try {
    await fs.writeFile(tmpPath, Buffer.from(pdfData))
    return await extractTextBlocksFromFile(tmpPath)
  } finally {
    fs.unlink(tmpPath).catch(() => {})
  }
}
