/**
 * Category 6: Freshness & Publishing Cadence (15 points max)
 *
 * Evaluates how recently content has been published or updated,
 * whether dates are machine-readable, and whether publishing
 * cadence suggests an active, maintained site.
 */

import * as cheerio from 'cheerio';
import { fetchText } from '../fetcher.js';

const MAX_SCORE = 15;

/**
 * Extract datePublished and dateModified from JSON-LD blocks.
 * Returns an array of Date objects (only valid dates).
 */
function extractDatesFromJsonLd($) {
  const dates = [];
  const scripts = $('script[type="application/ld+json"]');

  for (let i = 0; i < scripts.length; i++) {
    try {
      const raw = $(scripts[i]).html();
      if (!raw) continue;

      const data = JSON.parse(raw);
      collectJsonLdDates(data, dates);
    } catch {
      // Malformed JSON-LD — skip
    }
  }

  return dates;
}

/**
 * Recursively collect datePublished and dateModified from JSON-LD data.
 */
function collectJsonLdDates(data, dates) {
  if (!data || typeof data !== 'object') return;

  if (Array.isArray(data)) {
    for (const item of data) {
      collectJsonLdDates(item, dates);
    }
    return;
  }

  // Check @graph arrays
  if (Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      collectJsonLdDates(item, dates);
    }
  }

  // Extract date fields
  for (const field of ['datePublished', 'dateModified', 'dateCreated']) {
    if (typeof data[field] === 'string') {
      const parsed = parseDate(data[field]);
      if (parsed) dates.push({ date: parsed, source: `JSON-LD ${field}`, raw: data[field] });
    }
  }
}

/**
 * Extract dates from article:published_time and article:modified_time meta tags.
 */
function extractDatesFromMeta($) {
  const dates = [];

  const metaTags = [
    { property: 'article:published_time', label: 'article:published_time' },
    { property: 'article:modified_time', label: 'article:modified_time' },
    { name: 'date', label: 'meta[name=date]' },
    { name: 'last-modified', label: 'meta[name=last-modified]' },
  ];

  for (const tag of metaTags) {
    let content;
    if (tag.property) {
      content = $(`meta[property="${tag.property}"]`).attr('content');
    } else if (tag.name) {
      content = $(`meta[name="${tag.name}"]`).attr('content');
    }

    if (content) {
      const parsed = parseDate(content);
      if (parsed) dates.push({ date: parsed, source: tag.label, raw: content });
    }
  }

  return dates;
}

/**
 * Extract dates from <time datetime="..."> elements.
 */
function extractDatesFromTimeElements($) {
  const dates = [];
  const timeElements = $('time[datetime]');

  for (let i = 0; i < timeElements.length; i++) {
    const datetime = $(timeElements[i]).attr('datetime');
    if (datetime) {
      const parsed = parseDate(datetime);
      if (parsed) dates.push({ date: parsed, source: '<time> element', raw: datetime });
    }
  }

  return dates;
}

