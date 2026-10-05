import type { OrganizationRole } from '@flowsync/contracts';

export type OrganizationPermission =
  'read' | 'update' | 'delete' | 'manage_members' | 'transfer_owner' | 'invite';
export function canAccessOrganization(
  role: OrganizationRole,
  permission: OrganizationPermission,
  allowAdminInvites = true,
): boolean {
  if (permission === 'read') return true;
  if (role === 'OWNER') return true;
  return permission === 'invite' && role === 'ADMIN' && allowAdminInvites;
}
