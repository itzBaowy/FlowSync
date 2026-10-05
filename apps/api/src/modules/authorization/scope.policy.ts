import type { OrganizationRole } from '@flowsync/contracts';
export function managesOrganizationScope(role: OrganizationRole) {
  return role === 'OWNER' || role === 'ADMIN';
}
export function readsPrivateScope(role: OrganizationRole, membership: boolean) {
  return managesOrganizationScope(role) || membership;
}
