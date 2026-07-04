import { Resend } from 'resend';

// Email delivery is optional. Without RESEND_API_KEY the tool still works;
// the report URL is returned in the API response and shown in the UI.
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM || 'AI Visibility Audit <audit@example.com>';
const SITE = process.env.SITE_URL || 'http://localhost:3000';

const GRADE_COLORS = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
};

/**
 * Report delivery email, sent right after the email gate.
 *
 * @param {string} to        - Recipient email
 * @param {string} name      - Recipient name
 * @param {string} reportUrl - Relative report path, e.g. /report/<id>
 * @param {string} brandName - Scanned brand name (may be null)
 * @param {string} grade     - Letter grade A-F
 */
export async function sendReportEmail(to, name, reportUrl, brandName, grade) {
  if (!resend) return;

  const fullUrl = `${SITE}${reportUrl}`;
  const gradeColor = GRADE_COLORS[grade] || '#6b7280';
  const firstName = (name || '').split(' ')[0] || 'there';
  const siteLabel = brandName || 'your site';

  await resend.emails.send({
    from: FROM,
    to,
    subject: `Your AI visibility report for ${siteLabel} is ready`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111827">
        <p style="font-size:16px;line-height:1.6">Hi ${firstName},</p>
        <p style="font-size:16px;line-height:1.6">
          Your AI visibility audit for <strong>${siteLabel}</strong> is ready.
          Overall grade:
          <span style="display:inline-block;padding:2px 10px;border-radius:6px;background:${gradeColor};color:#fff;font-weight:700">${grade}</span>
        </p>
        <p style="margin:28px 0">
          <a href="${fullUrl}"
             style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
            View your full report
          </a>
        </p>
        <p style="font-size:14px;line-height:1.6;color:#6b7280">
          The report covers AI crawler access, structured data, content readability,
          brand footprint, trust signals, freshness, and what major AI engines
          currently know about your brand.
        </p>
      </div>
    `,
  });
}
