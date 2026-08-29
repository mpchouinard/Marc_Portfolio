# ML Portfolio Site: Build Plan

Planning doc. Hand this to Claude Code as `PLAN.md` (or fold the locked sections into `CLAUDE.md`) before starting the build.

---

## 1. Stack decision

**Astro 6 + React islands + Tailwind v4 + GSAP → Cloudflare Pages**

| Layer | Choice | Why |
|---|---|---|
| Framework | Astro 6 | Content-first. Ships ~0 JS by default, hydrates only interactive components. Requires Node 22. |
| Interactivity | React 19 islands | You already know React. Only the demos and filters are React; everything else is Markdown. |
| Styling | Tailwind v4 | CSS-first config, no `tailwind.config.js`. |
| Motion | GSAP + ScrollTrigger, Lenis for smooth scroll | Works on plain DOM in Astro: simpler than the React `useGSAP`/StrictMode cleanup dance. |
| Content | Astro content collections + MDX | Typed schema, validated at build. |
| Hosting | Cloudflare Pages | Unlimited bandwidth free, 500 builds/mo. |
| Analytics | Cloudflare Web Analytics | Free, cookieless, no banner needed. |

### Why not Next.js

Next.js is the right call when the site itself is the work sample: i.e. when you're applying for frontend roles and the recruiter should be impressed by the *implementation*. You're not. Your ML projects are the work sample; the site is the vitrine. Astro gets out of the way. The near-perfect Lighthouse score is a free credibility signal.

Secondary factor: you said you'll mostly be reviewing output rather than writing JS. Astro means the bulk of the site is Markdown you can edit confidently, with React confined to a few clearly-bounded islands.

---

## 2. The container: unified content architecture

This is the core of the build. You want education, research and personal projects in one system. The answer is a **single content collection with a discriminated schema**, not three separate sections.

### Schema (`src/content.config.ts`)

