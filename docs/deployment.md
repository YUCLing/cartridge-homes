# Deployment

GitHub Pages, built by GitHub Actions, served from a custom apex domain.
Public repository, no build tooling yet — the deploy simply publishes `site/`.

---

## Layout

```
.github/workflows/deploy.yml   build + deploy
site/                          the published root — nothing else ships
├── index.html
├── 404.html
├── privacy.html
├── favicon.svg
├── robots.txt
└── i18n/{ru,zh-Hans,zh-Hant}.html
docs/                          design notes, never published
scripts/check-i18n.mjs         runs before every deploy
```

Because the artifact *is* `site/`, anything outside it is unreachable on the web.
`docs/` and `scripts/` used to be downloadable; now they are not.

---

## One-time setup

1. Create the public repository, push `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   Not "Deploy from a branch" — that would run Jekyll and serve the repo root.
3. Push again (or run the workflow manually) and watch the Actions tab.

The workflow:

```
push → checkout → check translations → configure-pages → upload site/ → deploy
```

A failing translation check stops the deploy before anything reaches the live site.
The site stays on its last good version.

---

## Custom domain: cartridge.homes

**Order matters.** Add the domain on GitHub *before* touching DNS. GitHub warns that
configuring DNS first can let someone else claim a subdomain on your domain.

### 1. On GitHub

Settings → Pages → Custom domain → `cartridge.homes` → Save.

> With a GitHub Actions publishing source, **no `CNAME` file is created and any existing
> `CNAME` file is ignored**. The domain lives in repository settings only. Do not add
> `site/CNAME`; it will do nothing.

### 2. At your DNS provider

Apex (`cartridge.homes`) — either four `A` records, or a single `ALIAS`/`ANAME` if your
provider supports it (it survives IP changes better):

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |
| `AAAA` | `@` | `2606:50c0:8000::153` |
| `AAAA` | `@` | `2606:50c0:8001::153` |
| `AAAA` | `@` | `2606:50c0:8002::153` |
| `AAAA` | `@` | `2606:50c0:8003::153` |

`www` — a CNAME to the **user** domain, not the repo:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `www` | `<username>.github.io` |

Remove any pre-existing `A`/`AAAA` record the provider added for `@` — a leftover parking
record is the usual reason a domain "doesn't work". Do not add wildcard `*.cartridge.homes`
records: they defeat the takeover protection.

### 3. Verify

```bash
dig cartridge.homes +noall +answer -t A
dig cartridge.homes +noall +answer -t AAAA
dig www.cartridge.homes +nostats +nocomments +nocmd
```

Expect the four GitHub addresses, and `www` resolving through `CNAME <username>.github.io`.

### 4. HTTPS

Once DNS resolves, GitHub provisions a certificate — usually minutes, up to 24 hours.
Then tick **Enforce HTTPS**. Apex domains are fine; a `www` pointed at an apex can fail
certificate issuance, which is why `www` gets its own CNAME.

Also worth doing once: **Settings → Pages → Verified domains**, to block anyone else from
serving a repository on `cartridge.homes`.

---

## Why not "deploy from branch"

| | Branch deploy | Actions (chosen) |
|---|---|---|
| Publishes | entire repo, including `docs/` | only `site/` |
| Jekyll | runs by default, ignores `_`-prefixed paths | not involved |
| Failing checks | deploy anyway | deploy blocked |
| Custom domain | needs a `CNAME` file | settings only |

The Jekyll point will matter when a generator writes assets to `_astro/` or similar:
branch deploys drop those silently unless a `.nojekyll` file is added.

---

## Local preview

```bash
python3 -m http.server --directory site 8765
# http://127.0.0.1:8765/privacy.html
```

`file://` will not work: the language fragments are fetched, and `file://` blocks that.

---

## Known limits, accepted for now

- **No PR previews.** Pages has a single environment. Review changes by building locally,
  or move to Cloudflare Pages if previews become important.
- **No cache headers.** Pages sends `max-age=600`; the policy page works around it with a
  `?v=<date>` query on fragments, generated in code.
- **One site, one domain.** A second GitHub Pages site would need its own repository.

---

## When the second page lands

Introduce Eleventy, output to `dist/`, and change the workflow's artifact path from `site`
to `dist`. At that point the English shell becomes a layout, the three fragments become
pages, and — because each language gets a real URL — the fetch switcher and `?lang=` can be
deleted. See `docs/i18n-design.md` §13 for that fork in the road.
