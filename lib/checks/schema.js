/**
 * Category 2: Schema & Structured Data (15 points max)
 *
 * Parses JSON-LD blocks from each page, detects schema types,
 * checks Organization sameAs links, and scores accordingly.
 */

const TARGET_TYPES = {
  FAQPage: 1,
  Article: 2,
  BlogPosting: 2,
  Organization: 3,
  BreadcrumbList: 1,
  Person: 2,
  Product: 1,
  SoftwareApplication: 1,
};

// Article and BlogPosting share the same 2-pt slot — only count once
const ARTICLE_TYPES = new Set(['Article', 'BlogPosting']);

const SAME_AS_DOMAINS = ['wikipedia.org', 'linkedin.com', 'crunchbase.com'];

/**
 * Extract all JSON-LD blocks from a Cheerio instance.
 * Returns { parsed: object[], malformed: number }
 */
function extractJsonLd($) {
  const parsed = [];
  let malformed = 0;

  const scripts = $('script[type="application/ld+json"]');
  scripts.each((_i, el) => {
    try {
      const raw = $(el).html();
      if (!raw || !raw.trim()) return;
      const data = JSON.parse(raw);
      parsed.push(data);
    } catch {
      malformed++;
    }
  });

  return { parsed, malformed };
}

/**
 * Flatten a JSON-LD object (or array) into individual schema items.
 * Handles @graph arrays and top-level arrays.
 */
function flattenSchemas(data) {
  const items = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      items.push(...flattenSchemas(item));
    }
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data['@graph'])) {
      for (const item of data['@graph']) {
        items.push(...flattenSchemas(item));
      }
    }
    // Include the object itself if it has a @type
    if (data['@type']) {
      items.push(data);
    }
  }

  return items;
}

/**
 * Resolve @type to an array of type strings.
 */
function getTypes(item) {
  const t = item['@type'];
  if (!t) return [];
  if (Array.isArray(t)) return t.map(String);
  return [String(t)];
}

/**
 * Extract sameAs links from Organization schema items.
 */
function extractSameAsLinks(items) {
  const links = [];

  for (const item of items) {
    const types = getTypes(item);
    if (!types.includes('Organization')) continue;

    const sameAs = item.sameAs;
    if (typeof sameAs === 'string') {
      links.push(sameAs);
    } else if (Array.isArray(sameAs)) {
      for (const link of sameAs) {
        if (typeof link === 'string') links.push(link);
      }
    }
  }

  return links;
}

/**
 * Check if sameAs links include the target authority domains.
 */
function hasAuthoritySameAs(sameAsLinks) {
  return SAME_AS_DOMAINS.some((domain) =>
    sameAsLinks.some((link) => {
      try {
        return new URL(link).hostname.includes(domain);
      } catch {
        return false;
      }
    })
  );
}

/**
 * Check schema & structured data across all scanned pages.
 *
 * @param {{ url: string, $: import('cheerio').CheerioAPI, html: string, label: string }[]} pages
 * @returns {{ score: number, maxScore: 15, findings: Array, teaser: string, details: object }}
 */
