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
| Math | `remark-math` + `rehype-katex` | Renders at **build**. No client math JS. |
| Code | Shiki (built in) | Dual theme: `github-light` / `github-dark`. |
| Hosting | Cloudflare Pages | Static. |

### Two pinned constraints — do not "fix" these

1. **`overrides: { "vite": "^7.3.6" }` in `package.json` is load-bearing.**
   Astro 6.4.8 runs Vite 7. Without the override npm hoists Vite 8 for
   `@tailwindcss/vite` and `@vitejs/plugin-react`; the Tailwind plugin then binds
   against Vite 8's rolldown API while Astro executes Vite 7, and the build dies
   with `Missing field 'tsconfigPaths' on BindingViteResolvePluginConfig`.
   Removing the override reintroduces that failure.

2. **Do not upgrade to Astro 7 on this machine.** Astro 7 replaced the WASM
   compiler with a Rust native binding
   (`@astrojs/compiler-binding-win32-x64-msvc/astro.win32-x64-msvc.node`), and
   Windows **Smart App Control is enabled here** (`VerifiedAndReputablePolicyState
   = 1`), which blocks that unsigned low-reputation binary outright. Astro 6's
   compiler is pure WASM and loads fine. Same applies to `sharp@0.35.4` —
   `0.34.5`, which Astro 6 pulls, loads correctly.
   Never attempt to disable Smart App Control: it is a **one-way switch on
   Windows 11 Home**, unrecoverable without an OS reinstall. That is the user's
   decision alone, and CI/Cloudflare (Linux) is unaffected either way.

---

## 2. Content schema — VERBATIM, do not edit without Wave 0 sign-off

Location: `src/content.config.ts`. One collection, `work`, with a discriminated
schema. Everything on the site is a projection of this.

```ts
const work = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/work" }),
  schema: z.object({
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
    cover: z.string().optional(),
  }),
});
```

**Four views, one schema.** Write a project once, get: the timeline, the faceted
browser, the case-study page, and the generated resume. If you find yourself
hand-writing HTML that duplicates frontmatter, stop — render from the data.

### Case-study section order (fixed for every entry)

`Problem` → `Data` → `Approach` → `Experiments` → `What didn't work` → `Artifacts`

Every case-study MDX file MUST open with these two imports (blank line after
them, or MDX fails to parse), and place the components under their own headings:

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

**`What didn't work` is mandatory** — negative results are the strongest signal
that the work is real, and almost no portfolio has them.

---

## 3. Content integrity rules — these are absolute

- **Never invent a metric, benchmark number, date, or link.** If a value is
  unknown it stays an MDX comment `{/* TODO(marc): ... */}` until the user
  supplies it. A fabricated number on a portfolio is a fireable offense in
  research, and this site is going to recruiters.
- **MDX comments only** for placeholders — `{/* ... */}`. A markdown blockquote
  TODO renders publicly. Verify with:
  `grep -c "TODO(marc)" dist/work/*/index.html` → must be `0` for every page.
- **`src/data/profile.ts` is the single source of truth** for identity,
  education, and experience. It drives the About page, structured data, and the
  resume PDF. Never retype any of it as literal copy in a component.
- Resume-vs-context discrepancies resolved in favor of the **resume PDF**:
  GPA is **3.90**, degree is **BS Computer Science + MS Artificial Intelligence**.

---

## 4. Design tokens — LOCKED 2026-08-26

Direction: **"Terminal"**, chosen deliberately by the owner with PLAN.md §6's
anti-pattern warning on the table. Near-black ground, a single phosphor accent,
mono-forward. Because it *is* the common ML-portfolio look, the execution has to
carry it — restraint, real typographic hierarchy, and one excellent signature
moment rather than scattered effects.

Tokens live in `src/styles/global.css` under `@theme`. Tailwind v4 is CSS-first:
every token is automatically a utility (`--color-ground` → `bg-ground`,
`--color-accent` → `text-accent`, `--text-title` → `text-title`). **There is no
`tailwind.config.js` and there must never be one.**

```
ground   #0A0A0B    raised  #131316    sunken  #060607
text     #D4D4D8    bright  #F4F4F5    muted   #8A8A93    faint  #52525B
rule     #27272A    accent  #4ADE80    accent-dim #22C55E
aurora-1 #0B3B2E (deep green)   aurora-2 #10394A (teal)   aurora-3 #241B3D (violet)

--font-display / --font-mono   JetBrains Mono Variable   (identity: display, nav, labels, metrics, code)
--font-body                    Inter Variable            (long-form case-study prose ONLY)

--text-hero clamp(2.75rem,11vw,9rem) · --text-display · --text-title
--text-lede · --text-body · --text-small · --text-micro
--ease-out-expo
```

**One deliberate deviation from a pure Terminal look:** body prose uses Inter,
not mono. Mono at paragraph length is genuinely hard to read and the case
studies are meant to be read. Everything structural stays mono, so the identity
holds. To go fully mono, point `--font-body` at the mono stack — one line.

**Never write a raw hex value in a component.** If a colour you need does not
exist as a token, that is a Wave 0 decision — ask, do not add one locally.

**File ownership:** `src/styles/global.css` belongs to Wave 0 only. Wave 1+
agents must never edit it, not even to add a single rule.

### Signature element

Character/glyph-based mathematical background — a canvas grid of mathematical
glyphs whose brightness is driven by a real scalar field (summed sinusoids
drifting over time), which **fades into a soft aurora gradient as the page
scrolls**. Owner's brief: a front page with his name, where the moving
math background resolves into "a cool gradient that is pleasant to the eyes."

Explicitly NOT Matrix-style falling rain — that is the cliché the plan warns
against. Everything else on the site stays quiet.

## 5. Motion rules (non-negotiable)

- **One orchestrated signature moment, everything else quiet.** Scattered scroll
  effects on every section is precisely what makes a site read as AI-generated.
- `prefers-reduced-motion` gets a **static fallback**, not a shortened duration.
- Animation must never delay LCP — hero text renders immediately regardless of
  animation state.
- No scroll-jacking past the point of no return. Keyboard nav unaffected.

---

## 6. Layout of the repo

```
src/
  content.config.ts     # THE schema (§2)
  content/work/*.mdx    # one file per project
  data/profile.ts       # identity/education/experience source of truth
  styles/global.css     # tokens — Wave 0 only
  pages/
    index.astro         # WAVE 0 PLACEHOLDER — Wave 1 replaces
    work/[...slug].astro# WAVE 0 PLACEHOLDER — Wave 1 agent B replaces
```

Both files marked `WAVE 0 PLACEHOLDER` exist purely to prove the pipeline
compiles. Keep their data plumbing, replace their markup.

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
