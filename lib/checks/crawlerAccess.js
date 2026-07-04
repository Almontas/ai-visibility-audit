import robotsParser from 'robots-parser';
import { fetchText } from '../fetcher.js';

const MAX_SCORE = 15;

// Search crawlers — these are the ones that power AI search results.
// Each allowed crawler is worth +3 (max +9).
const SEARCH_CRAWLERS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot'];

// Training crawlers — we check if the site owner has explicitly configured
// rules for these (allowed OR blocked). Awareness itself is worth points.
const TRAINING_CRAWLERS = [
  'GPTBot',
  'anthropic-ai',
  'Google-Extended',
  'Meta-ExternalAgent',
  'CCBot',
];

/**
 * Checks whether robots.txt contains a blanket `Disallow: /` for all user-agents
 * by checking if the wildcard (*) agent is disallowed from the site root.
 *
 * NOTE: robots-parser requires full URLs, not bare paths like '/'.
 * Passing bare paths returns undefined which would be falsy — always use full URLs.
 */
function hasBlanketDisallow(robotsTxtContent, baseUrl) {
  if (!robotsTxtContent) return false;

  const robotsTxtUrl = `${baseUrl}/robots.txt`;
  const parser = robotsParser(robotsTxtUrl, robotsTxtContent);
  const result = parser.isAllowed(`${baseUrl}/`, '*');
  // isAllowed returns true/false/undefined — treat undefined as allowed
  return result === false;
}

/**
 * Checks whether a specific crawler is allowed to access the site root.
 * Uses robots-parser which correctly handles user-agent matching and
 * falls back to wildcard (*) rules when a specific agent isn't mentioned.
 *
 * NOTE: robots-parser requires full URLs, not bare paths.
 */
function isCrawlerAllowed(robotsTxtUrl, robotsTxtContent, crawlerName, baseUrl) {
  const parser = robotsParser(robotsTxtUrl, robotsTxtContent);
  const result = parser.isAllowed(`${baseUrl}/`, crawlerName);
  // isAllowed returns true/false/undefined — treat undefined as allowed
  return result !== false;
}

/**
 * Checks whether a crawler is explicitly mentioned in robots.txt
 * (either allowed or blocked — we just want to know if the site owner
 * is aware of it).
 */
function isCrawlerMentioned(robotsTxtContent, crawlerName) {
  if (!robotsTxtContent) return false;

  // Case-insensitive search for the crawler name in User-agent directives
  const lowerContent = robotsTxtContent.toLowerCase();
  const lowerName = crawlerName.toLowerCase();
  return lowerContent.includes(lowerName);
}

/**
 * Category 1: AI Crawler Access (15 points max)
 *
 * Evaluates how well a site's robots.txt and llms.txt files are configured
 * for AI search crawlers and training crawlers.
 *
 * @param {string} baseUrl - The base URL of the site (e.g. "https://example.com")
 * @returns {Promise<{score: number, maxScore: number, findings: Array, teaser: string, details: object}>}
 */
