import LegalPageLayout from '../components/LegalPageLayout';

const h2 = { fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 18, margin: '28px 0 10px' };
const h3 = { fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 15, margin: '18px 0 6px' };

export const metadata = { title: 'Privacy Policy — Reseeti' };

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="July 2026">
      <p>
        Reseeti ("we," "us") provides invoicing and business-management software for small and medium
        businesses. This policy explains what information we collect through Reseeti, why, who we share it with,
        and what control you have over it.
      </p>

      <h2 style={h2}>1. Who this applies to</h2>
      <p>
        Two kinds of people's data pass through Reseeti: <strong>business owners and their staff</strong> (who sign
        up, log in, and use the app), and <strong>those businesses' own customers</strong> (whose names, phone
        numbers, and invoice details a business owner enters into Reseeti to create invoices). If you're a
        customer of a business that uses Reseeti, Reseeti is a data processor acting on that business's
        instructions — for questions about your own data, contact that business directly, not Reseeti.
      </p>

      <h2 style={h2}>2. Information we collect</h2>
      <h3 style={h3}>From business owners and staff (account holders)</h3>
      <ul>
        <li>Phone number, used for account sign-in (one-time SMS codes) and, if turned on, login-alert texts.</li>
        <li>Business name, address, and logo, as entered in Business Settings.</li>
        <li>Two-factor authentication setup (an authenticator app secret, if enabled) and a list of devices that
          have signed in, used for account security.</li>
        <li>Payment details when upgrading to Pro — handled directly by Paystack, OPay, or Monnify; Reseeti never
          receives or stores card numbers.</li>
      </ul>
      <h3 style={h3}>Entered by the business, about their own customers</h3>
      <ul>
        <li>Customer names, phone numbers, and (optionally) email addresses, addresses, and tax IDs.</li>
        <li>Invoice contents: items, prices, quantities, payment status.</li>
        <li>A signature image, if a customer signs an invoice electronically.</li>
      </ul>
      <h3 style={h3}>Collected automatically</h3>
      <ul>
        <li>Basic device/browser information (used for the Security page's device list and to detect a sign-in
          from an unrecognized device).</li>
        <li>Usage events (e.g. an invoice marked paid, a reminder sent) — used for the in-app Activity Log and to
          understand how the product is used.</li>
        <li>Error reports (via Sentry) when something goes wrong, to help us fix it — see Section 4.</li>
      </ul>

      <h2 style={h2}>3. How we use this information</h2>
      <p>To operate the core service (creating and sharing invoices, tracking payments, managing inventory and
        customers); to send the messages a business owner asks Reseeti to send (payment reminders via SMS/WhatsApp,
        login alerts); to process subscription payments; to provide customer support when contacted; to detect and
        prevent abuse or fraud; and to improve the product.</p>
      <p>
        <strong>AI features</strong> (the Invoice Assistant, Business Insights, and Receipt Categorization) send
        the relevant text or image to a third-party AI provider to process. Business Insights only ever sends
        aggregated numbers (totals, counts), never raw customer names or phone numbers. The Invoice Assistant and
        Receipt Categorization do process the text/image you provide directly, which may include customer names.
      </p>

      <h2 style={h2}>4. Who we share information with</h2>
      <p>Reseeti uses the following sub-processors to operate the service. Each only receives the data needed for
        its specific function:</p>
      <ul>
        <li><strong>Supabase</strong> — database, authentication, and file storage (all business data lives here).</li>
        <li><strong>Twilio</strong> — sends SMS reminders and login alerts.</li>
        <li><strong>Meta (WhatsApp Business Platform)</strong> — sends WhatsApp reminders, if enabled.</li>
        <li><strong>Resend</strong> — sends transactional emails (invoice emails, feedback notifications).</li>
        <li><strong>Paystack, OPay, and Monnify</strong> — process Pro subscription payments.</li>
        <li>An AI provider (Anthropic or Google, depending on configuration) — processes the specific AI-feature
          requests described in Section 3.</li>
        <li><strong>Google Drive, Dropbox, or OneDrive</strong> — only if a business owner explicitly connects one,
          to receive that business's own data backups.</li>
        <li><strong>Sentry</strong> — receives error reports (stack traces, error messages) to help diagnose bugs.
          Request bodies and full user data are deliberately excluded from what's sent.</li>
      </ul>
      <p>We do not sell personal information to anyone, ever.</p>

      <h2 style={h2}>5. Data retention and backups</h2>
      <p>
        Business data is retained for as long as the account is active. Automated backups run daily (both a
        platform-wide backup we maintain, and — for businesses that opt in — a copy sent to that business's own
        connected cloud storage). Backups are retained on a rolling basis and are not kept indefinitely.
      </p>

      <h2 style={h2}>6. Security</h2>
      <p>
        Data in transit is encrypted (HTTPS). Passwords aren't used at all — sign-in is by one-time SMS code,
        optionally with a second authenticator-app factor. Sensitive tokens (e.g. connected cloud-storage access)
        are encrypted at rest. Offline data cached on a device is encrypted using a key that never leaves that
        device. See our Security settings page for the account-level controls available to you (two-factor
        authentication, session management, login alerts).
      </p>

      <h2 style={h2}>7. Your rights</h2>
      <p>
        You can access, correct, or delete most of your own data directly within Reseeti (customer records,
        products, business settings). You can export a full copy of your business's data at any time from
        Settings → Export Data. To delete your account entirely, contact us using the details below.
      </p>

      <h2 style={h2}>8. Children's privacy</h2>
      <p>Reseeti is a business tool, not directed at children, and we don't knowingly collect information from
        anyone under 18.</p>

      <h2 style={h2}>9. Changes to this policy</h2>
      <p>We'll update the "Last updated" date above when this policy changes. Material changes will be
        communicated in-app.</p>

      <h2 style={h2}>10. Contact</h2>
      <p>Questions about this policy or your data can be sent through the in-app Feedback button, or to the
        business's own registered support contact.</p>
    </LegalPageLayout>
  );
}
