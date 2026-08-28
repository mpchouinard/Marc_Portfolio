// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// TODO(open-item-4): swap to the custom domain if one is bought; otherwise this
// is the Cloudflare Pages subdomain. Must be set for sitemap/RSS/OG to emit
// absolute URLs.
const SITE = 'https://marcgc.pages.dev';

// https://astro.build/config
export default defineConfig({
  site: SITE,

  integrations: [react(), mdx(), sitemap()],

  markdown: {
    // Astro 6.4 moved plugin config onto `processor`: the top-level
    // `remarkPlugins`/`rehypePlugins` keys are deprecated.
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
    shikiConfig: {
      // Both themes ship; global.css picks one per color scheme.
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: false,
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
