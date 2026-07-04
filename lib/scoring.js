/**
 * scoring.js — Aggregates results from 6 check categories into a final score.
 *
 * Grade scale:
 *   A = 80-100 (Excellent)
 *   B = 65-79  (Strong)
 *   C = 45-64  (Fair)
 *   D = 30-44  (Weak)
 *   F = 0-29   (Poor)
 */

const CATEGORY_META = [
  { name: 'Crawler Access', key: 'crawlerAccess' },
  { name: 'Structured Data', key: 'schema' },
  { name: 'Content Readability', key: 'contentStructure' },
  { name: 'Brand Footprint', key: 'brandPresence' },
  { name: 'Trust Signals', key: 'citations' },
  { name: 'Content Freshness', key: 'freshness' },
];

const GRADE_THRESHOLDS = [
  { min: 80, grade: 'A', label: 'Excellent' },
  { min: 65, grade: 'B', label: 'Strong' },
  { min: 45, grade: 'C', label: 'Fair' },
  { min: 30, grade: 'D', label: 'Weak' },
  { min: 0, grade: 'F', label: 'Poor' },
];

const IMPACT_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Determine letter grade and label from a percentage score.
 */
function getGrade(percentage) {
  for (const threshold of GRADE_THRESHOLDS) {
    if (percentage >= threshold.min) {
      return { grade: threshold.grade, gradeLabel: threshold.label };
    }
  }
  // Fallback (should never reach here since min is 0)
  return { grade: 'F', gradeLabel: 'Poor' };
}

/**
 * Aggregate results from all 6 check categories into a final report object.
 *
 * @param {Object} results - Keys: crawlerAccess, schema, contentStructure,
 *   brandPresence, citations, freshness. Each value has
 *   { score, maxScore, findings, teaser, details }.
 * @param {boolean} blogDetected - Whether a blog page was found.
 * @returns {Object} Aggregated scoring output (see module docs).
 */
function aggregateScores(results, blogDetected) {
  try {
    let totalScore = 0;
    let totalMaxScore = 0;
    const categories = [];
    const teaserFindings = [];
    const allFindings = [];

    for (const meta of CATEGORY_META) {
      const result = results[meta.key] || {
        score: 0,
        maxScore: 0,
        findings: [],
        teaser: null,
        details: {},
      };

      const score = typeof result.score === 'number' ? result.score : 0;
      const maxScore = typeof result.maxScore === 'number' ? result.maxScore : 0;
      const findings = Array.isArray(result.findings) ? result.findings : [];
      const teaser = result.teaser || null;
      const details = result.details || {};

      const categoryPercentage =
        maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

      totalScore += score;
      totalMaxScore += maxScore;

      categories.push({
        name: meta.name,
        key: meta.key,
        score,
        maxScore,
        percentage: categoryPercentage,
        teaser,
        findings,
        details,
      });

      // One teaser finding per category for the Light Report
      if (teaser) {
        teaserFindings.push({
          category: meta.name,
          message: teaser,
        });
      }

      // Flatten all findings with category annotation
      for (const finding of findings) {
        allFindings.push({
          ...finding,
          category: meta.name,
        });
      }
    }

    const percentage =
      totalMaxScore > 0
        ? Math.round((totalScore / totalMaxScore) * 100)
        : 0;

    const { grade, gradeLabel } = getGrade(percentage);

    // Action plan: top 5 highest-impact fail/warning findings
    const actionable = allFindings.filter(
      (f) => f.status === 'fail' || f.status === 'warning'
    );

    actionable.sort((a, b) => {
      const aOrder =
        IMPACT_ORDER[a.impact] !== undefined ? IMPACT_ORDER[a.impact] : 3;
      const bOrder =
        IMPACT_ORDER[b.impact] !== undefined ? IMPACT_ORDER[b.impact] : 3;
      return aOrder - bOrder;
    });

    const actionPlan = actionable.slice(0, 5).map((f) => ({
      category: f.category,
      message: f.message,
      impact: f.impact || 'low',
      status: f.status,
    }));

    return {
      totalScore,
      totalMaxScore,
      percentage,
      grade,
      gradeLabel,
      categories,
      teaserFindings,
      allFindings,
      actionPlan,
    };
  } catch (_err) {
    // Never throws — return a safe default on any unexpected error
    return {
      totalScore: 0,
      totalMaxScore: 0,
      percentage: 0,
      grade: 'F',
      gradeLabel: 'Poor',
      categories: [],
      teaserFindings: [],
      allFindings: [],
      actionPlan: [],
    };
  }
}

export { aggregateScores };
