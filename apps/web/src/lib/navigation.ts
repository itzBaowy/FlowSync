import { invitationTokenSchema } from '@flowsync/contracts';

export function authDestination(value: string | null) {
  if (!value) return '/dashboard';
  try {
    const url = new URL(value, 'https://flowsync.local');
    const token = invitationTokenSchema.safeParse({ token: url.searchParams.get('token') });
    if (url.origin === 'https://flowsync.local' && url.pathname === '/invite' && token.success)
      return `/invite?token=${token.data.token}`;
  } catch {
    /* Invalid destinations return to the dashboard. */
  }
  return '/dashboard';
}
