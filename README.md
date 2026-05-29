# jason's portfolio

A personal site for showing what I'm building. Astro + MDX + a hint of swagger.

## Quick start

```bash
# 1. install dependencies
npm install

# 2. run the dev server (opens at http://localhost:4321)
npm run dev

# 3. build for production
npm run build

# 4. preview the production build locally
npm run preview
```

## Adding a new project (the 30-second version)

1. Copy `src/content/projects/_template.mdx`
2. Rename it to `your-project-name.mdx` — that filename becomes the URL
3. Fill in the frontmatter and write the case study
4. Drop screenshots in `public/projects/your-project-name/`
5. Set `draft: false` in the frontmatter when you're ready to publish
6. `git commit && git push` — Cloudflare Pages rebuilds the site

That's it. Full walkthrough in [`docs/ADD_PROJECT.md`](./docs/ADD_PROJECT.md).

## Deploying

Walkthrough for getting this live on Cloudflare Pages with a custom domain
is in [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## Project structure

```
portfolio/
├── astro.config.mjs        ← build config (update SITE_URL here)
├── public/                 ← static files (favicon, screenshots, OG image)
│   └── projects/
│       └── first-app/      ← screenshots for first-app go here
├── src/
│   ├── content/
│   │   ├── config.ts       ← schema: what every project must have
│   │   └── projects/       ← one .mdx file per project
│   ├── components/         ← reusable bits (header, footer, cards)
│   ├── layouts/            ← page layouts (Base, Project)
│   ├── pages/              ← the actual URLs of the site
│   └── styles/global.css   ← THE design system — colors, fonts, everything
└── docs/                   ← guides for future-you
```

## Tweaking the design

Everything visual is controlled by CSS variables at the top of
[`src/styles/global.css`](./src/styles/global.css). Change the colors, fonts, or
spacing there and the whole site updates.

| Variable      | What it controls           |
| ------------- | -------------------------- |
| `--bg`        | Page background            |
| `--ink`       | Primary text color         |
| `--accent`    | The phosphor lime accent   |
| `--peach`     | The playful secondary      |
| `--font-sans` | Body font (Inter)          |
| `--font-mono` | Monospace font (JetBrains) |
