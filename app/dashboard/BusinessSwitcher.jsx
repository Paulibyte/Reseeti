'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabaseClient';

// Only ever shows for someone who genuinely belongs to more than one
// business — a normal single-business owner or staff member never sees
// this at all, so nothing changes for the vast majority of accounts.
export default function BusinessSwitcher({ businesses, currentId }) {
  const supabase = createClient();
  const [switching, setSwitching] = useState(false);

  if (!businesses || businesses.length < 2) return null;

  async function switchTo(businessId) {
    if (businessId === currentId) return;
    setSwitching(true);
    // Just a metadata write — lib/getMyBusiness.js and
    // lib/supabaseServer.js's getMyBusinessId() both read
    // active_business_id from here to decide which membership is
    // "current". No server route needed: if this were ever set to a
    // business the person doesn't actually belong to, those lookups
    // simply wouldn't find a match among their real memberships and
    // would fall back to their first one instead — there's no
    // privilege to gain by lying to your own client.
    await supabase.auth.updateUser({ data: { active_business_id: businessId } });
    window.location.href = '/dashboard';
  }

  return (
    <select
      value={currentId || ''}
      onChange={(e) => switchTo(e.target.value)}
      disabled={switching}
      style={{
        padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12.5,
        background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', maxWidth: 160,
      }}
    >
      {businesses.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
}
