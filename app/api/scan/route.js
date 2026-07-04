import { fetchAndParse } from '../../../lib/fetcher.js';
import { detectBlogPage } from '../../../lib/pageDetector.js';
import { checkCrawlerAccess } from '../../../lib/checks/crawlerAccess.js';
import { checkSchema } from '../../../lib/checks/schema.js';
import { checkContentStructure } from '../../../lib/checks/contentStructure.js';
import { checkBrandPresence } from '../../../lib/checks/brandPresence.js';
import { checkCitations } from '../../../lib/checks/citations.js';
import { checkFreshness } from '../../../lib/checks/freshness.js';
import { checkLlmVisibility } from '../../../lib/checks/llmVisibility.js';

import { extractBrandName } from '../../../lib/brandExtractor.js';
import { aggregateScores } from '../../../lib/scoring.js';

import { hashUrl, getCachedScan, saveScan, checkRateLimit, cleanupRateLimits } from '../../../lib/db.js';

// ---------------------------------------------------------------------------
// Private IP / localhost regex for URL validation
// ---------------------------------------------------------------------------

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
];

/**
 * Validate and normalize a URL submitted for scanning.
 *
 * - Auto-prepends https:// if no protocol is present
 * - Rejects private/localhost addresses
 * - Rejects non-http(s) protocols
 *
 * @param {string} raw - The raw URL string from the request body
 * @returns {{ ok: boolean, url: string|null, error: string|null }}
 */
function validateUrl(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, url: null, error: 'URL is required.' };
  }

  let urlString = raw.trim();

  // Auto-prepend https:// if no protocol is present
  if (!/^https?:\/\//i.test(urlString) && !/^\w+:\/\//.test(urlString)) {
    urlString = `https://${urlString}`;
  }

  // Parse with URL constructor
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, url: null, error: 'Invalid URL format.' };
  }

  // Reject non-http(s) protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, url: null, error: 'Only http and https URLs are supported.' };
  }

  // Reject private IPs and localhost
  const hostname = parsed.hostname;
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { ok: false, url: null, error: 'Private or localhost URLs are not allowed.' };
    }
  }

  // Normalize: strip trailing slash for consistency, keep the origin + path
  const normalized = parsed.origin + parsed.pathname.replace(/\/+$/, '') + parsed.search + parsed.hash;

  return { ok: true, url: normalized, error: null };
}

/**
 * Build a zeroed-out fallback result for a check category that failed.
 * Matches the shape returned by each check function.
 */
function fallbackResult(maxScore, categoryLabel) {
  return {
    score: 0,
    maxScore,
    findings: [
      {
        status: 'warning',
        message: `${categoryLabel} check could not be completed.`,
        impact: 'high',
      },
    ],
    teaser: `Unable to evaluate ${categoryLabel.toLowerCase()}.`,
    details: {},
  };
}

// ---------------------------------------------------------------------------
// GET handler — simple status endpoint
// ---------------------------------------------------------------------------

export async function GET() {
  return Response.json({ status: 'ok', message: 'POST a URL to scan' });
}

// ---------------------------------------------------------------------------
// POST handler — run the full scan
// ---------------------------------------------------------------------------

// Allow up to 30s on Vercel; the LLM visibility check alone can take ~5s.
export const maxDuration = 30;

