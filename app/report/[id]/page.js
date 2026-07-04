'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Status icon + color mapping
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  pass: { icon: '\u2713', color: '#22c55e', label: 'Pass' },
  fail: { icon: '\u2717', color: '#ef4444', label: 'Fail' },
  warning: { icon: '\u26A0', color: '#eab308', label: 'Warning' },
  info: { icon: '\u2139', color: '#3b82f6', label: 'Info' },
};

const IMPACT_CONFIG = {
  high: { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: 'High' },
  medium: { color: '#f97316', bg: 'rgba(249,115,22,0.15)', label: 'Med' },
  low: { color: '#9ca3af', bg: 'rgba(156,163,175,0.15)', label: 'Low' },
};

const GRADE_COLORS = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
};

// Research-backed insights per category — static, no backend change needed
const CATEGORY_INSIGHTS = {
  crawlerAccess: {
    text: 'AI crawler traffic is up 305% year over year. Visitors from AI search convert at 4\u20135\u00d7 the rate of traditional search.',
    source: 'Playwire, RankScience',
  },
  schema: {
    text: 'Sites with proper behind-the-scenes markup get cited 2.8\u00d7 more often. Only 10.5% of cited pages have FAQ markup in place.',
    source: 'AirOps',
  },
  contentStructure: {
    text: 'Tables (34%), Q&A content (29%), and lists (21%) far outperform plain paragraphs (3%) when AI engines decide what to cite.',
    source: 'Opollo, Princeton GEO Study',
  },
  brandPresence: {
    text: '85% of the time AI cites a brand, the source is a third-party site, not the brand\u2019s own website. Wikipedia appears in 47.9% of ChatGPT answers.',
    source: 'Opollo, AirOps, Frase',
  },
  citations: {
    text: 'Adding real numbers and credible sources to your pages boosts AI visibility by 30\u201340%. The effect is strongest for smaller sites (+115%).',
    source: 'Princeton/Georgia Tech GEO Study',
  },
  freshness: {
    text: '76.4% of top-cited pages were updated within 30 days. Pages not updated in 3+ months are 3\u00d7 more likely to lose their citations.',
    source: 'Getpassionfruit',
  },
};

// ---------------------------------------------------------------------------
// Full Report Page Component
// ---------------------------------------------------------------------------

