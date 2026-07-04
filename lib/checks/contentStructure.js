/**
 * Category 3: Content Structure & Extractability (20 points max)
 *
 * Evaluates heading hierarchy, question-formatted H2s with direct answers,
 * semantic HTML usage, readability, and word count.
 */

import rs from 'text-readability';

const QUESTION_PATTERN = /^(what|how|why|when|where|which|can|does|is|are|should|will)\b/i;

const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * Strip non-content elements and return plain text from the body.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string}
 */
function extractText($) {
  // Clone so we don't mutate the original
  const $clone = $.root().clone();

  // Remove non-content elements
  $clone.find('script, style, nav, footer, header, noscript, svg, iframe').remove();

  const body = $clone.find('body');
  const text = body.length ? body.text() : $clone.text();

  // Collapse whitespace
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Count words in a string.
 */
function wordCount(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Get all headings from a page in document order with their level and text.
 */
function getHeadings($) {
  const headings = [];
  $(HEADING_LEVELS.join(', ')).each((_i, el) => {
    const tag = $(el).prop('tagName')?.toLowerCase() || '';
    const level = parseInt(tag.replace('h', ''), 10);
    if (level >= 1 && level <= 6) {
      headings.push({ level, text: $(el).text().trim(), el });
    }
  });
  return headings;
}

/**
 * Check if heading hierarchy is valid (no skipped levels).
 * E.g., H1 -> H3 without H2 is invalid.
 */
function isHierarchyValid(headings) {
  if (headings.length === 0) return true;

  let prevLevel = 0;
  for (const h of headings) {
    // Going deeper: allowed to go exactly +1 level at a time
    if (h.level > prevLevel + 1 && prevLevel > 0) {
      return false;
    }
    prevLevel = h.level;
  }
  return true;
}

/**
 * Find question-formatted H2s and check for direct-answer paragraphs
 * (the next <p> sibling after the H2, targeting 40-60 words).
 */
function analyzeQuestionH2s($, headings) {
  const questionH2s = [];

  // We need to find H2 elements in the DOM and check the next paragraph
  $('h2').each((_i, el) => {
    const text = $(el).text().trim();
    if (!QUESTION_PATTERN.test(text)) return;

    // Find the next paragraph element after this H2
    // Walk through next siblings to find the first <p>
    let next = $(el).next();
    let answerWords = 0;
    let hasDirectAnswer = false;

    // Look through the next few siblings for a <p>
    for (let attempts = 0; attempts < 5 && next.length; attempts++) {
      if (next.is('p')) {
        answerWords = wordCount(next.text());
        hasDirectAnswer = answerWords >= 25 && answerWords <= 80;
        break;
      }
      // If we hit another heading, stop looking
      if (next.is('h1, h2, h3, h4, h5, h6')) break;
      next = next.next();
    }

    questionH2s.push({ text, answerWords, hasDirectAnswer });
  });

  return questionH2s;
}

/**
 * Check content structure & extractability across all scanned pages.
 *
 * @param {{ url: string, $: import('cheerio').CheerioAPI, html: string, label: string }[]} pages
 * @returns {{ score: number, maxScore: 20, findings: Array, teaser: string, details: object }}
 */
export function checkContentStructure(pages) {
  try {
    const findings = [];
    let score = 0;

    const pageDetails = [];
    let totalQuestionH2s = 0;
    let totalDirectAnswers = 0;
    let anyTablesFound = false;
    let anySemanticHtml = false;
    const readabilityScores = [];
    const wordCounts = [];
    let h1Issues = [];

    for (const page of pages) {
      const $ = page.$;
      const headings = getHeadings($);
      const text = extractText($);
      const words = wordCount(text);
      wordCounts.push({ label: page.label, words });

      // ---------- H1 count ----------
      const h1Count = headings.filter((h) => h.level === 1).length;
      if (h1Count !== 1) {
        h1Issues.push({ label: page.label, count: h1Count });
      }

      // ---------- Heading hierarchy ----------
      const hierarchyValid = isHierarchyValid(headings);

      // ---------- Question H2s and direct answers ----------
      const questionH2s = analyzeQuestionH2s($, headings);
      totalQuestionH2s += questionH2s.length;
      totalDirectAnswers += questionH2s.filter((q) => q.hasDirectAnswer).length;

      // ---------- Tables ----------
      const tables = $('table').length;
      if (tables > 0) anyTablesFound = true;

      // ---------- Semantic HTML ----------
      const hasArticle = $('article').length > 0;
      const hasSection = $('section').length > 0;
      const hasMain = $('main').length > 0;
      if (hasArticle || hasSection || hasMain) anySemanticHtml = true;

      // ---------- Readability ----------
      let fleschScore = null;
      if (text && words >= 100) {
        try {
          fleschScore = rs.fleschReadingEase(text);
        } catch {
          // text-readability can fail on edge cases
          fleschScore = null;
        }
      }
      if (fleschScore !== null && !isNaN(fleschScore)) {
        readabilityScores.push(fleschScore);
      }

      pageDetails.push({
        label: page.label,
        h1Count,
        hierarchyValid,
        headingCount: headings.length,
        questionH2s: questionH2s.length,
        directAnswers: questionH2s.filter((q) => q.hasDirectAnswer).length,
        tables,
        semanticHtml: { article: hasArticle, section: hasSection, main: hasMain },
        fleschScore,
        wordCount: words,
      });
    }

    // ===================== SCORING =====================

    // H1: Exactly 1 H1 per page: +2
    if (h1Issues.length === 0 && pages.length > 0) {
      score += 2;
      findings.push({
        status: 'pass',
        message: 'Every page has one main heading — good.',
        impact: 'medium',
      });
    } else if (h1Issues.length > 0) {
      for (const issue of h1Issues) {
        findings.push({
          status: 'fail',
          message: issue.count === 0
            ? `${issue.label} page is missing a main heading. Add one.`
            : `${issue.label} page has ${issue.count} main headings. There should be exactly one.`,
          impact: 'medium',
        });
      }
    }

    // Heading hierarchy: +2
    const allHierarchyValid = pageDetails.every((p) => p.hierarchyValid);
    if (allHierarchyValid && pages.length > 0) {
      score += 2;
      findings.push({
        status: 'pass',
        message: 'Headings are properly nested on all pages.',
        impact: 'medium',
      });
    } else {
      const invalid = pageDetails.filter((p) => !p.hierarchyValid);
      for (const p of invalid) {
        findings.push({
          status: 'fail',
          message: `${p.label} page skips heading levels (e.g., jumps from title to sub-sub-heading). Fix the order.`,
          impact: 'medium',
        });
      }
    }

    // Question-formatted H2s: +3 if ≥3 found across all pages
    if (totalQuestionH2s >= 3) {
      score += 3;
      findings.push({
        status: 'pass',
        message: `Found ${totalQuestionH2s} headings phrased as questions. AI engines love to extract these as answers.`,
        impact: 'high',
      });
    } else if (totalQuestionH2s > 0) {
      score += 1;
      findings.push({
        status: 'warning',
        message: `Found ${totalQuestionH2s} question-style heading${totalQuestionH2s !== 1 ? 's' : ''} (3+ is ideal). Phrase more headings as questions your audience asks.`,
        impact: 'high',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'No headings phrased as questions. AI engines prefer content that directly answers common questions.',
        impact: 'high',
      });
    }

    // Direct answer paragraphs: +1 each, max +3
    const directAnswerPoints = Math.min(3, totalDirectAnswers);
    score += directAnswerPoints;
    if (totalDirectAnswers > 0) {
      findings.push({
        status: directAnswerPoints >= 3 ? 'pass' : 'warning',
        message: `${totalDirectAnswers} question${totalDirectAnswers !== 1 ? 's have' : ' has a'} short, direct answer${totalDirectAnswers !== 1 ? 's' : ''} right below — ${directAnswerPoints >= 3 ? 'ideal for AI to quote.' : 'add more for AI to quote.'}`,
        impact: 'high',
      });
    } else if (totalQuestionH2s > 0) {
      findings.push({
        status: 'fail',
        message: 'Your question headings don\'t have short answer paragraphs right below them. Add a 2-3 sentence answer after each.',
        impact: 'high',
      });
    }

    // Comparison tables: +2
    if (anyTablesFound) {
      score += 2;
      findings.push({
        status: 'pass',
        message: 'Tables found. AI engines use these to compare and cite information.',
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'info',
        message: 'No tables found. Adding comparison or data tables gives AI engines structured info to cite.',
        impact: 'low',
      });
    }

    // Semantic HTML: +3
    if (anySemanticHtml) {
      score += 3;
      findings.push({
        status: 'pass',
        message: 'Your pages use clear content sections that help AI engines identify what matters.',
        impact: 'medium',
      });
    } else {
      findings.push({
        status: 'fail',
        message: 'Your pages lack clearly labeled content sections. Adding them helps AI engines find the important parts.',
        impact: 'medium',
      });
    }

    // Flesch Reading Ease: scoring based on average across pages
    if (readabilityScores.length > 0) {
      const avgFlesch = readabilityScores.reduce((a, b) => a + b, 0) / readabilityScores.length;

      if (avgFlesch >= 60 && avgFlesch <= 80) {
        score += 3;
        findings.push({
          status: 'pass',
          message: `Content readability is in the ideal range for AI (score: ${avgFlesch.toFixed(1)}).`,
          impact: 'medium',
        });
      } else if ((avgFlesch >= 50 && avgFlesch < 60) || (avgFlesch > 80 && avgFlesch <= 90)) {
        score += 2;
        findings.push({
          status: 'warning',
          message: `Readability is close to ideal (score: ${avgFlesch.toFixed(1)}). ${avgFlesch < 60 ? 'Simplify your language slightly.' : 'Consider adding more depth.'}`,
          impact: 'medium',
        });
      } else if ((avgFlesch >= 40 && avgFlesch < 50) || (avgFlesch > 90 && avgFlesch <= 100)) {
        score += 1;
        findings.push({
          status: 'warning',
          message: `Readability is outside the ideal range (score: ${avgFlesch.toFixed(1)}). ${avgFlesch < 50 ? 'Your writing may be too complex for AI to summarize.' : 'Your writing may lack depth for the topic.'}`,
          impact: 'medium',
        });
      } else {
        findings.push({
          status: 'fail',
          message: `Readability score is ${avgFlesch.toFixed(1)}. ${avgFlesch < 40 ? 'Your writing is very hard to read — AI engines may struggle to summarize it.' : 'Your writing is very basic — adding substance would help.'}`,
          impact: 'medium',
        });
      }
    } else {
      findings.push({
        status: 'info',
        message: 'Not enough text to measure readability.',
        impact: 'low',
      });
    }

    // Word count: score based on per-page evaluation
    if (wordCounts.length > 0) {
      const pagesWithEnough = wordCounts.filter((p) => p.words >= 300).length;
      const pagesWithSome = wordCounts.filter((p) => p.words >= 150 && p.words < 300).length;
      const pagesWithTooFew = wordCounts.filter((p) => p.words < 150).length;

      // Score based on average behavior: if majority of pages have ≥300, +2; else if majority ≥150, +1
      if (pagesWithEnough >= wordCounts.length / 2) {
        score += 2;
        findings.push({
          status: 'pass',
          message: `${pagesWithEnough} of ${wordCounts.length} page${wordCounts.length !== 1 ? 's have' : ' has'} 300+ words — enough depth for AI to work with.`,
          impact: 'medium',
        });
      } else if (pagesWithEnough + pagesWithSome >= wordCounts.length / 2) {
        score += 1;
        findings.push({
          status: 'warning',
          message: `Only ${pagesWithEnough} of ${wordCounts.length} page${wordCounts.length !== 1 ? 's have' : ' has'} 300+ words. AI engines need substantial content to cite.`,
          impact: 'medium',
        });
      } else {
        findings.push({
          status: 'fail',
          message: `Most pages have very little text. AI engines need at least 300 words per page to cite your content.`,
          impact: 'high',
        });
      }

      // Report thin pages individually
      if (pagesWithTooFew > 0) {
        const thinPages = wordCounts.filter((p) => p.words < 150);
        for (const tp of thinPages) {
          findings.push({
            status: 'warning',
            message: `${tp.label} page has only ${tp.words} words. Expand it so AI engines have enough to work with.`,
            impact: 'medium',
          });
        }
      }
    }

    // Cap score at 0-20
    score = Math.max(0, Math.min(20, score));

    // ---------- Teaser ----------
    let teaser;
    if (score >= 16) {
      teaser = `Content is well-organized for AI (${score}/20).`;
    } else if (score >= 10) {
      teaser = `Content structure is decent (${score}/20), but key improvements would help.`;
    } else {
      teaser = `Content structure needs work (${score}/20). AI engines will struggle to pull useful info from your pages.`;
    }

    return {
      score,
      maxScore: 20,
      findings,
      teaser,
      details: {
        pages: pageDetails,
        totals: {
          questionH2s: totalQuestionH2s,
          directAnswers: totalDirectAnswers,
          avgReadability: readabilityScores.length > 0
            ? +(readabilityScores.reduce((a, b) => a + b, 0) / readabilityScores.length).toFixed(1)
            : null,
          avgWordCount: wordCounts.length > 0
            ? Math.round(wordCounts.reduce((a, b) => a + b.words, 0) / wordCounts.length)
            : 0,
        },
      },
    };
  } catch (err) {
    return {
      score: 0,
      maxScore: 20,
      findings: [
        {
          status: 'warning',
          message: `Content readability check failed: ${err.message}`,
          impact: 'high',
        },
      ],
      teaser: 'We couldn\'t analyze content structure on this site.',
      details: { pages: [], totals: {} },
    };
  }
}
