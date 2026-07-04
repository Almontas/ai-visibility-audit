import crypto from 'crypto';
import supabase from './supabase.js';

// ---------------------------------------------------------------------------
// Scan version — bump this when scoring logic changes to invalidate cache.
// Old cached results with a different version are ignored.
// ---------------------------------------------------------------------------

export const SCAN_VERSION = '2';

// ---------------------------------------------------------------------------
// URL hashing — deterministic 16-char hex for cache lookups
// ---------------------------------------------------------------------------

export function hashUrl(url) {
  const normalized = url.toLowerCase().replace(/\/+$/, '');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// saveScan — INSERT into scans, returns { id, expires_at } or null
// ---------------------------------------------------------------------------

export async function saveScan(url, urlHash, brandName, blogPage, score, llmVisibility) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('scans')
      .insert({
        url,
        url_hash: urlHash,
        brand_name: brandName || null,
        blog_page: blogPage || null,
        score,
        llm_visibility: llmVisibility || null,
        scan_version: SCAN_VERSION,
      })
      .select('id, expires_at')
      .single();

    if (error) {
      console.error('[db] saveScan error:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[db] saveScan exception:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// getCachedScan — returns a cached scan from the last 24 hours, or null
// ---------------------------------------------------------------------------

export async function getCachedScan(urlHash) {
  if (!supabase) return null;
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('scans')
      .select('*')
      .eq('url_hash', urlHash)
      .eq('scan_version', SCAN_VERSION)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// getReport — fetch a scan by ID (for the /report/[id] page)
// ---------------------------------------------------------------------------

export async function getReport(id) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('scans')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;

    // Check expiry
    if (new Date(data.expires_at) < new Date()) {
      return { expired: true };
    }

    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// saveLead — INSERT into leads, returns the lead row or null
// ---------------------------------------------------------------------------

export async function saveLead(scanId, name, email, company) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        scan_id: scanId,
        name,
        email,
        company: company || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[db] saveLead error:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[db] saveLead exception:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// getExistingLead — check for duplicate lead by email + scan_id
// ---------------------------------------------------------------------------

export async function getExistingLead(scanId, email) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, scan_id')
      .eq('scan_id', scanId)
      .eq('email', email)
      .limit(1)
      .single();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// updateLeadEmailSent — mark an email as sent
// ---------------------------------------------------------------------------

export async function updateLeadEmailSent(leadId, emailColumn) {
  if (!supabase) return;
  try {
    await supabase
      .from('leads')
      .update({ [emailColumn]: new Date().toISOString() })
      .eq('id', leadId);
  } catch (err) {
    console.error('[db] updateLeadEmailSent exception:', err);
  }
}

// ---------------------------------------------------------------------------
// checkRateLimit — returns true if under limit (allowed), false if exceeded
// Also inserts a new row for this request.
// ---------------------------------------------------------------------------

export async function checkRateLimit(ip) {
  if (!supabase) return true; // No Supabase = no rate limiting
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', oneHourAgo);

    if (error) {
      console.error('[db] checkRateLimit count error:', error.message);
      return true; // Fail open
    }

    // Insert the current request
    await supabase.from('rate_limits').insert({ ip });

    return (count || 0) < 5;
  } catch {
    return true; // Fail open
  }
}

// ---------------------------------------------------------------------------
// cleanupRateLimits — delete old rows (called occasionally)
// ---------------------------------------------------------------------------

export async function cleanupRateLimits() {
  if (!supabase) return;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await supabase.from('rate_limits').delete().lt('created_at', oneHourAgo);
  } catch {
    // Ignore cleanup errors
  }
}