export default function FullReportPage() {
  const params = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copyTooltip, setCopyTooltip] = useState(false);

  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      // Primary: fetch from API (works for share links, incognito, etc.)
      try {
        const res = await fetch(`/api/report/${params.id}`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            setData(json);
            setLoading(false);
          }
          return;
        }
        if (res.status === 410) {
          if (!cancelled) {
            setExpired(true);
            setLoading(false);
          }
          return;
        }
      } catch {
        // API unavailable — fall through to localStorage
      }

      // Fallback: try localStorage (local dev without Supabase)
      try {
        const stored = localStorage.getItem('scanResult');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (!cancelled) setData(parsed);
        }
      } catch {
        // Corrupted localStorage — leave data null
      }

      if (!cancelled) setLoading(false);
    }

    loadReport();
    return () => { cancelled = true; };
  }, [params.id]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyTooltip(true);
      setTimeout(() => setCopyTooltip(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = window.location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopyTooltip(true);
      setTimeout(() => setCopyTooltip(false), 2000);
    }
  };

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Loading report...</p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // No data state
  // -------------------------------------------------------------------------

  if (expired) {
    return (
      <div style={styles.page}>
        <div style={styles.notFoundContainer}>
          <div style={{ ...styles.notFoundIcon, borderColor: '#f97316', color: '#f97316' }}>!</div>
          <h1 style={styles.notFoundTitle}>Report Expired</h1>
          <p style={styles.notFoundText}>
            This report has expired. Scan your site again for a fresh report
            with up-to-date results.
          </p>
          <a href="/" style={styles.backLink}>
            Run a New Scan
          </a>
        </div>
      </div>
    );
  }

  if (!data || !data.score) {
    return (
      <div style={styles.page}>
        <div style={styles.notFoundContainer}>
          <div style={styles.notFoundIcon}>?</div>
          <h1 style={styles.notFoundTitle}>Report Not Found</h1>
          <p style={styles.notFoundText}>
            This report may have expired or the scan data is no longer available.
          </p>
          <a href="/" style={styles.backLink}>
            Run a new scan
          </a>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main report render
  // -------------------------------------------------------------------------

  const { url, brandName, blogPage, score, llmVisibility, scannedAt, expiresAt } = data;
  const {
    percentage,
    grade,
    gradeLabel,
    categories,
    actionPlan,
  } = score;

  const gradeColor = GRADE_COLORS[grade] || '#9ca3af';
  const scannedDate = scannedAt
    ? new Date(scannedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Unknown';

  // Compute days until expiry
  let daysLeft = 30;
  if (expiresAt) {
    const diff = new Date(expiresAt) - new Date();
    daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return (
    <div style={styles.page}>
      {/* Expiry Banner */}
      <div style={styles.expiryBanner}>
        <span style={styles.expiryIcon}>&#9203;</span>
        {daysLeft > 0
          ? `Report expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Share or bookmark this link to access it later.`
          : 'This report is about to expire. Run a new scan for fresh results.'}
      </div>

      <div style={styles.container}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.headerTop}>
            <div style={styles.gradeSection}>
              <div
                style={{
                  ...styles.gradeBadge,
                  borderColor: gradeColor,
                  color: gradeColor,
                }}
              >
                {grade}
              </div>
              <div style={styles.gradeDetails}>
                <span style={styles.percentage}>{percentage}/100</span>
                <span style={{ ...styles.gradeLabel, color: gradeColor }}>
                  {gradeLabel}
                </span>
              </div>
            </div>
            <div style={styles.shareSection}>
              <button
                onClick={handleShare}
                style={styles.shareButton}
                title="Copy report URL"
              >
                {copyTooltip ? 'Copied!' : 'Share Report'}
              </button>
            </div>
          </div>
          <div style={styles.headerMeta}>
            <div style={styles.metaRow}>
              <span style={styles.metaLabel}>URL Scanned</span>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.metaValueLink}
              >
                {url}
              </a>
            </div>
            {brandName && (
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Brand</span>
                <span style={styles.metaValue}>{brandName}</span>
              </div>
            )}
            <div style={styles.metaRow}>
              <span style={styles.metaLabel}>Scanned</span>
              <span style={styles.metaValue}>{scannedDate}</span>
            </div>
            {blogPage && (
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Blog Page</span>
                <span style={styles.metaValue}>
                  {blogPage.found ? blogPage.url : 'Not Detected'}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Category Sections */}
        <section style={styles.categoriesSection}>
          <h2 style={styles.sectionTitle}>Detailed Findings</h2>
          {categories.map((cat, idx) => (
            <CategorySection key={cat.key || idx} category={cat} />
          ))}
        </section>

        {/* LLM Visibility — display-only, present when the scan ran with LLM API keys */}
        {llmVisibility && llmVisibility.llms && llmVisibility.llms.length > 0 && (
          <section style={styles.categoriesSection}>
            <h2 style={styles.sectionTitle}>What AI Engines Say About You</h2>
            <p style={styles.actionSubtitle}>{llmVisibility.summary}</p>
            {llmVisibility.llms.map((llm, idx) => {
              const dotColor =
                llm.status === 'known' ? '#22c55e'
                : llm.status === 'partial' ? '#eab308'
                : llm.status === 'error' ? '#ef4444'
                : '#71717a';
              const statusText =
                llm.status === 'known' ? 'Recognizes your brand'
                : llm.status === 'partial' ? 'Has limited awareness'
                : llm.status === 'unknown' ? 'Does not recognize your brand'
                : llm.status === 'skipped' ? 'Not checked'
                : 'Check failed';
              return (
                <div key={llm.provider || idx} style={llmStyles.card}>
                  <div style={llmStyles.cardHeader}>
                    <span style={{ ...llmStyles.dot, backgroundColor: dotColor }} />
                    <span style={llmStyles.provider}>{llm.provider}</span>
                    <span style={llmStyles.model}>{llm.model}</span>
                    <span style={{ ...llmStyles.status, color: dotColor }}>{statusText}</span>
                  </div>
                  {llm.response && (
                    <div style={llmStyles.responseBox}>
                      <p style={llmStyles.responseText}>&ldquo;{llm.response}&rdquo;</p>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Action Plan */}
        {actionPlan && actionPlan.length > 0 && (
          <section style={styles.actionSection}>
            <h2 style={styles.sectionTitle}>Priority Action Plan</h2>
            <p style={styles.actionSubtitle}>
              Top fixes ranked by impact to improve your AI visibility score.
            </p>
            <ol style={styles.actionList}>
              {actionPlan.map((item, idx) => {
                const impact = IMPACT_CONFIG[item.impact] || IMPACT_CONFIG.low;
                const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.info;
                return (
                  <li key={idx} style={styles.actionItem}>
                    <div style={styles.actionNumber}>{idx + 1}</div>
                    <div style={styles.actionContent}>
                      <div style={styles.actionHeader}>
                        <span
                          style={{
                            ...styles.impactBadge,
                            color: impact.color,
                            backgroundColor: impact.bg,
                          }}
                        >
                          {impact.label}
                        </span>
                        <span style={styles.actionCategory}>{item.category}</span>
                        <span style={{ color: statusCfg.color, fontSize: '14px' }}>
                          {statusCfg.icon}
                        </span>
                      </div>
                      <p style={styles.actionMessage}>{item.message}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* Optional CTA — set NEXT_PUBLIC_CTA_URL to enable */}
        {process.env.NEXT_PUBLIC_CTA_URL && (
          <section style={styles.ctaSection}>
            <div style={styles.ctaContent}>
              <h2 style={styles.ctaTitle}>Ready to improve your AI visibility?</h2>
              <p style={styles.ctaText}>
                {process.env.NEXT_PUBLIC_CTA_TEXT ||
                  'Get in touch and we will walk you through your results.'}
              </p>
              <a
                href={process.env.NEXT_PUBLIC_CTA_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.ctaButton}
              >
                {process.env.NEXT_PUBLIC_CTA_LABEL || 'Get in Touch'}
              </a>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer style={styles.footer}>
          <p style={styles.footerText}>
            <a
              href="https://github.com/Almontas/ai-visibility-audit"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.footerLink}
            >
              AI Visibility Audit
            </a>
            {' '}(open source)
          </p>
          <p style={styles.footerSubtext}>
            Report ID: {params.id}
          </p>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategorySection — collapsible details/summary for each scoring category
// ---------------------------------------------------------------------------

function CategorySection({ category }) {
  const { name, key, score, maxScore, percentage, findings } = category;
  const insight = CATEGORY_INSIGHTS[key];

  const barColor =
    percentage >= 80
      ? '#22c55e'
      : percentage >= 60
      ? '#84cc16'
      : percentage >= 40
      ? '#eab308'
      : percentage >= 20
      ? '#f97316'
      : '#ef4444';

  return (
    <details style={styles.categoryDetails}>
      <summary style={styles.categorySummary}>
        <div style={styles.categoryHeader}>
          <div style={styles.categoryLeft}>
            <span style={styles.categoryName}>{name}</span>
            <span style={styles.categoryScore}>
              {score}/{maxScore} pts
            </span>
          </div>
          <div style={styles.categoryRight}>
            <span style={styles.categoryPercentage}>{percentage}%</span>
            <div style={styles.progressBarOuter}>
              <div
                style={{
                  ...styles.progressBarInner,
                  width: `${percentage}%`,
                  backgroundColor: barColor,
                }}
              />
            </div>
          </div>
        </div>
      </summary>
      <div style={styles.findingsContainer}>
        {insight && (
          <div style={styles.researchInsight}>
            <span style={styles.researchInsightLabel}>Research Insight</span>
            <p style={styles.researchInsightText}>{insight.text}</p>
            <span style={styles.researchInsightSource}>Source: {insight.source}</span>
          </div>
        )}
        {findings && findings.length > 0 ? (
          findings.map((finding, idx) => (
            <FindingRow key={idx} finding={finding} />
          ))
        ) : (
          <p style={styles.noFindings}>No findings for this category.</p>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// FindingRow — individual finding with status icon + impact badge
// ---------------------------------------------------------------------------

function FindingRow({ finding }) {
  const statusCfg = STATUS_CONFIG[finding.status] || STATUS_CONFIG.info;
  const impact = finding.impact
    ? IMPACT_CONFIG[finding.impact] || IMPACT_CONFIG.low
    : null;

  return (
    <div style={styles.findingRow}>
      <span
        style={{
          ...styles.findingIcon,
          color: statusCfg.color,
        }}
        title={statusCfg.label}
      >
        {statusCfg.icon}
      </span>
      <span style={{ ...styles.findingMessage, color: statusCfg.color }}>
        {finding.message}
      </span>
      {impact && (
        <span
          style={{
            ...styles.impactBadge,
            color: impact.color,
            backgroundColor: impact.bg,
          }}
        >
          {impact.label}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0a',
    color: '#ededed',
    fontFamily: 'var(--font-geist-sans), system-ui, -apple-system, sans-serif',
  },

  // Expiry Banner
  expiryBanner: {
    backgroundColor: 'rgba(234,179,8,0.1)',
    borderBottom: '1px solid rgba(234,179,8,0.25)',
    color: '#eab308',
    textAlign: 'center',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    position: 'sticky',
    top: 0,
    zIndex: 100,
    backdropFilter: 'blur(8px)',
  },
  expiryIcon: {
    marginRight: '8px',
  },

  // Container
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '40px 24px 60px',
  },

  // Header
  header: {
    marginBottom: '48px',
  },
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  gradeSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  gradeBadge: {
    width: '80px',
    height: '80px',
    borderRadius: '16px',
    border: '3px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '40px',
    fontWeight: 700,
    flexShrink: 0,
  },
  gradeDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  percentage: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#ededed',
  },
  gradeLabel: {
    fontSize: '16px',
    fontWeight: 500,
  },
  shareSection: {
    display: 'flex',
    alignItems: 'flex-start',
  },
  shareButton: {
    padding: '10px 20px',
    backgroundColor: 'transparent',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#ededed',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
  },
  headerMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '20px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  metaRow: {
    display: 'flex',
    gap: '12px',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  metaLabel: {
    color: '#888',
    minWidth: '100px',
    flexShrink: 0,
    fontWeight: 500,
  },
  metaValue: {
    color: '#ccc',
    wordBreak: 'break-all',
  },
  metaValueLink: {
    color: '#3b82f6',
    wordBreak: 'break-all',
    textDecoration: 'none',
  },

  // Categories Section
  categoriesSection: {
    marginBottom: '48px',
  },
  sectionTitle: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#ededed',
    marginBottom: '20px',
    paddingBottom: '12px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },

  // Category Details/Summary
  categoryDetails: {
    marginBottom: '12px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  categorySummary: {
    padding: '16px 20px',
    cursor: 'pointer',
    listStyle: 'none',
    userSelect: 'none',
  },
  categoryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
  },
  categoryLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
  },
  categoryName: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#ededed',
  },
  categoryScore: {
    fontSize: '13px',
    color: '#888',
    fontWeight: 400,
  },
  categoryRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: '180px',
  },
  categoryPercentage: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#ccc',
    minWidth: '36px',
    textAlign: 'right',
  },
  progressBarOuter: {
    width: '120px',
    height: '6px',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: '3px',
    overflow: 'hidden',
    flexShrink: 0,
  },
  progressBarInner: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.5s ease-out',
  },

  // Findings
  findingsContainer: {
    padding: '0 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  findingRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: '8px',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  findingIcon: {
    fontSize: '14px',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: '2px',
    width: '18px',
    textAlign: 'center',
  },
  findingMessage: {
    flex: 1,
  },
  noFindings: {
    color: '#666',
    fontSize: '14px',
    fontStyle: 'italic',
    padding: '8px 0',
  },
  researchInsight: {
    padding: '12px 14px',
    backgroundColor: 'rgba(59, 130, 246, 0.06)',
    border: '1px solid rgba(59, 130, 246, 0.12)',
    borderRadius: '8px',
    marginBottom: '4px',
  },
  researchInsightLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#3b82f6',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    display: 'block',
    marginBottom: '4px',
  },
  researchInsightText: {
    fontSize: '13px',
    color: '#ccc',
    lineHeight: '1.5',
    margin: 0,
  },
  researchInsightSource: {
    fontSize: '11px',
    color: '#666',
    marginTop: '4px',
    display: 'block',
  },

  // Impact Badge
  impactBadge: {
    fontSize: '11px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },

  // Action Plan
  actionSection: {
    marginBottom: '48px',
  },
  actionSubtitle: {
    color: '#888',
    fontSize: '15px',
    marginBottom: '20px',
    lineHeight: '1.5',
  },
  actionList: {
    listStyle: 'none',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  actionItem: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
    padding: '16px 20px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  actionNumber: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
    color: '#ededed',
    flexShrink: 0,
  },
  actionContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  actionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  actionCategory: {
    fontSize: '13px',
    color: '#888',
    fontWeight: 500,
  },
  actionMessage: {
    fontSize: '14px',
    color: '#ccc',
    lineHeight: '1.5',
  },

  // CTA Section
  ctaSection: {
    marginBottom: '48px',
    background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(147,51,234,0.1) 100%)',
    borderRadius: '16px',
    border: '1px solid rgba(59,130,246,0.2)',
    overflow: 'hidden',
  },
  ctaContent: {
    padding: '48px 32px',
    textAlign: 'center',
  },
  ctaTitle: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ededed',
    marginBottom: '12px',
  },
  ctaText: {
    fontSize: '16px',
    color: '#aaa',
    lineHeight: '1.6',
    maxWidth: '500px',
    margin: '0 auto 24px',
  },
  ctaButton: {
    display: 'inline-block',
    padding: '14px 32px',
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 600,
    borderRadius: '10px',
    textDecoration: 'none',
    transition: 'all 0.2s',
  },

  // Footer
  footer: {
    textAlign: 'center',
    padding: '24px 0',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  footerText: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '4px',
  },
  footerLink: {
    color: '#3b82f6',
    textDecoration: 'none',
  },
  footerSubtext: {
    fontSize: '12px',
    color: '#444',
    fontFamily: 'var(--font-geist-mono), monospace',
  },

  // Loading
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '16px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid rgba(255,255,255,0.1)',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    fontSize: '16px',
    color: '#888',
  },

  // Not Found
  notFoundContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '16px',
    padding: '24px',
    textAlign: 'center',
  },
  notFoundIcon: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    border: '2px solid #444',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '32px',
    color: '#666',
  },
  notFoundTitle: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ededed',
  },
  notFoundText: {
    fontSize: '16px',
    color: '#888',
    maxWidth: '400px',
    lineHeight: '1.5',
  },
  backLink: {
    display: 'inline-block',
    marginTop: '8px',
    padding: '12px 24px',
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    borderRadius: '8px',
    textDecoration: 'none',
  },
};

// ---------------------------------------------------------------------------
// LLM visibility section styles
// ---------------------------------------------------------------------------

const llmStyles = {
  card: {
    backgroundColor: '#141414',
    border: '1px solid #262626',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '12px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  provider: {
    fontWeight: 600,
    color: '#ededed',
    fontSize: '15px',
  },
  model: {
    color: '#71717a',
    fontSize: '12px',
    fontFamily: 'var(--font-geist-mono), monospace',
  },
  status: {
    marginLeft: 'auto',
    fontSize: '13px',
    fontWeight: 500,
  },
  responseBox: {
    backgroundColor: '#0a0a0a',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '12px',
  },
  responseText: {
    color: '#a1a1aa',
    fontSize: '14px',
    lineHeight: 1.6,
    fontStyle: 'italic',
    margin: 0,
  },
};