export async function POST(request) {
  // Overall timeout with a 2s buffer under maxDuration
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Scan timed out. Please try again.')), 28000)
  );

  try {
    const result = await Promise.race([
      runScan(request),
      timeoutPromise,
    ]);
    return result;
  } catch (err) {
    console.error('Scan API error:', err);
    const message = err.message || 'An unexpected error occurred while scanning. Please try again.';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

async function runScan(request) {
  try {
    // 1. Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, error: 'Invalid JSON in request body.' },
        { status: 400 }
      );
    }

    // 2. Validate URL
    const validation = validateUrl(body.url);
    if (!validation.ok) {
      return Response.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const normalizedUrl = validation.url;
    const baseUrl = new URL(normalizedUrl).origin;

    // 2b. Rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';

    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return Response.json(
        { success: false, error: 'Rate limit exceeded. Please try again in an hour.' },
        { status: 429 }
      );
    }

    // 2c. Cache check
    const urlHash = hashUrl(normalizedUrl);
    const cached = await getCachedScan(urlHash);
    if (cached) {
      return Response.json({
        success: true,
        cached: true,
        url: cached.url,
        brandName: cached.brand_name,
        blogPage: cached.blog_page,
        score: cached.score,
        llmVisibility: cached.llm_visibility || null,
        scannedAt: cached.created_at,
      });
    }

    // Cleanup old rate limit rows occasionally (~10% of requests)
    if (Math.random() < 0.1) {
      cleanupRateLimits().catch(() => {});
    }

    // 3. Fetch homepage
    const homepageResult = await fetchAndParse(normalizedUrl);
    if (!homepageResult.ok) {
      return Response.json(
        {
          success: false,
          error: `Could not reach the website: ${homepageResult.error || 'unknown error'}`,
        },
        { status: 400 }
      );
    }

    // 4. Extract brand name
    const brandName = extractBrandName(homepageResult.$) || null;

    // 5. Detect blog page
    const blogDetection = await detectBlogPage(baseUrl, homepageResult.$);

    // 6. Fetch blog page if detected
    let blogPageResult = null;
    if (blogDetection.found && blogDetection.url) {
      blogPageResult = await fetchAndParse(blogDetection.url);
      if (!blogPageResult.ok) {
        // Blog page failed to fetch — continue without it
        blogPageResult = null;
      }
    }

    // 7. Build pages array
    const pages = [
      {
        url: normalizedUrl,
        $: homepageResult.$,
        html: homepageResult.html,
        label: 'homepage',
      },
    ];

    if (blogPageResult) {
      pages.push({
        url: blogDetection.url,
        $: blogPageResult.$,
        html: blogPageResult.html,
        label: 'blog',
      });
    }

    // 8. Run all 6 checks in parallel
    const [
      crawlerResult,
      schemaResult,
      contentResult,
      brandResult,
      citationsResult,
      freshnessResult,
      llmResult,
    ] = await Promise.allSettled([
      checkCrawlerAccess(baseUrl),
      Promise.resolve(checkSchema(pages)),
      Promise.resolve(checkContentStructure(pages)),
      checkBrandPresence(brandName, normalizedUrl),
      Promise.resolve(checkCitations(pages)),
      checkFreshness(pages, baseUrl),
      checkLlmVisibility(brandName, normalizedUrl),
    ]);

    // 9. Handle settled results — fulfilled → value, rejected → zeroed fallback
    const results = {
      crawlerAccess:
        crawlerResult.status === 'fulfilled'
          ? crawlerResult.value
          : fallbackResult(15, 'AI Crawler Access'),
      schema:
        schemaResult.status === 'fulfilled'
          ? schemaResult.value
          : fallbackResult(15, 'Schema & Structured Data'),
      contentStructure:
        contentResult.status === 'fulfilled'
          ? contentResult.value
          : fallbackResult(20, 'Content Structure'),
      brandPresence:
        brandResult.status === 'fulfilled'
          ? brandResult.value
          : fallbackResult(20, 'Brand Presence'),
      citations:
        citationsResult.status === 'fulfilled'
          ? citationsResult.value
          : fallbackResult(15, 'Citations & Credibility'),
      freshness:
        freshnessResult.status === 'fulfilled'
          ? freshnessResult.value
          : fallbackResult(15, 'Freshness & Cadence'),
    };

    // 10. Aggregate scores
    const aggregated = aggregateScores(results, blogDetection.found);

    // 11. Build response
    const blogPage = {
      found: blogDetection.found,
      url: blogDetection.url,
      method: blogDetection.method,
    };
    const scannedAt = new Date().toISOString();

    const llmVisibility = llmResult.status === 'fulfilled'
      ? llmResult.value
      : { llms: [], summary: 'LLM visibility check could not complete.' };

    // 12. Cache the result in Supabase (non-blocking)
    saveScan(normalizedUrl, urlHash, brandName, blogPage, aggregated, llmVisibility).catch(() => {});

    // 13. Return JSON response
    return Response.json({
      success: true,
      url: normalizedUrl,
      brandName,
      blogPage,
      score: aggregated,
      llmVisibility,
      scannedAt,
    });
  } catch (err) {
    // Unexpected top-level error — 500
    console.error('Scan API error:', err);
    return Response.json(
      { success: false, error: 'An unexpected error occurred while scanning. Please try again.' },
      { status: 500 }
    );
  }
}
