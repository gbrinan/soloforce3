// 마이크루 디자인 시스템 통합 토큰 — 브랜드 색: jarvis 인디고 (메인 대시보드/approval/payment/isenssign과 동일)
// 순수 데이터 파일(훅/브라우저API 없음) — "use client" 부착 시 Server Component(layout.tsx)에서
// import한 lightVars/darkVars가 클라이언트 레퍼런스로 치환되어 Object.entries가 빈 배열을 반환한다.
import { createTheme, type MantineColorsTuple } from "@mantine/core";

const jarvis: MantineColorsTuple = [
  "#EEF2FF", "#E0E7FF", "#C7D2FE", "#A5B4FC", "#818CF8",
  "#6366F1", "#4F46E5", "#4338CA", "#3730A3", "#312E81",
];

export const hdCleanerTheme = createTheme({
  primaryColor: "jarvis",
  primaryShade: { light: 6, dark: 5 },
  colors: {
    jarvis,
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
  // 순수 데이터 파일 유지(상단 주석 참조) — Component.extend() 대신 플레인 객체 사용.
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

// 라이트 모드 토큰 — isenssign globals.css(마이크루 통합 토큰)와 동일 계열
export const lightVars: Record<string, string> = {
  "--bg-canvas": "#FAFAFA",
  "--bg-card": "#FFFFFF",
  "--bg-muted": "#F0F2F5",
  "--bg-elevated": "#E7EAF0",
  "--border-default": "#DFE1E5",
  "--text-primary": "#04070F",
  "--text-secondary": "#13295F",
  "--text-muted": "#6E7278",
  "--color-used": "#4F46E5",
  "--color-free": "#059669",
  "--color-reclaimable": "#FBBF24",
  "--color-action-primary": "#4F46E5",
  "--color-action-primary-hover": "#4338CA",
  "--color-danger": "#DC2626",
  "--color-success-text": "#059669",
};

// 다크 모드 토큰 — jarvis 다크 팔레트 (canvas #0A0F1E 계열)
export const darkVars: Record<string, string> = {
  "--bg-canvas": "#0A0F1E",
  "--bg-card": "#0F1726",
  "--bg-muted": "#151F32",
  "--bg-elevated": "#1B2740",
  "--border-default": "#1F293D",
  "--text-primary": "#F8F8F8",
  "--text-secondary": "#9DB7EB",
  "--text-muted": "#7D8699",
  "--color-used": "#6366F1",
  "--color-free": "#34D399",
  "--color-reclaimable": "#FBBF24",
  "--color-action-primary": "#6366F1",
  "--color-action-primary-hover": "#818CF8",
  "--color-danger": "#F87171",
  "--color-success-text": "#34D399",
};
