# CLAUDE.md: ML Portfolio Site

**Read this file completely before touching anything.** It is the contract every
agent working on this repo shares. If something here conflicts with your task
prompt, this file wins: raise the conflict instead of guessing.

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
| Math | `remark-math` + `rehype-katex` | Renders at **build**. No client math JS. |
| Code | Shiki (built in) | Dual theme: `github-light` / `github-dark`. |
| Hosting | Cloudflare Pages | Static. |

### Two pinned constraints: do not "fix" these

1. **`overrides: { "vite": "^7.3.6" }` in `package.json` is load-bearing.**
   Astro 6.4.8 runs Vite 7. Without the override npm hoists Vite 8 for
   `@tailwindcss/vite` and `@vitejs/plugin-react`; the Tailwind plugin then binds
   against Vite 8's rolldown API while Astro executes Vite 7; the build dies
   with `Missing field 'tsconfigPaths' on BindingViteResolvePluginConfig`.
   Removing the override reintroduces that failure.

2. **Do not upgrade to Astro 7 on this machine.** Astro 7 replaced the WASM
   compiler with a Rust native binding
   (`@astrojs/compiler-binding-win32-x64-msvc/astro.win32-x64-msvc.node`), and
   Windows **Smart App Control is enabled here** (`VerifiedAndReputablePolicyState
   = 1`), which blocks that unsigned low-reputation binary outright. Astro 6's
   compiler is pure WASM and loads fine. Same applies to `sharp@0.35.4`;
   `0.34.5`, which Astro 6 pulls, loads correctly.
   Never attempt to disable Smart App Control: it is a **one-way switch on
   Windows 11 Home**, unrecoverable without an OS reinstall. That is the user's
   decision alone. CI/Cloudflare (Linux) is unaffected either way.

---

## 2. Content schema: VERBATIM, do not edit without Wave 0 sign-off

Location: `src/content.config.ts`. One collection, `work`, with a discriminated
schema. Everything on the site is a projection of this.

```ts
const work = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/work" }),
  schema: ({ image }) => z.object({
    title: z.string(),
    kind: z.enum(["research", "coursework", "personal", "industry"]),
    period: z.object({ start: z.date(), end: z.date().optional() }),
    status: z.enum(["ongoing", "complete", "under-review", "published", "archived"]),

    role: z.string(),                          // "first author", "solo", "team of 4"
    affiliation: z.string().optional(),        // lab, course code, employer
    collaborators: z.array(z.string()).default([]),

    domains: z.array(z.string()),              // nlp, cv, rl, generative, tabular
    methods: z.array(z.string()),              // transformers, rag, bm25, rnn
    stack: z.array(z.string()),                // pytorch, fastapi, slurm

    results: z.array(z.object({
      metric: z.string(),
      dataset: z.string(),
      value: z.number(),
      baseline: z.number().optional(),
      unit: z.string().optional(),
    })).default([]),

    artifacts: z.array(z.object({
      type: z.enum(["paper", "repo", "notebook", "demo", "poster", "dataset", "model", "slides"]),
      url: z.string().url(),
      label: z.string(),
    })).default([]),

    summary: z.string().max(180),              // one line, used in cards + resume
    featured: z.boolean().default(false),
    cover: image().optional(),                 // ./covers/<name>.png, relative to the MDX
  }),
});
```

### Cover images

`cover` uses Astro's `image()` helper, not a plain string. Drop the file in
`src/content/work/covers/` and reference it **relative to the MDX**:

```yaml
cover: "./covers/model-builder.png"
```

That buys build-time WebP conversion, a `srcset`, intrinsic width/height (so
cards never shift as images load) and a hard build error on a wrong path.
`ProjectCard.astro` renders it at 16/9. A missing `cover` renders no image at
all: never a placeholder graphic.

**Four views, one schema.** Write a project once, get: the timeline, the faceted
browser, the case-study page and the generated resume. If you find yourself
hand-writing HTML that duplicates frontmatter, stop: render from the data.

### Case-study section order (fixed for every entry)

`Problem` → `Data` → `Approach` → `Experiments` → `What didn't work` → `Artifacts`

Every case-study MDX file MUST open with these two imports (blank line after
them, or MDX fails to parse) and place the components under their own headings:

```mdx
---
title: "..."
# ...rest of frontmatter
---

import ResultsTable from "../../components/ResultsTable.astro";
import ArtifactList from "../../components/ArtifactList.astro";

## Problem
...
## Experiments

<ResultsTable results={frontmatter.results} />

## What didn't work
...
## Artifacts

<ArtifactList artifacts={frontmatter.artifacts} />
```

Both components render **nothing** when their array is empty, so the imports are
safe to include before any data exists. This is what makes `Experiments`
auto-render from frontmatter *in place* rather than as a detached appendix.

**`What didn't work` is mandatory**: negative results are the strongest signal
that the work is real; almost no portfolio has them.

---

## 3. Content integrity rules: these are absolute

