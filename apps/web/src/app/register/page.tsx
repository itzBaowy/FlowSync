import { AuthForm } from '@/components/auth-form';
import { Suspense } from 'react';
export default function RegisterPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading registration…</p>}>
      <AuthForm mode="register" />
    </Suspense>
  );
}
