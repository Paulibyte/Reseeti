import { createAdminClient } from '../../../lib/supabaseAdmin';
import TutorialsManager from './TutorialsManager';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminTutorialsPage() {
  const supabase = createAdminClient();
  const { data: tutorials } = await supabase
    .from('help_tutorials')
    .select('*')
    .order('category', { ascending: true })
    .order('created_at', { ascending: false });

  return <TutorialsManager tutorials={tutorials || []} />;
}
