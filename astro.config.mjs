// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Production URL — used for sitemap, OpenGraph tags, and canonical URLs.
const SITE_URL = 'https://jjflux.build';

// Dev-only: the Vite dev server doesn't synthesize a directory index for
// static folders under public/, so a bare request like `/physarum/` 404s in
// `astro dev` even though it resolves fine in the production build. This tiny
// plugin rewrites such trailing-slash requests to the folder's index.html so
// the embedded standalone app loads identically in dev and prod. No-op in build.
const devStaticIndex = {
  name: 'dev-static-index',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /\/physarum\/(\?.*)?$/.test(req.url)) {
        req.url = req.url.replace(/\/physarum\/(\?.*)?$/, '/physarum/index.html$1');
      }
      next();
    });
  },
};

export default defineConfig({
  site: SITE_URL,
  integrations: [mdx(), sitemap()],
  vite: { plugins: [devStaticIndex] },
  markdown: {
    shikiConfig: {
      // Dark theme that matches our terminal vibe
      theme: 'github-dark-dimmed',
      wrap: true,
    },
  },
});
