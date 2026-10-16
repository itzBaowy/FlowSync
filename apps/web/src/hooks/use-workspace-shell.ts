'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { dashboardSchema } from '@flowsync/contracts';
import { toast } from 'sonner';
import { ApiError, api, refreshSession, setAccessToken } from '@/lib/api';
export function useWorkspaceShell() {
  const router = useRouter();
  const client = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: refreshSession,
    retry: false,
    staleTime: Infinity,
  });
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => dashboardSchema.parse(await api('/dashboard')),
    enabled: !!session.data,
    refetchInterval: 30000,
  });
  const unauthorized = session.error instanceof ApiError && session.error.status === 401;
  useEffect(() => {
    if (unauthorized) router.replace('/login');
  }, [unauthorized, router]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        navigationRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ??
          [],
      ).filter((node) => node.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener('change', closeOnDesktop);
      document.removeEventListener('keydown', handleKey);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [mobileOpen]);
  async function logout() {
    setLoggingOut(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      setAccessToken(null);
      client.clear();
      router.replace('/login');
    } catch {
      toast.error('Could not sign out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  }
  return {
    session,
    dashboard,
    unauthorized,
    mobileOpen,
    setMobileOpen,
    loggingOut,
    logout,
    navigationRef,
  };
}
