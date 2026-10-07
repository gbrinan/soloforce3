/**
 * LibreOffice headless 래퍼
 * Office 문서(.docx, .xlsx, .pptx)를 PDF로 변환
 */
import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import { promises as fs } from "fs"

const execFileAsync = promisify(execFile)

const CONVERT_TIMEOUT_MS = 60_000 // 60초

/**
 * LibreOffice 바이너리 경로 탐지
 */
function findSofficePath(): string {
  // 환경변수 우선
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH

  // macOS
  const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
  // Linux (Docker)
  const linuxPath = "/usr/bin/soffice"
  // Homebrew
  const brewPath = "/opt/homebrew/bin/soffice"

  // 기본값: macOS 경로 → Linux → brew → soffice (PATH에서 찾기)
  return macPath // 런타임에 존재 여부 확인
}

/**
 * Office 문서를 PDF로 변환
 * @param inputPath 원본 파일 경로 (절대 경로)
 * @param outputDir PDF 출력 디렉터리
 * @returns 생성된 PDF 파일 경로
 */
export async function convertToPdf(
  inputPath: string,
  outputDir: string,
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true })

  const sofficePaths = [
    process.env.LIBREOFFICE_PATH,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/bin/soffice",
    "soffice",
  ].filter(Boolean) as string[]

  let lastError: Error | null = null

  for (const soffice of sofficePaths) {
    try {
      await execFileAsync(
        soffice,
        [
          "--headless",
          "--norestore",
          "--convert-to",
          "pdf",
          "--outdir",
          outputDir,
          inputPath,
        ],
        {
          timeout: CONVERT_TIMEOUT_MS,
          env: {
            ...process.env,
            HOME: process.env.HOME || "/tmp",
          },
        },
      )

      // 변환된 PDF 경로 반환
      const basename = path.basename(inputPath, path.extname(inputPath))
      const pdfPath = path.join(outputDir, `${basename}.pdf`)

      // PDF 파일 존재 확인
      await fs.access(pdfPath)
      return pdfPath
    } catch (err) {
      lastError = err as Error
      // 다음 경로 시도
      continue
    }
  }

  throw new Error(
    `LibreOffice를 찾을 수 없습니다. LibreOffice를 설치해주세요.\n` +
      `macOS: brew install --cask libreoffice\n` +
      `Docker: apt-get install -y libreoffice-core\n` +
      `또는 LIBREOFFICE_PATH 환경변수를 설정해주세요.\n` +
      `마지막 에러: ${lastError?.message}`,
  )
}

/**
 * LibreOffice 설치 여부 확인
 */
export async function isLibreOfficeAvailable(): Promise<boolean> {
  const paths = [
    process.env.LIBREOFFICE_PATH,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/bin/soffice",
  ].filter(Boolean) as string[]

  for (const p of paths) {
    try {
      await fs.access(p)
      return true
    } catch {
      continue
    }
  }

  // PATH에서 찾기
  try {
    await execFileAsync("which", ["soffice"])
    return true
  } catch {
    return false
  }
}
