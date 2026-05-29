# Deploying to Cloudflare Pages (with a custom domain)

This is a one-time setup. After it's done, every `git push` to `main` will
automatically rebuild and redeploy the site.

---

## Part 1 — Pick & register your domain

### What makes a good portfolio domain

Pick **one** of these patterns, in roughly this order of preference:

1. **`yourname.com`** — the gold standard. Try this first.
2. **`yourname.dev`** — perfect if you're identifying as a builder/dev.
3. **`yourname.io`** — common in tech, slightly more "startup" flavored.
4. **`firstnamelast.com`** — fine fallback if `yourname.com` is taken.
5. **`yourhandle.com`** — if you have a strong internet handle, this works.

**Things to avoid:** dashes (`jason-white.com`), creative spellings
(`jasnwht.com`), and `.co` unless you're a company. Keep it pronounceable
out loud — you'll be saying this domain at parties.

### Where to register

Use **Cloudflare Registrar** — they charge wholesale price (no markup),
auto-renew, and free WHOIS privacy. It also keeps everything in one
dashboard since Cloudflare hosts the site.

1. Go to <https://dash.cloudflare.com/?to=/:account/registrar/register>
2. Search for your name
3. If available, register it ($10–$15/year for `.com`, $15 for `.dev`)
4. If taken, try the alternatives above

Alternative registrars if Cloudflare doesn't have your TLD:
- **Porkbun** — cheap, no upsells, clean UI
- **Namecheap** — fine, slightly more upsells

> Avoid GoDaddy and Network Solutions — they're overpriced and renewal
> prices spike hard.

---

## Part 2 — Push your code to GitHub

Cloudflare Pages deploys from a Git repo, so we need this on GitHub.

```bash
# from inside the portfolio/ folder
git init
git add .
git commit -m "initial portfolio scaffold"
```

Then on GitHub:

1. Go to <https://github.com/new>
2. Name the repo (e.g. `portfolio`)
3. Leave it public *or* private — doesn't matter, Cloudflare can read both
4. **Don't** add a README or .gitignore (we already have them)
5. Hit "Create"
6. Run the two `git remote add origin` + `git push -u origin main` commands
   GitHub shows you

---

## Part 3 — Connect Cloudflare Pages

1. Go to <https://dash.cloudflare.com/?to=/:account/workers-and-pages>
2. Click **Create application** → **Pages** → **Connect to Git**
3. Authorize Cloudflare to read your GitHub account
4. Select your `portfolio` repo
5. Configure the build:

| Setting              | Value             |
| -------------------- | ----------------- |
| Framework preset     | **Astro**         |
| Build command        | `npm run build`   |
| Build output dir     | `dist`            |
| Root directory       | `/` (leave blank) |
| Node version (env)   | `20`              |

6. Click **Save and Deploy**

The first build takes ~1–2 minutes. When it's done you'll get a free
`yourproject.pages.dev` URL. That's your site, live.

---

## Part 4 — Hook up your custom domain

1. In the Pages project, go to **Custom domains** → **Set up a domain**
2. Type your domain (`yourname.com`)
3. If you registered with Cloudflare, it's auto-configured. Click confirm.
4. If you registered elsewhere, Cloudflare will show you the two DNS
   records you need to add at your registrar. Add them. Wait ~5–10 minutes.

Done. SSL is automatic. The site is live.

---

## Part 5 — Update the config

In `astro.config.mjs`, change:

```js
const SITE_URL = "https://example.com";
```

to your real domain. Commit and push — sitemap and OpenGraph tags will
pick it up.

---

## Future deploys

```bash
# make changes locally
npm run dev          # preview at localhost:4321

# when ready
git add .
git commit -m "add: new project — coolthing"
git push
```

Cloudflare picks up the push and redeploys in ~60–90 seconds. You'll get
an email when the deploy is live.

---

## Troubleshooting

**Build fails with "Cannot find module"** — run `npm install` locally and
commit `package-lock.json`.

**Domain not resolving after 30 minutes** — double-check the DNS records.
Use <https://dnschecker.org> to see global propagation.

**Site loads but styles look wrong** — hard refresh (Cmd+Shift+R). Old
CSS is cached.

**Want to roll back a bad deploy?** — Cloudflare keeps every previous
build. In the Pages dashboard → Deployments → click the dots on an older
one → "Rollback to this deployment."
