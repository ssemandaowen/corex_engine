# Palette UX / Accessibility Learnings

## 2026-10-23 - Sidebar Accessible Navigation & Header Toggle
**Learning:** Icon-only navigation buttons in collapsed sidebars require explicit `aria-label` and `aria-current` attributes for screen readers, as well as `focus-visible` ring indicators for keyboard users. Non-interactive wrapper elements (e.g. header toggle `div`) used as clickable triggers should be converted to native semantic `<button type="button">`.
**Action:** Always check sidebar navigation items and expand/collapse triggers to ensure semantic HTML button elements, appropriate ARIA labels/states (`aria-label`, `aria-current="page"`), and distinct `focus-visible` styles.
