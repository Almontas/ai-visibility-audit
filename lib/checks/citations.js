/**
 * Category 5: Citations & Credibility (15 points max)
 *
 * Evaluates how well pages cite external sources, attribute data,
 * and establish author credibility — all signals AI models use
 * to assess trustworthiness.
 */

const MAX_SCORE = 15;

// Regex patterns for detecting data points with numeric context
const DATA_POINT_PATTERNS = [
  /\d+(\.\d+)?%/,                         // "42%", "3.5%"
  /\$\d[\d,.]*[KMBTkmbt]?\b/,             // "$1.2M", "$500K", "$10,000"
  /\d+(\.\d+)?x\s+(faster|slower|more|less|larger|smaller|greater|higher|lower|better|worse)/i,
                                            // "3x faster", "10x more"
  /\d{1,3}(,\d{3})+\+?/,                  // "10,000", "1,000,000+"
  /\b\d+(\.\d+)?\s*(billion|million|thousand|trillion)\b/i,
                                            // "1.5 billion", "200 million"
  /according to\s+(\d{4}|\w+)\s+study/i,  // "according to 2024 study"
];

// Phrases that indicate source attribution
const ATTRIBUTION_PHRASES = [
  'according to',
  'research shows',
  'study by',
  'data from',
  'reported by',
  'published in',
  'survey found',
  'research from',
  'analysis by',
  'findings from',
];

// Selectors for author byline detection
const AUTHOR_SELECTORS = [
  '.author',
  '.byline',
  '[rel="author"]',
  '.post-author',
  '.entry-author',
  '.article-author',
  '.author-name',
  '.writer',
  '.contributor',
];

// Regex for "By Firstname Lastname" patterns
const BY_LINE_REGEX = /\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+/;

/**
 * Extract the hostname from a URL for same-domain comparison.
 * Returns null if the URL cannot be parsed.
 */
function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Count external links on a page (links pointing to different domains).
 * Ignores anchors (#), mailto:, tel:, and javascript: links.
 */
function countExternalLinks($, pageUrl) {
  const pageHostname = getHostname(pageUrl);
  if (!pageHostname) return 0;

  let count = 0;
  const links = $('a[href]');

  for (let i = 0; i < links.length; i++) {
    const href = $(links[i]).attr('href');
    if (!href) continue;

    // Skip non-HTTP links
    const trimmed = href.trim();
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('tel:') ||
      trimmed.startsWith('javascript:')
    ) {
      continue;
    }

    // Resolve relative URLs
    let linkHostname;
    try {
      const resolved = new URL(trimmed, pageUrl);
      linkHostname = resolved.hostname.replace(/^www\./, '');
    } catch {
      continue;
    }

    if (linkHostname && linkHostname !== pageHostname) {
      count++;
    }
  }

  return count;
}

/**
 * Count data points (numbers with context) found in page text.
 */
