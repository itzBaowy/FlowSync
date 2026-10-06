import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ListQuery,
  WorkspaceInput,
  WorkspaceList,
  WorkspaceUpdate,
} from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type Workspace } from '../../generated/prisma/client';
import { PermissionService } from '../authorization/permission.service';
import { managesOrganizationScope } from '../authorization/scope.policy';
import { PaginatedResult } from '../../common/pagination';
import { RealtimeEventsService } from '../realtime/realtime-events.service';
import { NotificationsService } from '../notifications/notifications.service';

export const workspaceView = (row: Workspace, canManage: boolean) => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  slug: row.slug,
  description: row.description,
  icon: row.icon,
  canManage,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
export const publicMemberSelect = {
  userId: true,
  joinedAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const;
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly events: RealtimeEventsService,
    private readonly notifications: NotificationsService,
  ) {}
  private async mutate<T>(
    id: string,
    userId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.permissions.lockWorkspace(tx, id);
        await this.permissions.requireWorkspace(userId, id, 'manage', tx);
        const result = await run(tx);
        await tx.board.updateMany({
          where: { project: { workspaceId: id } },
          data: { revision: { increment: 1 } },
        });
        return result;
      });
      await this.events.boardsChanged({ project: { workspaceId: id } });
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Workspace slug or membership already exists');
      throw error;
    }
  }
  async create(userId: string, input: WorkspaceInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.permissions.lockOrganization(tx, input.organizationId);
        const actor = await this.permissions.requireOrganization(
          userId,
          input.organizationId,
          'read',
          tx,
        );
        if (!managesOrganizationScope(actor.role))
          throw new ForbiddenException('Workspace management requires an owner or admin');
        return workspaceView(
          await tx.workspace.create({ data: { ...input, members: { create: { userId } } } }),
          true,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Workspace slug already exists in this organization');
      throw error;
    }
  }
  async list(userId: string, query: WorkspaceList) {
    const actor = await this.permissions.requireOrganization(userId, query.organizationId, 'read');
    const canManage = managesOrganizationScope(actor.role);
    const where: Prisma.WorkspaceWhereInput = {
      organizationId: query.organizationId,
      ...(canManage ? {} : { members: { some: { userId } } }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.workspace.findMany({
          where,
          orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        this.prisma.workspace.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map((row) => workspaceView(row, canManage)),
      query.page,
      query.limit,
      total,
    );
  }
  async get(userId: string, id: string) {
    const actor = await this.permissions.requireWorkspace(userId, id, 'read');
    return workspaceView(actor.workspace, actor.canManage);
  }
  update(userId: string, id: string, input: WorkspaceUpdate) {
    return this.mutate(id, userId, async (tx) =>
      workspaceView(await tx.workspace.update({ where: { id }, data: input }), true),
    );
  }
  remove(userId: string, id: string) {
    return this.mutate(id, userId, async (tx) => {
      if (await tx.project.count({ where: { workspaceId: id } }))
        throw new ConflictException('Remove projects before deleting this workspace');
      await tx.workspace.delete({ where: { id } });
      return { success: true };
    });
  }
  async members(userId: string, id: string, query: ListQuery) {
    await this.permissions.requireWorkspace(userId, id, 'read');
    const where: Prisma.WorkspaceMemberWhereInput = {
      workspaceId: id,
      ...(query.search
        ? {
            user: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.workspaceMember.findMany({
          where,
          select: publicMemberSelect,
          orderBy:
            query.sort === 'name'
              ? [{ user: { name: query.order } }, { userId: 'asc' }]
              : [{ joinedAt: query.order }, { userId: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.workspaceMember.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() })),
      query.page,
      query.limit,
      total,
    );
  }
  async addMember(userId: string, id: string, targetId: string) {
    const result = await this.mutate(id, userId, async (tx) => {
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id } });
      if (
        !(await tx.organizationMember.findUnique({
          where: {
            organizationId_userId: { organizationId: workspace.organizationId, userId: targetId },
          },
        }))
      )
        throw new NotFoundException('Organization member not found');
      const row = await tx.workspaceMember.create({
        data: { workspaceId: id, userId: targetId },
        select: publicMemberSelect,
      });
      await this.notifications.recordScope(tx, userId, targetId, {
        workspaceId: id,
        name: workspace.name,
      });
      return { ...row, joinedAt: row.joinedAt.toISOString() };
    });
    await this.notifications.afterCommit([targetId]);
    return result;
  }
  removeMember(userId: string, id: string, targetId: string) {
    return this.mutate(id, userId, async (tx) => {
      if (
        !(await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: id, userId: targetId } },
        }))
      )
        throw new NotFoundException('Workspace member not found');
      if (await tx.project.count({ where: { workspaceId: id, ownerId: targetId } }))
        throw new ConflictException('Transfer project ownership before removing this member');
      await tx.task.updateMany({
        where: {
          assignees: { some: { userId: targetId } },
          column: { board: { project: { workspaceId: id } } },
        },
        data: { version: { increment: 1 } },
      });
      await tx.taskAssignee.deleteMany({
        where: { userId: targetId, task: { column: { board: { project: { workspaceId: id } } } } },
      });
      await tx.projectMember.deleteMany({
        where: { userId: targetId, project: { workspaceId: id } },
      });
      await tx.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId: id, userId: targetId } },
      });
      return { success: true };
    });
  }
}
