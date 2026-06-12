import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export default function ReforecastRedirectPage() {
  // The Phase 6 Reforecast Module lives at /reforecasts. This legacy placeholder
  // route redirects so existing links keep working.
  redirect('/reforecasts');
}
