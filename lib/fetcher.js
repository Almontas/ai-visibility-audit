import * as cheerio from 'cheerio';

const DEFAULT_TIMEOUT = 5000;
const USER_AGENT = 'Mozilla/5.0 (compatible; AIDiscoveryAudit/1.0)';

/**
 * Fetches a URL with a timeout. Never throws — always returns a normalized result.
 *
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options (method, headers, timeout, etc.)
 * @returns {Promise<{ok: boolean, status: number|null, text: string, headers: object|null, error: string|null}>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(options.headers || {}),
      },
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      text,
      headers: Object.fromEntries(response.headers.entries()),
      error: null,
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      ok: false,
      status: null,
      text: '',
      headers: null,
      error: isTimeout ? `Request timed out after ${timeout}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a URL and parses the HTML into a Cheerio instance. Never throws.
 *
 * @param {string} url - The URL to fetch and parse
 * @returns {Promise<{ok: boolean, $: cheerio.CheerioAPI|null, html: string, url: string, error: string|null}>}
 */
export async function fetchAndParse(url) {
  const result = await fetchWithTimeout(url);

  if (!result.ok) {
    return {
      ok: false,
      $: null,
      html: '',
      url,
      error: result.error || `HTTP ${result.status}`,
    };
  }

  try {
    const $ = cheerio.load(result.text);
    return {
      ok: true,
      $,
      html: result.text,
      url,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      $: null,
      html: result.text,
      url,
      error: `HTML parse error: ${err.message}`,
    };
  }
}

/**
 * Checks if a URL exists via HEAD request, falling back to GET if HEAD fails.
 * Never throws.
 *
 * @param {string} url - The URL to check
 * @returns {Promise<boolean>}
 */
export async function urlExists(url) {
  // Try HEAD first — cheaper, no body download
  const headResult = await fetchWithTimeout(url, { method: 'HEAD' });

  if (headResult.ok) {
    return true;
  }

  // Some servers reject HEAD requests; fall back to GET
  if (headResult.status !== null && headResult.status >= 400 && headResult.status < 500) {
    // Could be a real 4xx — but some servers return 405 for HEAD.
    // Only fall back to GET for method-related or ambiguous failures.
    const getResult = await fetchWithTimeout(url);
    return getResult.ok;
  }

  // For network errors / timeouts, also try GET as a fallback
  if (headResult.status === null) {
    const getResult = await fetchWithTimeout(url);
    return getResult.ok;
  }

  return false;
}

/**
 * Fetches raw text content from a URL (for robots.txt, llms.txt, sitemaps).
 * Never throws.
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<{ok: boolean, text: string, error: string|null}>}
 */
export async function fetchText(url) {
  const result = await fetchWithTimeout(url);

  return {
    ok: result.ok,
    text: result.text,
    error: result.ok ? null : (result.error || `HTTP ${result.status}`),
  };
}
