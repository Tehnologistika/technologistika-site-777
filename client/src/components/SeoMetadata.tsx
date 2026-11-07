import { useEffect } from "react";
import { useLocation } from "wouter";
import { getPageMetadata, SITE_ORIGIN, SITE_PAGES } from "@shared/seo";

// Keep metadata in sync when navigating without a full document request.
export default function SeoMetadata() {
  const [pathname] = useLocation();

  useEffect(() => {
    const page = getPageMetadata(pathname);
    const indexable = Object.hasOwn(SITE_PAGES, pathname);
    document.title = page.title;
    for (const [selector, content] of [
      ['meta[name="description"]', page.description],
      ['meta[name="robots"]', indexable ? "index, follow" : "noindex, follow"],
      ['meta[property="og:title"]', page.title],
      ['meta[property="og:description"]', page.description],
      ['meta[property="og:url"]', SITE_ORIGIN + pathname],
    ]) {
      document.querySelector(selector)?.setAttribute("content", content);
    }
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (indexable) {
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        document.head.appendChild(canonical);
      }
      canonical.href = SITE_ORIGIN + pathname;
    } else {
      canonical?.remove();
    }
  }, [pathname]);

  return null;
}
