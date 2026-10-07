import { getRequestConfig } from "next-intl/server"
import { readFileSync } from "fs"
import { join } from "path"
import { routing, type Locale } from "./routing"

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale
  }

  // Use fs.readFileSync to avoid Turbopack JSON import caching issues.
  // ★ 정본은 루트 messages/ (16키 완전). src/messages/ 는 stale 복사본(6키)이라
  //   booking·signing·settings 등 누락 → MISSING_MESSAGE 다발. messages/ 로 통일 (2026-06-26).
  const messagesPath = join(process.cwd(), "messages", `${locale}.json`)
  const messages = JSON.parse(readFileSync(messagesPath, "utf-8"))

  return {
    locale,
    messages,
  }
})
