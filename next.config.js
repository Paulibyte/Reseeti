/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

// The image optimiser may only fetch from THIS project's own Supabase Storage.
// Business logos and signatures live there, on a per-project hostname. The
// hostname is read from NEXT_PUBLIC_SUPABASE_URL, so local dev, staging and
// production each allow only their own project and this file never needs
// editing when the app is pointed at a different one.
//
// This replaces the earlier wildcard ('**.supabase.co'): anyone can create a
// free Supabase project, so the wildcard let any stranger make this server
// fetch and process files they host. If the variable is missing, NO remote
// image is allowed (fail closed) rather than falling back to a wildcard.
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  } catch {
    return null;
  }
})();

const nextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: 'https',
            hostname: supabaseHost,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
    // These two are Next's defaults, stated on purpose: the image optimiser
    // has had critical flaws in AVIF and SVG handling (Aug and Oct 2026), so
    // neither format should ever be switched on here by accident. Also do not
    // install the optional `sharp` package until Next.js has been upgraded.
    formats: ['image/webp'],
    dangerouslyAllowSVG: false,
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
