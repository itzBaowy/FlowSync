import { AuthForm } from '@/components/auth-form';
import { Suspense } from 'react';
export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading sign in…</p>}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
