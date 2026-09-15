/*
 * Bundles each page — its HTML, style.css, index.js, and its own data file —
 * into one self-contained file under dist/, openable straight from disk or
 * hostable anywhere. The nav links are rewritten to the built filenames so the
 * three pages still reach each other.
 *
 *   node build.js
 */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const pages = [
  { html: "index.html", data: "data.json", out: "software-tree.html" },
  { html: "web-apps.html", data: "web-apps.json", out: "web-apps.html" },
  { html: "mobile-apps.html", data: "mobile-apps.json", out: "mobile-apps.html" },
];

const css = read("style.css");
const js = read("index.js");

/** index.html is the homepage in source but software-tree.html once built. */
const relink = (markup) =>
  pages.reduce(
    (out, page) =>
      out.split(`href="${page.html}"`).join(`href="${page.out}"`),
    markup,
  );

fs.mkdirSync(path.join(root, "dist"), { recursive: true });

for (const page of pages) {
  const html = read(page.html);
  const data = JSON.parse(read(page.data));

  const body = html.match(/<!-- APP:START -->([\s\S]*?)<!-- APP:END -->/);
  if (!body) throw new Error(`${page.html} is missing its APP:START / APP:END markers`);

  const title = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!title) throw new Error(`${page.html} is missing its <title>`);

  const fonts = html.match(/<link\s+rel="stylesheet"\s+href="https:\/\/fonts[^>]*>/);
  if (!fonts) throw new Error(`${page.html} is missing its Google Fonts link`);

  // Inline JSON must not be able to close the script element early.
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");

  const out = `<title>${title[1]}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts[0]}
<style>
${css}
</style>
${relink(body[1].trim())}
<script>window.SOFTWARE_TREE = ${payload};</script>
<script>
${js}
</script>
`;

  const file = path.join(root, "dist", page.out);
  fs.writeFileSync(file, out);

  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`dist/${page.out} — ${kb} KB, ${data.categories.length} branches`);
}
