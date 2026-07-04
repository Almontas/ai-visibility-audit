import { fetchWithTimeout } from '../fetcher.js';

const UNABLE_MESSAGE = 'Couldn\'t check — the platform may block automated lookups.';

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/**
 * Extract a clean domain identifier from a URL for use in search queries.
 * "https://example.com/about" → "example.com"
 * Also returns a short slug for filtering: "example"
 */
function extractDomain(siteUrl) {
  try {
    const hostname = new URL(siteUrl).hostname.replace(/^www\./, '');
    const slug = hostname.replace(/\.[^.]+$/, ''); // strip TLD
    return { hostname, slug };
  } catch {
    return { hostname: '', slug: '' };
  }
}

// ---------------------------------------------------------------------------
// Search API helpers
// ---------------------------------------------------------------------------

/**
 * Search via Brave Search API. Returns normalized results.
 * Falls back gracefully if API key is not set.
 */
async function searchBrave(query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return { ok: false, results: [] };

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  const result = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    timeout: 4000,
  });

  if (!result.ok) return { ok: false, results: [] };

  try {
    const json = JSON.parse(result.text);
    return { ok: true, results: json?.web?.results || [] };
  } catch {
    return { ok: false, results: [] };
  }
}

/**
 * Search via Exa API. Returns normalized results.
 * Falls back gracefully if API key is not set.
 */
async function searchExa(query) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return { ok: false, results: [] };

  const result = await fetchWithTimeout('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, numResults: 10, type: 'keyword' }),
    timeout: 4000,
  });

  if (!result.ok) return { ok: false, results: [] };

  try {
    const json = JSON.parse(result.text);
    return { ok: true, results: json?.results || [] };
  } catch {
    return { ok: false, results: [] };
  }
}

/**
 * Check if a search result is relevant to the actual brand (not a different
 * company with a similar name). Uses the domain slug as the primary signal.
 */
function isRelevantResult(result, domainSlug) {
  if (!domainSlug) return true; // no domain to check against — accept all
  const text = [
    result.url || '',
    result.title || '',
    result.description || '',
  ].join(' ').toLowerCase();
  return text.includes(domainSlug);
}

// ---------------------------------------------------------------------------
// Individual platform checks
// ---------------------------------------------------------------------------

/**
 * Reddit — via Brave Search (site:reddit.com query).
 * Uses domain to disambiguate from similarly-named brands.
 * Falls back to direct Reddit JSON API if Brave key is not set.
 * 4 points if brand appears in Reddit search results.
 */
async function checkReddit(brandName, domain) {
  // Try Brave Search first — use domain for precise matching
  const query = domain.hostname
    ? `site:reddit.com "${domain.hostname}" OR "${domain.slug}"`
    : `site:reddit.com "${brandName}"`;

  const braveResult = await searchBrave(query);

  if (braveResult.ok) {
    const redditResults = braveResult.results.filter((r) =>
      r.url && r.url.includes('reddit.com')
    );

    // Validate relevance — must reference the actual domain, not a namesake
    const relevant = domain.slug
      ? redditResults.filter((r) => isRelevantResult(r, domain.slug))
      : redditResults;

    if (relevant.length > 0) {
      return found('Reddit', 4, relevant[0].url);
    }
    // If we got Reddit results but none are relevant, still not_found
    return notFound('Reddit', 4);
  }

  // Fallback: direct Reddit JSON API
  return checkRedditDirect(brandName);
}

/**
 * Reddit direct fallback — public JSON API (no auth needed).
 */
async function checkRedditDirect(brandName) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(brandName)}&limit=5`;
  const result = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });

  if (!result.ok) {
    return unable('Reddit', 4);
  }

  try {
    const json = JSON.parse(result.text);
    const children = json?.data?.children ?? [];
    if (children.length > 0) {
      return found('Reddit', 4, `https://www.reddit.com/search/?q=${encodeURIComponent(brandName)}`);
    }
    return notFound('Reddit', 4);
  } catch {
    return unable('Reddit', 4);
  }
}

/**
 * Wikipedia — MediaWiki search API. Most reliable of all platform checks.
 * Uses domain slug to validate results actually reference this brand.
 * 4 points if brand appears in search results.
 */
