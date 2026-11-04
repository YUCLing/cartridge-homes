# Core Mita privacy page — on-demand language switcher

Implemented on 4 November 2026. English is the only document in `privacy.html`; Russian,
Simplified Chinese and Traditional Chinese are fetched on demand. This file records the
design and the decisions behind it.

---

## 1. What changes

**Today:** one file, two complete `<article data-lang-block>` trees, one hidden with the
`hidden` attribute. Every visitor downloads English *and* Russian, and every new language
adds its full weight to the initial page.

**Target:** English stays in `privacy.html` as the canonical, static, indexable document.
Other languages live in their own files and are fetched only when someone asks for them.

```
before                          after
privacy.html  (EN + RU)   →     privacy.html        EN + shell, static
                                 i18n/ru.html        Russian
                                 i18n/zh-Hans.html   Simplified Chinese
                                 i18n/zh-Hant.html   Traditional Chinese
```

Measured on the current file (raw / gzip):

| | before (2 languages) | after |
|---|---|---|
| First visit | 55.2 KB / 15.4 KB | 37.1 KB / 11.4 KB |
| Switch to Russian | 0 | 26.7 KB / 6.8 KB |
| Switch to Chinese | — | 16.5 KB / 5.6 KB |

All four languages inline would be roughly 97 KB on every visit. The shell's loader adds
about 7.7 KB to the initial page; that cost is paid once and buys every future language.

The switcher becomes a small loader rather than a `hidden` toggle.

---

## 2. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | Translations are **HTML fragments**, not JSON | The document is prose with links, bold, lists and a 7-row table. JSON would need a renderer and a schema; HTML keeps markup fidelity and lets translators edit text only. |
| D2 | **English is never fetched** | It is the canonical text, must work without JS, and should be indexable. It also means the default experience has zero network cost. |
| D3 | **The URL is the source of truth** (`?lang=ru`) | Shareable, survives reload, works on any static host with no rewrite rules. `localStorage` is only a tiebreaker. |
| D4 | Every fragment carries the **effective date it was translated from** | A stale translation of a *privacy policy* is a legal risk, not a cosmetic one. Mismatch → render, but with a banner. |
| D5 | **Fail open to English** | Any fetch error leaves the reader on English with a retry, never on a blank page or a half-rendered document. |

---

## 3. File layout

```
site/                        the published root (see docs/deployment.md)
├── privacy.html             shell: <head>, CSS, language row, <main id="doc"> with EN,
│                            loader script
└── i18n/
    ├── ru.html              one <article data-lang="ru" …> and nothing else
    ├── zh-Hans.html
    └── zh-Hant.html
scripts/check-i18n.mjs       CI check: ids, metadata and button targets
```

Everything path-relative below is relative to `site/`; the file only ships when it is
inside that directory.

No manifest. The buttons in the HTML *are* the manifest — each one names its own file.
Adding a language = one `<button>` + one file, with no config to keep in sync.

---

## 4. The fragment contract

`i18n/ru.html` is a single element, no `<html>`, `<head>`, `<style>` or `<script>`:

```html
<article data-lang="ru"
         data-updated="2026-11-03"
         data-title="Политика конфиденциальности — Core Mita"
         data-description="Как бот модерации Core Mita обращается с данными…"
         data-note="Это перевод для удобства. Юридическую силу имеет английская версия."
         data-stale="Перевод может отставать от текущей версии…">
  <header class="hero">…</header>
  <div class="glance">…</div>
  <div class="layout">…</div>
  <footer>…</footer>
</article>
```

Rules:

- **Same ids and classes as English.** Anchors (`#who-ru`), the TOC and the scroll spy all
  depend on them. Suffixed ids (`-ru`) are no longer needed once ids live in separate
  documents — they can become plain `#who` inside the fragment. Either works; plain ids
  are simpler, and there is no collision because only one article exists at a time.
- **No scripts in fragments.** `innerHTML` would not execute them anyway, and CSP should
  be able to say `script-src 'self'`.
