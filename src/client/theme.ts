import { createTheme, MantineColorsTuple, Modal, Card, Button, TextInput, Select, Textarea, Tabs, Badge, ActionIcon } from '@mantine/core';

// Tailwind Indigo 10-shade — 보존 팔레트 (CostsPanel, TodoPanel c="jarvis.4" 사용처)
const jarvis: MantineColorsTuple = [
  '#EEF2FF', // 0  indigo-50
  '#E0E7FF', // 1  indigo-100
  '#C7D2FE', // 2  indigo-200
  '#A5B4FC', // 3  indigo-300
  '#818CF8', // 4  indigo-400  ← 다크 모드 액센트 (legacy)
  '#6366F1', // 5  indigo-500
  '#4F46E5', // 6  indigo-600
  '#4338CA', // 7  indigo-700
  '#3730A3', // 8  indigo-800
  '#312E81', // 9  indigo-900
];

// 영업부 store-redesign 팔레트 매칭 — 새 primary 톤
const jarvisPrime: MantineColorsTuple = [
  '#EBF2FF', // 0  영업부 --secondary (light)
  '#E1ECFF', // 1  영업부 --accent (light)
  '#9DB7EB', // 2  영업부 --secondary-foreground (dark)
  '#4779EA', // 3  ← 다크 primary (primaryShade.dark)
  '#1E49B7', // 4  ← 라이트 primary (primaryShade.light) ※ 인덱스 비표준
  '#13295F', // 5  영업부 --sidebar-accent (light)
  '#03185A', // 6  영업부 --accent-foreground (light)
  '#031448', // 7  영업부 --sidebar (light)
  '#020824', // 8  영업부 --sidebar (dark)
  '#04070F', // 9  영업부 --foreground (light)
];

export const theme = createTheme({
  primaryColor: 'jarvis',
  primaryShade: { light: 6, dark: 5 },
  colors: {
    jarvis,
    jarvisPrime,
    // 다크 팔레트 — 영업부 store-redesign hex 매칭
    dark: [
      '#F8F8F8', // dark.0 — 영업부 --foreground (dark)
      '#E4E4E4', // dark.1 — 영업부 --sidebar-foreground (dark)
      '#9DB7EB', // dark.2 — dimmed = 영업부 --secondary-foreground
      '#7D8699', // dark.3 — 영업부 --muted-foreground (dark)
      '#1F293D', // dark.4 — 보더 = 영업부 --border (dark)
      '#151F32', // dark.5 — 영업부 --muted (dark)
      '#070D1A', // dark.6 — 카드 = 영업부 --card (dark)
      '#04070F', // dark.7 — 메인 배경 = 영업부 --background (dark)
      '#020824', // dark.8 — 영업부 --sidebar (dark)
      '#000000', // dark.9
    ],
    // 라이트 모드 gray — 영업부 라이트 톤 매칭
    gray: [
      '#FFFFFF', // gray.0 — 영업부 --background (light) = --card
      '#F0F2F5', // gray.1 — 영업부 --muted (light)
      '#E1ECFF', // gray.2 — 영업부 --accent (light)
      '#DFE1E5', // gray.3 — 영업부 --border (light)
      '#9DB7EB', // gray.4
      '#7D8699',
      '#6E7278', // gray.6 — 영업부 --muted-foreground (light)
      '#13295F', // gray.7 — 영업부 --secondary-foreground (light)
      '#1F293D', // gray.8
      '#04070F', // gray.9 — 영업부 --foreground (light)
    ],
  },
  fontFamily:
    "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  defaultRadius: 'md',
  radius: {
    xs: '4px',
    sm: '6px',
    md: '10px',  // 영업부 --radius
    lg: '14px',  // 영업부 Card rounded-xl = --radius + 4px
    xl: '32px',  // 영업부 Badge rounded-4xl (완전 pill)
  },
  // 폰트 사이즈 4단계 통일 (S/M/L/XL) — 강조는 weight로 처리
  // S=12px (메타·캡션), M=14px (본문 default), L=16px (소제목), XL=20px (페이지 제목)
  // Mantine 토큰 5개를 4단계로 압축 (xs=sm=S 동일 매핑)
  fontSizes: {
    xs: '12px', // S
    sm: '12px', // S
    md: '14px', // M
    lg: '16px', // L
    xl: '20px', // XL
  },
  components: {
    Modal: Modal.extend({
      // overlayProps 기본 — 다크모드에서 모달과 배경 구분이 약해 딤을 더 어둡게(0.75).
      defaultProps: { radius: 'lg' /* 14px = 영업부 카드 톤 */, overlayProps: { backgroundOpacity: 0.8, blur: 2 } },
      styles: {
        body: { padding: 'var(--mantine-spacing-md)' },
        content: { backgroundColor: 'var(--jarvis-surface-bg)' },
        header: { backgroundColor: 'var(--jarvis-surface-bg)' },
      },
    }),
    // 영업부 카드: ring-1 black/10 + radius 14 + soft shadow. ring·shadow는 styles.css 글로벌.
    // shadow:'none' 명시 시 Mantine inline box-shadow가 글로벌 .mantine-Card-root 룰을 가려서 제거함.
    // Paper는 의도적 제외 (ChatBubble 사용자 메시지 박스 보호)
    Card: Card.extend({
      defaultProps: { withBorder: false, radius: 'lg' /* 14px */ },
    }),
    Button: Button.extend({
      defaultProps: { radius: 'md' /* 10px = 영업부 base */, variant: 'light' },
    }),
    // 영업부 ghost variant 매칭: subtle + radius 10px. focus ring은 styles.css 글로벌.
    ActionIcon: ActionIcon.extend({
      defaultProps: { radius: 'md' /* 10px */, variant: 'subtle' },
    }),
    TextInput: TextInput.extend({
      defaultProps: { radius: 'md' },
    }),
    Select: Select.extend({
      defaultProps: { radius: 'md' },
    }),
    Textarea: Textarea.extend({
      defaultProps: { radius: 'md' },
    }),
    // 영업부 Tabs: 활성 흰색 pill + drop shadow. active 룰은 styles.css 글로벌.
    Tabs: Tabs.extend({
      defaultProps: { color: 'jarvis', radius: 'sm', variant: 'pills' },
    }),
    // 영업부 Badge: 완전 pill (radius 32px) + sm 사이즈 + filled.
    // 영업부 캡처 매칭 — 진한 BG + 흰 텍스트 + 좌측 dot. dot은 사용처에서 leftSection으로 주입.
    Badge: Badge.extend({
      defaultProps: { radius: 'xl' /* 32px */, size: 'sm', variant: 'light' },
    }),
  },
  other: {
    surface: {
      body: '#04070F',     // 영업부 다크 --background
      panel: '#070D1A',    // 영업부 다크 --card
      border: '#1F293D',   // 영업부 다크 --border
      mutedBg: '#151F32',  // 영업부 다크 --muted
    },
    text: {
      base: '#F8F8F8',     // 영업부 다크 --foreground
      muted: '#7D8699',    // 영업부 다크 --muted-foreground
      dim: '#7D8699',
      accent: '#818CF8',   // 인디고 다크 액센트 (jarvis.4) — 게이지 톤 통일
    },
    status: {
      success: '#34D399',  // mint (게이지 녹색)
      danger: '#F87171',   // soft coral
      info: '#6366F1',
      warning: '#FBBF24',  // soft amber
    },
  },
});
