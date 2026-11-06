import { setMarketplaceOptIn } from '../marketplaceOptIn';
import { MARKETPLACES } from '../../../../lib/marketplaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// "List on Jobtins" for the signed-in owner's business. The rules are shared with every marketplace
// (../marketplaceOptIn.js).
export async function POST(req) {
  return setMarketplaceOptIn(req, MARKETPLACES.jobtins);
}