function countDataPoints($) {
  const bodyText = $('body').text() || '';
  let count = 0;

  for (const pattern of DATA_POINT_PATTERNS) {
    const matches = bodyText.match(new RegExp(pattern.source, 'gi'));
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

/**
 * Check for source attribution phrases in page text.
 */
function hasSourceAttribution($) {
  const bodyText = ($('body').text() || '').toLowerCase();

  const found = [];
  for (const phrase of ATTRIBUTION_PHRASES) {
    if (bodyText.includes(phrase)) {
      found.push(phrase);
    }
  }

  return found;
}

/**
 * Check for author bylines using common CMS patterns.
 */
function hasAuthorByline($) {
  // Check CSS selectors
  for (const selector of AUTHOR_SELECTORS) {
    const elements = $(selector);
    if (elements.length > 0) {
      const text = elements.first().text().trim();
      if (text.length > 0) {
        return { found: true, method: `selector: ${selector}`, value: text };
      }
    }
  }

  // Check for "By Firstname Lastname" pattern in the page content
  // Search in a narrower scope: article, main, header areas
  const narrowScope = $('article, main, .post, .entry, .blog-post, header').text() || '';
  const match = narrowScope.match(BY_LINE_REGEX);
  if (match) {
    return { found: true, method: 'by-line pattern', value: match[0] };
  }

  return { found: false, method: null, value: null };
}

/**
 * Category 5: Citations & Credibility (15 points max)
 *
 * Checks for external links, data points, source attribution,
 * author bylines, and Person schema across all scanned pages.
 *
 * @param {Array<{url: string, $: import('cheerio').CheerioAPI, html: string, label: string}>} pages
 * @returns {{score: number, maxScore: number, findings: Array, teaser: string, details: object}}
 */
export function checkCitations(pages) {
  const findings = [];
  let score = 0;

  const details = {
    externalLinks: [],
    dataPointCount: 0,
    attributionPhrases: [],
    authorBylines: [],
  };

  try {
    if (!pages || pages.length === 0) {
      return {
        score: 0,
        maxScore: MAX_SCORE,
        findings: [
          {
            status: 'fail',
            message: 'No pages available to check for trust signals.',
            impact: 'high',
          },
        ],
        teaser: 'No pages could be scanned for trust signals.',
        details,
      };
    }

    // ── External Links (max +5) ──────────────────────────────────────

    let totalExternalLinks = 0;

    for (const page of pages) {
      const count = countExternalLinks(page.$, page.url);
      details.externalLinks.push({ url: page.url, label: page.label, count });
      totalExternalLinks += count;
    }

    const avgExternalLinks = totalExternalLinks / pages.length;

    if (avgExternalLinks >= 3) {
      score += 5;
      findings.push({
        status: 'pass',
        message: `Your pages link to outside sources (${avgExternalLinks.toFixed(1)} per page on average). This signals credibility to AI.`,
        impact: 'high',
      });
    } else if (avgExternalLinks >= 2) {
      score += 4;
      findings.push({
        status: 'pass',
        message: `Good external linking (${avgExternalLinks.toFixed(1)} per page). Linking to outside sources builds trust with AI engines.`,
        impact: 'high',
      });
    } else if (avgExternalLinks >= 1) {
      score += 2;
      findings.push({
        status: 'warning',
        message: `Some external links found (${avgExternalLinks.toFixed(1)} per page). Link to more outside sources to boost credibility.`,
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: `Very few links to outside sources (${avgExternalLinks.toFixed(1)} per page). AI engines trust content more when it cites authoritative sites.`,
        impact: 'high',
      });
    }

    // ── Data Points (max +4) ─────────────────────────────────────────

    let totalDataPoints = 0;

    for (const page of pages) {
      const count = countDataPoints(page.$);
      totalDataPoints += count;
    }

    details.dataPointCount = totalDataPoints;

    if (totalDataPoints >= 5) {
      score += 4;
      findings.push({
        status: 'pass',
        message: `${totalDataPoints} specific data points found (stats, percentages, numbers). AI engines prefer concrete evidence.`,
        impact: 'medium',
      });
    } else if (totalDataPoints >= 3) {
      score += 3;
      findings.push({
        status: 'pass',
        message: `${totalDataPoints} data points found. Adding more statistics and numbers makes your content more citable.`,
        impact: 'medium',
      });
    } else if (totalDataPoints >= 1) {
      score += 1;
      findings.push({
        status: 'warning',
        message: `Only ${totalDataPoints} data point${totalDataPoints > 1 ? 's' : ''} found. Add more statistics, percentages, and concrete numbers.`,
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No specific data points found. Add statistics and concrete numbers — AI engines cite factual claims more often.',
        impact: 'medium',
      });
    }

    // ── Source Attribution (max +3) ──────────────────────────────────

    const allAttributions = new Set();

    for (const page of pages) {
      const found = hasSourceAttribution(page.$);
      for (const phrase of found) {
        allAttributions.add(phrase);
      }
    }

    details.attributionPhrases = [...allAttributions];

    if (allAttributions.size >= 2) {
      score += 3;
      findings.push({
        status: 'pass',
        message: `Your content cites sources (e.g., "${[...allAttributions].join('", "')}"). This helps AI engines trust and quote your claims.`,
        impact: 'medium',
      });
    } else if (allAttributions.size >= 1) {
      score += 2;
      findings.push({
        status: 'pass',
        message: `Source citation found ("${[...allAttributions].join('", "')}"). AI engines trust content more when it attributes claims.`,
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No source citations found. Use phrases like "according to" or "research shows" to help AI engines trust your claims.',
        impact: 'medium',
      });
    }

    // ── Author Bylines (max +3) ─────────────────────────────────────

    let anyByline = false;

    for (const page of pages) {
      const result = hasAuthorByline(page.$);
      if (result.found) {
        anyByline = true;
        details.authorBylines.push({
          url: page.url,
          label: page.label,
          method: result.method,
          value: result.value,
        });
      }
    }

    if (anyByline) {
      score += 3;
      findings.push({
        status: 'pass',
        message: `Author names found on ${details.authorBylines.length} page${details.authorBylines.length > 1 ? 's' : ''}. Named authors help AI engines treat your content as authoritative.`,
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No author names found. Adding a named author increases your credibility with AI engines.',
        impact: 'medium',
      });
    }

    // ── Cap score ────────────────────────────────────────────────────

    score = Math.min(score, MAX_SCORE);

    // ── Build teaser ─────────────────────────────────────────────────

    const teaser = buildTeaser(score, details, anyByline);

    return {
      score,
      maxScore: MAX_SCORE,
      findings,
      teaser,
      details,
    };
  } catch (err) {
    return {
      score: 0,
      maxScore: MAX_SCORE,
      findings: [
        {
          status: 'fail',
          message: `Trust signals check failed: ${err.message}`,
          impact: 'high',
        },
      ],
      teaser: 'We couldn\'t check trust signals on this site.',
      details,
    };
  }
}

/**
 * Builds a single-sentence teaser summarizing citations & credibility
 * for the Light Report.
 */
function buildTeaser(score, details, anyByline) {
  const pct = Math.round((score / MAX_SCORE) * 100);

  if (pct >= 80) {
    return 'Strong trust signals: your content cites sources, uses data, and names its authors.';
  }

  if (pct >= 50) {
    const missing = [];
    if (details.dataPointCount === 0) missing.push('data points');
    if (details.attributionPhrases.length === 0) missing.push('source attribution');
    if (!anyByline) missing.push('author bylines');

    return missing.length > 0
      ? `Some trust signals found, but missing ${missing.join(' and ')}.`
      : 'Some trust signals found, with room to improve.';
  }

  if (pct >= 20) {
    return 'Few trust signals. Adding source citations, statistics, and author names would help.';
  }

  return 'Very few trust signals. AI engines look for citations, data, and named authors before citing content.';
}
