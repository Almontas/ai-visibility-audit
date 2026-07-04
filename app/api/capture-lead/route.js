import { saveScan, saveLead, updateLeadEmailSent, hashUrl } from '../../../lib/db.js';
import { sendReportEmail } from '../../../lib/email.js';

// ---------------------------------------------------------------------------
// Basic email validation regex
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// POST /api/capture-lead
//
// Accepts email-gate form submissions. Persists the scan result to Supabase,
// saves the lead, sends Email 1 (report link), and returns the report URL.
//
// Request body:
//   { name: string, email: string, company?: string, scanResult: object }
//
// Response:
//   { success: true, reportId: string, reportUrl: string }
// ---------------------------------------------------------------------------

export async function POST(request) {
  try {
    // 1. Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, error: 'Invalid JSON in request body.' },
        { status: 400 }
      );
    }

    const { name, email, company, scanResult } = body;

    // 2. Validate required fields
    const errors = [];

    if (!name || typeof name !== 'string' || !name.trim()) {
      errors.push('Name is required.');
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      errors.push('Email is required.');
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.push('Please provide a valid email address.');
    }

    if (errors.length > 0) {
      return Response.json(
        { success: false, error: errors.join(' ') },
        { status: 400 }
      );
    }

    // 3. Try to persist scan result to Supabase
    let scanId = null;
    let expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (scanResult && scanResult.url && scanResult.score) {
      const urlHash = hashUrl(scanResult.url);
      const saved = await saveScan(
        scanResult.url,
        urlHash,
        scanResult.brandName || null,
        scanResult.blogPage || null,
        scanResult.score
      );

      if (saved) {
        scanId = saved.id;
        expiresAt = saved.expires_at;
      }
    }

    // 4. Fallback: generate a UUID if Supabase not available
    if (!scanId) {
      scanId = crypto.randomUUID();
    }

    const reportUrl = `/report/${scanId}`;

    // 5. Save the lead
    const lead = await saveLead(scanId, name.trim(), email.trim(), company?.trim() || null);

    // 6. Send Email 1 (report link) immediately
    const grade = scanResult?.score?.grade || '?';
    const brandName = scanResult?.brandName || null;
    await sendReportEmail(email.trim(), name.trim(), reportUrl, brandName, grade);

    // 7. Mark email 1 as sent
    if (lead) {
      await updateLeadEmailSent(lead.id, 'email_1_sent_at');
    }

    // 8. Log the capture
    console.log('[capture-lead] New lead captured:', {
      scanId,
      name: name.trim(),
      email: email.trim(),
      company: company?.trim() || null,
      supabaseConnected: !!lead,
    });

    return Response.json({
      success: true,
      reportId: scanId,
      reportUrl,
    });
  } catch (err) {
    console.error('[capture-lead] Unexpected error:', err);
    return Response.json(
      { success: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
