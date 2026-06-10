'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase/client';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState('');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      return;
    }
    router.push(searchParams?.get('redirectedFrom') || '/workspace');
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" required />
      </label>
      <button className="button" type="submit">Sign in</button>
      {message ? <p>{message}</p> : null}
    </form>
  );
}
