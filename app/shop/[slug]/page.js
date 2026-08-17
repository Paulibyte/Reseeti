import { createAdminClient } from '../../../lib/supabaseAdmin';
import ShopCart from './ShopCart';

// Next.js caches a server component's data fetches by default and
// keeps serving that same snapshot on every subsequent visit unless
// told otherwise — fine for something immutable like a receipt, but
// this page's whole point is showing whichever products are currently
// toggled "show in catalogue" and in stock, which changes constantly.
// Without this, toggling a product on Inventory would have no visible
// effect on the live page until something else happened to bust the
// cache.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Public, no login required — a customer reaches this from a shared
// link (WhatsApp, social bio, etc), same as the existing /inv/[id]
// public receipt page. Uses the service-role client for the same
// reason: the visitor has no Supabase session, so RLS has nothing to
// authenticate against; only the specific fields safe to show a
// stranger are selected here.
export default async function ShopPage({ params }) {
  const supabase = createAdminClient();

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, address, whatsapp_number, plan, catalogue_enabled')
    .eq('catalogue_slug', params.slug)
    .maybeSingle();

  // Re-checks plan === 'pro' here too, not just catalogue_enabled — a
  // business that lapses from Pro back to Free should stop serving its
  // public catalogue even if catalogue_enabled was never explicitly
  // toggled off (nothing currently does that automatically on
  // downgrade, so this read-time check is the actual safety net).
  if (!business || !business.catalogue_enabled || business.plan !== 'pro') {
    return (
      <main style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: '0 20px', fontFamily: 'sans-serif' }}>
        <p style={{ color: '#8a8175' }}>This shop link isn&apos;t available right now.</p>
      </main>
    );
  }

  if (!business.whatsapp_number) {
    return (
      <main style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: '0 20px', fontFamily: 'sans-serif' }}>
        <p style={{ color: '#8a8175' }}>This shop hasn&apos;t finished setting up ordering yet — check back soon.</p>
      </main>
    );
  }

  const { data: products } = await supabase
    .from('products')
    .select('id, name, price, unit, unit_value, category, stock_qty, photo_url')
    .eq('business_id', business.id)
    .eq('show_in_catalogue', true)
    .order('category')
    .order('name');

  return (
    <ShopCart
      businessName={business.name}
      businessAddress={business.address}
      whatsappNumber={business.whatsapp_number}
      products={products || []}
    />
  );
}
