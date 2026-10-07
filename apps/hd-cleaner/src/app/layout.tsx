import type { Metadata, Viewport } from "next";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { hdCleanerTheme, lightVars, darkVars } from "@/styles/theme";

export const metadata: Metadata = {
  title: "HD Cleaner",
  description: "디스크 정리 유틸리티 (mycrew)",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

function cssVarsBlock(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
        {/* 헨젤 디자인 §1 색상 토큰을 CSS 변수로 주입 (시스템 설정 자동 감지, 다크는 Mantine data-attribute로 전환) */}
        <style>{`:root { ${cssVarsBlock(lightVars)} } [data-mantine-color-scheme="dark"] { ${cssVarsBlock(darkVars)} }`}</style>
      </head>
      <body style={{ margin: 0 }}>
        <MantineProvider theme={hdCleanerTheme} defaultColorScheme="auto">
          <Notifications position="top-right" />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
