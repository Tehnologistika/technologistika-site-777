import fs from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import App from "../client/src/App";
import { getPageMetadata, SITE_ORIGIN, SITE_PAGES } from "../shared/seo";

const output = path.resolve("dist/public");
const template = fs.readFileSync(path.join(output, "index.html"), "utf8");
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

for (const pathname of [...Object.keys(SITE_PAGES), "/404"]) {
  const page = getPageMetadata(pathname);
  const indexable = Object.hasOwn(SITE_PAGES, pathname);
  const markup = renderToString(<Router ssrPath={pathname}><App /></Router>);
  let html = template
    .replace(/<title>.*?<\/title>/s, `<title>${escapeAttribute(page.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*("\s*\/>)/, `$1${escapeAttribute(page.description)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*("\s*\/>)/, `$1${escapeAttribute(page.title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*("\s*\/>)/, `$1${escapeAttribute(page.description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*("\s*\/>)/, `$1${SITE_ORIGIN + pathname}$2`)
    .replace(/<link rel="canonical"[^>]*\/>/, indexable ? `<link rel="canonical" href="${SITE_ORIGIN + pathname}" />` : "")
    .replace('<div id="root"></div>', `<div id="root" class="prerendered">${markup}</div>`)
    .replace("</head>", `<style>.prerendered [style*="opacity:0;"],.prerendered [style$="opacity:0"]{opacity:1!important;transform:none!important}</style></head>`);
  if (!indexable) html = html.replace('content="index, follow"', 'content="noindex, follow"');
  const destination = pathname === "/" ? "index.html" : pathname === "/404" ? "404.html" : pathname.slice(1) + "/index.html";
  const filename = path.join(output, destination);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, html);
  console.log(`Prerendered ${pathname}`);
}

fs.writeFileSync(path.join(output, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.keys(SITE_PAGES).map(pathname => `  <url><loc>${SITE_ORIGIN + pathname}</loc></url>`).join("\n")}\n</urlset>\n`);
