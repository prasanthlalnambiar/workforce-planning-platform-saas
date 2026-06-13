import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function LoginPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return (
    <main className="login-shell">
      <section className="card login-card">
        <p className="eyebrow">Phase 1 SaaS foundation</p>
        <h1>Sign in</h1>
        <p className="lede">Use Supabase Auth to access the tenant-scoped workspace.</p>
        {configured ? (
          <Suspense fallback={<p>Loading sign-in form...</p>}>
            <LoginForm />
          </Suspense>
        ) : (
          <p>Supabase environment variables are not configured yet. Copy `.env.example` to `.env.local` and add your project URL and anon key.</p>
        )}
      </section>
    </main>
  );
}
