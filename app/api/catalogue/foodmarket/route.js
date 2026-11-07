import { setMarketplaceOptIn } from '../marketplaceOptIn';
import { MARKETPLACES } from '../../../../lib/marketplaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// "List on Owerri Food Market" for the signed-in owner's business: a choice of its own, separate from Jobtins.
// The rules are shared with every marketplace (../marketplaceOptIn.js).
export async function POST(req) {
  return setMarketplaceOptIn(req, MARKETPLACES.foodmarket);
}
