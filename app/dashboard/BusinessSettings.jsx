'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import AppVersion from './AppVersion';
import { csrfFetch } from '../../lib/csrfFetch';

export default function BusinessSettings({ business, onSaved, onClose }) {
  const supabase = createClient();
  const [name, setName] = useState(business.name || '');
  const [phone, setPhone] = useState(business.phone || '');
  const [address, setAddress] = useState(business.address || '');
  const [invoicePrefix, setInvoicePrefix] = useState(business.invoice_prefix || 'INV');
  const [logoUrl, setLogoUrl] = useState(business.logo_url || '');
  const [bankName, setBankName] = useState(business.bank_name || '');
  const [bankAccountName, setBankAccountName] = useState(business.bank_account_name || '');
  const [bankAccountNumber, setBankAccountNumber] = useState(business.bank_account_number || '');
  const [termsAndConditions, setTermsAndConditions] = useState(business.terms_and_conditions || '');
  const [signatureUrl, setSignatureUrl] = useState(business.signature_url || '');
  const [vatEnabled, setVatEnabled] = useState(business.vat_enabled || false);
  const [defaultVatRate, setDefaultVatRate] = useState(business.default_vat_rate ?? 7.5);
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(business.service_charge_enabled || false);
  const [defaultServiceChargeRate, setDefaultServiceChargeRate] = useState(business.default_service_charge_rate ?? 0);
  const [whtEnabled, setWhtEnabled] = useState(business.withholding_tax_enabled || false);
  const [defaultWhtRate, setDefaultWhtRate] = useState(business.default_withholding_tax_rate ?? 0);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(business.loyalty_enabled || false);
  const [loyaltyThreshold, setLoyaltyThreshold] = useState(business.loyalty_purchase_threshold ?? 10);
  const [loyaltyPercent, setLoyaltyPercent] = useState(business.loyalty_discount_percent ?? 5);
  const [smsRemindersEnabled, setSmsRemindersEnabled] = useState(business.sms_reminders_enabled || false);
  const [whatsappRemindersEnabled, setWhatsappRemindersEnabled] = useState(business.whatsapp_reminders_enabled || false);
  const [reminderDaysAfter, setReminderDaysAfter] = useState(business.reminder_days_after ?? 3);
  const [sendingTestReminders, setSendingTestReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState(null);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Catalogue module — whatsappNumber saves through the normal save()
  // flow below like any other field, but catalogueEnabled deliberately
  // does NOT: it's Pro-gated, which RLS has no way to enforce on a plain
  // client update, so toggling it only ever happens through the two
  // dedicated API routes (see toggleCatalogue below).
  const [whatsappNumber, setWhatsappNumber] = useState(business.whatsapp_number || '');
  const [catalogueEnabled, setCatalogueEnabled] = useState(business.catalogue_enabled || false);
  const [catalogueSlug, setCatalogueSlug] = useState(business.catalogue_slug || null);
  const [togglingCatalogue, setTogglingCatalogue] = useState(false);
  const [catalogueError, setCatalogueError] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  async function toggleCatalogue() {
    setTogglingCatalogue(true);
    setCatalogueError('');
    const endpoint = catalogueEnabled ? '/api/catalogue/disable' : '/api/catalogue/enable';
    const res = await csrfFetch(endpoint, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setTogglingCatalogue(false);
    if (!res.ok) {
      setCatalogueError(data.error || 'Could not update the catalogue.');
      return;
    }
    setCatalogueEnabled(!catalogueEnabled);
    if (data.slug) setCatalogueSlug(data.slug);
  }

  function copyShopLink() {
    const url = `${window.location.origin}/shop/${catalogueSlug}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  function handlePrefixChange(value) {
    setInvoicePrefix(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2MB.');
      return;
    }

    setUploading(true);
    setError('');

    const ext = file.name.split('.').pop();
    const path = `${business.id}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(path, file, { upsert: true, cacheControl: '3600' });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(path);
    // Cache-bust so the new logo shows immediately instead of a stale
    // browser-cached version at the same URL.
    const freshUrl = `${data.publicUrl}?t=${Date.now()}`;
    setLogoUrl(freshUrl);
    setUploading(false);
  }

  async function handleSignatureUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Signature image must be under 2MB.');
      return;
    }

    setUploadingSignature(true);
    setError('');

    const ext = file.name.split('.').pop();
    // Reuses the same 'logos' storage bucket/policies as the business
    // logo — the RLS policy only checks the business_id folder, not the
    // filename, so this is a legitimate reuse rather than a workaround.
    const path = `${business.id}/signature.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(path, file, { upsert: true, cacheControl: '3600' });

    if (uploadError) {
      setError(uploadError.message);
      setUploadingSignature(false);
      return;
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(path);
    const freshUrl = `${data.publicUrl}?t=${Date.now()}`;
    setSignatureUrl(freshUrl);
    setUploadingSignature(false);
  }

  async function save() {
    if (invoicePrefix.length < 2) {
      setError('Invoice prefix must be at least 2 characters.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: updateError } = await supabase
      .from('businesses')
      .update({
        name, phone, address, logo_url: logoUrl, invoice_prefix: invoicePrefix,
        bank_name: bankName || null,
        bank_account_name: bankAccountName || null,
        bank_account_number: bankAccountNumber || null,
        terms_and_conditions: termsAndConditions || null,
        signature_url: signatureUrl || null,
        vat_enabled: vatEnabled,
        default_vat_rate: Number(defaultVatRate) || 0,
        service_charge_enabled: serviceChargeEnabled,
        default_service_charge_rate: Number(defaultServiceChargeRate) || 0,
        withholding_tax_enabled: whtEnabled,
        default_withholding_tax_rate: Number(defaultWhtRate) || 0,
        loyalty_enabled: loyaltyEnabled,
        loyalty_purchase_threshold: Math.max(Number(loyaltyThreshold) || 10, 1),
        loyalty_discount_percent: Number(loyaltyPercent) || 0,
        sms_reminders_enabled: smsRemindersEnabled,
        whatsapp_reminders_enabled: whatsappRemindersEnabled,
        reminder_days_after: Math.max(Number(reminderDaysAfter) || 3, 1),
        whatsapp_number: whatsappNumber || null,
      })
      .eq('id', business.id);
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    onSaved();
  }

  async function sendRemindersNow() {
    setSendingTestReminders(true);
    setReminderResult(null);
    try {
      const res = await csrfFetch('/api/reminders/send', { method: 'POST' });
      const data = await res.json();
      setReminderResult(res.ok ? data : { error: data.error || 'Failed to send reminders' });
    } catch (err) {
      setReminderResult({ error: err.message });
    }
    setSendingTestReminders(false);
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: 20, marginBottom: 24 }}>
      <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, fontSize: 16 }}>
        Business settings
      </h3>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 6, border: '1px dashed var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          background: 'var(--bg)', flexShrink: 0,
        }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center' }}>No logo</span>
          )}
        </div>
        <div>
          <label style={{
            display: 'inline-block', fontSize: 12.5, fontWeight: 700, color: 'var(--heading)',
            border: '1px solid var(--heading)', borderRadius: 4, padding: '7px 12px', cursor: 'pointer',
          }}>
            {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
            <input type="file" accept="image/*" onChange={handleLogoUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '6px 0 0' }}>PNG or JPG, under 2MB. Shows on shared invoices.</p>
        </div>
      </div>

      <input placeholder="Business name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
      <input placeholder="Address / area" value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle} />

      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
        Invoice prefix
      </label>
      <input
        placeholder="e.g. RST or ABJ"
        value={invoicePrefix}
        onChange={(e) => handlePrefixChange(e.target.value)}
        style={inputStyle}
      />
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '-6px 0 12px' }}>
        Your invoices will look like: <strong style={{ fontFamily: 'monospace' }}>{invoicePrefix || 'INV'}-{new Date().getFullYear()}-000001</strong>
      </p>

      <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 13.5, margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Bank transfer details
      </h4>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '-4px 0 10px' }}>
        Shown on receipts for unpaid invoices, with a QR code your customer can scan — this needs all three fields filled in to appear.
      </p>
      <input placeholder="Bank name (e.g. GTBank)" value={bankName} onChange={(e) => setBankName(e.target.value)} style={inputStyle} />
      <input placeholder="Account name" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} style={inputStyle} />
      <input placeholder="Account number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} style={inputStyle} />

      <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 13.5, margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Signature
      </h4>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <div style={{
          width: 90, height: 48, borderRadius: 6, border: '1px dashed var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          background: 'var(--bg)', flexShrink: 0,
        }}>
          {signatureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signatureUrl} alt="Signature" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <span style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center' }}>None yet</span>
          )}
        </div>
        <div>
          <label style={{
            display: 'inline-block', fontSize: 12.5, fontWeight: 700, color: 'var(--heading)',
            border: '1px solid var(--heading)', borderRadius: 4, padding: '7px 12px', cursor: 'pointer',
          }}>
            {uploadingSignature ? 'Uploading…' : signatureUrl ? 'Change signature' : 'Upload signature'}
            <input type="file" accept="image/*" onChange={handleSignatureUpload} disabled={uploadingSignature} style={{ display: 'none' }} />
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '6px 0 0' }}>
            A photo of your signature on plain paper works fine. Shown on every receipt as "Authorized signature."
          </p>
        </div>
      </div>

      <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 13.5, margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Taxes &amp; charges
      </h4>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '-4px 0 10px' }}>
        Default rates applied to new invoices — each can still be adjusted per invoice before saving.
      </p>

      <RateToggleRow
        label="VAT"
        enabled={vatEnabled}
        onToggle={setVatEnabled}
        rate={defaultVatRate}
        onRateChange={setDefaultVatRate}
      />
      <RateToggleRow
        label="Service charge"
        enabled={serviceChargeEnabled}
        onToggle={setServiceChargeEnabled}
        rate={defaultServiceChargeRate}
        onRateChange={setDefaultServiceChargeRate}
      />
      <RateToggleRow
        label="Withholding tax"
        enabled={whtEnabled}
        onToggle={setWhtEnabled}
        rate={defaultWhtRate}
        onRateChange={setDefaultWhtRate}
      />
      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '-2px 0 16px' }}>
        Withholding tax is deducted from the amount payable — mainly relevant if you invoice corporate clients who withhold tax at source.
      </p>

      <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 13.5, margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Loyalty discount
      </h4>
      <RateToggleRow
        label={`After every`}
        enabled={loyaltyEnabled}
        onToggle={setLoyaltyEnabled}
        rate={loyaltyPercent}
        onRateChange={setLoyaltyPercent}
        rateSuffix="% off"
        extraControl={
          <input
            type="number"
            min="1"
            value={loyaltyThreshold}
            onChange={(e) => setLoyaltyThreshold(e.target.value)}
            disabled={!loyaltyEnabled}
            style={{ width: 56, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13.5, background: loyaltyEnabled ? 'var(--bg)' : 'var(--surface-alt)', color: 'var(--text)' }}
          />
        }
      />
      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '-2px 0 16px' }}>
        Once a customer profile reaches this many <em>paid</em> invoices, the discount applies automatically next time they're picked in the invoice form — shown as a banner the cashier can turn off for that one sale if needed.
      </p>

      <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 13.5, margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        SMS reminders for unpaid invoices
      </h4>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>
          <input type="checkbox" checked={smsRemindersEnabled} onChange={(e) => setSmsRemindersEnabled(e.target.checked)} />
          Send automatically after
        </label>
        <input
          type="number"
          min="1"
          value={reminderDaysAfter}
          onChange={(e) => setReminderDaysAfter(e.target.value)}
          disabled={!smsRemindersEnabled}
          style={{ width: 56, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13.5, background: smsRemindersEnabled ? 'var(--bg)' : 'var(--surface-alt)', color: 'var(--text)' }}
        />
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>days unpaid</span>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '-2px 0 10px' }}>
        Sends a real SMS (not the WhatsApp link) — this costs money per message via Twilio and needs Twilio credentials
        set up separately from phone login. See README_STAGE16.md. Automatic daily sending only runs once this app is
        deployed (it needs a scheduled trigger that your local dev server can't provide) — use the button below to send
        a batch right now, any time, from wherever you're running this.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>
          <input type="checkbox" checked={whatsappRemindersEnabled} onChange={(e) => setWhatsappRemindersEnabled(e.target.checked)} />
          Also send via WhatsApp (Business API)
        </label>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '-10px 0 10px' }}>
        Sends automatically through Meta's WhatsApp Business Platform — different from the manual WhatsApp Share
        button elsewhere, which just opens a pre-filled chat for you to send by hand. Needs a WhatsApp Business
        Cloud API setup and an approved message template; see README_STAGE24.md. Uses the same "days unpaid" and
        "Send reminders now" as SMS above — a business can run either channel, both, or neither.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button
          type="button"
          onClick={sendRemindersNow}
          disabled={sendingTestReminders || (!smsRemindersEnabled && !whatsappRemindersEnabled)}
          style={{ background: 'none', border: '1px solid var(--heading)', color: 'var(--heading)', borderRadius: 4, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: (smsRemindersEnabled || whatsappRemindersEnabled) ? 'pointer' : 'not-allowed', opacity: (smsRemindersEnabled || whatsappRemindersEnabled) ? 1 : 0.5 }}
        >
          {sendingTestReminders ? 'Sending…' : 'Send reminders now'}
        </button>
        {reminderResult && (
          <span style={{ fontSize: 12.5, color: reminderResult.error ? 'var(--danger)' : 'var(--success)' }}>
            {reminderResult.error ? reminderResult.error : `Checked ${reminderResult.checked}, sent ${reminderResult.sent}${reminderResult.failed ? `, ${reminderResult.failed} failed` : ''}.`}
          </span>
        )}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '-4px 0 16px' }}>
        Save your settings below first if you just turned this on — the button uses whatever's currently saved.
      </p>

      <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 13.5, margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Online catalogue & WhatsApp ordering
      </h4>
      {business.plan !== 'pro' ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Share a public product catalogue and take orders straight to your WhatsApp — a Pro feature. Upgrade to turn it on.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -2, marginBottom: 10 }}>
            A shareable link showing everything you've marked "show in catalogue" on the Inventory page. Customers pick
            what they want and send you the order straight to WhatsApp — no separate app for them to install.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <button
              type="button"
              onClick={toggleCatalogue}
              disabled={togglingCatalogue}
              style={{
                background: catalogueEnabled ? 'var(--success-bg)' : 'var(--orange)',
                color: catalogueEnabled ? 'var(--success)' : '#fff',
                border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}
            >
              {togglingCatalogue ? 'Saving…' : catalogueEnabled ? 'Catalogue is ON — turn off' : 'Turn on catalogue'}
            </button>
            {catalogueEnabled && catalogueSlug && (
              <button
                type="button"
                onClick={copyShopLink}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, cursor: 'pointer' }}
              >
                {linkCopied ? 'Copied!' : `Copy link: /shop/${catalogueSlug}`}
              </button>
            )}
          </div>
          {catalogueError && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 8 }}>{catalogueError}</p>}

          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 8 }}>
            WhatsApp Business number for orders
          </label>
          <input
            type="tel"
            placeholder="e.g. 08012345678"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 4, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
          />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '0 0 16px' }}>
            Where "Order via WhatsApp" sends the customer — can be a different line than the one you log in with. Orders
            won't work until this is set and saved.
          </p>
        </>
      )}

      <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 13.5, margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Terms &amp; conditions
      </h4>
      <textarea
        placeholder="e.g. Goods sold are not returnable after 3 days. Payment due on delivery."
        value={termsAndConditions}
        onChange={(e) => setTermsAndConditions(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '-6px 0 12px' }}>
        Shown at the bottom of every receipt, if filled in.
      </p>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button onClick={save} disabled={saving || uploading} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 4, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <AppVersion />
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 14,
  marginBottom: 10,
  boxSizing: 'border-box',
  background: 'var(--bg)',
  color: 'var(--text)',
};

function RateToggleRow({ label, enabled, onToggle, rate, onRateChange, extraControl, rateSuffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      {extraControl}
      {extraControl && <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>purchases,</span>}
      <input
        type="number"
        min="0"
        step="0.1"
        value={rate}
        onChange={(e) => onRateChange(e.target.value)}
        disabled={!enabled}
        style={{ width: 80, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13.5, background: enabled ? 'var(--bg)' : 'var(--surface-alt)', color: 'var(--text)' }}
      />
      <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>{rateSuffix || '%'}</span>
    </div>
  );
}