async function checkWikipedia(brandName, domain) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(brandName)}&format=json&srlimit=5`;
  const result = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });

  if (!result.ok) {
    return unable('Wikipedia', 4);
  }

  try {
    const json = JSON.parse(result.text);
    const results = json?.query?.search ?? [];

    if (results.length === 0) {
      return notFound('Wikipedia', 4);
    }

    // If we have a domain slug, check if any result's snippet references
    // the actual brand (not just a word match on a common name)
    if (domain.slug) {
      const relevant = results.filter((r) => {
        const text = `${r.title} ${r.snippet}`.toLowerCase();
        return text.includes(domain.slug) || text.includes(brandName.toLowerCase());
      });
      // For Wikipedia, brand name match is acceptable since articles
      // won't usually contain domain slugs. But if the brand name is
      // very generic (< 4 chars or a common word), require slug match.
      const isGeneric = brandName.length < 6;
      if (isGeneric && !relevant.some((r) =>
        `${r.title} ${r.snippet}`.toLowerCase().includes(domain.slug)
      )) {
        return notFound('Wikipedia', 4);
      }
    }

    return found('Wikipedia', 4, `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(brandName)}`);
  } catch {
    return unable('Wikipedia', 4);
  }
}

/**
 * G2 — via Brave Search (site:g2.com query).
 * Uses domain to disambiguate from similarly-named products.
 * Falls back to direct HTML scrape if Brave key is not set.
 * 3 points if brand appears in G2 search results.
 */
async function checkG2(brandName, domain) {
  const query = domain?.hostname
    ? `site:g2.com "${brandName}" "${domain.hostname}"`
    : `site:g2.com "${brandName}"`;

  const braveResult = await searchBrave(query);

  if (braveResult.ok) {
    const g2Results = braveResult.results.filter((r) =>
      r.url && r.url.includes('g2.com')
    );

    if (domain?.slug) {
      const relevant = g2Results.filter((r) => isRelevantResult(r, domain.slug));
      if (relevant.length > 0) {
        return found('G2', 3, relevant[0].url);
      }
    }

    if (g2Results.length > 0 && !domain?.slug) {
      return found('G2', 3, g2Results[0].url);
    }

    return notFound('G2', 3);
  }

  // Fallback: direct scrape (often blocked)
  const url = `https://www.g2.com/search?query=${encodeURIComponent(brandName)}`;
  const result = await fetchWithTimeout(url);

  if (!result.ok || result.text.length < 1000) {
    return unable('G2', 3);
  }

  const lowerHtml = result.text.toLowerCase();
  if (lowerHtml.includes(brandName.toLowerCase())) {
    return found('G2', 3, url);
  }

  return notFound('G2', 3);
}

/**
 * Crunchbase — via Brave Search (site:crunchbase.com query).
 * Uses domain to disambiguate from similarly-named companies.
 * Falls back to direct Crunchbase scrape if Brave key is not set.
 * 3 points if brand appears in Crunchbase search results.
 */
async function checkCrunchbase(brandName, domain) {
  // Try Brave Search — use domain for disambiguation
  const query = domain.hostname
    ? `site:crunchbase.com "${domain.hostname}" OR "${brandName}"`
    : `site:crunchbase.com "${brandName}"`;

  const braveResult = await searchBrave(query);

  if (braveResult.ok) {
    const cbResults = braveResult.results.filter((r) =>
      r.url && r.url.includes('crunchbase.com')
    );

    // Validate — prefer results that reference the domain
    if (domain.slug) {
      const relevant = cbResults.filter((r) => isRelevantResult(r, domain.slug));
      if (relevant.length > 0) {
        return found('Crunchbase', 3, relevant[0].url);
      }
    }

    // Accept any Crunchbase result if no domain filter or no relevant match
    if (cbResults.length > 0 && !domain.slug) {
      return found('Crunchbase', 3, cbResults[0].url);
    }

    return notFound('Crunchbase', 3);
  }

  // Fallback: direct Crunchbase scrape
  return checkCrunchbaseDirect(brandName);
}

/**
 * Crunchbase direct fallback — text search endpoint. Frequently blocked.
 */
