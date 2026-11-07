import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';
import { rateLimit, requestIp } from '../../../../../lib/rateLimit';
import { selectCatalogueProducts } from '../../../../../lib/catalogueProducts';
import { photosOf } from '../../../../../lib/productPhotos';
import { wholesaleFields } from '../../../../../lib/wholesalePricing';
import { marketplaceFor } from '../../../../../lib/marketplaces';

// Both are needed on any route that reads live data: without them Next
// can serve a cached snapshot of the products (see app/shop/[slug]/page.js).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Public, read-only JSON version of a business's catalogue — the data
// behind /shop/<slug>, in a form another app (Jobtins) can consume
// without scraping HTML.
//
// It deliberately follows the SAME rules as the shop page itself: a
// catalogue is only served if it is switched on, the business is on the
// Pro plan, and ordering is set up (a WhatsApp number exists). On top of
// that the OWNER must have switched on "List on <marketplace>" for the marketplace
// that is asking (Stage 60 for Jobtins, Stage 62 for HomeEase Nigeria) — a
// catalogue being public is not consent to appear in a marketplace, and agreeing
// to one is not agreeing to another, so without that marketplace's opt-in this
// answers exactly as if the shop didn't exist. The marketplace says who it is
// with ?market=jobtins or ?market=homeease; asking without it means Jobtins,
// as every Jobtins did before HomeEase existed, and a name we do not know is refused.
// "Not opted in" and "not published" give the same answer on purpose, so
// the feed never reveals which businesses exist or why one is missing. It only
// returns fields the shop page already shows a stranger. One difference
// on purpose: it returns a yes/no "in_stock" instead of the exact
// stock_qty, so a third party can't read a business's stock levels.
//
// No Access-Control-Allow-Origin header is sent: Jobtins fetches this
// server-to-server, so there is no reason to let arbitrary web pages read
// it from a browser.
//
// This does NOT record a catalogue_views row — a sync is not a customer.
export async function GET(req, { params }) {
  // Generous on purpose: Jobtins syncs every listed business from one
  // server in a burst, so a per-IP limit has to leave room for that
  // while still stopping someone hammering the endpoint.
  // Which marketplace is asking. Each has its own allowance, so one syncing a lot of shops never uses up another's.
  let asked = null;
  try { asked = new URL(req.url, 'http://x').searchParams.get('market'); } catch { /* no address: the default marketplace */ }
  const market = marketplaceFor(asked);
  if (!market) {
    return NextResponse.json({ error: 'unavailable' }, { status: 404 });
  }

  const { allowed } = await rateLimit(`catalogue-public:${market.key}:${requestIp(req)}`, { limit: 300, windowSeconds: 600 });
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const slug = String(params.slug || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) {
    return NextResponse.json({ error: 'unavailable' }, { status: 404 });
  }

  const supabase = createAdminClient();

  const { data: business } = await supabase
    .from('businesses')
    .select(`id, name, address, whatsapp_number, plan, catalogue_enabled, ${market.optIn}, paystack_subaccount_code, logo_url, catalogue_accent_color`)
    .eq('catalogue_slug', slug)
    .maybeSingle();

  if (!business || !business[market.optIn] || !business.catalogue_enabled || business.plan !== 'pro' || !business.whatsapp_number) {
    return NextResponse.json({ error: 'unavailable' }, { status: 404 });
  }

  // Each product also carries its list of photos (the first is the cover, which is also photo_url).
  const { data: products, error } = await selectCatalogueProducts(
    supabase,
    business.id,
    'id, name, description, price, unit, unit_value, category, type, stock_qty, photo_url',
    { limit: 5000 },
  );

  if (error) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  return NextResponse.json(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      business: {
        name: business.name,
        address: business.address || null,
        whatsapp_number: business.whatsapp_number,
        logo_url: business.logo_url || null,
        accent_color: business.catalogue_accent_color || null,
        can_pay_online: !!business.paystack_subaccount_code,
      },
      products: (products || []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description || null,
        price: Number(p.price) || 0,
        unit: p.unit || null,
        unit_value: p.unit_value || null,
        category: p.category || null,
        type: p.type === 'service' ? 'service' : 'product',
        // A service has no stock to run out of.
        in_stock: p.type === 'service' || Number(p.stock_qty) > 0,
        photo_url: p.photo_url || null,
        photos: photosOf(p),
        // Bulk selling: sale_mode, minimum order, bulk prices, and when the price last changed. An ordinary product sends
        // the quiet defaults (retail, 1, none), so a marketplace that does not know about them loses nothing.
        ...wholesaleFields(p),
      })),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