export async function checkCrawlerAccess(baseUrl) {
  const findings = [];
  let score = 0;

  // Normalize base URL — strip trailing slash
  const base = baseUrl.replace(/\/+$/, '');
  const robotsTxtUrl = `${base}/robots.txt`;
  const llmsTxtUrl = `${base}/llms.txt`;
  const llmsFullTxtUrl = `${base}/llms-full.txt`;

  // Details object we'll populate as we go
  const details = {
    robotsTxtExists: false,
    llmsTxtExists: false,
    llmsFullTxtExists: false,
    searchCrawlers: [],
    trainingCrawlers: [],
    robotsTxtContent: null,
  };

  try {
    // Fetch all three files in parallel
    const [robotsResult, llmsResult, llmsFullResult] = await Promise.all([
      fetchText(robotsTxtUrl),
      fetchText(llmsTxtUrl),
      fetchText(llmsFullTxtUrl),
    ]);

    // ── robots.txt analysis ──────────────────────────────────────────

    const robotsTxtExists = robotsResult.ok && robotsResult.text.trim().length > 0;
    details.robotsTxtExists = robotsTxtExists;
    details.robotsTxtContent = robotsTxtExists ? robotsResult.text : null;

    // ── robots.txt existence bonus (+2) ────────────────────────────

    if (robotsTxtExists) {
      score += 2;
      findings.push({
        status: 'pass',
        message: 'robots.txt found — your site has rules controlling which AI crawlers can visit.',
        impact: 'medium',
      });
    }

    // ── Search Crawlers (max +9, +3 per crawler) ────────────────────

    if (robotsTxtExists) {
      const blanketBlock = hasBlanketDisallow(robotsResult.text, base);

      if (blanketBlock) {
        // Blanket Disallow: / — check if specific search crawlers are exempted
        for (const crawler of SEARCH_CRAWLERS) {
          const mentioned = isCrawlerMentioned(robotsResult.text, crawler);
          const allowed = mentioned
            ? isCrawlerAllowed(robotsTxtUrl, robotsResult.text, crawler, base)
            : false; // blanket block, not mentioned = blocked

          details.searchCrawlers.push({ name: crawler, allowed });

          if (allowed) {
            score += 3;
            findings.push({
              status: 'pass',
              message: `${crawler} can access your site.`,
              impact: 'high',
            });
          } else {
            findings.push({
              status: 'fail',
              message: `${crawler} is blocked. Update your robots.txt to allow it.`,
              impact: 'high',
            });
          }
        }
      } else {
        // No blanket block — check each search crawler individually
        for (const crawler of SEARCH_CRAWLERS) {
          const allowed = isCrawlerAllowed(robotsTxtUrl, robotsResult.text, crawler, base);
          details.searchCrawlers.push({ name: crawler, allowed });

          if (allowed) {
            score += 3;
            findings.push({
              status: 'pass',
              message: `${crawler} can access your site.`,
              impact: 'high',
            });
          } else {
            findings.push({
              status: 'fail',
              message: `${crawler} is blocked. Update your robots.txt to allow it.`,
              impact: 'high',
            });
          }
        }
      }
    } else {
      // No robots.txt — crawlers are allowed by default, but partial credit (+5)
      score += 5;

      for (const crawler of SEARCH_CRAWLERS) {
        details.searchCrawlers.push({ name: crawler, allowed: true });
      }

      findings.push({
        status: 'warning',
        message: 'No robots.txt found. AI crawlers can visit by default, but adding one gives you control over which ones.',
        impact: 'medium',
      });
    }

    // ── Training Crawlers (max +3) ──────────────────────────────────

    if (robotsTxtExists) {
      let anyMentioned = false;

      for (const crawler of TRAINING_CRAWLERS) {
        const mentioned = isCrawlerMentioned(robotsResult.text, crawler);
        const allowed = isCrawlerAllowed(robotsTxtUrl, robotsResult.text, crawler, base);

        details.trainingCrawlers.push({ name: crawler, mentioned, allowed });

        if (mentioned) {
          anyMentioned = true;
        }
      }

      if (anyMentioned) {
        // Explicitly configured — shows awareness (+2)
        score += 2;

        const mentionedNames = details.trainingCrawlers
          .filter((c) => c.mentioned)
          .map((c) => c.name);
        const blockedNames = details.trainingCrawlers
          .filter((c) => c.mentioned && !c.allowed)
          .map((c) => c.name);
        const allowedNames = details.trainingCrawlers
          .filter((c) => c.mentioned && c.allowed)
          .map((c) => c.name);

        findings.push({
          status: 'pass',
          message: `Your site has rules for AI training crawlers: ${mentionedNames.join(', ')}.${blockedNames.length > 0 ? ` Blocked: ${blockedNames.join(', ')}.` : ''}${allowedNames.length > 0 ? ` Allowed: ${allowedNames.join(', ')}.` : ''}`,
          impact: 'medium',
        });
      } else {
        // robots.txt exists but no training crawlers mentioned — minimal awareness (+1)
        score += 1;
        findings.push({
          status: 'warning',
          message: 'Your robots.txt doesn\'t address AI training crawlers (like GPTBot or Google-Extended). Add rules to control them.',
          impact: 'medium',
        });
      }
    } else {
      // No robots.txt at all — no awareness of training crawlers (+1)
      score += 1;

      for (const crawler of TRAINING_CRAWLERS) {
        details.trainingCrawlers.push({ name: crawler, mentioned: false, allowed: true });
      }

      findings.push({
        status: 'warning',
        message: 'No robots.txt found. AI training crawlers have unrestricted access to your content.',
        impact: 'medium',
      });
    }

    // ── llms.txt and llms-full.txt (max +2) ─────────────────────────

    const llmsTxtExists = llmsResult.ok && llmsResult.text.trim().length > 0;
    const llmsFullTxtExists = llmsFullResult.ok && llmsFullResult.text.trim().length > 0;

    details.llmsTxtExists = llmsTxtExists;
    details.llmsFullTxtExists = llmsFullTxtExists;

    if (llmsTxtExists && llmsFullTxtExists) {
      score += 2;
      findings.push({
        status: 'pass',
        message: 'llms.txt and llms-full.txt found — AI models have a detailed guide to your site.',
        impact: 'medium',
      });
    } else if (llmsTxtExists) {
      score += 1;
      findings.push({
        status: 'pass',
        message: 'llms.txt found. Consider adding llms-full.txt for a more detailed guide.',
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'info',
        message: 'No llms.txt found. Adding one gives AI models a summary of what your site is about.',
        impact: 'low',
      });
    }

    // ── Cap score at MAX_SCORE ───────────────────────────────────────

    score = Math.min(score, MAX_SCORE);

    // ── Build teaser ─────────────────────────────────────────────────

    const teaser = buildTeaser(score, details);

    return {
      score,
      maxScore: MAX_SCORE,
      findings,
      teaser,
      details,
    };
  } catch (err) {
    // Catastrophic failure — return a zero score with error info
    return {
      score: 0,
      maxScore: MAX_SCORE,
      findings: [
        {
          status: 'fail',
          message: `Crawler access check failed: ${err.message}`,
          impact: 'high',
        },
      ],
      teaser: 'We couldn\'t check crawler access for this site.',
      details,
    };
  }
}

/**
 * Builds a single-sentence teaser summarizing crawler access status
 * for the Light Report.
 */
function buildTeaser(score, details) {
  const pct = Math.round((score / MAX_SCORE) * 100);

  if (!details.robotsTxtExists) {
    return 'No robots.txt found. AI crawlers can access your site, but you have no control over which ones.';
  }

  const allowedSearch = details.searchCrawlers.filter((c) => c.allowed).length;
  const totalSearch = details.searchCrawlers.length;

  if (pct >= 80) {
    return `AI crawlers are well-configured: ${allowedSearch}/${totalSearch} search crawlers can access your site${details.llmsTxtExists ? ' and llms.txt is in place' : ''}.`;
  }

  if (pct >= 50) {
    return `Partial setup: ${allowedSearch}/${totalSearch} AI search crawlers can access your site. ${details.llmsTxtExists ? '' : 'Consider adding llms.txt.'}`.trim();
  }

  if (allowedSearch === 0) {
    return 'AI search crawlers are blocked. Your content likely won\'t appear in AI search results.';
  }

  return `Only ${allowedSearch}/${totalSearch} AI search crawlers can reach your site.`;
}
