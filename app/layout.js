import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/merriweather/900.css';
import RegisterSW from './RegisterSW';
import ThemeProvider from './ThemeProvider';
import './globals.css';

export const metadata = {
  title: 'Reseeti — Smart Invoicing for African Businesses',
  description: 'Create professional invoices, share them instantly, track payments and grow your business.',
  manifest: '/manifest.json',
};

// themeColor lives in a separate viewport export as of Next.js 14 — it
// used to be part of metadata (still is in older Next.js versions/docs
// examples), but keeping it there now throws the "Unsupported metadata
// themeColor" warning at every render. Same value, just relocated.
export const viewport = {
  themeColor: '#0E1A2B',
};

// --font-heading / --font-body are read throughout the app (globals.css
// and inline styles alike) with exactly these same names as before —
// only how the actual font FILES load changed here. next/font/google
// used to fetch these live from fonts.gstatic.com on every single
// build, which this VPS's outbound network rules don't allow, causing
// the repeated "request to fonts.gstatic.com failed... Retrying"
// output on every build. @fontsource ships the real font files inside
// node_modules itself, installed the same way any other npm dependency
// already is — no internet access needed at build time at all, and
// nothing outside this file needed to change as a result.
const fontVars = {
  '--font-heading': "'Merriweather', Georgia, 'Times New Roman', serif",
  '--font-body': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" style={fontVars}>
      <body>
        <ThemeProvider>
          <RegisterSW />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
