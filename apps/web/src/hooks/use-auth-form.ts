'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  authSessionSchema,
  registerSchema,
  loginSchema,
  type RegisterInput,
  type LoginInput,
} from '@flowsync/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, setAccessToken } from '@/lib/api';
import { authDestination } from '@/lib/navigation';
export function useAuthForm(mode: 'login' | 'register') {
  const registering = mode === 'register';
  const router = useRouter();
  const client = useQueryClient();
  const destination = authDestination(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<LoginInput | RegisterInput>({
    resolver: zodResolver(registering ? registerSchema : loginSchema),
    defaultValues: registering
      ? { name: '', email: '', password: '' }
      : { email: '', password: '' },
  });
  async function onSubmit(values: LoginInput | RegisterInput) {
    setError(null);
    try {
      const session = authSessionSchema.parse(
        await api<unknown>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(values) }),
      );
      setAccessToken(session.accessToken);
      client.setQueryData(['session'], session);
      toast.success(registering ? 'Your account is ready' : 'Welcome back');
      router.replace(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    }
  }
  const errors = form.formState.errors as Partial<
    Record<keyof RegisterInput, { message?: string }>
  >;
  return {
    form,
    errors,
    error,
    registering,
    destination,
    showPassword,
    togglePassword: () => setShowPassword((visible) => !visible),
    onSubmit,
  };
}
