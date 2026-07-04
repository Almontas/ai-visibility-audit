/**
 * Brand name extraction from webpage HTML.
 *
 * Priority order:
 *   1. Organization schema `name` from JSON-LD (direct object or @graph array)
 *   2. og:site_name meta tag
 *   3. <title> tag, cleaned
 */

const TITLE_SEPARATORS = /\s*[|/–—-]\s*/;

const COMMON_SUFFIXES = [
  'home',
  'homepage',
  'official site',
  'official website',
  'welcome',
];

/**
 * Attempt to extract the Organization name from JSON-LD blocks.
 * Handles both top-level objects and @graph arrays.
 */
function extractFromJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const raw = $(scripts[i]).html();
      if (!raw) continue;
      const data = JSON.parse(raw);
      const name = findOrganizationName(data);
      if (name) return name;
    } catch {
      // Malformed JSON-LD — skip silently
    }
  }
  return null;
}

/**
 * Recursively search a JSON-LD object (or array) for an Organization name.
 */
function findOrganizationName(data) {
  if (!data || typeof data !== 'object') return null;

  if (Array.isArray(data)) {
    for (const item of data) {
      const name = findOrganizationName(item);
      if (name) return name;
    }
    return null;
  }

  // Check @graph array
  if (Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      const name = findOrganizationName(item);
      if (name) return name;
    }
  }

  // Check if this object is an Organization with a name
  const type = data['@type'];
  const isOrg =
    type === 'Organization' ||
    (Array.isArray(type) && type.includes('Organization'));

  if (isOrg && typeof data.name === 'string' && data.name.trim()) {
    return data.name.trim();
  }

  return null;
}

/**
 * Extract brand name from og:site_name meta tag.
 */
function extractFromOgSiteName($) {
  const content = $('meta[property="og:site_name"]').attr('content');
  if (content && typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  return null;
}

/**
 * Extract and clean brand name from the <title> tag.
 *
 * Splitting: split on | / – — -
 * Take the first segment, trim.
 * Strip common suffixes: "Home", "Homepage", "Official Site",
 * "Official Website", "Welcome" (case-insensitive).
 */
function extractFromTitle($) {
  const title = $('title').first().text();
  if (!title || !title.trim()) return null;

  // Split on common separators and take the first segment
  const segments = title.split(TITLE_SEPARATORS);
  let brand = (segments[0] || '').trim();
  if (!brand) return null;

  // Strip common suffixes (case-insensitive)
  for (const suffix of COMMON_SUFFIXES) {
    const regex = new RegExp(`\\s*${escapeRegex(suffix)}\\s*$`, 'i');
    brand = brand.replace(regex, '').trim();
  }

  return brand || null;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract a brand name from a parsed HTML page.
 *
 * @param {import('cheerio').CheerioAPI} $ — A Cheerio instance of the page
 * @returns {string|null} The brand name, or null if none found
 */
function extractBrandName($) {
  try {
    return extractFromJsonLd($) || extractFromOgSiteName($) || extractFromTitle($) || null;
  } catch {
    return null;
  }
}

export { extractBrandName };