- **`data-updated` must equal the date the translated text reflects**, not the date the
  file was edited. That is the whole point of D4.
- **`data-note` is shown on every non-English document**, injected by the loader rather
  than written into the fragment, so a new translation cannot forget it. It states that
  the English text is the authoritative one — the answer to "which version applies".
- Links may be relative to the site root; the fragment is same-origin.

---

## 5. Loader

Five states: `idle → loading → applied | stale | error`, with the previous document left
in place until a new one is ready.

```js
const doc    = document.getElementById('doc');
const status = document.getElementById('lang-status');
const enNode = doc.querySelector('article').cloneNode(true); // keep for switching back
const cache  = new Map([['en', enNode]]);
const known  = new Map(                       // button data is the only allow-list
  [...document.querySelectorAll('[data-set-lang][data-src]')]
    .map((b) => [b.dataset.setLang, b.dataset.src])
);

let current = 'en';
let seq = 0;                       // guards against out-of-order responses
let inflight = null;               // AbortController for the pending request

async function show(lang, { focus = false } = {}) {
  if (lang === current || !known.has(lang)) return;
  const mine = ++seq;
  inflight?.abort();

  if (!cache.has(lang)) {
    inflight = new AbortController();
    setStatus('loading', lang);
    try {
      const url = new URL(known.get(lang), document.baseURI);
      const res = await fetch(url, {
        signal: inflight.signal,
        headers: { Accept: 'text/html' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const tpl  = document.createElement('template');
      tpl.innerHTML = html.trim();
      const node = tpl.content.firstElementChild;
      if (!node || node.tagName !== 'ARTICLE') throw new Error('bad fragment');
      cache.set(lang, node);
    } catch (err) {
      if (mine !== seq || err.name === 'AbortError') return;  // superseded
      setStatus('error', lang);
      return;
    }
  }

  if (mine !== seq) return;        // a newer switch won the race

  const node = cache.get(lang).cloneNode(true);
  doc.replaceChildren(node);
  doc.lang = lang;
  document.documentElement.lang = lang;
  document.title = node.dataset.title || document.title;
  setMeta('description', node.dataset.description);
  current = lang;

  if (node.dataset.updated !== document.documentElement.dataset.updated) {
    node.prepend(staleBanner(node.dataset.stale));   // D4
  }

  syncButtons(lang);
  syncUrl(lang);
  document.getElementById('lang-status').textContent = '';
  initScrollSpy();                 // re-arm: the old observer watched removed nodes
  if (focus) {
    const h1 = node.querySelector('h1');
    h1.tabIndex = -1;              // focusable without entering the tab order
    h1.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}
```

`setStatus`, `setMeta`, `syncButtons` and `staleBanner` are small helpers, omitted here.

Two things that are easy to miss:

- **`initScrollSpy()` must be callable again.** Today it builds its id→link map once at
  load. After `replaceChildren`, every observed node is gone and the TOC stops
  highlighting. Either re-run it after each swap or observe `#doc` and re-query.
- **Language codes are never interpolated into a path.** `?lang=` is matched against the
  known button list (`known`), so `?lang=../../etc/passwd` simply does nothing.

---

## 6. Anti-flash on repeat visits

A visitor landing on `?lang=ru` would otherwise see English for the length of a fetch.
A blocking snippet in `<head>` prevents that:

```html
<script>
(function () {
  var l = new URLSearchParams(location.search).get('lang');
  if (!l) { try { l = localStorage.getItem('cm-lang'); } catch (e) {} }
  if (l && l !== 'en') {
    document.documentElement.dataset.pending = l;
    // failsafe: never leave the page blank if the loader dies
    setTimeout(function () {
      document.documentElement.removeAttribute('data-pending');
    }, 4000);
  }
})();
</script>
```

```css
html[data-pending] #doc { visibility: hidden; }
#doc { min-height: 60vh; }         /* no layout collapse while hidden */
```