- **Never invent a metric, benchmark number, date, or link.** If a value is
  unknown it stays an MDX comment `{/* TODO(marc): ... */}` until the user
  supplies it. A fabricated number on a portfolio is a fireable offense in
  research; this site is going to recruiters.
- **MDX comments only** for placeholders: `{/* ... */}`. A markdown blockquote
  TODO renders publicly. Verify with:
  `grep -c "TODO(marc)" dist/work/*/index.html` → must be `0` for every page.
- **`src/data/profile.ts` is the single source of truth** for identity,
  education and experience. It drives the About page, structured data and the
  resume PDF. Never retype any of it as literal copy in a component.
- Resume-vs-context discrepancies resolved in favor of the **resume PDF**:
  GPA is **3.90**, degree is **BS Computer Science + MS Artificial Intelligence**.

---

## 4. Design tokens: LOCKED 2026-08-26

Direction: **"Terminal"**, chosen deliberately by the owner with PLAN.md §6's
anti-pattern warning on the table. Near-black ground, a single phosphor accent,
mono-forward. Because it *is* the common ML-portfolio look, the execution has to
carry it: restraint, real typographic hierarchy and one excellent signature
moment rather than scattered effects.

Tokens live in `src/styles/global.css` under `@theme`. Tailwind v4 is CSS-first:
every token is automatically a utility (`--color-ground` → `bg-ground`,
`--color-accent` → `text-accent`, `--text-title` → `text-title`). **There is no
`tailwind.config.js` and there must never be one.**

```
ground   #0A0A0B    raised  #131316    sunken  #060607
text     #D4D4D8    bright  #F4F4F5    muted   #8A8A93    faint  #52525B
rule     #27272A    accent  #4ADE80    accent-dim #22C55E
aurora-1 #08140E (near-black green)  aurora-2 #0E3320 (deep forest)  aurora-3 #14532D (moss)
bloom-hot #86EFAC (light phosphor, for glyph crests and the additive bloom pass)

--font-display / --font-mono   JetBrains Mono Variable   (identity: display, nav, labels, metrics, code)
--font-body                    Inter Variable            (long-form case-study prose ONLY)

--text-hero clamp(2.75rem,11vw,9rem) · --text-display · --text-title
--text-lede · --text-body · --text-small · --text-micro
--ease-out-expo · --ease-spring · --ease-settle   (see §5)
```

**One deliberate deviation from a pure Terminal look:** body prose uses Inter,
not mono. Mono at paragraph length is genuinely hard to read and the case
studies are meant to be read. Everything structural stays mono, so the identity
holds. To go fully mono, point `--font-body` at the mono stack: one line.

**Never write a raw hex value in a component.** If a colour you need does not
exist as a token, that is a Wave 0 decision: ask, do not add one locally.

**File ownership:** `src/styles/global.css` belongs to Wave 0 only. Wave 1+
agents must never edit it, not even to add a single rule.

### Signature element

A character/glyph mathematical field: one document-level canvas of maths glyphs
whose brightness is driven by a real scalar field (summed sinusoids drifting
over time), with an additive `lighter` pass so crests genuinely bloom.

Two owner decisions are baked in here:

1. **The gradient is phosphor green, never blue.** The first version resolved
   into teal + violet and was rejected. The whole transition now stays in one
   hue family. Do not reintroduce a second hue.
2. **The field follows the reader down the page.** It is mounted once in
   `Base.astro`, fixed behind all content and the hero scrubs its intensity
   from 1 to ~0.14 rather than fading it to nothing. There must only ever be
   ONE field canvas per document: `window.__glyphField` assumes it.

Scroll velocity from Lenis is piped into the field, damped, so fast scrolling
shears the pattern and it settles afterwards. That is the "adhering to physics"
feel; keep it damped, never 1:1 with scroll.

Explicitly NOT Matrix-style falling rain.

## 5. Motion rules

The owner explicitly asked for a page that feels alive as you scroll, overriding
PLAN.md §4's "everything else quiet". That is a deliberate, informed choice.
**It is not licence for one-off effects.** There is ONE motion language, defined
by the tokens below, reused everywhere. A bespoke animation on a single section
is a bug, not a feature.

```
--ease-spring   cubic-bezier(0.34, 1.56, 0.64, 1)   entrances; slight overshoot = mass
--ease-settle   cubic-bezier(0.22, 1, 0.36, 1)      settling, scrubbed motion
--ease-out-expo cubic-bezier(0.16, 1, 0.3, 1)       chrome; must not overshoot
--reveal-distance 24px · --reveal-duration 720ms · --reveal-stagger 70ms
```

### The reveal contract (`src/scripts/reveal.ts`)

Markup opts in declaratively. No component writes its own IntersectionObserver.

- `data-reveal` on an element → it rises `--reveal-distance` and fades in when
  it enters the viewport, once, using `--ease-spring`.
- `data-reveal-group` on a parent → its direct `[data-reveal]` children stagger
  by `--reveal-stagger` in DOM order.
