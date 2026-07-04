import { urlExists, fetchText } from './fetcher.js';

const COMMON_BLOG_PATHS = ['/blog', '/resources', '/articles', '/news', '/insights'];
const BLOG_PATH_PATTERNS = ['/blog/', '/post/', '/article/'];

/**
 * Auto-detect the blog page for a given website.
 *
 * Detection strategy (in order):
 *   1. Try common paths via parallel HEAD requests
 *   2. Fallback: parse sitemap.xml for blog-like URLs
 *   3. Fallback: parse homepage nav links for blog-like hrefs
 *
 * @param {string} baseUrl - The base URL of the website (e.g. "https://example.com")
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance loaded with the homepage HTML
 * @returns {Promise<{ found: boolean, url: string|null, method: string|null }>}
 */
export async function detectBlogPage(baseUrl, $) {
  try {
    const base = baseUrl.replace(/\/+$/, '');

    // Strategy 1: Try common paths in parallel via HEAD requests
    const commonPathResult = await tryCommonPaths(base);
    if (commonPathResult.found) return commonPathResult;

    // Strategy 2: Parse sitemap.xml for blog-like URLs
    const sitemapResult = await trySitemap(base);
    if (sitemapResult.found) return sitemapResult;

    // Strategy 3: Parse homepage nav links for blog-like hrefs
    const navResult = tryNavLinks(base, $);
    if (navResult.found) return navResult;

    return { found: false, url: null, method: null };
  } catch {
    return { found: false, url: null, method: null };
  }
}

/**
 * Try common blog paths in parallel using HEAD requests.
 */
async function tryCommonPaths(base) {
  const checks = COMMON_BLOG_PATHS.map(async (path) => {
    const url = `${base}${path}`;
    const exists = await urlExists(url);
    return { url, exists };
  });

  const results = await Promise.all(checks);

  for (const result of results) {
    if (result.exists) {
      return { found: true, url: result.url, method: 'common-path' };
    }
  }

  return { found: false, url: null, method: null };
}

/**
 * Parse sitemap.xml and look for blog-like URLs.
 */
async function trySitemap(base) {
  try {
    const sitemapUrl = `${base}/sitemap.xml`;
    const xml = await fetchText(sitemapUrl);
    if (!xml) return { found: false, url: null, method: null };

    // Extract <loc> entries from sitemap XML
    const locMatches = xml.match(/<loc>([^<]+)<\/loc>/gi);
    if (!locMatches || locMatches.length === 0) {
      return { found: false, url: null, method: null };
    }

    const urls = locMatches.map((m) => m.replace(/<\/?loc>/gi, ''));

    // Look for URLs that contain blog-like path segments
    for (const url of urls) {
      const path = url.toLowerCase();
      if (BLOG_PATH_PATTERNS.some((pattern) => path.includes(pattern))) {
        // Return the blog index page, not an individual post.
        // Extract the blog section root (e.g. "https://example.com/blog/my-post" → "https://example.com/blog")
        const blogRoot = extractBlogRoot(url);
        if (blogRoot) {
          return { found: true, url: blogRoot, method: 'sitemap' };
        }
      }
    }

    return { found: false, url: null, method: null };
  } catch {
    return { found: false, url: null, method: null };
  }
}

/**
 * Given a full blog post URL, extract the blog section root URL.
 * e.g. "https://example.com/blog/my-post" → "https://example.com/blog"
 */
function extractBlogRoot(url) {
  try {
    const parsed = new URL(url);
    const pathLower = parsed.pathname.toLowerCase();

    for (const pattern of BLOG_PATH_PATTERNS) {
      const segment = pattern.replace(/\//g, '');
      const idx = pathLower.indexOf(`/${segment}/`);
      if (idx !== -1) {
        parsed.pathname = parsed.pathname.slice(0, idx + segment.length + 1);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/, '');
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse homepage nav links for blog-like hrefs.
 */
function tryNavLinks(base, $) {
  try {
    if (!$) return { found: false, url: null, method: null };

    // Look in common navigation containers first, then fall back to all links
    const navSelectors = ['nav a', 'header a', '[role="navigation"] a'];
    const blogKeywords = /\b(blog|articles|resources|news|insights|posts)\b/i;

    for (const selector of navSelectors) {
      const links = $(selector);
      for (let i = 0; i < links.length; i++) {
        const el = links.eq(i);
        const href = el.attr('href');
        const text = el.text().trim();

        if (!href) continue;

        // Check if link text or href looks blog-related
        const hrefMatch = blogKeywords.test(href);
        const textMatch = blogKeywords.test(text);

        if (hrefMatch || textMatch) {
          const resolvedUrl = resolveUrl(base, href);
          if (resolvedUrl) {
            return { found: true, url: resolvedUrl, method: 'nav-link' };
          }
        }
      }
    }

    return { found: false, url: null, method: null };
  } catch {
    return { found: false, url: null, method: null };
  }
}

/**
 * Resolve a possibly-relative href against a base URL.
 */
function resolveUrl(base, href) {
  try {
    const resolved = new URL(href, base);
    // Only return URLs on the same origin
    const baseOrigin = new URL(base).origin;
    if (resolved.origin !== baseOrigin) return null;
    return resolved.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}
