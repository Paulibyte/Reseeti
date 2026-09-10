'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';

export default function DeviceLookupPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: r } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(r);
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  // RLS already scopes this to the caller's own business — this tool
  // traces a dealer's own stock and sales history, not a cross-business
  // or national IMEI registry.
  async function search() {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    setSearched(true);
    // .limit(1) rather than .maybeSingle() — the latter errors out
    // entirely if more than one row matches, which is exactly what
    // silently broke this tool once already (a duplicate serial number
    // that should never have been possible to create — now prevented
    // at the database level by a unique constraint, see
    // schema_device_units_unique_serial.sql). This is a second,
    // independent safeguard: even if a duplicate ever slipped through
    // for some other reason, this tool would still show a real result
    // instead of a false "not found."
    const { data } = await supabase
      .from('device_units')
      .select('*, products(name), suppliers(name, address, supplier_contacts(name, phone, role)), invoice_items(invoices(invoice_number, customer_name, customer_phone, created_at))')
      .or(`serial_number.eq.${term},imei1.eq.${term},imei2.eq.${term}`)
      .limit(1);
    setResult(data?.[0] || null);
    setSearching(false);
  }

  const sale = result?.invoice_items?.[0]?.invoices;

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
    <div style={{ padding: 20, maxWidth: 560 }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 6px' }}>Serial / IMEI Lookup</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Trace any unit in your inventory back to its supplier, and — if it's been sold — to the customer and sale.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Enter a serial number or IMEI"
          style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }}
        />
        <button
          onClick={search}
          disabled={searching || !query.trim()}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {searched && !searching && !result && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13.5 }}>No unit found matching that serial number or IMEI.</p>
      )}

      {result && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '4px solid var(--orange)', borderRadius: 10, padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 17, color: 'var(--heading)', fontFamily: 'var(--font-heading)' }}>
            {result.products?.name}
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-faint)' }}>
            {[result.color, result.condition, result.specs].filter(Boolean).join(' · ')}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16, fontSize: 13 }}>
            <div><span style={{ color: 'var(--text-faint)' }}>Serial:</span> <strong>{result.serial_number}</strong></div>
            {result.imei1 && <div><span style={{ color: 'var(--text-faint)' }}>IMEI 1:</span> <strong>{result.imei1}</strong></div>}
            {result.imei2 && <div><span style={{ color: 'var(--text-faint)' }}>IMEI 2:</span> <strong>{result.imei2}</strong></div>}
          </div>

          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: '0 0 4px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Supplier</p>
            {result.suppliers ? (
              <>
                <p style={{ margin: '0 0 2px', fontSize: 13.5, color: 'var(--text)' }}>{result.suppliers.name}</p>
                {result.suppliers.address && <p style={{ margin: '0 0 2px', fontSize: 12.5, color: 'var(--text-muted)' }}>{result.suppliers.address}</p>}
                {(result.suppliers.supplier_contacts || []).map((c, i) => (
                  <p key={i} style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-faint)' }}>
                    {c.name}{c.role ? ` (${c.role})` : ''}{c.phone ? ` · ${c.phone}` : ''}
                  </p>
                ))}
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>No supplier recorded for this unit.</p>
            )}
          </div>

          <div>
            <p style={{ margin: '0 0 4px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Sale status</p>
            {sale ? (
              <div style={{ background: 'var(--success-bg)', borderRadius: 6, padding: '10px 12px' }}>
                <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 700, color: 'var(--success)' }}>Sold</p>
                <p style={{ margin: '0 0 2px', fontSize: 13, color: 'var(--text)' }}>
                  To {sale.customer_name || 'a walk-in customer'}{sale.customer_phone ? ` · ${sale.customer_phone}` : ''}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  Invoice {sale.invoice_number} · {new Date(sale.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>
            ) : (
              <div style={{ background: 'var(--orange-bg)', borderRadius: 6, padding: '10px 12px' }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--orange-dark)' }}>Still in stock — not yet sold</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </DashboardShell>
  );
}
