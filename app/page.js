'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCAN_STEPS = [
  'Checking AI crawler access...',
  'Analyzing schema & structured data...',
  'Evaluating content structure...',
  'Searching brand presence across platforms...',
  'Reviewing citations & credibility signals...',
  'Checking content freshness & cadence...',
];

const STEP_DELAY_MS = 2500;

const GRADE_COLORS = {
  A: 'var(--grade-a)',
  B: 'var(--grade-b)',
  C: 'var(--grade-c)',
  D: 'var(--grade-d)',
  F: 'var(--grade-f)',
};

const PLATFORM_ICONS = {
  Reddit: 'R',
  Wikipedia: 'W',
  G2: 'G',
  Crunchbase: 'C',
  YouTube: 'Y',
  Quora: 'Q',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url) && !/^\w+:\/\//.test(url)) {
    url = `https://${url}`;
  }
  return url;
}

function getBarClass(percentage) {
  if (percentage >= 70) return 'category__bar-fill--high';
  if (percentage >= 40) return 'category__bar-fill--mid';
  return 'category__bar-fill--low';
}

// ---------------------------------------------------------------------------
// Landing View
// ---------------------------------------------------------------------------

function LandingView({ onScan }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      setError('');

      const trimmed = url.trim();
      if (!trimmed) {
        setError('Please enter a website URL.');
        return;
      }

      const normalized = normalizeUrl(trimmed);
      try {
        new URL(normalized);
      } catch {
        setError('Please enter a valid URL (e.g., example.com).');
        return;
      }

      setSubmitting(true);
      onScan(normalized);
    },
    [url, onScan]
  );

  return (
    <div className="landing">
      <div className="landing__badge">
        <span className="landing__badge-dot" />
        AI Visibility Audit
      </div>

      <h1 className="landing__headline">
        Is Your Website Ready for AI Search?
      </h1>

      <p className="landing__subheadline">
        Get your free AI Visibility Score — see how ChatGPT, Perplexity,
        Claude, and Google AI Overviews see your site.
      </p>

      <form className="landing__form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="landing__input"
          placeholder="Enter your website URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={submitting}
          autoComplete="url"
          spellCheck={false}
        />
        <button
          type="submit"
          className="landing__submit"
          disabled={submitting}
        >
          {submitting ? 'Starting...' : 'Scan My Site'}
        </button>
      </form>

      {error && <div className="landing__error">{error}</div>}

      <p className="landing__trust">
        Free<span>&middot;</span>No signup required
        <span>&middot;</span>Results in 15 seconds
      </p>

      <div className="landing__stats">
        <div className="landing__stat">
          <span className="landing__stat-number">5x</span>
          <span className="landing__stat-text">AI search traffic converts up to 5x higher than organic</span>
        </div>
        <div className="landing__stat">
          <span className="landing__stat-number">527%</span>
          <span className="landing__stat-text">Year-over-year growth in AI-referred traffic</span>
        </div>
        <div className="landing__stat">
          <span className="landing__stat-number">2&ndash;7</span>
          <span className="landing__stat-text">Domains cited per AI response &mdash; is yours one of them?</span>
        </div>
      </div>

      <div className="landing__credit">
        <a
          href="https://github.com/Almontas/ai-visibility-audit"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open source on GitHub
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scanning View
// ---------------------------------------------------------------------------

function ScanningView({ url, completedSteps }) {
  return (
    <div className="scanning">
      <div className="scanning__spinner" />
      <h2 className="scanning__title">Analyzing your website</h2>
      <p className="scanning__url">{url}</p>

      <ul className="scanning__checks">
        {SCAN_STEPS.map((step, i) => {
          const isDone = i < completedSteps;
          const isActive = i === completedSteps;

          let iconClass = 'scanning__check-icon--pending';
          if (isDone) iconClass = 'scanning__check-icon--done';
          else if (isActive) iconClass = 'scanning__check-icon--active';

          let checkClass = 'scanning__check';
          if (isDone) checkClass += ' scanning__check--done';
          else if (isActive) checkClass += ' scanning__check--active';

          return (
            <li key={i} className={checkClass}>
              <span className="scanning__check-icon">
                {isDone ? (
                  <span className="scanning__check-icon--done">&#10003;</span>
                ) : (
                  <span className={iconClass} />
                )}
              </span>
              <span>{isDone ? step.replace('...', '') : step}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report View — Category Card
// ---------------------------------------------------------------------------

function CategoryCard({ category }) {
  return (
    <div className="category">
      <div className="category__header">
        <span className="category__name">{category.name}</span>
        <span className="category__score">
          {category.score}/{category.maxScore} ({category.percentage}%)
        </span>
      </div>
      <div className="category__bar-track">
        <div
          className={`category__bar-fill ${getBarClass(category.percentage)}`}
          style={{ width: `${category.percentage}%` }}
        />
      </div>
      {category.teaser && (
        <p className="category__teaser">{category.teaser}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report View — Brand Presence
// ---------------------------------------------------------------------------

function BrandPresenceSection({ platforms }) {
  if (!platforms || platforms.length === 0) return null;

  return (
    <div className="brand-presence">
      <h3 className="report__section-title">Brand Presence Across Platforms</h3>
      <div className="brand-presence__grid">
        {platforms.map((p) => {
          let iconClass = 'brand-presence__icon--unable';
          let statusClass = 'brand-presence__status--unable';
          let statusText = 'Unable to check';
          let icon = '?';

          if (p.status === 'found') {
            iconClass = 'brand-presence__icon--found';
            statusClass = 'brand-presence__status--found';
            statusText = 'Found';
            icon = '\u2713';
          } else if (p.status === 'not_found') {
            iconClass = 'brand-presence__icon--not-found';
            statusClass = 'brand-presence__status--not-found';
            statusText = 'Not found';
            icon = '\u2717';
          } else {
            icon = '!';
          }

          return (
            <div key={p.name} className="brand-presence__item">
              <div className={`brand-presence__icon ${iconClass}`}>
                {icon}
              </div>
              <div className="brand-presence__info">
                <span className="brand-presence__platform">
                  {PLATFORM_ICONS[p.name] ? '' : ''}{p.name}
                </span>
                <span className={`brand-presence__status ${statusClass}`}>
                  {statusText}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report View — Email Capture
// ---------------------------------------------------------------------------

function EmailCapture({ scanResult }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError('');

      if (!name.trim() || !email.trim() || !company.trim()) {
        setError('All fields are required.');
        return;
      }

      // Basic email validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('Please enter a valid email address.');
        return;
      }

      setSubmitting(true);

      try {
        const res = await fetch('/api/capture-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            company: company.trim(),
            scanResult,
          }),
        });

        const data = await res.json();

        // Store scan result in localStorage as fallback for local dev
        if (scanResult) {
          try {
            localStorage.setItem('scanResult', JSON.stringify(scanResult));
          } catch {
            // localStorage unavailable — ignore
          }
        }

        if (res.ok && data.reportUrl) {
          setSubmitted(true);
          // Redirect to the full report after a brief confirmation
          setTimeout(() => {
            window.location.href = data.reportUrl;
          }, 1500);
        } else {
          // Fallback: show success even if API partially failed
          setSubmitted(true);
        }
      } catch {
        // Fallback for local dev — store to localStorage and redirect
        if (scanResult) {
          try {
            localStorage.setItem('scanResult', JSON.stringify(scanResult));
          } catch {
            // ignore
          }
        }
        setSubmitted(true);
      } finally {
        setSubmitting(false);
      }
    },
    [name, email, company, scanResult]
  );

  if (submitted) {
    return (
      <div className="email-cta">
        <div className="email-cta__success">
          Report ready! Redirecting to your full AI Visibility Report...
        </div>
      </div>
    );
  }

  return (
    <div className="email-cta">
      <h3 className="email-cta__title">
        Want the full report with research-backed recommendations?
      </h3>
      <p className="email-cta__subtitle">
        Get page-by-page breakdowns with research context, prioritized fixes
        ranked by impact, and a custom action plan backed by the Princeton GEO
        study and industry benchmarks.
      </p>

      <form className="email-cta__form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="email-cta__input"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
        />
        <input
          type="email"
          className="email-cta__input"
          placeholder="Work email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />
        <input
          type="text"
          className="email-cta__input"
          placeholder="Company name"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          disabled={submitting}
        />
        {error && <div className="email-cta__error">{error}</div>}
        <button
          type="submit"
          className="email-cta__submit"
          disabled={submitting}
        >
          {submitting ? 'Sending...' : 'Get Full Report'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report View
// ---------------------------------------------------------------------------

function ReportView({ scanResult, onScanAgain }) {
  const [copied, setCopied] = useState(false);

  const { score, url, brandName } = scanResult;
  const { grade, gradeLabel, percentage, categories } = score;

  // Brand presence platforms from category 4 (index 3)
  const brandCategory = categories.find((c) => c.key === 'brandPresence');
  const platforms = brandCategory?.details?.platforms || [];

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: select text
      const textArea = document.createElement('textarea');
      textArea.value = window.location.href;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <div className="report">
      {/* Header */}
      <div className="report__header">
        <button className="report__scan-again" onClick={onScanAgain}>
          &larr; Scan another site
        </button>

        <div className="report__grade-container">
          <div className={`report__grade-badge report__grade-badge--${grade}`}>
            {grade}
          </div>
          <div className="report__grade-label">{gradeLabel}</div>
          <div className="report__grade-score">
            {percentage}% AI Visibility Score
          </div>
        </div>

        <div className="report__meta">
          <div className="report__meta-item">
            <span className="report__meta-label">URL:</span>
            <span className="report__meta-value">{url}</span>
          </div>
          {brandName && (
            <div className="report__meta-item">
              <span className="report__meta-label">Brand:</span>
              <span className="report__meta-value">{brandName}</span>
            </div>
          )}
        </div>
      </div>

      {/* Category Scores */}
      <h3 className="report__section-title">Score Breakdown</h3>
      <div className="categories">
        {categories.map((cat) => (
          <CategoryCard key={cat.key} category={cat} />
        ))}
      </div>

      {/* Brand Presence */}
      <BrandPresenceSection platforms={platforms} />

      {/* Research Callout */}
      <div className="research-callout">
        <div className="research-callout__stat">4&ndash;5x</div>
        <div className="research-callout__text">
          AI-referred traffic converts at 4&ndash;5x the rate of organic search.
          Only 2&ndash;7 domains get cited per AI response.
          <span className="research-callout__emphasis"> Is your site one of them?</span>
        </div>
      </div>

      {/* Email Capture */}
      <EmailCapture scanResult={scanResult} />

      {/* Share */}
      <div className="report__actions">
        <button
          className={`btn--share ${copied ? 'btn--share--copied' : ''}`}
          onClick={handleShare}
        >
          {copied ? '\u2713 Link copied!' : 'Share this report'}
        </button>
      </div>

      {/* Footer */}
      <div className="report__footer">
        <a
          href="https://github.com/Almontas/ai-visibility-audit"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open source on GitHub
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function Home() {
  const [view, setView] = useState('landing'); // 'landing' | 'scanning' | 'report'
  const [scanUrl, setScanUrl] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [completedSteps, setCompletedSteps] = useState(0);

  // Refs to manage the animation/API race
  const apiResultRef = useRef(null);
  const apiDoneRef = useRef(false);
  const animationDoneRef = useRef(false);
  const stepTimersRef = useRef([]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      stepTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  const showReport = useCallback((result) => {
    setScanResult(result);
    setScanError('');
    setView('report');
  }, []);

  const showError = useCallback((errorMsg) => {
    setScanError(errorMsg);
    setView('landing');
  }, []);

  const startScan = useCallback(
    (url) => {
      // Reset state
      setScanUrl(url);
      setScanError('');
      setScanResult(null);
      setCompletedSteps(0);
      apiResultRef.current = null;
      apiDoneRef.current = false;
      animationDoneRef.current = false;
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];

      setView('scanning');

      // Start the API call immediately
      fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (res.status === 429) {
            throw new Error("You've reached the scan limit. Try again in an hour.");
          }
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Scan failed. Please try again.');
          }
          apiResultRef.current = data;
          apiDoneRef.current = true;

          // If animation is already done, show the report
          if (animationDoneRef.current) {
            showReport(data);
          }
        })
        .catch((err) => {
          apiDoneRef.current = true;
          apiResultRef.current = null;

          if (animationDoneRef.current) {
            showError(err.message || 'Something went wrong. Please try again.');
          }
        });

      // Start step animation with theatrical delays
      // Steps 0-4 complete on schedule. Step 5 (last) waits for API if needed.
      for (let i = 0; i < SCAN_STEPS.length; i++) {
        const timer = setTimeout(() => {
          setCompletedSteps(i + 1);

          // After the last step completes
          if (i === SCAN_STEPS.length - 1) {
            // Add a small final pause for polish
            const finishTimer = setTimeout(() => {
              animationDoneRef.current = true;

              if (apiDoneRef.current) {
                if (apiResultRef.current) {
                  showReport(apiResultRef.current);
                } else {
                  showError('Scan failed. Please try again.');
                }
              }
              // If API isn't done yet, the API callback will handle it
            }, 600);
            stepTimersRef.current.push(finishTimer);
          }
        }, STEP_DELAY_MS * (i + 1));

        stepTimersRef.current.push(timer);
      }
    },
    [showReport, showError]
  );

  const handleScanAgain = useCallback(() => {
    setView('landing');
    setScanResult(null);
    setScanUrl('');
    setScanError('');
    setCompletedSteps(0);
    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = [];
  }, []);

  // Render the active view
  if (view === 'scanning') {
    return <ScanningView url={scanUrl} completedSteps={completedSteps} />;
  }

  if (view === 'report' && scanResult) {
    return <ReportView scanResult={scanResult} onScanAgain={handleScanAgain} />;
  }

  // Default: landing
  return (
    <>
      <LandingView onScan={startScan} />
      {scanError && (
        <div
          style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '480px',
            width: '90%',
            zIndex: 100,
          }}
        >
          <div className="landing__error">{scanError}</div>
        </div>
      )}
    </>
  );
}
