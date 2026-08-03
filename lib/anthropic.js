// Every AI feature in this app (invoice parsing, business insights,
// receipt extraction) goes through this one function rather than each
// API route rolling its own fetch — one place to update if the API
// shape or a model ID ever changes.
//
// SERVER-ONLY. process.env.ANTHROPIC_API_KEY must never reach client
// code, so this file must only ever be imported from
// app/api/ai/*/route.js handlers — never from a 'use client' component.

const API_URL = 'https://api.anthropic.com/v1/messages';

// claude-haiku-4-5-20251001 for the two narrow, well-specified
// extraction tasks (invoice parsing, receipt reading) — both are
// structured "pull these fields out" jobs where Haiku's speed and cost
// are the right tradeoff and don't cost meaningful accuracy. Business
// Insights uses claude-sonnet-5 instead, since noticing an actually
// useful, non-obvious pattern in a business's numbers ("most customers
// buy on Saturdays") benefits from stronger reasoning than a pure
// extraction task needs.
export const MODELS = {
  FAST: 'claude-haiku-4-5-20251001',
  REASONING: 'claude-sonnet-5',
};

// `messages` follows the Messages API shape directly — an array of
// { role, content } where content can be a plain string or (for the
// receipt-extraction case) a content-block array mixing image and text
// blocks. Callers build that shape themselves; this function just
// forwards it.
export async function callClaude({ model, system, messages, maxTokens = 1024 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Claude API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return (data.content || []).map((block) => block.text || '').join('\n');
}

// Every prompt in this file's callers asks Claude to reply with ONLY a
// JSON object — no markdown fences, no preamble — but models
// occasionally wrap it in a ```json fence anyway despite being told not
// to. This strips that before parsing rather than failing the whole
// request over formatting. Throws normally (JSON.parse's own error) if
// what's left still isn't valid JSON — callers decide how to surface
// that to the person using the feature.
export function parseJSONResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}
