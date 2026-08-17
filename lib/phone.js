// Supabase's own auth.users.phone is stored WITHOUT a leading '+'
// (confirmed directly against a real account earlier) — e.g.
// "2348068744434", not "+2348068744434". Every place that writes a
// phone number intended to later match against auth.users.phone (most
// importantly, a staff invite in business_members, which
// handle_new_user() matches via `where phone = new.phone` on signup)
// must use this exact format, or the match silently never happens.
// This was the root cause of invites never actually auto-linking, even
// for a genuinely brand-new phone number — team/page.js had its own
// local toE164() that added a '+', which this replaces.
export function toE164NoPlus(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  if (digits.startsWith('234')) return digits;
  return '234' + digits;
}

// For display only (e.g. showing a phone number back to a user) — never
// use this on anything that gets compared against auth.users.phone or
// stored in business_members.phone.
export function formatPhoneDisplay(phone) {
  const digits = toE164NoPlus(phone);
  return `+${digits}`;
}
