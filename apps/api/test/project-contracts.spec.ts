import { describe, it, expect } from 'vitest';
import {
  updateOrganizationSchema,
  projectInputSchema,
  projectUpdateSchema,
  workspaceUpdateSchema,
} from '@flowsync/contracts';
import {
  managesOrganizationScope,
  readsPrivateScope,
} from '../src/modules/authorization/scope.policy';
describe('project validation and scope policy', () => {
  it('keeps omitted PATCH fields absent instead of applying create defaults', () => {
    for (const schema of [updateOrganizationSchema, workspaceUpdateSchema, projectUpdateSchema])
      expect(schema.parse({ name: 'Name only' })).toEqual({ name: 'Name only' });
    expect(projectUpdateSchema.parse({ dueDate: null })).toEqual({ dueDate: null });
  });
  it('requires explicit scope membership for ordinary members', () => {
    expect(readsPrivateScope('MEMBER', false)).toBe(false);
    expect(readsPrivateScope('MEMBER', true)).toBe(true);
    expect(readsPrivateScope('ADMIN', false)).toBe(true);
    expect(managesOrganizationScope('MEMBER')).toBe(false);
  });
  it('rejects invalid dates, status and parent reassignment', () => {
    const valid = {
      name: 'A project',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      startDate: '2026-10-06T00:00:00.000Z',
      dueDate: '2026-10-07T00:00:00.000Z',
    };
    expect(projectInputSchema.safeParse(valid).success).toBe(true);
    expect(
      projectInputSchema.safeParse({ ...valid, dueDate: '2026-10-05T00:00:00.000Z' }).success,
    ).toBe(false);
    expect(projectUpdateSchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ workspaceId: valid.workspaceId }).success).toBe(false);
    expect(workspaceUpdateSchema.safeParse({ organizationId: valid.workspaceId }).success).toBe(
      false,
    );
  });
});