async function checkCrunchbaseDirect(brandName) {
  const url = `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(brandName)}`;
  const result = await fetchWithTimeout(url);

  if (!result.ok) {
    return unable('Crunchbase', 3);
  }

  try {
    const json = JSON.parse(result.text);
    const hasResults =
      (Array.isArray(json) && json.length > 0) ||
      (json?.entities && json.entities.length > 0) ||
      (json?.results && json.results.length > 0) ||
      (json?.count && json.count > 0);

    if (hasResults) {
      return found('Crunchbase', 3, `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(brandName)}`);
    }
    return notFound('Crunchbase', 3);
  } catch {
    const lowerHtml = result.text.toLowerCase();
    const lowerBrand = brandName.toLowerCase();

    if (lowerHtml.includes(lowerBrand) && result.text.length > 1000) {
      return found('Crunchbase', 3, `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(brandName)}`);
    }

    if (result.text.length < 1000) {
      return unable('Crunchbase', 3);
    }

    return notFound('Crunchbase', 3);
  }
}

/**
 * Forum Discussions — via Brave Search across forum platforms.
 * Searches for brand mentions on Quora, Stack Overflow, HackerNews, etc.
 * Falls back to Exa if Brave key is not set.
 * 3 points if brand appears in forum/discussion results.
 */
async function checkForumPresence(brandName, domain) {
  const forumDomains = [
    'quora.com', 'stackoverflow.com', 'news.ycombinator.com',
    'reddit.com', 'community.', 'forum.', 'discuss.',
    'dev.to', 'medium.com', 'producthunt.com',
  ];

  // Try Brave Search — more reliable for finding specific platform results
  const searchTerm = domain.hostname || brandName;
  const query = `"${searchTerm}" (site:quora.com OR site:stackoverflow.com OR site:news.ycombinator.com OR site:dev.to OR site:medium.com OR site:producthunt.com)`;

  const braveResult = await searchBrave(query);

  if (braveResult.ok && braveResult.results.length > 0) {
    const forumResults = braveResult.results.filter((r) =>
      r.url && forumDomains.some((d) => r.url.includes(d))
    );

    if (forumResults.length > 0) {
      return found('Forum Discussions', 3, forumResults[0].url);
    }
  }

  // Fallback: Exa search
  const exaQuery = domain.hostname
    ? `"${domain.hostname}" OR "${domain.slug}" forum discussion`
    : `"${brandName}" forum discussion`;

  const exaResult = await searchExa(exaQuery);

  if (!exaResult.ok) {
    return braveResult.ok ? notFound('Forum Discussions', 3) : unable('Forum Discussions', 3);
  }

  // Filter out the brand's own site
  const externalResults = domain.slug
    ? exaResult.results.filter((r) => {
        const url = r.url?.toLowerCase() || '';
        return !url.includes(domain.hostname);
      })
    : exaResult.results;

  const forumResults = externalResults.filter((r) =>
    r.url && forumDomains.some((d) => r.url.includes(d))
  );

  if (forumResults.length > 0) {
    return found('Forum Discussions', 3, forumResults[0].url);
  }

  return notFound('Forum Discussions', 3);
}

/**
 * News & Media Coverage — via Exa keyword search.
 * Uses domain to search for external coverage of this specific brand.
 * Filters out the brand's own site to avoid self-references.
 * 3 points if brand appears in news/media results.
 */
