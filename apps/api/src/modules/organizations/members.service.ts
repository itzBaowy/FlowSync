import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ListQuery } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import { PaginatedResult } from '../../common/pagination';
import { PermissionService } from '../authorization/permission.service';
import { organizationView } from './organizations.service';
import type { Prisma } from '../../generated/prisma/client';
import { RealtimeEventsService } from '../realtime/realtime-events.service';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly events: RealtimeEventsService,
  ) {}
  private async mutate<T>(
    organizationId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const where = { project: { workspace: { organizationId } } };
    const result = await this.prisma.$transaction(async (tx) => {
      const result = await run(tx);
      await tx.board.updateMany({ where, data: { revision: { increment: 1 } } });
      return result;
    });
    await this.events.boardsChanged(where);
    return result;
  }
  async list(actorId: string, organizationId: string, query: ListQuery) {
    await this.permissions.requireOrganization(actorId, organizationId, 'read');
    const where = {
      organizationId,
      ...(query.search
        ? {
            user: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { email: { contains: query.search, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.organizationMember.findMany({
          where,
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          orderBy:
            query.sort === 'name'
              ? [{ user: { name: query.order } }, { userId: 'asc' }]
              : [{ joinedAt: query.order }, { userId: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.organizationMember.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map(({ userId, role, joinedAt, user }) => ({
        userId,
        role,
        joinedAt: joinedAt.toISOString(),
        user,
      })),
      query.page,
      query.limit,
      total,
    );
  }
  async updateRole(
    actorId: string,
    organizationId: string,
    targetId: string,
    role: 'ADMIN' | 'MEMBER',
  ) {
    return this.mutate(organizationId, async (tx) => {
      await this.permissions.lockOrganization(tx, organizationId);
      const actor = await this.permissions.requireOrganization(
        actorId,
        organizationId,
        'manage_members',
        tx,
      );
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: targetId } },
      });
      if (!target) throw new NotFoundException('Member not found');
      if (target.userId === actor.organization.ownerId || target.role === 'OWNER')
        throw new ConflictException('Transfer ownership before changing the owner role');
      await tx.organizationMember.update({
        where: { organizationId_userId: { organizationId, userId: targetId } },
        data: { role },
      });
      return { success: true };
    });
  }
  async remove(actorId: string, organizationId: string, targetId: string) {
    return this.mutate(organizationId, async (tx) => {
      await this.permissions.lockOrganization(tx, organizationId);
      const actor = await this.permissions.requireOrganization(
        actorId,
        organizationId,
        'manage_members',
        tx,
      );
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: targetId } },
      });
      if (!target) throw new NotFoundException('Member not found');
      if (target.userId === actor.organization.ownerId || target.role === 'OWNER')
        throw new ConflictException('The owner cannot be removed; transfer ownership first');
      if (await tx.project.count({ where: { ownerId: targetId, workspace: { organizationId } } }))
        throw new ConflictException('Transfer project ownership before removing this member');
      await tx.task.updateMany({
        where: {
          assignees: { some: { userId: targetId } },
          column: { board: { project: { workspace: { organizationId } } } },
        },
        data: { version: { increment: 1 } },
      });
      await tx.taskAssignee.deleteMany({
        where: {
          userId: targetId,
          task: { column: { board: { project: { workspace: { organizationId } } } } },
        },
      });
      await tx.projectMember.deleteMany({
        where: { userId: targetId, project: { workspace: { organizationId } } },
      });
      await tx.workspaceMember.deleteMany({
        where: { userId: targetId, workspace: { organizationId } },
      });
      await tx.organizationMember.delete({
        where: { organizationId_userId: { organizationId, userId: targetId } },
      });
      return { success: true };
    });
  }
  async transferOwner(actorId: string, organizationId: string, targetId: string) {
    return this.mutate(organizationId, async (tx) => {
      await this.permissions.lockOrganization(tx, organizationId);
      await this.permissions.requireOrganization(actorId, organizationId, 'transfer_owner', tx);
      if (actorId === targetId) throw new ConflictException('Select a different member');
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: targetId } },
      });
      if (!target)
        throw new NotFoundException('The new owner must already be an organization member');
      await tx.organizationMember.update({
        where: { organizationId_userId: { organizationId, userId: actorId } },
        data: { role: 'ADMIN' },
      });
      await tx.organizationMember.update({
        where: { organizationId_userId: { organizationId, userId: targetId } },
        data: { role: 'OWNER' },
      });
      const organization = await tx.organization.update({
        where: { id: organizationId },
        data: { ownerId: targetId },
      });
      return organizationView(organization, 'ADMIN');
    });
  }
}
