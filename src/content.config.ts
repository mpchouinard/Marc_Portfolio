import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

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

    // structured results — renders as a comparison table, no hand-written HTML
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

export const collections = { work };
