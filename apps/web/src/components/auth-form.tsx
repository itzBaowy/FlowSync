'use client';
import Link from 'next/link';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthForm } from '@/hooks/use-auth-form';
import { authCopy as copy } from '@/data/mockData';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { AuthPreview } from './auth-preview';
interface AuthFormProps {
  readonly mode: 'login' | 'register';
}
export function AuthForm({ mode }: AuthFormProps) {
  const { form, errors, error, registering, destination, showPassword, togglePassword, onSubmit } =
    useAuthForm(mode);
  return (
    <main className="grid min-h-dvh bg-card lg:grid-cols-[1.05fr_1fr]">
      <aside className="auth-story relative hidden flex-col justify-between border-r border-border px-10 py-9 lg:flex xl:px-16">
        <Logo href="/login" />
        <div className="mx-auto w-full max-w-lg py-12">
          <p className="mb-5 text-[9px] font-semibold tracking-[.18em] text-primary">
            {copy.eyebrow}
          </p>
          <h1 className="text-[44px] font-semibold leading-[1.12] tracking-[-.05em] xl:text-[52px]">
            {copy.headline[0]}
            <br />
            <span className="text-primary">{copy.headline[1]}</span>
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
            {copy.description}
          </p>
          <AuthPreview />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          {copy.footer}
        </p>
      </aside>
      <section className="relative flex flex-col px-6 py-7 sm:px-12">
        <header className="flex items-center justify-between">
          <div className="lg:invisible">
            <Logo href="/login" />
          </div>
          <ThemeToggle />
        </header>
        <div className="m-auto w-full max-w-[380px] py-12">
          <span className="mb-4 inline-flex text-[10px] font-semibold uppercase tracking-[.13em] text-primary">
            {registering ? 'YOUR NEXT CHAPTER' : 'WELCOME BACK'}
          </span>
          <h2 className="text-[32px] font-semibold tracking-[-.04em]">
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
              <div className="relative">
                <Input
                  className="pr-12"
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  placeholder={registering ? 'At least 12 characters' : 'Enter your password'}
                  {...form.register('password')}
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={togglePassword}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-primary"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
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
            <Button type="submit" className="h-12 w-full" disabled={form.formState.isSubmitting}>
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
          <p className="mt-7 border-t border-border pt-6 text-center text-xs text-muted-foreground">
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