```ts
const work = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/work" }),
  schema: z.object({
    title: z.string(),
    kind: z.enum(["research", "coursework", "personal", "industry"]),
    period: z.object({ start: z.date(), end: z.date().optional() }),
    status: z.enum(["ongoing", "complete", "under-review", "published", "archived"]),

    // context
    role: z.string(),                          // "first author", "solo", "team of 4"
    affiliation: z.string().optional(),        // lab, course code, employer
    collaborators: z.array(z.string()).default([]),

    // the taxonomy that makes cross-cutting views possible
    domains: z.array(z.string()),              // nlp, cv, rl, generative, tabular, robotics
    methods: z.array(z.string()),              // transformers, diffusion, GNN, RLHF, contrastive
    stack: z.array(z.string()),                // pytorch, jax, cuda, ray, wandb

    // structured results: renders as a comparison table, no hand-written HTML
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

**Why this pays off.** One schema means you write each project once and get four views for free:

1. **Timeline**: everything chronological, kinds interleaved. This is the "container" made visible: coursework, research and side projects on one spine, showing trajectory rather than three disconnected lists.
2. **Facet browser**: filter by domain / method / year. React island. Makes "show me your diffusion work" a two-click operation for a recruiter.
3. **Case study pages**: one template, driven by frontmatter.
4. **Resume**: generated from the same data (see §5).

### Case study template

Fixed section order for every entry, because consistency is what makes a portfolio scannable:

- **Problem**: what was actually hard, in two sentences
- **Data**: a short data card: source, size, splits, known biases
- **Approach**: architecture, with a diagram
- **Experiments**: auto-rendered from the `results` frontmatter
- **What didn't work**: ← include this. Negative results and dead ends are the single strongest signal that you did the work yourself. Almost no portfolio has this section.
- **Artifacts**: paper / repo / notebook / demo row

---

## 3. ML-specific tooling

- **Math**: `remark-math` + `rehype-katex`. KaTeX renders at build; no client JS.
- **Code**: Shiki, built into Astro.
- **Notebooks**: prebuild script: `jupyter nbconvert --to markdown` → MDX, committed. Do *not* try to render `.ipynb` live in the browser; it's a lot of weight for a worse result.
- **Plots**: pre-render training curves and confusion matrices to static SVG at build time. Zero client JS, perfectly crisp, works with the scroll animations.
- **Live demos**: `@huggingface/transformers` (transformers.js). Runs models entirely client-side via ONNX Runtime, with WebGPU acceleration and Web Workers to keep the UI responsive. No backend, so it deploys to a static host for free.

  **Constraint that matters:** model weights are tens to hundreds of MB. Rules: gate every demo behind an explicit "Run demo" button, never autoload; run in a Worker; show download progress; offer int8 quantization. Do this for **one or two flagship projects only.**

  For anything too heavy, embed a Hugging Face Space in an iframe instead. Free, zero infra. It's already the venue ML people expect.

---

## 4. Motion direction

Heavy scroll animation was a priority, so this needs to be deliberate rather than scattered.

**One orchestrated signature moment, everything else quiet.** Scattered scroll effects on every section is the thing that makes a site read as AI-generated. Spend the boldness in one place.

The hero should come from your own subject matter, not generic parallax. Two candidates worth prototyping:

- **Scroll-scrubbed training run**: a loss curve draws itself as you scroll, with the model's outputs at each checkpoint appearing alongside it. Literal, legible and unmistakably yours.
- **Embedding space resolving**: a point cloud starts as noise and separates into labelled clusters as you scroll down. Visually striking. It's a real artifact of your work rather than decoration.

Non-negotiables:
- `prefers-reduced-motion` fully respected: static fallback, not just shortened durations
- Animation must not delay LCP; the hero text renders immediately regardless of animation state
- Keyboard navigation unaffected; nothing scroll-jacked past the point of no return

---

## 5. Free extras worth the effort

- **Resume PDF generated from content data at build time.** Single YAML/JSON source of truth drives both the site and the downloadable PDF, so they can never drift. Roughly an hour of work and it always gets a comment.
- **Per-project OG images** generated at build (Satori) so links preview properly on LinkedIn and Slack.
- **⌘K command palette** to jump between projects.
- **View Transitions** between pages: built into Astro, near-free.
- **RSS + sitemap**: Astro integrations, five minutes each.

---

## 6. Design direction: needs sign-off before any UI work

**Do not start building until the token system is locked.** Parallel subagents writing UI without a fixed palette and type scale will produce four subtly different sites. This is the main failure mode of the whole plan.

Decide and freeze:
- 4–6 named hex values
- Display face + body face + a mono/utility face for data and code (mono matters here: you have a lot of metrics and code)
- Type scale with explicit weights
- The one signature element

**Anti-pattern warning:** the default look for an ML portfolio is near-black background, one acid-green or vermilion accent, monospace everything, faint grid lines. It's everywhere. If that's genuinely what you want, fine. But choose it, don't default into it.

---

## 7. Subagent breakdown for Claude Code

Structured as waves. Everything within a wave runs in parallel; waves are sequential.

### Wave 0: sequential, do not parallelize
Scaffold the Astro project, write `content.config.ts`, lock the design tokens into `global.css` and write `CLAUDE.md` containing the schema and tokens verbatim. Every subsequent agent reads this file first. Seed 2–3 real projects as reference content.

### Wave 1: parallel (4 agents)
- **A (Shell):** layout, nav, footer, theming, typography scale, dark mode
- **B (Content pipeline):** collections wiring, case study template, MDX with math + code + notebook conversion, results table component
- **C (Motion system):** GSAP + ScrollTrigger setup, Lenis, reduced-motion handling, the signature hero
- **D (Browse views):** timeline component, faceted filter island, project cards

### Wave 2: parallel (3 agents)
- **E (Resume):** PDF generation from content data
- **F (Live demo):** transformers.js island for the flagship project, Worker + progress UI
- **G (Meta):** OG image generation, sitemap, RSS, analytics, `<head>` and structured data

### Wave 3: sequential
Perf pass (Lighthouse ≥ 95 across the board), accessibility pass, Cloudflare Pages deploy, custom domain.

**Subagent hygiene:** each agent gets an explicit file ownership boundary in its prompt. Wave 1 agents in particular must not touch `global.css`. Token changes go through you.

---

## 8. Cost

| Item | Cost |
|---|---|
| Cloudflare Pages hosting | $0 |
| `*.pages.dev` subdomain | $0 |
| Custom `.com` domain | ~$10–12/yr (optional) |
| Cloudflare Web Analytics | $0 |
| Hugging Face Spaces (demo embeds) | $0 |
| **Total** | **$0–12/yr** |

---

## 9. Open items

1. Design direction sign-off (§6)
2. Project inventory: a rough list of everything going in, tagged by kind, so the schema can be validated against real content before the build starts
3. Which one or two projects get live in-browser demos
4. Custom domain, or `.pages.dev`
