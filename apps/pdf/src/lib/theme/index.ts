// MyPDF Mantine theme — 마이크루 디자인 시스템 통합 토큰 (jarvis 인디고)
// 메인 대시보드/approval/payment/hd-cleaner와 동일 팔레트·폰트·radius.
import { createTheme, type MantineColorsTuple } from "@mantine/core";

const jarvis: MantineColorsTuple = [
  "#EEF2FF", "#E0E7FF", "#C7D2FE", "#A5B4FC", "#818CF8",
  "#6366F1", "#4F46E5", "#4338CA", "#3730A3", "#312E81",
];

export const pdfTheme = createTheme({
  primaryColor: "jarvis",
  primaryShade: { light: 6, dark: 5 },
  colors: {
    jarvis,
    // 영업부 store-redesign 다크 팔레트 (메인 대시보드와 동일)
    dark: [
      "#F8F8F8", "#E4E4E4", "#9DB7EB", "#7D8699", "#1F293D",
      "#151F32", "#070D1A", "#04070F", "#020824", "#000000",
    ],
  },
  fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  defaultRadius: "md",
  radius: { xs: "4px", sm: "6px", md: "10px", lg: "14px", xl: "32px" },
  fontSizes: { xs: "12px", sm: "12px", md: "14px", lg: "16px", xl: "20px" },
  // 마이크루 Mantine 컴포넌트 기본값 — 메인 대시보드(src/client/theme.ts) components 블록과 동일 규격.
  // Modal backgroundColor(--jarvis-surface-bg)는 메인 전용 CSS 변수라 제외 (radius·overlayProps만).
  // Next.js 서버 컴포넌트(layout.tsx)에서 import되므로 Component.extend() 대신 플레인 객체 사용.
  components: {
    Modal: { defaultProps: { radius: "lg", overlayProps: { backgroundOpacity: 0.8, blur: 2 } } },
    Card: { defaultProps: { withBorder: false, radius: "lg" } },
    Button: { defaultProps: { radius: "md", variant: "light" } },
    ActionIcon: { defaultProps: { radius: "md", variant: "subtle" } },
    TextInput: { defaultProps: { radius: "md" } },
    Select: { defaultProps: { radius: "md" } },
    Textarea: { defaultProps: { radius: "md" } },
    Tabs: { defaultProps: { color: "jarvis", radius: "sm", variant: "pills" } },
    Badge: { defaultProps: { radius: "xl", size: "sm", variant: "light" } },
  },
});