The loader is an ordinary script at the end of `<body>`, but its `fetch` does not wait for
the DOM: it starts as soon as the script parses. The apply step clears `data-pending`.
Cost: first-time Russian visitors see the page frame — not English — for roughly one round
trip; with a ~7 KB gzip fragment that is 50–150 ms on a normal connection.

The same snippet should add `document.documentElement.classList.add('js')` so the toggle
can be hidden for users without JavaScript (§9).

---

## 7. URL, history and persistence

Precedence: `?lang=` in the URL → `localStorage` → `navigator.languages` → English.
Chinese needs one special case: `zh-CN`/`zh-SG` map to `zh-Hans`, `zh-TW`/`zh-HK`/`zh-MO`
map to `zh-Hant`, and anything else starting with `zh` falls back to `zh-Hans`.

| Action | Result |
|---|---|
| `/?lang=ru` | load RU, `aria-pressed` on RU, `localStorage` untouched until a click |
| click RU | `history.replaceState` to `?lang=ru`, store `cm-lang=ru` |
| click EN | `replaceState` to the clean URL (no `?lang=en`), store `cm-lang=en` |
| reload | URL wins; stored preference is only consulted when the URL is silent |
| share the link | recipient gets the same language |

`replaceState`, not `pushState`: Back should leave the page, not walk back through
language toggles. Preserve other query params and the hash when rewriting.

```js
function syncUrl(lang) {
  const url = new URL(location.href);
  if (lang === 'en') url.searchParams.delete('lang');
  else url.searchParams.set('lang', lang);
  history.replaceState(null, '', url);
}
```

---

## 8. Failure, staleness, no-JS

| Situation | Behaviour |
|---|---|
| Fetch 404 / offline | Keep whatever is on screen (English on first load). Inline `role="alert"`: "Couldn't load Russian — try again", with a retry button that bypasses the cache. |
| Bad fragment | Same as above; log to console, never inject a partial tree. |
| Rapid clicking RU → EN → RU | `AbortController` cancels in flight; `seq` discards late responses. |
| Translation older than the policy | Render anyway, prepend a dismissible banner from `data-stale`, localised inside the fragment. English is authoritative. |
| JavaScript disabled | `data-pending` never set (script never ran) → English renders normally. Toggle hidden via the `.js` class; `<noscript>` explains that other languages need scripting. |
| JS enabled but loader throws | The 4 s failsafe in §6 clears `data-pending`, so the page is never permanently blank. |

---

## 9. Accessibility

- `<div class="seg" role="group" aria-label="Language">` with `<button aria-pressed>` —
  a segmented control is right for 2–3 languages; past ~4 it should become a `<select>`
  or a disclosure menu.
- `#doc` is `aria-busy="true"` while loading; a `role="status"` line announces
  "Loading Russian…" and errors.
- Focus moves to the new `<h1>` (with `tabindex="-1"`) after a switch, so keyboard and
  screen-reader users are not left at the old scroll position.
- The container's `lang` attribute changes with the content, which is what makes a screen
  reader pronounce the document in the right voice.
- Never use flag emoji as labels; language names are written in their own language
  ("Русский", not "Russian").

---

## 10. SEO

Fetched translations are invisible to crawlers that do not execute JavaScript, and
`?lang=ru` is not a distinct URL. That is acceptable while English is authoritative, but
it means:

- keep `privacy.html` canonical, self-contained and indexable;
- do **not** add `hreflang` until there are real per-language URLs — pointing `hreflang`
  at `?lang=` parameters is worse than omitting it;
- if translated pages should rank later, generate static `/ru/privacy.html` at build time
  from the same fragments and keep the fetch switcher as an enhancement (see §13).

---

## 11. Caching

GitHub Pages does not allow custom headers. It serves static files with
`Cache-Control: max-age=600` and an ETag, so a fragment can be up to ten minutes stale at
the edge and there is nothing to configure. That is acceptable for a policy page, and the
`?v=` query string is the lever we do have:

The loader appends the cache-buster itself:

```js
var url = new URL(src, document.baseURI);
url.searchParams.set("v", document.documentElement.dataset.updated);
```

