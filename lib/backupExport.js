// Builds one self-contained JSON snapshot of a business's data — used by
// every cloud backup provider (lib/cloudBackup.js just uploads whatever
// this returns; it doesn't know or care about the shape). Plain JSON
// rather than a zip of CSVs: no new dependency needed (no zip library in
// this project), and a single JSON file is just as restorable — see
// README_STAGE24.md's "left out" section for the CSV/zip tradeoff.

export async function buildBackupPayload(admin, business) {
  const [{ data: customers }, { data: products }, { data: invoices }, { data: expenses }] = await Promise.all([
    admin.from('customers').select('*').eq('business_id', business.id),
    admin.from('products').select('*').eq('business_id', business.id),
    admin.from('invoices').select('*, invoice_items(*)').eq('business_id', business.id),
    admin.from('expenses').select('*').eq('business_id', business.id),
  ]);

  const payload = {
    reseeti_backup_version: 1,
    generated_at: new Date().toISOString(),
    business: {
      id: business.id,
      name: business.name,
      phone: business.phone,
      address: business.address,
    },
    customers: customers || [],
    products: products || [],
    invoices: invoices || [],
    expenses: expenses || [],
  };

  return JSON.stringify(payload, null, 2);
}

// Sanitized so it's safe as a filename across every provider — Windows
// (which OneDrive users are overwhelmingly on) rejects several
// characters that a business name could easily contain (e.g. "Ade & Sons
// Ltd." has none of these, but "24/7 Mart" has a slash).
export function backupFilename(businessName) {
  const safeName = (businessName || 'Business').replace(/[\\/:*?"<>|]/g, '-');
  const date = new Date().toISOString().slice(0, 10);
  return `Reseeti Backup - ${safeName} - ${date}.json`;
}
