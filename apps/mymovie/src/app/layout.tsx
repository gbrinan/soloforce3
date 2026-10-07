import type { Metadata, Viewport } from "next";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import "@/lib/theme/tokens.css";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { mymovieTheme } from "@/lib/theme";
import HostBridge from "@/components/HostBridge";

export const metadata: Metadata = {
  title: "MyMovie",
  description: "MyMovie 영상 편집 (mycrew)",
};

// Mobile responsive — match shell/sister apps (photos·sign) which set
// initial-scale=1 + maximum-scale=1 so the embedded Next app does not get
// zoomed on small viewports. iframe-embedded child needs its own viewport.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body>
        <MantineProvider theme={mymovieTheme} defaultColorScheme="dark">
          <Notifications position="top-right" />
          <HostBridge />
          <I18nProvider>{children}</I18nProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
