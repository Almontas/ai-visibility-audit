# AI Visibility Audit

A free, self-hostable AEO/GEO audit tool. Enter any URL and get a scored report on how ready that site is for AI-powered search: ChatGPT, Perplexity, Claude, and Google AI Overviews.

Built with Next.js. No login, no build-time config: paste a URL, get a grade, see exactly what to fix. Optionally it asks the major LLMs directly what they know about the brand and shows their answers in the report.

## What it checks

The scan fetches the homepage (and auto-detects a blog page), then runs 6 scored checks plus 1 display-only check in parallel:

| Category | Max points | What it looks at |
|---|---|---|
| Crawler Access | 15 | robots.txt rules for GPTBot, ClaudeBot, PerplexityBot and friends; llms.txt; sitemap |
| Structured Data | 15 | JSON-LD schema types (FAQPage, Article, Organization...) on homepage and blog |
| Content Readability | 20 | Heading hierarchy, lists and tables, Q&A patterns, readability score, paragraph density |
| Brand Footprint | 20 | Whether the brand appears on the third-party sites AI engines actually cite |
| Trust Signals | 15 | Outbound citations, statistics, author bylines, credibility markers |
| Content Freshness | 15 | Publish/modified dates, blog cadence, stale content |
| LLM Visibility | display-only | Asks ChatGPT, Claude, Perplexity, and Gemini "What is {brand}?" and classifies each answer as known / partial / unknown |

Scores aggregate to a 0-100 percentage and an A-F grade, plus a prioritized action plan of the highest-impact fixes. The grading logic lives in [lib/scoring.js](lib/scoring.js); each check is a self-contained module in [lib/checks/](lib/checks/).

## Quickstart

```sh
git clone https://github.com/Almontas/ai-visibility-audit
cd ai-visibility-audit
npm install
npm run dev
```

Open http://localhost:3000 and scan a site. That's it: with zero configuration the report renders from localStorage.

## Optional integrations

Copy `.env.example` to `.env.local` and add keys for the features you want:

- **Supabase** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`): persistent, shareable report links (`/report/<id>`), 24h scan caching, IP rate limiting (5 scans/hour), and lead storage. Create the tables by pasting [supabase/schema.sql](supabase/schema.sql) into the Supabase SQL Editor.
- **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`): emails the report link after the email-gate form.
- **LLM keys** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GOOGLE_AI_API_KEY`): enables the "What AI Engines Say About You" report section. Each key enables one provider; the check queries them in parallel with a 5s timeout each and skips missing keys. Cost per scan is fractions of a cent (300 max tokens per provider).
- **CTA** (`NEXT_PUBLIC_CTA_URL`, `NEXT_PUBLIC_CTA_LABEL`, `NEXT_PUBLIC_CTA_TEXT`): shows a call-to-action block on the report page. Point it at your booking page or contact form. Hidden when unset.

## Architecture

```
app/page.js                  Landing + scanning + teaser report (single-page flow)
app/api/scan/route.js        POST { url } → runs all checks → full scored JSON
app/api/capture-lead/route.js POST → saves lead, persists scan, emails report link
app/api/report/[id]/route.js GET → fetches a stored report by id
app/report/[id]/page.js      Full report UI

lib/fetcher.js               Fetch + cheerio parse with timeouts
lib/pageDetector.js          Blog page auto-detection (nav links, sitemap, common paths)
lib/brandExtractor.js        Brand name extraction from title/OG/schema
lib/checks/*.js              One module per check category
lib/scoring.js               Aggregation, grading, action plan
lib/db.js                    Supabase persistence (no-ops without keys)
lib/email.js                 Report email via Resend (no-op without key)
```

Design decisions worth knowing:

- **Every dependency degrades gracefully.** No Supabase: reports fall back to localStorage. No Resend: the report URL is still returned in the UI. No LLM keys: the section is hidden. `Promise.allSettled` wraps every check, so one failing category zeroes out instead of failing the scan.
- **Scan versioning.** `SCAN_VERSION` in lib/db.js invalidates cached scans when scoring logic changes. Bump it when you edit checks.
- **SSRF protection.** The scan endpoint rejects localhost and private-range IPs and only allows http/https.
- **Serverless-friendly.** The scan route sets `maxDuration = 30` for Vercel; all checks run in parallel and each has its own timeout.

## Deploying

Deploys as a standard Next.js app on Vercel (or anywhere Next runs). Set the env vars from `.env.example` in your hosting dashboard. The URL in `SITE_URL` is used for links in report emails.

## License

MIT
