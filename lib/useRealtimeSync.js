'use client';

import { useEffect } from 'react';

// Subscribes to Postgres change events (insert/update/delete) for one
// table, scoped to one business, over the same websocket connection
// Supabase's client already maintains — this is what actually makes
// "phone → tablet → laptop stays synchronized" real rather than
// aspirational: a sale rung up on the phone shows up on the tablet's
// dashboard within about a second, with no manual refresh, no polling.
//
// Needs the table added to the `supabase_realtime` publication first
// (see schema_stage26.sql) — Supabase doesn't stream changes for a table
// that isn't in that publication, regardless of anything on the client
// side.
//
// onChange receives the raw Postgres Changes payload
// ({ eventType: 'INSERT'|'UPDATE'|'DELETE', new, old, ... }) — callers
// decide how to merge it into their own state (a full refetch, a
// targeted patch, whatever fits that page). This hook only owns the
// subscription lifecycle, not the merge logic, since that's genuinely
// different per page (a product price update merges differently than a
// new invoice appearing).
export function useRealtimeSync(supabase, table, businessId, onChange) {
  useEffect(() => {
    if (!businessId) return;

    const channel = supabase
      .channel(`realtime:${table}:${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `business_id=eq.${businessId}` },
        onChange
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, table, businessId]);
}
