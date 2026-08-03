import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { sendEmailWithAttachment } from '../../../../lib/resendEmail';
import { formatNaira } from '../../../../lib/format';

export const dynamic = 'force-dynamic';

// Called from the public receipt page (app/inv/[id]/ReceiptClient.jsx),
// which has no login wall — same as the existing WhatsApp share and
// Download PDF buttons. Since anyone with an invoice link can reach this
// endpoint, verificationCode (the same random code already shown on the
// receipt and checked at /verify/{code}) acts as proof the caller
// actually has this specific invoice open, not just a guessed/sequential
// id — closing off using this endpoint to mass-email arbitrary addresses
// by iterating invoice ids.
export async function POST(request) {
  const { invoiceId, verificationCode, to, pdfBase64, shareUrl } = await request.json();

  if (!invoiceId || !verificationCode || !to || !pdfBase64) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_name, total, business_id, verification_code')
    .eq('id', invoiceId)
    .single();

  if (!invoice || invoice.verification_code !== verificationCode) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const { data: business } = await admin
    .from('businesses')
    .select('name')
    .eq('id', invoice.business_id)
    .single();

  const businessName = business?.name || 'Your supplier';
  const greeting = invoice.customer_name ? `Dear ${invoice.customer_name},` : 'Hello,';

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1E3A5F; max-width: 480px;">
      <p>${greeting}</p>
      <p>Please find attached invoice <strong>${invoice.invoice_number}</strong> from <strong>${businessName}</strong>, for <strong>${formatNaira(invoice.total)}</strong>.</p>
      ${shareUrl ? `<p>You can also view, download, or pay it online here: <a href="${shareUrl}">${shareUrl}</a></p>` : ''}
      <p style="color: #8A8578; font-size: 12px; margin-top: 24px;">Sent via Reseeti on behalf of ${businessName}.</p>
    </div>
  `;

  try {
    await sendEmailWithAttachment({
      to,
      subject: `Invoice ${invoice.invoice_number} from ${businessName}`,
      html,
      attachmentBase64: pdfBase64,
      attachmentFilename: `${invoice.invoice_number}.pdf`,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to send email' }, { status: 502 });
  }

  await admin.from('events').insert({
    business_id: invoice.business_id,
    event_type: 'invoice_emailed',
    metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, to },
  }).then(() => {}).catch(() => {});

  return NextResponse.json({ ok: true });
}
