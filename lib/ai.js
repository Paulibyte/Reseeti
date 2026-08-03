// Every AI feature in this app (invoice parsing, business insights,
// receipt extraction) goes through this one function rather than each
// API route rolling its own fetch — one place to update if the API
// shape or a model ID ever changes.
//
// SERVER-ONLY. process.env.GEMINI_API_KEY must never reach client code,
// so this file must only ever be imported from app/api/ai/*/route.js
// handlers — never from a 'use client' component.
//
// Uses Google's Gemini API rather than a paid provider specifically for
// its no-credit-card free tier — see README_STAGE22.md for the
// reasoning and the tradeoffs (rate limits, and free-tier prompts may be
// used by Google to improve their models — paid tier turns that off).

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Model IDs are intentionally overridable via env vars, not hardcoded
// only — Google renames/retires free-tier models more often than most
// providers (Gemini 2.0 Flash was retired within months of Gemini 2.5
// launching, for example). If a default below ever 404s, set
// GEMINI_MODEL_FAST / GEMINI_MODEL_REASONING in .env.local to whatever
// Google AI Studio (aistudio.google.com) currently lists as free for
// your project — no code change needed.
//
// The FAST/REASONING split mirrors the old Claude setup: a
// cheaper/lighter model for the two narrow extraction tasks (invoice
// parsing, receipt reading), a stronger one for Business Insights, which
// benefits from more genuine reasoning to say something non-obvious
// about a business's numbers rather than just restating them.
export const MODELS = {
  FAST: process.env.GEMINI_MODEL_FAST || 'gemini-2.5-flash-lite',
  REASONING: process.env.GEMINI_MODEL_REASONING || 'gemini-2.5-flash',
};

// `messages` uses the same shape the old Anthropic version accepted — an
// array of { role, content } where content is a plain string or (for
// receipt extraction) a content-block array mixing
// { type: 'text', text } and { type: 'image', source: { media_type, data } }
// blocks. Kept in that shape (rather than Gemini's native parts/inlineData
// naming) so the three API routes that call this didn't need to change
// at all when the provider switched — only this file translates between
// the two.
export async function callAI({ model, system, messages, maxTokens = 1024 }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toParts(m.content),
  }));

  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        maxOutputTokens: maxTokens,
        // Every caller in this app asks for a JSON object back — telling
        // Gemini that up front via response_mime_type is more reliable
        // than prompting alone, though parseJSONResponse below still
        // strips markdown fences as a fallback in case a model ignores it.
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];

  // A missing candidate usually means the safety filters blocked the
  // response (finishReason: 'SAFETY' or similar) rather than a network
  // failure — surfaced as a normal error so the calling route's existing
  // try/catch handles it the same way as any other failure.
  if (!candidate) {
    throw new Error(`Gemini returned no candidates (finishReason: ${data.promptFeedback?.blockReason || 'unknown'})`);
  }

  return (candidate.content?.parts || []).map((p) => p.text || '').join('\n');
}

// Converts this app's plain-string-or-content-blocks shape into Gemini's
// parts array. A plain string becomes a single text part; the
// content-block array used by the receipt-extraction route maps
// { type: 'image', source: { media_type, data } } to Gemini's
// { inlineData: { mimeType, data } }.
function toParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((block) => {
    if (block.type === 'text') return { text: block.text };
    if (block.type === 'image') {
      return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
    }
    throw new Error(`Unsupported content block type: ${block.type}`);
  });
}

// With generationConfig.responseMimeType set to 'application/json' above,
// Gemini's text output is already a JSON string in the normal case — this
// still strips markdown fences defensively, since it's a cheap safety net
// and costs nothing when there's nothing to strip.
export function parseJSONResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}
