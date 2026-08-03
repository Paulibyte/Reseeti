// Runs in the Node.js server runtime — every app/api/**/route.js
// handler, server components, etc. See sentry.client.config.js for the
// browser side and instrumentation.js for how this gets loaded.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  environment: process.env.NODE_ENV,
  // API route bodies routinely contain customer names, phone numbers,
  // and payment amounts (invoice creation, AI receipt extraction,
  // webhook payloads) — sending full request bodies to Sentry by
  // default would leak real customer data into a third-party tool no
  // customer agreed to. Stack traces and error messages are still fully
  // captured; just not the raw request/response payloads.
  sendDefaultPii: false,
});
