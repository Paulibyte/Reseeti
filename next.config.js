/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

const nextConfig = {
  images: {
    // Business logos and signatures live in Supabase Storage, on a
    // per-project *.supabase.co hostname. A wildcard pattern is used
    // (rather than hardcoding one project ref) so this config doesn't
    // need editing every time the app is pointed at a different Supabase
    // project (local dev vs. staging vs. production).
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

// withSentryConfig uploads readable source maps to Sentry at build time
// (so a stack trace shows your actual code, not minified bundle
// output) and wires up a few automatic instrumentation hooks. It's a
// no-op wrapper — safe to keep even before SENTRY_ORG/SENTRY_PROJECT/
// SENTRY_AUTH_TOKEN are configured, it just skips the source-map upload
// step and logs a notice rather than failing the build.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Quiets Sentry's own build-time console output — this app already
  // has a lot going on in a `next build` log; only actual problems are
  // worth surfacing there.
  silent: true,
  // Source maps are uploaded then deleted from the final client bundle
  // — real Reseeti application code shouldn't be trivially downloadable
  // and readable by anyone visiting the site.
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
