// Runs in the Edge runtime. Reseeti doesn't currently declare
// `export const runtime = 'edge'` anywhere (every API route runs on
// Node, which is what the admin/service-role Supabase client and
// Node-only packages like crypto need) — this file exists for
// completeness and in case that changes later, following Sentry's
// standard three-config (client/server/edge) Next.js setup.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
});
