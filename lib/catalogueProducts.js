// Loads the products a business shows in its online catalogue.
//
// Some columns only exist once a database update has been run: `photos` (stage 61) and the wholesale columns (stage 63).
// Asking for a column that is not there makes the WHOLE query fail, which would make the shop look empty. So each such group
// of columns is requested, and if the database says one of them is missing, that group alone is dropped and the question is
// asked again. A shop therefore keeps working whichever updates have been run, just without the newer features.
export const OPTIONAL_COLUMN_GROUPS = {
  photos: ['photos'],
  wholesale: ['sale_mode', 'moq', 'price_tiers', 'price_updated_at'],
};

// Runs `run(columns)` (which must return { data, error }) with the base columns plus the named optional groups, dropping
// any group the database reports as missing. Anything else wrong is returned as it is.
export async function queryWithOptionalColumns(run, baseColumns, groupNames) {
  let active = [...groupNames];
  for (;;) {
    const columns = [baseColumns, ...active.flatMap((g) => OPTIONAL_COLUMN_GROUPS[g])].join(', ');
    const result = await run(columns);
    if (!result.error) return result;
    const message = String(result.error.message || '');
    const missing = active.find((g) => OPTIONAL_COLUMN_GROUPS[g].some((c) => new RegExp(`\\b${c}\\b`, 'i').test(message)));
    if (!missing) return result;
    active = active.filter((g) => g !== missing);
  }
}

export function selectCatalogueProducts(supabase, businessId, baseColumns, { limit } = {}) {
  return queryWithOptionalColumns((columns) => {
    let query = supabase
      .from('products')
      .select(columns)
      .eq('business_id', businessId)
      .eq('show_in_catalogue', true)
      .order('category')
      .order('name');
    if (limit) query = query.limit(limit);
    return query;
  }, baseColumns, ['photos', 'wholesale']);
}
