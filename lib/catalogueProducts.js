// Loads the products a business shows in its online catalogue, including each product's list of photos.
//
// If the database has not had the stage 61 update yet there is no `photos` column, and asking for it makes the whole
// query fail, which would make the shop look empty. So that one failure is met by asking again without it: the shop
// then shows each product's cover photo, exactly as it did before several photos existed.
export async function selectCatalogueProducts(supabase, businessId, baseColumns, { limit } = {}) {
  const run = (columns) => {
    let query = supabase
      .from('products')
      .select(columns)
      .eq('business_id', businessId)
      .eq('show_in_catalogue', true)
      .order('category')
      .order('name');
    if (limit) query = query.limit(limit);
    return query;
  };
  const first = await run(`${baseColumns}, photos`);
  if (first.error && /photos/i.test(first.error.message || '')) return run(baseColumns);
  return first;
}
