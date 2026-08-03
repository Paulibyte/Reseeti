import LegalPageLayout from '../components/LegalPageLayout';

const h2 = { fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 18, margin: '28px 0 10px' };

export const metadata = { title: 'Terms of Service — Reseeti' };

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="July 2026">
      <p>
        These terms govern your use of Reseeti. By creating an account, you agree to them. If you're using
        Reseeti on behalf of a business, you're confirming you have the authority to agree on that business's
        behalf.
      </p>

      <h2 style={h2}>1. The service</h2>
      <p>
        Reseeti provides invoicing, inventory, customer, and expense-tracking tools for small and medium
        businesses, along with optional AI-assisted features, payment reminders, and data backup tools. We may
        add, change, or remove features over time.
      </p>

      <h2 style={h2}>2. Accounts</h2>
      <p>
        Accounts sign in by phone number and one-time SMS code, optionally with two-factor authentication. You're
        responsible for keeping access to your registered phone number secure — anyone with access to it can sign
        in to your account. Use the Security page's login alerts and "sign out of all other devices" if you
        suspect unauthorized access.
      </p>

      <h2 style={h2}>3. Plans and billing</h2>
      <p>
        Reseeti offers a Free plan (limited monthly invoices) and a Pro plan (unlimited, paid monthly). Pro
        subscriptions via Paystack renew automatically each billing period until cancelled. If a renewal payment
        fails, your account enters a 7-day grace period during which Pro features continue to work; if payment
        isn't resolved within that window, your account reverts to the Free plan. You can cancel or change your
        plan at any time from the Payments page. Fees already charged are non-refundable except where required by
        law.
      </p>

      <h2 style={h2}>4. Acceptable use</h2>
      <p>You agree not to use Reseeti to: violate any law; send unsolicited bulk messages through the reminder
        features; attempt to bypass plan limits, rate limits, or other technical restrictions; interfere with the
        service's operation; or access another business's data without authorization.</p>

      <h2 style={h2}>5. Your data</h2>
      <p>
        You (the business) own the data you enter into Reseeti — customer records, invoices, products, and
        everything else. We process it to provide the service, as described in our Privacy Policy. You're
        responsible for the accuracy of the data you enter and for having any necessary rights or consents to
        store your customers' information.
      </p>

      <h2 style={h2}>6. AI features</h2>
      <p>
        The AI Invoice Assistant, Business Insights, and Receipt Categorization features use third-party AI
        models and can make mistakes — a misread receipt amount, a misheard sale description, an inaccurate
        insight. These features are designed to require your review before anything is saved (an AI suggestion
        never saves itself), and you're responsible for checking their output before relying on it, particularly
        anything involving money.
      </p>

      <h2 style={h2}>7. Third-party integrations</h2>
      <p>
        Features that connect to WhatsApp, Google Drive, Dropbox, OneDrive, or payment gateways depend on those
        providers' own availability and terms. We're not responsible for outages, changes, or failures on their
        end, though we'll make reasonable efforts to keep integrations working.
      </p>

      <h2 style={h2}>8. Availability</h2>
      <p>
        We aim for high availability but don't guarantee the service will be uninterrupted or error-free. Offline
        support (the offline invoice queue, cached data) is designed to reduce the impact of connectivity issues,
        not eliminate all risk of data loss in extreme cases.
      </p>

      <h2 style={h2}>9. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Reseeti is provided "as is," and we're not liable for indirect,
        incidental, or consequential damages arising from your use of the service, including lost revenue or lost
        data, beyond fees paid to us in the preceding 12 months.
      </p>

      <h2 style={h2}>10. Termination</h2>
      <p>
        You can stop using Reseeti and request account deletion at any time. We may suspend or terminate accounts
        that violate these terms, with notice where practical.
      </p>

      <h2 style={h2}>11. Governing law</h2>
      <p>These terms are governed by the laws of the Federal Republic of Nigeria, without regard to conflict-of-law
        principles.</p>

      <h2 style={h2}>12. Changes</h2>
      <p>We'll update the "Last updated" date above when these terms change, and communicate material changes
        in-app.</p>

      <h2 style={h2}>13. Contact</h2>
      <p>Questions about these terms can be sent through the in-app Feedback button.</p>
    </LegalPageLayout>
  );
}