/**
 * Parse a date string into a Date object. Returns null if invalid.
 */
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;

  try {
    const d = new Date(str.trim());
    // Check for valid date and reasonable range (not in the far future or before 2000)
    if (isNaN(d.getTime())) return null;
    if (d.getFullYear() < 2000 || d.getFullYear() > new Date().getFullYear() + 1) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Calculate the number of days between a date and now.
 */
function daysAgo(date) {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Fetch and parse a single sitemap document. If the document is a sitemap
 * index (references child sitemaps), fetch the children in parallel and
 * merge their <lastmod> dates.
 *
 * Returns null when the URL can't be fetched or the XML can't be parsed,
 * so callers can distinguish "sitemap doesn't exist" from "sitemap exists
 * but has no dates" (the latter returns []).
 */
async function fetchSitemapDocument(url, maxChildren = 5) {
  const result = await fetchText(url);
  if (!result.ok || !result.text) return null;

  let $;
  try {
    $ = cheerio.load(result.text, { xmlMode: true });
  } catch {
    return null;
  }

  const isSitemapIndex = $('sitemapindex').length > 0;
  const isUrlset = $('urlset').length > 0 || $('urlset url').length > 0 || $('url > loc').length > 0;

  if (!isSitemapIndex && !isUrlset) {
    // Valid XML but not a sitemap (e.g. an RSS feed served at /sitemap.xml).
    // Signal "no sitemap here" so the caller tries the next fallback.
    return null;
  }

  if (isSitemapIndex) {
    const childUrls = $('sitemapindex sitemap loc')
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const toFetch = childUrls.slice(0, maxChildren);
    const results = await Promise.all(toFetch.map((u) => fetchSitemapDocument(u, 0)));
    const dates = [];
    for (const r of results) {
      if (r) dates.push(...r);
    }
    return dates;
  }

  const dates = [];
  $('url').each((_i, el) => {
    const loc = $(el).find('loc').text().trim();
    const lastmod = $(el).find('lastmod').text().trim();
    if (lastmod) {
      const parsed = parseDate(lastmod);
      if (parsed) dates.push({ date: parsed, source: 'sitemap lastmod', raw: lastmod, url: loc || null });
    }
  });

  return dates;
}

/**
 * Discover sitemap URLs for a site and return all <lastmod> dates found.
 *
 * Discovery priority:
 *   1. `Sitemap:` directives in robots.txt (authoritative; a site can declare
 *      multiple section-specific sitemaps, so we fetch them all in parallel).
 *   2. Common fallback paths (/sitemap.xml, /sitemap_index.xml,
 *      /sitemap-index.xml) tried in order; first one that loads wins.
 */
async function fetchSitemapDates(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');

  const robotsResult = await fetchText(`${base}/robots.txt`);
  const declared = [];
  if (robotsResult.ok && robotsResult.text) {
    const matches = robotsResult.text.match(/^\s*Sitemap:\s*(\S+)/gim);
    if (matches) {
      for (const line of matches) {
        const url = line.replace(/^\s*Sitemap:\s*/i, '').trim();
        if (url) declared.push(url);
      }
    }
  }

  if (declared.length > 0) {
    const capped = declared.slice(0, 6);
    const results = await Promise.all(capped.map((u) => fetchSitemapDocument(u)));
    const dates = [];
    for (const r of results) {
      if (r) dates.push(...r);
    }
    return dates;
  }

  const fallbacks = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap-index.xml`,
  ];
  for (const url of fallbacks) {
    const r = await fetchSitemapDocument(url);
    if (r !== null) return r;
  }
  return [];
}

/**
 * Collect all dates from a page using all extraction methods.
 */
function collectPageDates($) {
  return [
    ...extractDatesFromJsonLd($),
    ...extractDatesFromMeta($),
    ...extractDatesFromTimeElements($),
  ];
}

/**
 * Find the most recent date from an array of date entries.
 */
function getMostRecent(dates) {
  if (dates.length === 0) return null;
  return dates.reduce((latest, entry) =>
    entry.date.getTime() > latest.date.getTime() ? entry : latest
  );
}

/**
 * Category 6: Freshness & Publishing Cadence (15 points max)
 *
 * Checks for dateModified/datePublished in JSON-LD, visible dates,
 * sitemap lastmod freshness, and blog publishing cadence.
 *
 * @param {Array<{url: string, $: import('cheerio').CheerioAPI, html: string, label: string}>} pages
 * @param {string} baseUrl - The base URL of the site
 * @returns {Promise<{score: number, maxScore: number, findings: Array, teaser: string, details: object}>}
 */
export async function checkFreshness(pages, baseUrl) {
  const findings = [];
  let score = 0;

  const details = {
    jsonLdDates: [],
    metaDates: [],
    timeDates: [],
    sitemapDates: [],
    mostRecentDate: null,
    blogPostDates: [],
    publishingCadence: null,
  };

  let effectiveMax = MAX_SCORE;

  try {
    if (!pages || pages.length === 0) {
      return {
        score: 0,
        maxScore: MAX_SCORE,
        findings: [
          {
            status: 'fail',
            message: 'No pages available to check for freshness signals.',
            impact: 'high',
          },
        ],
        teaser: 'No pages could be scanned for freshness signals.',
        details,
      };
    }

    const now = new Date();

    // ── Collect dates from all pages ─────────────────────────────────

    const allJsonLdDates = [];
    const allMetaDates = [];
    const allTimeDates = [];

    for (const page of pages) {
      const jsonLdDates = extractDatesFromJsonLd(page.$);
      const metaDates = extractDatesFromMeta(page.$);
      const timeDates = extractDatesFromTimeElements(page.$);

      for (const d of jsonLdDates) allJsonLdDates.push({ ...d, pageUrl: page.url, pageLabel: page.label });
      for (const d of metaDates) allMetaDates.push({ ...d, pageUrl: page.url, pageLabel: page.label });
      for (const d of timeDates) allTimeDates.push({ ...d, pageUrl: page.url, pageLabel: page.label });
    }

    details.jsonLdDates = allJsonLdDates;
    details.metaDates = allMetaDates;
    details.timeDates = allTimeDates;

    // ── dateModified in JSON-LD (max +4) ─────────────────────────────

    // Look specifically for dateModified entries
    const modifiedDates = allJsonLdDates.filter((d) =>
      d.source.includes('dateModified') || d.source.includes('datePublished')
    );
    const mostRecentJsonLd = getMostRecent(modifiedDates);

    if (mostRecentJsonLd) {
      const age = daysAgo(mostRecentJsonLd.date);
      details.mostRecentDate = {
        date: mostRecentJsonLd.date.toISOString(),
        daysAgo: age,
        source: mostRecentJsonLd.source,
      };

      if (age <= 90) {
        score += 4;
        findings.push({
          status: 'pass',
          message: `Content was recently updated (${age} day${age !== 1 ? 's' : ''} ago). AI engines favor fresh content.`,
          impact: 'high',
        });
      } else if (age <= 180) {
        score += 2;
        findings.push({
          status: 'warning',
          message: `Content was last updated ${age} days ago. Updating within 90 days signals that your site is active.`,
          impact: 'high',
        });
      } else {
        findings.push({
          status: 'fail',
          message: `Content was last updated ${age} days ago. AI engines strongly prefer recently updated pages.`,
          impact: 'high',
        });
      }
    } else {
      findings.push({
        status: 'fail',
        message: 'No publish or update dates found in your structured data. Add them so AI engines know when content was last updated.',
        impact: 'high',
      });
    }

    // ── Visible dates: <time> elements or meta tags (max +2) ─────────

    const hasVisibleDates = allTimeDates.length > 0 || allMetaDates.length > 0;

    if (hasVisibleDates) {
      score += 2;
      const count = allTimeDates.length + allMetaDates.length;
      findings.push({
        status: 'pass',
        message: `${count} machine-readable date${count > 1 ? 's' : ''} found on your pages. AI engines use these to assess how current your content is.`,
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No machine-readable dates found. Add visible dates so AI engines know your content is current.',
        impact: 'medium',
      });
    }

    // ── Sitemap lastmod (max +2) ─────────────────────────────────────

    const sitemapDates = await fetchSitemapDates(baseUrl);
    details.sitemapDates = [...sitemapDates]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 20)
      .map((d) => ({
        date: d.date.toISOString(),
        raw: d.raw,
      }));

    if (sitemapDates.length > 0) {
      const mostRecentSitemap = getMostRecent(sitemapDates);
      const sitemapAge = daysAgo(mostRecentSitemap.date);

      if (sitemapAge <= 90) {
        score += 2;
        findings.push({
          status: 'pass',
          message: `Your sitemap shows recent updates (${sitemapAge} day${sitemapAge !== 1 ? 's' : ''} ago). This tells AI crawlers your site is actively maintained.`,
          impact: 'medium',
        });
      } else {
        findings.push({
          status: 'warning',
          message: `Your sitemap was last updated ${sitemapAge} days ago. Keep it current so AI crawlers prioritize your content.`,
          impact: 'medium',
        });
      }
    } else {
      findings.push({
        status: 'fail',
        message: 'No sitemap found (or no dates in it). Add one with update dates so AI crawlers know what\'s new.',
        impact: 'medium',
      });
    }

    // ── Blog freshness & cadence (max +4 for recency, +3 for cadence) ─

    // Identify the blog page and collect dates from it
    const blogPage = pages.find((p) => p.label === 'blog');
    let blogPostDates = [];

    if (blogPage) {
      // Collect all dates we can find on the blog page
      // These are typically dates of individual posts visible on a listing page
      const blogDates = collectPageDates(blogPage.$);
      blogPostDates = blogDates
        .map((d) => d.date)
        .sort((a, b) => b.getTime() - a.getTime()); // Most recent first

      // If blog page has no machine-readable dates, use sitemap entries
      // for blog-like URLs as a fallback
      if (blogPostDates.length === 0 && sitemapDates.length > 0) {
        const blogPatterns = ['/blog', '/post', '/article', '/news', '/insight', '/resource'];
        const sitemapBlogDates = sitemapDates
          .filter((d) => d.url && blogPatterns.some((p) => d.url.includes(p)))
          .map((d) => d.date)
          .sort((a, b) => b.getTime() - a.getTime());

        if (sitemapBlogDates.length > 0) {
          blogPostDates = sitemapBlogDates;
        }
      }

      details.blogPostDates = blogPostDates.map((d) => d.toISOString());

      if (blogPostDates.length > 0) {
        const newestPostAge = daysAgo(blogPostDates[0]);

        // Blog posts in last 30 days → +4, in last 90 days → +2
        if (newestPostAge <= 30) {
          score += 4;
          findings.push({
            status: 'pass',
            message: `Blog updated ${newestPostAge} day${newestPostAge !== 1 ? 's' : ''} ago. Active publishing is a strong signal to AI engines.`,
            impact: 'high',
          });
        } else if (newestPostAge <= 90) {
          score += 2;
          findings.push({
            status: 'warning',
            message: `Blog updated ${newestPostAge} days ago. Publishing within the last 30 days sends a stronger signal.`,
            impact: 'high',
          });
        } else {
          findings.push({
            status: 'fail',
            message: `Blog hasn\'t been updated in ${newestPostAge} days. Publish new content regularly to signal activity.`,
            impact: 'high',
          });
        }

        // Monthly cadence bonus: 3+ posts in last 90 days → +3
        const postsInLast90Days = blogPostDates.filter((d) => daysAgo(d) <= 90).length;
        details.publishingCadence = {
          postsInLast90Days,
          postsInLast30Days: blogPostDates.filter((d) => daysAgo(d) <= 30).length,
        };

        if (postsInLast90Days >= 3) {
          score += 3;
          findings.push({
            status: 'pass',
            message: `${postsInLast90Days} post${postsInLast90Days > 1 ? 's' : ''} in the last 90 days. Consistent publishing builds authority with AI engines.`,
            impact: 'medium',
          });
        } else if (postsInLast90Days > 0) {
          findings.push({
            status: 'warning',
            message: `Only ${postsInLast90Days} post${postsInLast90Days > 1 ? 's' : ''} in the last 90 days. Publishing at least monthly would strengthen your signal.`,
            impact: 'medium',
          });
        } else {
          findings.push({
            status: 'fail',
            message: 'No blog posts in the last 90 days. Aim to publish at least once a month.',
            impact: 'medium',
          });
        }
      } else {
        findings.push({
          status: 'warning',
          message: 'Blog found, but no machine-readable dates on posts. Add visible dates to your blog posts.',
          impact: 'high',
        });
      }
    } else {
      effectiveMax -= 7;
      findings.push({
        status: 'info',
        message: 'No blog found. Publishing frequency couldn\'t be checked.',
        impact: 'low',
      });
    }

    // ── Cap score ────────────────────────────────────────────────────

    score = Math.min(score, effectiveMax);

    // ── Build teaser ─────────────────────────────────────────────────

    const teaser = buildTeaser(score, details, blogPage != null, effectiveMax);

    return {
      score,
      maxScore: effectiveMax,
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
          message: `Content freshness check failed: ${err.message}`,
          impact: 'high',
        },
      ],
      teaser: 'We couldn\'t check content freshness on this site.',
      details,
    };
  }
}

/**
 * Builds a single-sentence teaser summarizing freshness signals
 * for the Light Report.
 */
function buildTeaser(score, details, hasBlogPage, effectiveMax = MAX_SCORE) {
  const pct = Math.round((score / effectiveMax) * 100);

  if (pct >= 80) {
    return 'Content is fresh and regularly updated.';
  }

  if (pct >= 50) {
    if (details.mostRecentDate && details.mostRecentDate.daysAgo <= 90) {
      return 'Content is fairly recent, but publishing more often would help.';
    }
    return 'Some freshness signals, but dates and publishing frequency need work.';
  }

  if (pct >= 20) {
    return 'Few freshness signals. Update your content and publish regularly.';
  }

  if (!hasBlogPage) {
    return 'Few freshness signals and no blog. Regular publishing is one of the strongest signals for AI visibility.';
  }

  return 'Very few freshness signals. AI engines strongly prefer sites that publish and update regularly.';
}
