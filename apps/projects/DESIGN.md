# Projects transfer design

## 1. Atmosphere & Identity
Preserve the existing Projects application's quiet, document-first utility surface. Native HTML controls, blue actions, white panels on the existing pale background.

## 2. Color
Existing tokens: --bg #f6f7f9, --panel #fff, --line #e5e7eb, --muted #6b7280, --accent #2563eb, --accent-bg #eef2ff. --text #111827 matches existing text. Transfer errors use --error #b91c1c.

## 3. Typography
Existing -apple-system, Segoe UI, Malgun Gothic, sans-serif stack. Body 14px/1.5, page heading 20px, section heading 16px, muted help 14px. No external fonts.

## 4. Spacing & Layout
4px spacing unit; 8px inline gaps, 12px field gaps, 16px panel padding, 24px page spacing. Transfer page width at most 900px, 16px mobile margins. Two columns become a single column below 768px. Document owns scrolling, content wraps naturally.

## 5. Components
Panels retain existing border and 8px radius. Labelled native selects/inputs/buttons have a minimum 44px touch target. Buttons use accent fills or white secondary style, focus outline, disabled opacity, and loading text. Status uses role=status, errors role=alert. Preview is a bounded scrolling file list with filename and size, total counts, explicit consent checkbox and final action. Empty, disconnected, loading, error and success states remain visible as text. No motion beyond native control feedback.

## 6. Motion & Interaction
No decorative animation. Controls disable while pending and retain visible labels. Preview consent resets on a new preview or connection change. Keyboard focus uses native outlines plus accent. OAuth navigates the current tab after creating the one-time transaction; the callback provides a return link to the transfer screen. No popup dependency.

## 7. Depth & Surface
Borders-only, matching the existing project viewer. No shadows or gradients.

## 8. Accessibility Constraints & Accepted Debt
Use semantic headings, labels, live regions, named buttons and same-origin links. Korean prose uses word-break:keep-all; URL/status/file regions permit overflow-wrap:anywhere. File list wraps unbroken names. Preserve existing application styling and avoid unrelated React/toolchain changes; this screen is plain HTML. Existing Projects viewer's div-based navigation accessibility remains outside this feature. Actual cloud transfer requires owner OAuth and Console redirect registration; no simulated success UI.
