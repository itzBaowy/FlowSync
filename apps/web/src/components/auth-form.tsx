'use client';
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
import Link from 'next/link';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, setAccessToken } from '@/lib/api';
import { authDestination } from '@/lib/navigation';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const registering = mode === 'register';
  const router = useRouter();
  const client = useQueryClient();
  const destination = authDestination(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
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
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      <aside className="relative hidden flex-col justify-between bg-[#171b2a] p-12 text-white lg:flex xl:p-16">
        <Logo href="/login" />
        <div className="max-w-lg">
          <div className="mb-6 text-xs font-medium tracking-[.2em] text-indigo-300">
            A LITTLE LESS CHAOS. A LOT MORE FLOW.
          </div>
          <h1 className="text-5xl font-semibold leading-[1.15] tracking-tight">
            Great work starts
            <br />
            with a shared space.
          </h1>
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-slate-400">
            Bring your team, projects, and conversations together. Make room for what matters.
          </p>
          <div className="mt-10 space-y-4 text-sm text-slate-300">
            {[
              'A clear home for every project',
              'Built for teams that move together',
              'Thoughtful tools, without the noise',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <Check size={16} className="text-indigo-300" />
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px w-8 bg-slate-600" />
          Your next great idea belongs here.
        </div>
      </aside>
      <section className="relative flex flex-col px-6 py-6 sm:px-12">
        <header className="flex items-center justify-between">
          <div className="lg:invisible">
            <Logo href="/login" />
          </div>
          <ThemeToggle />
        </header>
        <div className="m-auto w-full max-w-[380px] py-12">
          <span className="mb-6 inline-flex rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            Welcome to your workspace
          </span>
          <h2 className="text-3xl font-semibold tracking-tight">
            {registering ? 'Start something great.' : 'Back in your flow.'}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {registering
              ? 'Create your account to get started with FlowSync.'
              : 'Sign in to pick up where you left off.'}
          </p>
          <form className="mt-8 space-y-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            {registering && (
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="name">
                  Full name
                </label>
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="Your name"
                  {...form.register('name')}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                />
                {errors.name && (
                  <p id="name-error" className="mt-1.5 text-xs text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="email">
                Work email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                {...form.register('email')}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <p id="email-error" className="mt-1.5 text-xs text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete={registering ? 'new-password' : 'current-password'}
                placeholder={registering ? 'At least 12 characters' : 'Enter your password'}
                {...form.register('password')}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
              />
              {errors.password && (
                <p id="password-error" className="mt-1.5 text-xs text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <Button type="submit" className="h-11 w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  {registering ? 'Create account' : 'Sign in'}
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>
          <p className="mt-7 text-center text-sm text-muted-foreground">
            {registering ? 'Already part of the team?' : 'New to FlowSync?'}{' '}
            <Link
              className="font-medium text-primary hover:underline"
              href={`${registering ? '/login' : '/register'}${destination.startsWith('/invite?') ? `?next=${encodeURIComponent(destination)}` : ''}`}
            >
              {registering ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
        <footer className="text-center text-xs text-muted-foreground">
          A calmer place to do your best work.
        </footer>
      </section>
    </main>
  );
}