export function checkSchema(pages) {
  try {
    const findings = [];
    const pageSchemas = []; // { page, types[], raw[] }
    const allItems = [];
    let totalMalformed = 0;

    // ---------- Parse JSON-LD from each page ----------
    for (const page of pages) {
      const { parsed, malformed } = extractJsonLd(page.$);
      totalMalformed += malformed;

      const items = [];
      for (const block of parsed) {
        items.push(...flattenSchemas(block));
      }

      const typeSet = new Set();
      for (const item of items) {
        for (const t of getTypes(item)) {
          typeSet.add(t);
        }
      }

      pageSchemas.push({
        page: page.label,
        types: [...typeSet],
        raw: parsed,
      });

      allItems.push(...items);
    }

    // Collect all distinct types across every page
    const allTypes = new Set();
    for (const ps of pageSchemas) {
      for (const t of ps.types) {
        allTypes.add(t);
      }
    }

    // ---------- Scoring ----------
    let score = 0;

    // Any valid JSON-LD present: +1
    const hasAnyJsonLd = allItems.length > 0;
    if (hasAnyJsonLd) {
      score += 1;
      findings.push({
        status: 'pass',
        message: `Structured data found (${allItems.length} item${allItems.length !== 1 ? 's' : ''} across ${pages.length} page${pages.length !== 1 ? 's' : ''}). This helps AI engines understand your content.`,
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No structured data found. Without it, AI engines have to guess what your content means.',
        impact: 'high',
      });
    }

    // FAQPage: +1
    if (allTypes.has('FAQPage')) {
      score += 1;
      findings.push({
        status: 'pass',
        message: 'FAQ markup found. AI engines can pull your questions and answers directly.',
        impact: 'high',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No FAQ markup found. Adding it helps AI engines surface your answers to common questions.',
        impact: 'high',
      });
    }

    // Article or BlogPosting: +2 (only counted once even if both present)
    const hasArticleType = ARTICLE_TYPES.has('Article') && allTypes.has('Article');
    const hasBlogPosting = ARTICLE_TYPES.has('BlogPosting') && allTypes.has('BlogPosting');
    if (hasArticleType || hasBlogPosting) {
      score += 2;
      const which = hasArticleType && hasBlogPosting
        ? 'Article and BlogPosting'
        : hasArticleType
          ? 'Article'
          : 'BlogPosting';
      findings.push({
        status: 'pass',
        message: `Article markup found. AI engines can identify your blog and news content.`,
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No article markup on blog content. Add it so AI engines recognize your posts.',
        impact: 'medium',
      });
    }

    // Organization: +3
    if (allTypes.has('Organization')) {
      score += 3;
      findings.push({
        status: 'pass',
        message: 'Company info markup found. AI engines can identify your brand.',
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No company info markup found. Add it so AI engines know who you are.',
        impact: 'high',
      });
    }

    // Organization with sameAs links: +2
    const sameAsLinks = extractSameAsLinks(allItems);
    if (allTypes.has('Organization') && sameAsLinks.length > 0 && hasAuthoritySameAs(sameAsLinks)) {
      score += 2;
      findings.push({
        status: 'pass',
        message: `Your company markup links to authoritative profiles (${sameAsLinks.length} link${sameAsLinks.length !== 1 ? 's' : ''}).`,
        impact: 'medium',
      });
    } else if (allTypes.has('Organization') && sameAsLinks.length > 0) {
      findings.push({
        status: 'warning',
        message: 'Your company markup has profile links, but none point to Wikipedia, LinkedIn, or Crunchbase.',
        impact: 'medium',
      });
    } else if (allTypes.has('Organization')) {
      findings.push({
        status: 'fail',
        message: 'Your company markup is missing profile links. Add your Wikipedia, LinkedIn, and Crunchbase pages.',
        impact: 'medium',
      });
    }

    // BreadcrumbList: +1
    if (allTypes.has('BreadcrumbList')) {
      score += 1;
      findings.push({
        status: 'pass',
        message: 'Breadcrumb navigation markup found. Helps AI engines understand your site structure.',
        impact: 'low',
      });
    } else {
      findings.push({
        status: 'info',
        message: 'No breadcrumb navigation markup. Adding it helps AI engines map your site.',
        impact: 'low',
      });
    }

    // Person schema: +2
    if (allTypes.has('Person')) {
      score += 2;
      findings.push({
        status: 'pass',
        message: 'Author markup found. AI engines can connect your content to a named person.',
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No author markup found. Add it so AI engines can attribute your content to a real person.',
        impact: 'medium',
      });
    }

    // Product or SoftwareApplication: +1
    if (allTypes.has('Product') || allTypes.has('SoftwareApplication')) {
      score += 1;
      const which = allTypes.has('Product') && allTypes.has('SoftwareApplication')
        ? 'Product and SoftwareApplication'
        : allTypes.has('Product')
          ? 'Product'
          : 'SoftwareApplication';
      findings.push({
        status: 'pass',
        message: `Product markup found. AI engines can include your product in recommendations.`,
        impact: 'low',
      });
    } else {
      findings.push({
        status: 'info',
        message: 'No product markup found. If you sell a product or tool, add it so AI engines can recommend it.',
        impact: 'low',
      });
    }

    // Bonus: 3+ distinct schema types: +2
    if (allTypes.size >= 3) {
      score += 2;
      findings.push({
        status: 'pass',
        message: `Good variety: ${allTypes.size} different types of structured data found across your pages.`,
        impact: 'low',
      });
    }

    // Penalty: malformed JSON-LD: -1 per occurrence
    if (totalMalformed > 0) {
      score -= totalMalformed;
      findings.push({
        status: 'warning',
        message: `${totalMalformed} broken structured data block${totalMalformed !== 1 ? 's' : ''} found. Fix these so AI engines can read them.`,
        impact: 'high',
      });
    }

    // Cap score at 0–15
    score = Math.max(0, Math.min(15, score));

    // ---------- Teaser (1 finding for Light Report) ----------
    let teaser;
    if (score >= 12) {
      teaser = `Solid structured data: ${allTypes.size} types of markup found with good coverage.`;
    } else if (hasAnyJsonLd) {
      teaser = `Some structured data found, but key types are missing.`;
    } else {
      teaser = 'No structured data found. AI engines will struggle to understand your content.';
    }

    return {
      score,
      maxScore: 15,
      findings,
      teaser,
      details: {
        schemas: pageSchemas,
        sameAsLinks,
      },
    };
  } catch (err) {
    return {
      score: 0,
      maxScore: 15,
      findings: [
        {
          status: 'warning',
          message: `Structured data check failed: ${err.message}`,
          impact: 'high',
        },
      ],
      teaser: 'We couldn\'t check structured data on this site.',
      details: { schemas: [], sameAsLinks: [] },
    };
  }
}
