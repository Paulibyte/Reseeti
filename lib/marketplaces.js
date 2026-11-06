// The shopping sites ("marketplaces") that can show a Reseeti business's public catalogue, and the owner's separate
// choice for each. Appearing on one is NOT consent to appear on another, so each has its own switch (a column on
// `businesses`), its own route, and its own history on the Activity page.
//
// To add another marketplace: add it here, add its two columns in a new schema_stageNN.sql, add a route that calls
// setMarketplaceOptIn (copy app/api/catalogue/homeease/route.js), and add its labels to the Activity page.

export const MARKETPLACES = {
  jobtins: {
    key: 'jobtins',
    name: 'Jobtins',
    optIn: 'jobtins_opt_in',
    optInAt: 'jobtins_opt_in_at',
    blurb: 'Jobtins is a shopping site that shows products from Reseeti shops in one place, so more people can find yours.',
  },
  homeease: {
    key: 'homeease',
    name: 'HomeEase Nigeria',
    optIn: 'homeease_opt_in',
    optInAt: 'homeease_opt_in_at',
    blurb: 'HomeEase Nigeria is a shopping site for the home (building materials, furniture, appliances, décor and home services) that shows products from Reseeti shops in one place, so more people can find yours.',
  },
};

// A marketplace that asks for a feed without saying which it is (every Jobtins release before HomeEase existed)
// is Jobtins.
export const DEFAULT_MARKETPLACE = 'jobtins';

// The marketplace named by a request, or null if the name is not one we know. An unknown name is never guessed at.
export function marketplaceFor(name) {
  const key = String(name ?? DEFAULT_MARKETPLACE).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MARKETPLACES, key) ? MARKETPLACES[key] : null;
}