async function checkNewsMedia(brandName, domain) {
  // Search using domain — the most unique identifier
  const query = domain.hostname
    ? `"${domain.hostname}" OR "${brandName}" -site:${domain.hostname}`
    : `"${brandName}" company`;

  const exaResult = await searchExa(query);

  if (!exaResult.ok) {
    return unable('News & Media', 3);
  }

  // Filter out the brand's own domain
  const externalResults = domain.hostname
    ? exaResult.results.filter((r) => {
        const url = r.url?.toLowerCase() || '';
        return !url.includes(domain.hostname);
      })
    : exaResult.results;

  // Require coverage from at least 2 distinct external domains
  const uniqueDomains = new Set();
  for (const r of externalResults) {
    try { uniqueDomains.add(new URL(r.url).hostname); } catch {}
  }

  if (uniqueDomains.size >= 2) {
    return found('News & Media', 3, externalResults[0].url);
  }

  return notFound('News & Media', 3);
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function found(platform, points, url) {
  return {
    platform,
    points,
    found: true,
    status: 'found',
    url,
    message: `Your brand appears on ${platform}.`,
  };
}

function notFound(platform, points) {
  return {
    platform,
    points,
    found: false,
    status: 'not_found',
    url: null,
    message: `Your brand was not found on ${platform}.`,
  };
}

function unable(platform, maxPoints = 0) {
  return {
    platform,
    points: 0,
    maxPoints,
    found: null,
    status: 'unable',
    url: null,
    message: UNABLE_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Category 4: Brand Presence (20 points max)
 *
 * Checks whether the brand appears on 6 third-party platforms that AI models
 * commonly use as knowledge sources. Uses Brave Search and Exa APIs for
 * reliable web search, with direct scraping fallbacks where appropriate.
 * All checks run in parallel. Failures are handled gracefully.
 *
 * The site URL is used to extract a domain identifier for disambiguation —
 * ensuring we find mentions of THIS brand, not a similarly-named one.
 *
 * @param {string} brandName - The extracted brand name to search for
 * @param {string} [siteUrl] - The site URL for domain-based disambiguation
 * @returns {Promise<{score: number, maxScore: number, findings: Array, teaser: string, details: object}>}
 */
export async function checkBrandPresence(brandName, siteUrl) {
  try {
    if (!brandName || typeof brandName !== 'string' || brandName.trim().length === 0) {
      return {
        score: 0,
        maxScore: 20,
        findings: [{
          status: 'warning',
          message: 'Couldn\'t determine your brand name. Brand checks were skipped.',
          impact: 'high',
          platform: null,
        }],
        teaser: 'Couldn\'t determine your brand name.',
        details: {
          brandName: null,
          platforms: [],
        },
      };
    }

    const cleanBrand = brandName.trim();
    const domain = siteUrl ? extractDomain(siteUrl) : { hostname: '', slug: '' };

    // Run all 6 platform checks in parallel — one failure never blocks the rest
    const results = await Promise.allSettled([
      checkReddit(cleanBrand, domain),
      checkWikipedia(cleanBrand, domain),
      checkG2(cleanBrand, domain),
      checkCrunchbase(cleanBrand, domain),
      checkForumPresence(cleanBrand, domain),
      checkNewsMedia(cleanBrand, domain),
    ]);

    // Extract values (Promise.allSettled always resolves)
    const platformResults = results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return unable('Unknown');
    });

    // Calculate score — only award points for confirmed "found" results.
    // Reduce maxScore for platforms we couldn't check (unable) so sites
    // aren't penalised for our scraping limitations.
    let score = 0;
    let effectiveMax = 20;
    const findings = [];
    const platforms = [];

    for (const pr of platformResults) {
      if (pr.status === 'found') {
        score += pr.points;
        findings.push({
          status: 'pass',
          message: pr.message,
          impact: pr.points >= 4 ? 'high' : pr.points >= 3 ? 'medium' : 'low',
          platform: pr.platform,
        });
      } else if (pr.status === 'not_found') {
        findings.push({
          status: 'fail',
          message: pr.message,
          impact: pr.points >= 4 ? 'high' : pr.points >= 3 ? 'medium' : 'low',
          platform: pr.platform,
        });
      } else {
        // unable — don't count these points in the denominator
        effectiveMax -= (pr.maxPoints || pr.points);
        findings.push({
          status: 'unable',
          message: `${pr.platform}: ${pr.message}`,
          impact: 'low',
          platform: pr.platform,
        });
      }

      platforms.push({
        name: pr.platform,
        points: pr.points,
        found: pr.found,
        url: pr.url,
        status: pr.status,
      });
    }

    // Build teaser
    const checkedCount = platformResults.filter((p) => p.status !== 'unable').length;
    const foundCount = platformResults.filter((p) => p.status === 'found').length;
    const totalPlatforms = platformResults.length;

    let teaser;
    if (checkedCount === 0) {
      teaser = 'Couldn\'t check brand presence on external platforms.';
    } else {
      teaser = `Your brand appears on ${foundCount} of ${totalPlatforms} platforms AI engines reference.`;
    }

    const finalMaxScore = Math.max(effectiveMax, 1);

    return {
      score,
      maxScore: finalMaxScore,
      findings,
      teaser,
      details: {
        brandName: cleanBrand,
        platforms,
      },
    };
  } catch (err) {
    return {
      score: 0,
      maxScore: 20,
      findings: [{
        status: 'warning',
        message: `Brand footprint check failed: ${err.message}`,
        impact: 'high',
        platform: null,
      }],
      teaser: 'Brand footprint check encountered an error.',
      details: {
        brandName: brandName ?? null,
        platforms: [],
      },
    };
  }
}
