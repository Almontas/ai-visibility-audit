import { getReport } from '../../../../lib/db.js';

export async function GET(request, { params }) {
  const { id } = await params;

  if (!id || typeof id !== 'string') {
    return Response.json({ error: 'Missing report ID.' }, { status: 400 });
  }

  const report = await getReport(id);

  if (!report) {
    return Response.json({ error: 'Report not found.' }, { status: 404 });
  }

  if (report.expired) {
    return Response.json({ error: 'Report has expired.', expired: true }, { status: 410 });
  }

  return Response.json({
    success: true,
    url: report.url,
    brandName: report.brand_name,
    blogPage: report.blog_page,
    score: report.score,
    llmVisibility: report.llm_visibility || null,
    scannedAt: report.created_at,
    expiresAt: report.expires_at,
  });
}
