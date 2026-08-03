import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../lib/supabaseServer';
import { sendEmailWithAttachment } from '../../../lib/resendEmail';
import { verifyCsrfToken } from '../../../lib/csrf';
import { rateLimit } from '../../../lib/rateLimit';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['bug', 'idea', 'other'];
const CATEGORY_LABELS = { bug: '🐛 Bug report', idea: '💡 Idea', other: '💬 Feedback' };

export async function POST(request) {
  if (!verifyCsrfToken(request)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const { allowed } = await rateLimit(`feedback:${membership.businessId}`, { limit: 20, windowSeconds: 3600 });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many submissions — please wait a bit before sending more.' }, { status: 429 });
  }

  const { category, message, pageUrl, screenshotBase64 } = await request.json();
  if (!CATEGORIES.includes(category) || !message?.trim()) {
    return NextResponse.json({ error: 'Pick a category and write a message first.' }, { status: 400 });
  }
  // Screenshots are optional and capped well below Resend's attachment
  // limit — a full-page html2canvas capture is easily a few hundred KB,
  // and there's no reason a feedback screenshot needs to be huge.
  if (screenshotBase64 && screenshotBase64.length > 4 * 1024 * 1024) {
    return NextResponse.json({ error: 'That screenshot is too large.' }, { status: 413 });
  }

  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();

  let screenshotUrl = null;
  if (screenshotBase64) {
    const path = `${membership.businessId}/${Date.now()}.png`;
    const { error: uploadError } = await admin.storage
      .from('feedback-screenshots')
      .upload(path, Buffer.from(screenshotBase64, 'base64'), { contentType: 'image/png' });
    if (!uploadError) {
      const { data: signed } = await admin.storage.from('feedback-screenshots').createSignedUrl(path, 60 * 60 * 24 * 30);
      screenshotUrl = signed?.signedUrl || null;
    }
    // A failed screenshot upload doesn't block the feedback itself from
    // being recorded — the written message is the part that matters.
  }

  const { error: insertError } = await admin.from('feedback').insert({
    business_id: membership.businessId,
    user_id: user?.id || null,
    category,
    message: message.trim(),
    page_url: pageUrl || null,
    screenshot_url: screenshotUrl,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const notifyEmail = process.env.FEEDBACK_NOTIFICATION_EMAIL;
  if (notifyEmail) {
    try {
      await sendEmailWithAttachment({
        to: notifyEmail,
        subject: `${CATEGORY_LABELS[category]} — Reseeti feedback`,
        html: `
          <p><strong>Category:</strong> ${CATEGORY_LABELS[category]}</p>
          <p><strong>Business:</strong> ${membership.businessId}</p>
          <p><strong>Page:</strong> ${pageUrl || 'unknown'}</p>
          <p><strong>Message:</strong></p>
          <p>${message.trim().replace(/\n/g, '<br>')}</p>
          ${screenshotUrl ? `<p><a href="${screenshotUrl}">View screenshot</a> (link expires in 30 days)</p>` : ''}
        `,
      });
    } catch (err) {
      // The feedback is already safely stored in the database either
      // way — a failed notification email is a secondary concern, not
      // a reason to tell the person their feedback didn't go through.
      console.error('Feedback notification email failed:', err.message);
    }
  }

  return NextResponse.json({ ok: true });
}
