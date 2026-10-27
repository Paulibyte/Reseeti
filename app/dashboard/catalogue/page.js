'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';
import { csrfFetch } from '../../../lib/csrfFetch';

// Deliberately does NOT move the enable/disable toggle, WhatsApp number,
// bank verification, or accent-color picker out of BusinessSettings —
// those already work and are already tested end-to-end (including the
// Paystack Subaccount verification flow), so re-plumbing them here would
// be pure regression risk for zero new capability. This page links out
// to Settings for those instead, and focuses on the one thing that
// genuinely didn't have a good home anywhere: seeing every product at a
// glance and toggling catalogue visibility in bulk, without opening
// each product's edit form individually.
export default function CataloguePage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [ordersCount, setOrdersCount] = useState(0);
  const [views30, setViews30] = useState(0);
  const [jobtinsBusy, setJobtinsBusy] = useState(false);
  const [jobtinsError, setJobtinsError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    if (biz.plan === 'pro') {
      const { data: prods } = await supabase
        .from('products')
        .select('id, name, price, photo_url, show_in_catalogue, unit, unit_value, category')
        .eq('business_id', biz.id)
        .order('name');
      setProducts(prods || []);

      const { count } = await supabase
        .from('catalogue_orders')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', biz.id)
        .eq('status', 'pending');
      setOrdersCount(count || 0);

      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { count: viewCount } = await supabase
        .from('catalogue_views')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', biz.id)
        .gte('created_at', since.toISOString());
      setViews30(viewCount || 0);
    }

    setLoading(false);
  }

  async function toggleVisible(product) {
    setSavingId(product.id);
    const next = !product.show_in_catalogue;
    const { error } = await supabase.from('products').update({ show_in_catalogue: next }).eq('id', product.id);
    setSavingId(null);
    if (error) {
      alert(error.message);
      return;
    }
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, show_in_catalogue: next } : p)));
  }

  // Opting in to Jobtins (a separate shopping site that shows products
  // from Reseeti shops) is the owner's choice and nothing is listed until
  // they make it — see schema_stage60.sql. The route re-checks everything
  // here (owner only, Pro, catalogue on, WhatsApp number set).
  async function toggleJobtins() {
    const next = !business.jobtins_opt_in;
    if (next && !window.confirm(
      `List ${business.name} on Jobtins?\n\nJobtins will show your shop's name, address, WhatsApp number and logo, and every product marked Visible, with its price, photo and description. It never sees your customers, invoices or stock counts.\n\nYou can switch this off at any time.`
    )) return;
    setJobtinsBusy(true);
    setJobtinsError('');
    const res = await csrfFetch('/api/catalogue/jobtins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    const data = await res.json().catch(() => ({}));
    setJobtinsBusy(false);
    if (!res.ok) {
      setJobtinsError(data.error || 'Could not save that. Please try again.');
      return;
    }
    setBusiness((b) => ({ ...b, jobtins_opt_in: next }));
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
  }, [products, search]);

  const visibleCount = products.filter((p) => p.show_in_catalogue).length;

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageInventory', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage the catalogue.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, marginBottom: 4 }}>
        Catalogue
      </h1>

      {business.plan !== 'pro' ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, marginTop: 16 }}>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            The online catalogue — a public shop link with WhatsApp ordering and optional online payment — is a Pro feature.
          </p>
          <button
            onClick={() => router.push('/dashboard/payments')}
            style={{ marginTop: 14, background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
          >
            Upgrade to Pro
          </button>
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
            {visibleCount} of {products.length} products visible on your public shop.{' '}
            {!business.catalogue_enabled && 'Your catalogue is currently turned off — turn it on in Settings.'}
          </p>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <h2 style={{ fontSize: 16, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  List on Jobtins
                  {business.jobtins_opt_in && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'var(--success-bg)', color: 'var(--success)' }}>Listed</span>
                  )}
                </h2>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
                  Jobtins is a shopping site that shows products from Reseeti shops in one place, so more people can find yours.
                  Shoppers who tap Order are sent back to your own shop link, so orders and payments still come to you.
                </p>
              </div>
              {role === 'owner' ? (
                <button
                  onClick={toggleJobtins}
                  disabled={jobtinsBusy || (!business.jobtins_opt_in && (!business.catalogue_enabled || !business.whatsapp_number))}
                  style={{
                    background: business.jobtins_opt_in ? 'var(--surface)' : 'var(--orange)',
                    color: business.jobtins_opt_in ? 'var(--text)' : '#fff',
                    border: business.jobtins_opt_in ? '1px solid var(--border)' : 'none',
                    borderRadius: 8, padding: '10px 18px', fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                    opacity: jobtinsBusy || (!business.jobtins_opt_in && (!business.catalogue_enabled || !business.whatsapp_number)) ? 0.55 : 1,
                  }}
                >
                  {jobtinsBusy ? 'Saving…' : business.jobtins_opt_in ? 'Remove from Jobtins' : 'List my shop on Jobtins'}
                </button>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--text-faint)', flexShrink: 0 }}>Only the owner can change this.</span>
              )}
            </div>

            {role === 'owner' && !business.jobtins_opt_in && !business.catalogue_enabled && (
              <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>Turn on your catalogue in Settings first.</p>
            )}
            {role === 'owner' && !business.jobtins_opt_in && business.catalogue_enabled && !business.whatsapp_number && (
              <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>Add your WhatsApp number in Settings first — shoppers order through it.</p>
            )}
            {jobtinsError && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--danger)' }}>{jobtinsError}</p>}

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>What Jobtins can and can&apos;t see</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                <li><b>Shown:</b> your shop name, address, WhatsApp number and logo, and each product marked Visible below, with its name, price, photo, description and whether it is in stock.</li>
                <li><b>Never shown:</b> your customers, invoices, payments, costs, or exact stock numbers.</li>
                <li>Jobtins refreshes regularly, so changes — including removing your shop — can take a little while to appear there.</li>
              </ul>
            </details>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={statCardStyle}>
              <p style={statLabelStyle}>Shop visits (30d)</p>
              <p style={statValueStyle}>{views30}</p>
            </div>
            <div style={statCardStyle}>
              <p style={statLabelStyle}>Pending orders</p>
              <p style={statValueStyle}>{ordersCount}</p>
            </div>
            <button
              onClick={() => router.push('/dashboard/analytics')}
              style={{ ...statCardStyle, cursor: 'pointer', textAlign: 'left', background: 'var(--surface-alt)' }}
            >
              <p style={statLabelStyle}>Full analytics →</p>
              <p style={{ ...statValueStyle, fontSize: 13, fontWeight: 600 }}>View catalogue analytics</p>
            </button>
            <button
              onClick={() => router.push('/dashboard/payments')}
              style={{ ...statCardStyle, cursor: 'pointer', textAlign: 'left', background: 'var(--surface-alt)' }}
            >
              <p style={statLabelStyle}>Settings →</p>
              <p style={{ ...statValueStyle, fontSize: 13, fontWeight: 600 }}>
                {business.catalogue_enabled ? 'Manage shop link, WhatsApp & payments' : 'Turn on your catalogue'}
              </p>
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Products</h2>
            <input
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13.5, width: 200 }}
            />
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {filtered.length === 0 && (
              <p style={{ color: 'var(--text-faint)', padding: 16, margin: 0 }}>
                {products.length === 0 ? 'Add products in Inventory first, then come back here to feature them.' : 'No matches.'}
              </p>
            )}
            {filtered.map((p, idx) => (
              <div
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--border)',
                }}
              >
                {p.photo_url ? (
                  <img src={p.photo_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                    📦
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{p.name}</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                    {formatNaira(p.price)}{p.category ? ` · ${p.category}` : ''}{!p.photo_url ? ' · No photo' : ''}
                  </p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: p.show_in_catalogue ? 'var(--success)' : 'var(--text-faint)', fontWeight: 600 }}>
                    {savingId === p.id ? 'Saving…' : p.show_in_catalogue ? 'Visible' : 'Hidden'}
                  </span>
                  <input
                    type="checkbox"
                    checked={p.show_in_catalogue}
                    onChange={() => toggleVisible(p)}
                    disabled={savingId === p.id}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--orange)' }}
                  />
                </label>
              </div>
            ))}
          </div>
        </>
      )}
    </DashboardShell>
  );
}

const statCardStyle = {
  flex: '1 1 160px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '12px 16px',
};
const statLabelStyle = { margin: '0 0 2px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.4 };
const statValueStyle = { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' };
