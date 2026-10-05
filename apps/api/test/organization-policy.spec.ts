import { describe, expect, it } from 'vitest';
import {
  invitationInputSchema,
  organizationInputSchema,
  memberRoleSchema,
} from '@flowsync/contracts';
import {
  canAccessOrganization,
  type OrganizationPermission,
} from '../src/modules/authorization/organization.policy';

describe('organization policy', () => {
  const privileged: OrganizationPermission[] = [
    'update',
    'delete',
    'manage_members',
    'transfer_owner',
  ];
  it('allows owner management and denies member/admin management', () => {
    for (const permission of privileged) {
      expect(canAccessOrganization('OWNER', permission)).toBe(true);
      expect(canAccessOrganization('ADMIN', permission)).toBe(false);
      expect(canAccessOrganization('MEMBER', permission)).toBe(false);
    }
  });
  it('gates admin invitations on current organization settings', () => {
    expect(canAccessOrganization('ADMIN', 'invite', true)).toBe(true);
    expect(canAccessOrganization('ADMIN', 'invite', false)).toBe(false);
    expect(canAccessOrganization('MEMBER', 'invite')).toBe(false);
    expect(canAccessOrganization('OWNER', 'invite', false)).toBe(true);
  });
  it('allows all tenant member roles to read their organization', () => {
    for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as const)
      expect(canAccessOrganization(role, 'read')).toBe(true);
  });
  it('blocks owner role injection and malformed organization slugs', () => {
    expect(memberRoleSchema.safeParse({ role: 'OWNER' }).success).toBe(false);
    expect(
      invitationInputSchema.safeParse({ email: 'test@example.com', role: 'OWNER' }).success,
    ).toBe(false);
    expect(organizationInputSchema.safeParse({ name: 'Acme', slug: '../admin' }).success).toBe(
      false,
    );
    expect(invitationInputSchema.parse({ email: 'TEST@EXAMPLE.COM' }).email).toBe(
      'test@example.com',
    );
  });
});
