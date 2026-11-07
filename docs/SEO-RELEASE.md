# Search indexability release

Canonical origin: `https://xn--c1adkkjgb0abiz.xn--p1ai` (технологист.рф).

This change builds static HTML for the five existing React routes and a sitemap. The client keeps its existing render and form behaviour; route metadata also updates on client navigation. Express serves the pre-rendered pages and real 404 responses, and redirects GET/HEAD www requests to the canonical host. POST `/api/leads` is unchanged.

## Validation

Use the project's existing compatible Node runtime (README recommends Node 22) and locked dependencies:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:seo
```

The HTTP tests start a local process with empty Telegram credentials. They do not send real leads. The build now runs the prerender step, so deploy the complete generated `dist/public` together with the matching `dist/index.js`.

## Deployment boundaries

This branch is based on `cursor/hero-elbrus-background-edfd` at `369fbcb84263fd7e436ff1b90f2b88c26655dd64` to preserve the current Elbrus design. `main` is older. Confirm the actual deployed source/ref before integrating; do not replace production with the older main branch.

Before deployment, establish the exact site directory and process, save the current site files/build and record their checksums. Build separately, then deploy only this site's matching frontend/backend. Preserve its existing environment and lead credentials. Do not modify nginx stream routing, VPN, firewall, SSH configuration, ports or other applications. Roll back this site's build if public checks regress.

Public checks after deployment:

- All five sitemap URLs return 200, unique titles/descriptions and self-canonical URLs.
- Sitemap returns XML, robots points to the same canonical origin.
- HTTPS www redirects to the canonical origin preserving route/query; HTTP retains a working HTTPS redirect.
- Unknown routes and missing assets return 404 with noindex.
- Main text appears in raw HTML and links/form remain usable in a browser.
- Validate a clearly labelled test lead through the existing delivery channel only with owner authorization.
- Verify the search console property, submit sitemap, then request recrawl through the search engines' supported interfaces.

Google's verification meta tag was obtained from the authorized account during setup. Verification and sitemap submission still require the deployment to become publicly reachable. Search indexing and rankings remain search-engine decisions.
