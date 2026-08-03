'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// Deliberately infers progress from real data rather than tracking each
// step's completion explicitly — "have you added a product" is answered
// by counting products, not by a flag set the moment a Add Product
// button was first clicked. That means the checklist stays honest even
// if someone adds a product from a completely different flow than the
// one this checklist points at, and there's nothing to get out of sync.
//
// Only rendered for the owner (see dashboard/page.js) — businesses.
// onboarding_dismissed is owner-only to write under RLS (Stage 8), and
// setup tasks like these are naturally owner territory anyway.
const STEPS = [
  { key: 'logo', label: 'Add your business logo', href: null }, // opens Settings via onSettingsClick, not a route
  { key: 'product', label: 'Add your first product', href: '/dashboard/inventory' },
  { key: 'customer', label: 'Add your first customer', href: '/dashboard/customers' },
  { key: 'invoice', label: 'Create your first invoice', href: '/dashboard' },
];

export default function OnboardingChecklist({ supabase, business, onOpenSettings }) {
  const [counts, setCounts] = useState(null);
  const [dismissed, setDismissed] = useState(business.onboarding_dismissed);

  useEffect(() => { loadCounts(); }, [business.id]);

  async function loadCounts() {
    // head: true + count: 'exact' asks Postgres for just the row count,
    // not the rows themselves — cheap enough to run on every dashboard
    // visit without it being a real query cost.
    const [{ count: products }, { count: customers }, { count: invoices }] = await Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    ]);
    setCounts({ product: products || 0, customer: customers || 0, invoice: invoices || 0 });
  }

  async function dismiss() {
    setDismissed(true);
    await supabase.from('businesses').update({ onboarding_dismissed: true }).eq('id', business.id);
  }

  if (dismissed || !counts) return null;

  const done = {
    logo: !!business.logo_url,
    product: counts.product > 0,
    customer: counts.customer > 0,
    invoice: counts.invoice > 0,
  };
  const completedCount = Object.values(done).filter(Boolean).length;

  // Once every step is done, there's nothing left to walk through —
  // rather than leaving a "100% complete, all checked" card sitting on
  // the dashboard forever, it just quietly stops rendering. A person
  // can always re-visit the individual pages (Inventory, Customers)
  // directly; this card's only job was pointing at them the first time.
  if (completedCount === STEPS.length) return null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', margin: 0, fontSize: 15.5 }}>
          👋 Get set up
        </h3>
        <button
          onClick={dismiss}
          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
        >
          Dismiss
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 12px' }}>
        {completedCount} of {STEPS.length} done
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STEPS.map((step) => (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: done[step.key] ? 'var(--success)' : 'var(--surface-alt)', color: '#fff', fontSize: 11, fontWeight: 700,
            }}>
              {done[step.key] ? '✓' : ''}
            </span>
            {done[step.key] ? (
              <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{step.label}</span>
            ) : step.href ? (
              <Link href={step.href} style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none' }}>{step.label}</Link>
            ) : (
              <button
                onClick={onOpenSettings}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text)', fontWeight: 600, cursor: 'pointer', fontSize: 13.5, textAlign: 'left' }}
              >
                {step.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
