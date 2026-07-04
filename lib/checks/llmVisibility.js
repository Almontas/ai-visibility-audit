// ---------------------------------------------------------------------------
// LLM Visibility Check — queries up to 4 LLM APIs in parallel to determine
// what AI engines know about a brand. Display-only (not scored).
// ---------------------------------------------------------------------------

/** Phrases that indicate the LLM does not know the brand. */
const NEGATION_PHRASES = [
  "i don't have specific information",
  "i don't have reliable information",
  "i'm not familiar with",
  "i don't have information about",
  "i couldn't find",
  "i'm not aware of",
  "no specific information",
  "not aware of a company",
  "not aware of a product",
  "i cannot provide information",
];

/** Phrases that indicate the LLM is uncertain / hedging. */
const HEDGING_PHRASES = [
  "appears to be",
  "seems to be",
  "may be",
  "might be",
  "could be",
  "i believe",
  "it's possible",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count approximate words in a string.
 * @param {string} text
 * @returns {number}
 */
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Build the standard prompt for all providers.
 * @param {string} brandName
 * @returns {string}
 */
function buildPrompt(brandName) {
  return (
    `What is ${brandName}? Provide a brief factual description of this company, product, or organization. ` +
    `If you don't have reliable information about ${brandName}, say "I don't have specific information about this brand." ` +
    `Do not guess or make up details.`
  );
}

/**
 * Classify an LLM response into a visibility status and confidence level.
 * @param {string} text      — The raw LLM response
 * @param {string} brandName — Brand name to look for (case-insensitive)
 * @param {string} domain    — Site domain (without www.) to look for
 * @returns {{ status: 'known'|'partial'|'unknown', mentionsBrand: boolean, mentionsDomain: boolean, confidence: 'high'|'medium'|'low' }}
 */
function classifyResponse(text, brandName, domain) {
  const lower = text.toLowerCase();
  const brandLower = brandName.toLowerCase();

  const mentionsBrand = lower.includes(brandLower);
  const mentionsDomain = lower.includes(domain.toLowerCase());
  const words = wordCount(text);

  const hasNegation = NEGATION_PHRASES.some((p) => lower.includes(p));
  const hasHedging = HEDGING_PHRASES.some((p) => lower.includes(p));

  // --- unknown ---
  if (hasNegation || !mentionsBrand || words < 20) {
    return { status: 'unknown', mentionsBrand, mentionsDomain, confidence: 'low' };
  }

  // --- partial ---
  if (
    (mentionsBrand && hasHedging) ||
    (mentionsBrand && words >= 20 && words <= 50) ||
    (mentionsBrand && !mentionsDomain)
  ) {
    return {
      status: 'partial',
      mentionsBrand,
      mentionsDomain,
      confidence: mentionsDomain ? 'medium' : 'low',
    };
  }

  // --- known ---
  // mentionsBrand is true, no negation, words > 50, no hedging
  return {
    status: 'known',
    mentionsBrand,
    mentionsDomain,
    confidence: mentionsDomain ? 'high' : 'medium',
  };
}

// ---------------------------------------------------------------------------
// Provider functions — each returns a single LLM result entry
// ---------------------------------------------------------------------------

/**
 * Query OpenAI ChatGPT (gpt-4o-mini).
 * @param {string} prompt
 * @param {string} brandName
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function queryChatGPT(prompt, brandName, domain) {
  const provider = 'ChatGPT';
  const model = 'gpt-4o-mini';
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return { provider, model, status: 'skipped' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const start = Date.now();

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    const json = await res.json();

    if (!res.ok) {
      return { provider, model, status: 'error', response: json?.error?.message ?? res.statusText, latencyMs };
    }

    const text = (json.choices?.[0]?.message?.content ?? '').trim();
    const classification = classifyResponse(text, brandName, domain);

    return {
      provider,
      model,
      ...classification,
      response: text.slice(0, 500),
      latencyMs,
    };
  } catch (/** @type {any} */ err) {
    return { provider, model, status: 'error', response: err.name === 'AbortError' ? 'Request timed out' : err.message, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Query Anthropic Claude (claude-haiku-4-5).
 * @param {string} prompt
 * @param {string} brandName
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function queryClaude(prompt, brandName, domain) {
  const provider = 'Claude';
  const model = 'claude-haiku-4-5-20251001';
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return { provider, model, status: 'skipped' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const start = Date.now();

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    const json = await res.json();

    if (!res.ok) {
      return { provider, model, status: 'error', response: json?.error?.message ?? res.statusText, latencyMs };
    }

    const text = (json.content?.[0]?.text ?? '').trim();
    const classification = classifyResponse(text, brandName, domain);

    return {
      provider,
      model,
      ...classification,
      response: text.slice(0, 500),
      latencyMs,
    };
  } catch (/** @type {any} */ err) {
    return { provider, model, status: 'error', response: err.name === 'AbortError' ? 'Request timed out' : err.message, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Query Perplexity (sonar model).
 * @param {string} prompt
 * @param {string} brandName
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function queryPerplexity(prompt, brandName, domain) {
  const provider = 'Perplexity';
  const model = 'sonar';
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) return { provider, model, status: 'skipped' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const start = Date.now();

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    const json = await res.json();

    if (!res.ok) {
      return { provider, model, status: 'error', response: json?.error?.message ?? res.statusText, latencyMs };
    }

    const text = (json.choices?.[0]?.message?.content ?? '').trim();
    const citations = json.citations ?? [];
    const classification = classifyResponse(text, brandName, domain);

    return {
      provider,
      model,
      ...classification,
      response: text.slice(0, 500),
      citations,
      latencyMs,
    };
  } catch (/** @type {any} */ err) {
    return { provider, model, status: 'error', response: err.name === 'AbortError' ? 'Request timed out' : err.message, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Query Google Gemini (gemini-2.0-flash).
 * @param {string} prompt
 * @param {string} brandName
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function queryGemini(prompt, brandName, domain) {
  const provider = 'Gemini';
  const model = 'gemini-2.0-flash';
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) return { provider, model, status: 'skipped' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const start = Date.now();

  try {
    // Key goes in a header, not the URL, so it never lands in request logs.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0 },
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    const json = await res.json();

    if (!res.ok) {
      return { provider, model, status: 'error', response: json?.error?.message ?? res.statusText, latencyMs };
    }

    const text = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const classification = classifyResponse(text, brandName, domain);

    return {
      provider,
      model,
      ...classification,
      response: text.slice(0, 500),
      latencyMs,
    };
  } catch (/** @type {any} */ err) {
    return { provider, model, status: 'error', response: err.name === 'AbortError' ? 'Request timed out' : err.message, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Query up to 4 LLM APIs in parallel to check what they know about a brand.
 * Only providers with configured API keys are queried; others are skipped.
 *
 * @param {string} brandName — The brand / company name to look up
 * @param {string} siteUrl   — The brand's website URL (used to check domain mentions)
 * @returns {Promise<{
 *   llms: Array<{
 *     provider: string,
 *     model: string,
 *     status: 'known'|'partial'|'unknown'|'skipped'|'error',
 *     response?: string,
 *     mentionsBrand?: boolean,
 *     mentionsDomain?: boolean,
 *     confidence?: 'high'|'medium'|'low',
 *     latencyMs?: number,
 *     citations?: string[],
 *   }>,
 *   summary: string,
 *   checkedAt: string,
 * }>}
 */
export async function checkLlmVisibility(brandName, siteUrl) {
  const checkedAt = new Date().toISOString();

  if (!brandName) {
    return { llms: [], summary: 'Brand name not detected.', checkedAt };
  }

  const domain = new URL(siteUrl).hostname.replace(/^www\./, '');
  const prompt = buildPrompt(brandName);

  // Collect promises only for providers with configured keys
  const checks = [];
  if (process.env.OPENAI_API_KEY) checks.push(queryChatGPT(prompt, brandName, domain));
  if (process.env.ANTHROPIC_API_KEY) checks.push(queryClaude(prompt, brandName, domain));
  if (process.env.PERPLEXITY_API_KEY) checks.push(queryPerplexity(prompt, brandName, domain));
  if (process.env.GOOGLE_AI_API_KEY) checks.push(queryGemini(prompt, brandName, domain));

  if (checks.length === 0) {
    return { llms: [], summary: 'No LLM API keys configured.', checkedAt };
  }

  const settled = await Promise.allSettled(checks);

  const llms = settled.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // Promise rejected unexpectedly — should not happen given internal try/catch,
    // but handle gracefully just in case.
    return {
      provider: 'Unknown',
      model: 'unknown',
      status: /** @type {const} */ ('error'),
      response: result.reason?.message ?? 'Unexpected error',
    };
  });

  // Build human-readable summary
  const recognizedCount = llms.filter(
    (l) => l.status === 'known' || l.status === 'partial'
  ).length;
  const totalQueried = llms.filter((l) => l.status !== 'skipped').length;

  let summary;
  if (totalQueried === 0) {
    summary = 'No LLM API keys configured.';
  } else if (recognizedCount === 0) {
    summary = `None of ${totalQueried} AI engine${totalQueried === 1 ? '' : 's'} recognize this brand.`;
  } else if (recognizedCount === totalQueried) {
    summary = `All ${totalQueried} AI engine${totalQueried === 1 ? '' : 's'} recognize this brand.`;
  } else {
    summary = `${recognizedCount} of ${totalQueried} AI engine${totalQueried === 1 ? '' : 's'} recognize this brand.`;
  }

  return { llms, summary, checkedAt };
}
