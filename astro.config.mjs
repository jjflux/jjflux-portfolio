// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Production URL — used for sitemap, OpenGraph tags, and canonical URLs.
const SITE_URL = 'https://jjflux.build';

export default defineConfig({
  site: SITE_URL,
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      // Dark theme that matches our terminal vibe
      theme: 'github-dark-dimmed',
      wrap: true,
    },
  },
});
