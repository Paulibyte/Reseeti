import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { callClaude, parseJSONResponse, MODELS } from '../../../../lib/anthropic';

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Keeps the request body (and the Claude API payload) bounded — receipts
// are small documents; there's no legitimate reason for this endpoint to
// accept a 20MB photo.
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

const CATEGORIES = ['fuel', 'transport', 'salary', 'rent', 'electricity', 'internet', 'other'];

// A photographed receipt in, { vendor, amount, date, category } out —
// pre-fills the "Log an expense" form (app/dashboard/expenses/page.js)
// but never saves anything itself. The business owner still has to
// review and hit Save, same as the invoice assistant never auto-saves
// an invoice: a misread amount here is real money misrecorded in the
// books if nobody checks it.
export async function POST(request) {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const { image, mediaType } = await request.json();
  if (!image || !ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return NextResponse.json({ error: 'Upload a JPEG, PNG, or WebP photo of the receipt.' }, { status: 400 });
  }
  if (image.length > MAX_BASE64_BYTES) {
    return NextResponse.json({ error: 'That image is too large — try a smaller photo or a tighter crop of the receipt.' }, { status: 413 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = `You read a photographed receipt or invoice for a small Nigerian business's expense log and extract four fields.

Categories you must choose from (pick the closest match, "other" if none fit): ${CATEGORIES.join(', ')}.

Rules:
- amount is the total paid, as a plain number (no currency symbol, no commas).
- date is the transaction date in YYYY-MM-DD format. If no date is visible, use today's date: ${today}.
- vendor is the business/seller name printed on the receipt, as written. If genuinely unreadable, use null.
- If the amount isn't legible at all, set amount to null rather than guessing — do not invent a figure.
- Respond with ONLY a JSON object, no markdown fences, no other text, in exactly this shape:
{"vendor": string|null, "amount": number|null, "date": string, "category": string, "confidence": "high"|"medium"|"low"}`;

  try {
    const raw = await callClaude({
      model: MODELS.FAST,
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: 'Extract the receipt fields.' },
          ],
        },
      ],
      maxTokens: 400,
    });

    const parsed = parseJSONResponse(raw);
    if (!CATEGORIES.includes(parsed.category)) parsed.category = 'other';

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('AI receipt extraction failed:', err);
    return NextResponse.json({ error: "Couldn't read that receipt — you can still fill in the details by hand." }, { status: 500 });
  }
}