Because that date changes whenever the text changes, a fragment URL changes with the
policy, and a ten-minute edge cache can never serve an old document against a new page.
Doing it in code rather than in the button's `data-src` means nobody has to remember to
bump four URLs when the date moves. The D4 banner still covers a translation that was
never updated.

Two Pages-specific constraints worth remembering: a project site is served from
`/<repo>/`, so every path is relative (`i18n/ru.html`, resolved against
`document.baseURI`) and never root-absolute; and paths are case-sensitive, so
`zh-Hans.html` and `zh-hans.html` are different files.

---

## 12. Maintenance

**Editing the English policy** — change `privacy.html`, update the date chip and
`<html data-updated>`.

**Updating a translation** — copy the English `<article>`, translate the text nodes only,
set `data-updated` to the date being translated, save as `i18n/ru.html`.

**Adding a language** — add one button:

```html
<button type="button" data-set-lang="uk" data-src="i18n/uk.html"
        aria-pressed="false" lang="uk">UK</button>
```

and one fragment. Nothing else.

**Drift check** (optional, ~25 lines, Node, no dependencies):

```js
// scripts/check-i18n.mjs — compares ids and dates between English and every fragment
// (imports and helper definitions omitted)
const ids = (s) => new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const en  = ids(readFileSync('privacy.html', 'utf8'));
for (const file of glob('i18n/*.html')) {
  const missing = [...en].filter((id) => !ids(readFileSync(file, 'utf8')).has(id));
  if (missing.length) fail(`${file} is missing: ${missing.join(', ')}`);
}
```

This is implemented as `scripts/check-i18n.mjs`. Run `node scripts/check-i18n.mjs` before
publishing; it catches the one failure mode HTML fragments are prone to — a section that
exists in English and silently does not in a translation. It also rejects fragments that
are missing `data-lang`, `data-updated`, `data-title`, `data-description`, `data-note`,
`data-stale`, or that smuggle in a `<script>` or `<style>`.

---

## 13. Alternatives considered

| Approach | Pros | Cons |
|---|---|---|
| **HTML fragments + fetch** (chosen) | Small initial page, exact markup fidelity, translators edit prose only | Needs JS for non-English; structural drift possible; not indexable |
| Keep everything inline | Zero requests, no flash, works without JS | Page weight × languages; a 4th language makes the document unwieldy |
| JSON + runtime renderer | Translations are pure data; drift impossible | Needs a schema and renderer for headings, lists, links, a table; the whole document becomes JS-built, which would also force English to be rendered |
| Build-time static `/ru/` pages | Best SEO, no flash, works without JS | Requires a build step and a template; today the site has none |

The chosen option is the smallest change that pays off at 3–5 languages. The build-time
route is the right upgrade if translations ever need to rank in search.

---

## 14. Migration checklist

1. Extract the RU `<article>` into `i18n/ru.html`; strip `hidden` and the shell.
2. Convert RU ids from `who-ru` style back to `who` (one document at a time now), or keep
   them — either way, the TOC links follow.
3. Replace the two-block toggle script with the loader in §5.
4. Add the `<head>` bootstrap (§6), `[data-pending]` CSS, and the `.js` class hook.
5. Add `aria-live` status, retry UI, and the stale banner.
6. Re-arm the scroll spy after each swap.
7. Delete the old inline RU text; verify `privacy.html` still renders fully with JS off.
8. `python3 -m http.server` for testing — `fetch` fails on `file://`.

---

## 15. Decisions taken

| Question | Answer | Consequence |
|---|---|---|
| Hosting | GitHub Pages, project site | No custom headers and no rewrites, so only relative URLs are safe and caching is whatever Pages sends (§11). `?lang=` needs no server support. |
| Indexing | Not needed | No `hreflang`, no build-time `/ru/` output. English stays the only indexed document. |
| Languages | Four now (EN, RU, 简体, 繁體), more later | The segmented control still fits at four; past five it should become a `<select>`, which changes markup only, not the loader. |
| Stale translations | Show with a banner | `data-stale` renders above the document; English is always the effective text. |
