# CLAUDE.md — ML Portfolio Site

**Read this file completely before touching anything.** It is the contract every
agent working on this repo shares. If something here conflicts with your task
prompt, this file wins — raise the conflict instead of guessing.

Owner: Marc Godbout-Chouinard · WPI BS CS / MS AI, expected May 2027.

---

## 1. Stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Astro 6.4.8** | Static output. Ships ~0 JS by default. |
| Interactivity | React 19 islands | Only demos + filters. Everything else is `.astro`/MDX. |
| Styling | Tailwind v4 (`@tailwindcss/vite`) | CSS-first config. There is no `tailwind.config.js`. |
| Motion | GSAP + ScrollTrigger, Lenis | Plain DOM, not React `useGSAP`. |
| Content | Astro content collections + MDX | Typed, validated at build. |
| Math | `remark-math` + `rehype-katex` | Renders at 