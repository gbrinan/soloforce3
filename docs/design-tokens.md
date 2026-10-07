# Existing meeting UI design contract

This document records the existing meeting drawer controls, not a visual redesign.

## 1. Colors
Use existing CSS variables: --bg-canvas, --border-default, --text-primary, --text-muted. Shared button variants own accent colors.

## 2. Typography
Use --font-s for recording metadata and controls, --font-m for section labels. Keep existing application font inheritance.

## 3. Layout
Recording cards and their wrapping action row remain unchanged. Existing row gap is 4px and margin-top is 8px. Helper copy uses Mantine Text size sm and dimmed color. Korean helper copy keeps words together.

## 4. Motion
Reuse the existing dialog opening/closing and focus behavior. No new animation.

## 5. Reusable primitives and states
src/client/ui/controls.ts defines btn(sm, variant), wrapped by Meeting/buttonStyles.ts. Default Groq and optional Gemini actions use neutral buttons. Native disabled state prevents actions while a request is pending or the recording is processing. Dialog/dialog.tsx owns title input, confirm, cancel, keyboard and focus states. QA covers the drawer and provider dialogs at 375, 768 and 1280px, with request interception so no provider quota is consumed.

Dialog descriptions keep CJK words intact with word-break: keep-all; overflow-wrap: anywhere preserves long URL wrapping.
