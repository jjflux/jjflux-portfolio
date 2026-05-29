# Adding a new project

The whole site is designed around this being painless. Here's the playbook.

---

## TL;DR

```bash
cp src/content/projects/_template.mdx src/content/projects/my-new-app.mdx
# edit the file, fill in frontmatter + write the case study
mkdir public/projects/my-new-app
# drop screenshots into the folder above
git add . && git commit -m "add: my-new-app project"
git push
```

That's it. Cloudflare rebuilds, project appears on `/projects` and at
`/projects/my-new-app`.

---

## Step-by-step

### 1. Copy the template

```bash
cp src/content/projects/_template.mdx src/content/projects/my-new-app.mdx
```

The **filename** becomes the **URL slug**. So `my-new-app.mdx` lives at
`/projects/my-new-app`. Use lowercase, no spaces, dashes between words.

### 2. Fill in the frontmatter

The block at the top of the file (between the `---` lines) is the
structured data. Here's the cheat sheet:

```yaml
title: "App Name"                # display name
summary: "One sentence pitch."   # shown on cards + as the page lede
status: "live"                   # live | in-progress | archived | concept
year: 2026                       # year built
role: "Solo builder"             # your role, optional
tech:                            # list of tech tags (shown as chips)
  - "React Native"
  - "Supabase"
coverImage: "/projects/my-new-app/cover.png"   # main image, optional
links:                           # all optional
  live: "https://example.com"
  appStore: "https://apps.apple.com/..."
  github: "https://github.com/..."
featured: true                   # show on homepage featured strip?
order: 5                         # lower = appears first
draft: false                     # set true to hide from public site
```

If you skip a field, the page just hides that piece. No errors.

### 3. Write the case study

The MDX body uses normal Markdown. The included `_template.mdx` has the
sections in the order that works best — keep them as headings:

```markdown
## the problem
## what i built
## how it works
## tech & tradeoffs
## what i learned
## try it
```

You don't have to use all of them. Skip the ones that don't apply.

### 4. Add screenshots

Put images in `public/projects/[your-slug]/`. Then reference them in MDX:

```markdown
![Caption for the image](/projects/my-new-app/screenshot-1.png)
```

Image sizing tips:

- **Cover image:** ~1600x900px (or any 16:9), JPG/PNG
- **In-content:** width 1200–1600px is plenty
- Compress with <https://tinypng.com> first — keeps the site fast

### 5. Publish

```bash
git add .
git commit -m "add: my-new-app project"
git push
```

Wait ~60 seconds for Cloudflare to rebuild, then visit
`https://yourname.com/projects/my-new-app`.

---

## Common patterns

### "I want to publish before I have screenshots"

Leave `coverImage` blank in frontmatter. The page works fine without it.

### "I want to update the home page featured projects"

Set `featured: true` on the projects you want featured. Adjust `order:`
to control the order (lower = first). The home page shows up to 4 of them.

### "I started a project but haven't shipped it yet"

Set `status: "in-progress"`. It'll show a different colored dot and the
label "in progress" on the cards. Honest > polished.

### "I want to retire an old project but keep the page live"

Set `status: "archived"`. It stays at its URL but gets a muted indicator.

### "I want to draft a project without publishing"

Set `draft: true`. The page won't be built. Set it to `false` when ready.

---

## Working with Claude on this

Since you build with Claude, here's a prompt that works well:

> I want to add a new project to my portfolio. The project is [name],
> which is [one sentence]. I built it with [tech]. Help me write the
> case study using the structure in `_template.mdx`. The voice should
> match the rest of the site — casual, honest, builder-first, no
> corporate-speak.

Then iterate. Claude can write the first draft, you tweak it until it
sounds like you.
