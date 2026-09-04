'use client';

import { useState } from 'react';
import Link from 'next/link';
import Logo from '../components/Logo';
import HelpTutorials from './HelpTutorials';

const FAQ_SECTIONS = [
  {
    title: 'Getting started',
    items: [
      {
        q: 'How do I create my first invoice?',
        a: 'From the dashboard, tap "+ Create Invoice." Add items either by typing them, picking from your product catalog, describing the sale in plain language with the AI Invoice Assistant ("Sold 2 bags of rice"), or scanning a barcode. Add a customer (or leave it as a walk-in sale), then save.',
      },
      {
        q: 'Do I need to add my products before invoicing?',
        a: "No — you can type a freehand item on any invoice. Adding products to Inventory first is worth it once you're selling the same items repeatedly, since it lets you track stock, use barcode scanning, and get accurate profit numbers on Analytics.",
      },
      {
        q: "What's the difference between the Free and Pro plans?",
        a: 'Free includes a limited number of invoices per month (shown on your dashboard). Pro removes that limit and unlocks Analytics, Reports, and automated payment reminders. Upgrade any time from the Payments page.',
      },
    ],
  },
  {
    title: 'Invoices & payments',
    items: [
      {
        q: 'How do I share an invoice with a customer?',
        a: 'Every invoice gets its own link (shown after saving, or via "Share" from the invoice list) that works whether or not your customer has Reseeti — it opens as a clean receipt page they can view, pay, and download on any phone.',
      },
      {
        q: 'How does my customer actually pay?',
        a: "If you've connected Paystack, OPay, or Monnify, customers can pay directly from the invoice link. Otherwise, mark an invoice paid yourself once you've collected payment by cash, transfer, or any other method.",
      },
      {
        q: 'Can I send automatic payment reminders?',
        a: 'Yes — turn on SMS and/or WhatsApp reminders in Business Settings, and set how many days after an invoice is issued to nudge an unpaid customer. Reminders also send automatically until an invoice is paid.',
      },
      {
        q: "What's the difference between the WhatsApp Share button and WhatsApp reminders?",
        a: 'The Share button opens WhatsApp with a message ready for you to review and send by hand. WhatsApp reminders (Business Settings) send automatically, no tap needed, via WhatsApp\'s official Business API.',
      },
    ],
  },
  {
    title: 'Working offline',
    items: [
      {
        q: 'What happens if I lose internet while making a sale?',
        a: "Nothing is lost — invoices save to your device instantly and sync to the server the moment you're back online, automatically. You'll see a small badge showing how many sales are waiting to sync.",
      },
      {
        q: 'Can I edit products or customers while offline?',
        a: "Yes — edits queue the same way and sync once you're back online. If someone else edited the exact same record on another device in the meantime, you'll be asked which version to keep.",
      },
    ],
  },
  {
    title: 'Team & roles',
    items: [
      {
        q: 'Can I add staff to my account?',
        a: "Yes — from the Team page, invite someone by phone number and assign a role (Manager, Cashier, Salesperson, or Accountant). Each role has different permissions — Team shows exactly what each can and can't do.",
      },
      {
        q: 'Can staff members turn on two-factor authentication for themselves?',
        a: "Yes — 2FA, device management, and login alerts are personal account settings on the Security page, available to every team member regardless of role.",
      },
    ],
  },
  {
    title: 'AI features',
    items: [
      {
        q: 'Does the AI ever save something without me reviewing it?',
        a: 'No — every AI feature (Invoice Assistant, Business Insights, Receipt Categorization) only ever fills in a form or suggests text. You always review and confirm before anything saves.',
      },
      {
        q: "What if the AI gets a receipt amount or invoice item wrong?",
        a: "Just correct it before saving — nothing is final until you submit the form. Unmatched invoice items are deliberately left with no price pre-filled, so a misheard item can't silently become a wrong charge.",
      },
    ],
  },
  {
    title: 'Backups & your data',
    items: [
      {
        q: 'How do I get a copy of all my business data?',
        a: 'Settings → Export Data downloads a complete JSON copy of your customers, products, invoices, and expenses immediately. You can also connect Google Drive, Dropbox, or OneDrive for automatic daily backups to your own cloud account.',
      },
      {
        q: 'Can I bulk-import existing customers or products?',
        a: 'Yes — Customers and Inventory both have an Import option that accepts a CSV or Excel file, with a downloadable template showing the expected columns.',
      },
    ],
  },
  {
    title: 'Troubleshooting',
    items: [
      {
        q: "My thermal printer/barcode scanner isn't working.",
        a: "Bluetooth and USB printing need Chrome or Edge (not Safari — Apple doesn't support the required browser features on any iOS browser). Barcode scanners that plug in or pair as a keyboard need no setup at all; just make sure the scan box is focused before scanning.",
      },
      {
        q: 'I think someone else has access to my account.',
        a: 'Go to Security → "Sign out of all other devices" immediately — this ends every session except the one you\'re using right now. Then check your device list and consider turning on two-factor authentication.',
      },
    ],
  },
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          background: 'none', border: 'none', textAlign: 'left', padding: '14px 0', cursor: 'pointer',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14.5 }}>{q}</span>
        <span style={{ color: 'var(--text-faint)', fontSize: 18, flexShrink: 0 }}>{open ? '−' : '+'}</span>
      </button>
      {open && <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.65 }}>{a}</p>}
    </div>
  );
}

export default function HelpPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <Logo size={32} showWordmark />
        </Link>
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px 80px' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 28, margin: '0 0 8px' }}>
          Help &amp; FAQ
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 32px' }}>
          Common questions about using Reseeti. Can't find what you need? Use the feedback button in the app to
          reach us directly.
        </p>

        <HelpTutorials />

        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 20, margin: '0 0 16px' }}>
          Frequently asked questions
        </h1>

        {FAQ_SECTIONS.map((section) => (
          <div key={section.title} style={{ marginBottom: 28 }}>
            <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 16, margin: '0 0 4px' }}>
              {section.title}
            </h2>
            {section.items.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        ))}

        <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 40 }}>
          <Link href="/privacy" style={{ color: 'var(--text-muted)' }}>Privacy Policy</Link>
          {' · '}
          <Link href="/terms" style={{ color: 'var(--text-muted)' }}>Terms of Service</Link>
          {' · '}
          <Link href="/login" style={{ color: 'var(--text-muted)' }}>Back to Reseeti</Link>
        </p>
      </main>
    </div>
  );
}
