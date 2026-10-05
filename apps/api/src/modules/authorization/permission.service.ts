import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { canAccessOrganization, type OrganizationPermission } from './organization.policy';
import { managesOrganizationScope, readsPrivateScope } from './scope.policy';

export type OrganizationDb = PrismaService | Prisma.TransactionClient;
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}
  async requireOrganization(
    userId: string,
    organizationId: string,
    permission: OrganizationPermission,
    db: OrganizationDb = this.prisma,
  ) {
    const membership = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { organization: true },
    });
    // Missing resource and missing membership share the same response to prevent tenant enumeration.
    if (!membership) throw new NotFoundException('Organization not found');
    const allowed = canAccessOrganization(
      membership.role,
      permission,
      membership.organization.allowAdminInvites,
    );
    if (!allowed) throw new ForbiddenException('You do not have permission for this action');
    return membership;
  }
  async lockOrganization(db: Prisma.TransactionClient, id: string) {
    await db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async requireWorkspace(
    userId: string,
    id: string,
    permission: 'read' | 'manage',
    db: OrganizationDb = this.prisma,
  ) {
    const workspace = await db.workspace.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: {
        organization: { include: { members: { where: { userId }, select: { role: true } } } },
        members: { where: { userId }, select: { userId: true } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const role = workspace.organization.members[0]!.role;
    const canManage = managesOrganizationScope(role);
    if (!readsPrivateScope(role, workspace.members.length > 0))
      throw new NotFoundException('Workspace not found');
    if (permission === 'manage' && !canManage)
      throw new ForbiddenException('Workspace management requires an owner or admin');
    return { workspace, role, canManage };
  }
  async requireProject(
    userId: string,
    id: string,
    permission: 'read' | 'manage',
    db: OrganizationDb = this.prisma,
  ) {
    const project = await db.project.findUnique({
      where: { id },
      include: { members: { where: { userId }, select: { userId: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    const actor = await this.requireWorkspace(userId, project.workspaceId, 'read', db).catch(
      (error: unknown) => {
        if (error instanceof NotFoundException) throw new NotFoundException('Project not found');
        throw error;
      },
    );
    if (!readsPrivateScope(actor.role, project.members.length > 0))
      throw new NotFoundException('Project not found');
    const canManage = actor.canManage || project.ownerId === userId;
    if (permission === 'manage' && !canManage)
      throw new ForbiddenException('You cannot manage this project');
    return { ...actor, project, canManage };
  }
  async lockWorkspace(db: Prisma.TransactionClient, id: string) {
    const workspace = await db.workspace.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    await this.lockOrganization(db, workspace.organizationId);
    await db.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async lockProject(db: Prisma.TransactionClient, id: string) {
    const project = await db.project.findUnique({ where: { id }, select: { workspaceId: true } });
    if (!project) throw new NotFoundException('Project not found');
    await this.lockWorkspace(db, project.workspaceId);
    await db.$queryRaw`SELECT id FROM "Project" WHERE id = ${id}::uuid FOR UPDATE`;
  }
}
