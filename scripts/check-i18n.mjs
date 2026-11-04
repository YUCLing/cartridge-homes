// Checks every translated fragment against the English document in site/privacy.html.
// Run: node scripts/check-i18n.mjs
//
// Catches the one failure HTML fragments are prone to: a section that exists in
// English and silently does not in a translation, or a fragment that will not
// carry its date/title metadata.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const REQUIRED = ["data-lang", "data-updated", "data-title", "data-description", "data-note", "data-stale"];

function articleOf(html) {
  const start = html.indexOf("<article");
  if (start < 0) return "";
  const re = /<\/?article\b/gi;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(start, m.index + m[0].length);
    } else {
      depth += 1;
    }
  }
  return html.slice(start);
}

const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const attr = (html, name) => (html.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

const pageHtml = readFileSync(join(ROOT, "site", "privacy.html"), "utf8");
const english = articleOf(pageHtml);
const englishIds = idsOf(english);
const fragments = readdirSync(join(ROOT, "site", "i18n")).filter((f) => f.endsWith(".html"));

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`  ✗ ${msg}`); };

console.log(`English document: ${englishIds.size} ids\n`);

for (const file of fragments) {
  const path = join(ROOT, "site", "i18n", file);
  const html = readFileSync(path, "utf8");
  const article = articleOf(html);
  console.log(file);

  for (const name of REQUIRED) {
    if (!attr(article, name)) fail(`missing ${name}`);
  }
  if (/<script\b/i.test(article)) fail("contains a <script>");
  if (/<style\b/i.test(article)) fail("contains a <style>");

  const local = idsOf(article);
  const missing = [...englishIds].filter((id) => !local.has(id));
  const extra = [...local].filter((id) => !englishIds.has(id));
  if (missing.length) fail(`missing ids: ${missing.join(", ")}`);
  if (extra.length) fail(`unknown ids: ${extra.join(", ")}`);
  if (!missing.length && !extra.length) console.log(`  ✓ ${local.size} ids match`);
}

// Every button must point at a file that exists.
console.log("\nlanguage buttons");
for (const m of pageHtml.matchAll(/<button[^>]*data-set-lang="([^"]+)"[^>]*data-src="([^"]+)"/g)) {
  const [, code, src] = m;
  const file = src.split("?")[0];
  if (!existsSync(join(ROOT, "site", file))) fail(`${code} points at missing ${file}`);
  else console.log(`  ✓ ${code} → ${file}`);
}

if (failures) {
  console.error(`\n${failures} problem(s).`);
  process.exit(1);
}
console.log("\nAll fragments consistent with English.");
