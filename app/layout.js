import { Merriweather, Inter } from 'next/font/google';
import RegisterSW from './RegisterSW';
import ThemeProvider from './ThemeProvider';
import './globals.css';

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--font-heading',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

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

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${merriweather.variable} ${inter.variable}`}>
      <body>
        <ThemeProvider>
          <RegisterSW />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
