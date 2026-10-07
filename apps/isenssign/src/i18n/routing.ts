import { defineRouting } from "next-intl/routing"

export const routing = defineRouting({
  locales: ["ko", "en", "ja"],
  // 미지원·무효 로케일 폴백은 en (표준 언어 감지 규칙). `/` 진입 시 언어 감지는 next.config.ts redirects 담당.
  defaultLocale: "en",
  // basePath(mycrew iframe 프록시) 하에서 "as-needed"는 기본 로케일 바로-루트(`/`)
  // 리라이트가 깨져 404가 난다. 모든 페이지에 로케일 프리픽스를 강제해 회피.
  localePrefix: "always",
})

export type Locale = (typeof routing.locales)[number]
