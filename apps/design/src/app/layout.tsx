import type { Metadata, Viewport } from "next";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { designTheme } from "@/lib/theme";

export const metadata: Metadata = {
  title: "MyDesign",
  description: "MyDesign 벡터 디자인 도구 (mycrew)",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body style={{ margin: 0, overflow: "hidden" }}>
        <MantineProvider theme={designTheme} defaultColorScheme="dark">
          <Notifications position="top-right" />
          <I18nProvider>{children}</I18nProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
