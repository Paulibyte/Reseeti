import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { callClaude, parseJSONResponse, MODELS } from '../../../../lib/anthropic';

// "Sold 2 bags of rice and one carton of milk" → structured invoice line
// items, matched against the business's actual product catalog wherever
// possible so the price/stock-deduction behavior is identical to picking
// the item from the dropdown by hand.
//
// The one rule this route never breaks: it never invents a price for
// something it can't match to a real product. An unmatched item comes
// back with price: null and matched: false — InvoiceForm.jsx leaves that
// row's price blank and highlighted rather than filling in a guess,
// because a wrong AI-guessed price becomes a real, wrong amount charged
// to a real customer if nobody catches it before hitting Save.
export async function POST(request) {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const { text } = await request.json();
  if (!text || !text.trim()) {
    return NextResponse.json({ error: 'Describe the sale first.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: products } = await admin
    .from('products')
    .select('id, name, price, stock_qty')
    .eq('business_id', membership.businessId)
    .order('name');

  // Kept small and flat on purpose — this goes straight into the prompt,
  // and the catalog is exactly the information Claude needs to decide
  // "is this the rice they mean, and what does it actually cost."
  const catalog = (products || []).map((p) => ({ id: p.id, name: p.name, price: Number(p.price), stock_qty: p.stock_qty }));

  const system = `You turn a shopkeeper's plain-language description of a sale into structured invoice line items for a Nigerian small-business invoicing app.

The business's current product catalog (name, price in NGN, stock on hand) is:
${JSON.stringify(catalog)}

Rules:
- Match each item the person mentions to a catalog product when you're reasonably confident it's the same item (allow for singular/plural, common abbreviations, and minor spelling differences). When matched, use that product's exact id, name, and price.
- If an item doesn't clearly match anything in the catalog, still include it as a line item with matched: false, product_id: null, price: null, and your best-guess description and quantity. Never invent a price for an unmatched item.
- Parse quantities from words ("one", "a", "two", "a dozen" = 12, etc.) as well as digits.
- If a customer name is mentioned (e.g. "for John", "sold to Mrs Adeyemi"), extract it as customer_name. Otherwise customer_name is null.
- If the described quantity of a matched item exceeds that product's stock_qty, add a short warning string to the warnings array (e.g. "Only 3 bags of rice in stock, but 5 were requested.").
- Respond with ONLY a JSON object, no markdown fences, no other text, in exactly this shape:
{"items": [{"description": string, "qty": number, "price": number|null, "product_id": string|null, "matched": boolean}], "customer_name": string|null, "warnings": string[]}`;

  try {
    const raw = await callClaude({
      model: MODELS.FAST,
      system,
      messages: [{ role: 'user', content: text.trim() }],
      maxTokens: 1024,
    });
    const parsed = parseJSONResponse(raw);

    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      return NextResponse.json({ error: "Couldn't find any items in that description — try naming what was sold and how many." }, { status: 422 });
    }

    return NextResponse.json({
      items: parsed.items,
      customer_name: parsed.customer_name || null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    });
  } catch (err) {
    console.error('AI invoice parse failed:', err);
    return NextResponse.json({ error: 'Could not read that description right now. You can still fill in the invoice by hand.' }, { status: 500 });
  }
}