- `data-reveal-delay="120"` → extra per-element delay in ms.

**No-JS safety (and this is mandatory):** elements must be fully visible with CSS
alone. The hidden starting state may ONLY be applied under `html.js-reveal`, a
class `reveal.ts` sets on itself at startup. Never put `opacity: 0` in static CSS:
a JS failure or a crawler would then see a blank page.

**Reduced motion:** `reveal.ts` must not hide anything at all. Everything renders
in final position immediately. Static fallback, never a shortened duration.

### Non-negotiables (unchanged)

- Animation must never delay LCP: hero text renders immediately, never gated on
  animation state, never `opacity: 0` awaiting JS.
- No scroll-jacking past the point of no return. Lenis smooths; it must not trap.
- Keyboard navigation unaffected. Decorative canvases are `aria-hidden` and not
  focusable.
- Every rAF loop pauses when off-screen and on `document.hidden` and cleans up
  on `astro:before-swap`.

### The generative family (added 2026-08-29)

The glyph field is no longer the only plotted geometry. Three components now
sample the **same summed-sinusoid idea** at different rates, which is what keeps
them one language rather than a pile of effects. Anything new in this space must
join this family, not start a fourth style.

| Component | Sampling | Motion |
|---|---|---|
| `scripts/glyph-field.ts` | per cell, per frame | rAF, scroll velocity coupled |
| `components/ProjectArt.astro` | iso-contours over an area | draws on scroll entry |
| `components/LissajousMark.astro` | one curve against itself | draws on scroll entry |

`LissajousMark` is a closed figure only because its `a` and `b` are
**integers**, so the path returns exactly to its start. Keep them integral or
the join reappears.

**Owner decision 2026-08-29: no plotted section dividers.** A fourth member,
`MathRule.astro`, drew a sinusoid between every section. Six of them across the
site read as "random green lines all over the place" and were removed. The
generative geometry now appears where it is doing a job (behind the content as
the field, as a project's own art, as a page's closing mark) and never as
chrome between sections. Do not reintroduce a divider-shaped member.

### Two rules every animation here follows

**1. Gate twice.** Scroll-driven work is wrapped in
`@supports (animation-timeline: ...)` AND scoped under `html.js-reveal`, which
`reveal.ts` sets only when JS is running and motion is allowed. Any property
that HIDES something (`stroke-dashoffset`, `opacity: 0`, `scale(0)`) must live
**inside** both gates, so an unsupporting browser shows the finished artwork
rather than an invisible one. This is the same no-JS rule as the reveal
contract, applied to geometry.

**2. Loops must be justified and bounded.** Prefer scroll-driven timelines: the
browser scrubs them and they cost nothing while the page is still. As of this
writing the whole site runs exactly **two** looping animations, the hero name's
sweep and the `ongoing` markers; and the hero's pause when it scrolls out of
view. Before adding a third, check `animation:.*infinite` across `dist/`.

**Performance precedent, do not regress it:** the bloom pass once called
`fillText` per crest cell with `ctx.shadowBlur` set. Measured at 1920x1080 that
cost 1.96ms for 237 glyphs and **128ms for 592**, against a 16.7ms frame budget,
and because the crest count rises and falls with the field it stalled
intermittently rather than uniformly. It is now a sprite sheet blitted with
`drawImage` (1.04ms at 592). Never put a per-draw-call blur in a render loop.
Pre-render it once and blit.

### Skills matrix policy (owner decision 2026-08-29)

`SkillMatrix.astro` renders only skills that a project on this site actually
evidences. 19 of 41 rows were empty, which was most of the table's height. The
unevidenced skills are **not deleted**: they render as a line beneath the table
and still drive the resume from `profile.ts`. Do not reintroduce empty rows, and
do not delete the footnote, which is what keeps the omission honest.

## 6. Layout of the repo

```
src/
  content.config.ts     # THE schema (§2)
  content/work/*.mdx    # one file per project
  data/profile.ts       # identity/education/experience source of truth
  styles/global.css     # tokens: Wave 0 only
  scripts/
    motion.ts           # Lenis + GSAP wiring, reduced-motion, scroll velocity
    glyph-field.ts      # the canvas engine
    reveal.ts           # the declarative reveal engine (§5)
  components/           # Nav, Footer, Hero, GlyphField, cards, tables
  layouts/Base.astro    # shared shell; Props interface is FIXED
  pages/
    index.astro         # hero + selected work
    work/index.astro    # timeline + faceted browser
    work/[...slug].astro# case study template
```

---

## 7. Verify before you claim done

```bash
npm run build
```

Build must be clean. Then check, every time:

- `grep -c "TODO(marc)" dist/work/*/index.html` → `0` on all pages
- KaTeX still renders: `grep -c 'class="katex"' dist/work/rnn-music-generation/index.html` → `>0`
- No new Vite/Astro deprecation warnings introduced

Report failures with the actual output. Do not report success on an unrun build.
