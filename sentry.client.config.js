// Runs in the browser. Captures unhandled client-side errors and
// (at the configured sample rate) performance traces. See
// README_STAGE27.md for setup — this file does nothing useful without a
// real NEXT_PUBLIC_SENTRY_DSN in the environment, and Sentry's SDK
// itself no-ops safely when the DSN is empty rather than throwing, so
// this is safe to ship even before that's configured.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 10% of transactions in production — enough to spot real performance
  // trends without the cost/noise of tracing every single page load on
  // an app with real traffic. 100% in development, where traffic is
  // just you.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // Session Replay is off by default here — it captures a
  // reconstructable recording of what the user saw, which is more data
  // collection than an invoicing app handling real customer names,
  // phone numbers, and payment amounts should turn on without a
  // deliberate decision (and a Privacy Policy update) to do so. Errors
  // are still fully captured without it.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  environment: process.env.NODE_ENV,
});
