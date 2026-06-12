import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';


export const dynamic = 'force-dynamic';
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
