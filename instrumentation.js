// Next.js's own instrumentation hook (file-system convention — Next.js
// looks for this exact filename in the project root and calls
// register() once when a new server instance starts). This is what
// actually loads the two server-side Sentry config files above; without
// this file, sentry.server.config.js and sentry.edge.config.js would
// just sit there unused.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors from Server Components, Server Actions, Route
// Handlers, and middleware — the one class of error that neither the
// client-side SDK (sentry.client.config.js) nor a plain try/catch in
// each route would otherwise reliably reach Sentry for.
export const onRequestError = (...args) => {
  // Imported lazily rather than at module top-level so this file has no
  // hard dependency on @sentry/nextjs before register() has had a
  // chance to run — matches Sentry's own documented pattern for this
  // hook.
  // eslint-disable-next-line global-require
  const Sentry = require('@sentry/nextjs');
  return Sentry.captureRequestError(...args);
};
