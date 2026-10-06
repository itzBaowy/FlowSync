import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  validProjectDates,
  type ListQuery,
  type ProjectInput,
  type ProjectList,
  type ProjectUpdate,
} from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type Project } from '../../generated/prisma/client';
import { PermissionService } from '../authorization/permission.service';
import { PaginatedResult } from '../../common/pagination';
import { publicMemberSelect } from '../workspaces/workspaces.service';
import { RealtimeEventsService } from '../realtime/realtime-events.service';
import { NotificationsService } from '../notifications/notifications.service';
export const projectView = (row: Project, canManage: boolean) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  ownerId: row.ownerId,
  name: row.name,
  description: row.description,
  status: row.status,
  startDate: row.startDate?.toISOString() ?? null,
  dueDate: row.dueDate?.toISOString() ?? null,
  canManage,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly events: RealtimeEventsService,
    private readonly notifications: NotificationsService,
  ) {}
  private async mutate<T>(
    userId: string,
    id: string,
    run: (tx: Prisma.TransactionClient, project: Project) => Promise<T>,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.permissions.lockProject(tx, id);
        const actor = await this.permissions.requireProject(userId, id, 'manage', tx);
        const result = await run(tx, actor.project);
        await tx.board.updateMany({
          where: { projectId: id },
          data: { revision: { increment: 1 } },
        });
        return result;
      });
      await this.events.boardsChanged({ projectId: id });
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Project membership already exists');
      throw error;
    }
  }
  create(userId: string, input: ProjectInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.lockWorkspace(tx, input.workspaceId);
      await this.permissions.requireWorkspace(userId, input.workspaceId, 'manage', tx);
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId } },
        create: { workspaceId: input.workspaceId, userId },
        update: {},
      });
      return projectView(
        await tx.project.create({
          data: { ...input, ownerId: userId, members: { create: { userId } } },
        }),
        true,
      );
    });
  }
  async list(userId: string, query: ProjectList) {
    const actor = await this.permissions.requireWorkspace(userId, query.workspaceId, 'read');
    const where: Prisma.ProjectWhereInput = {
      workspaceId: query.workspaceId,
      ...(actor.canManage ? {} : { members: { some: { userId } } }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.project.findMany({
          where,
          orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        this.prisma.project.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map((row) => projectView(row, actor.canManage || row.ownerId === userId)),
      query.page,
      query.limit,
      total,
    );
  }
  async get(userId: string, id: string) {
    const actor = await this.permissions.requireProject(userId, id, 'read');
    return projectView(actor.project, actor.canManage);
  }
  update(userId: string, id: string, input: ProjectUpdate) {
    return this.mutate(userId, id, async (tx, project) => {
      const dates = {
        startDate:
          input.startDate === undefined ? project.startDate?.toISOString() : input.startDate,
        dueDate: input.dueDate === undefined ? project.dueDate?.toISOString() : input.dueDate,
      };
      if (!validProjectDates(dates))
        throw new BadRequestException('Start date must be on or before due date');
      return projectView(await tx.project.update({ where: { id }, data: input }), true);
    });
  }
  remove(userId: string, id: string) {
    return this.mutate(userId, id, async (tx) => {
      const retained = await Promise.all([
        tx.board.count({ where: { projectId: id } }),
        tx.label.count({ where: { projectId: id } }),
        tx.activity.count({ where: { projectId: id } }),
        tx.aIConversation.count({ where: { projectId: id } }),
      ]);
      if (retained.some((count) => count > 0))
        throw new ConflictException(
          'Remove boards, labels and handle retained history before deleting this project',
        );
      await tx.project.delete({ where: { id } });
      return { success: true };
    });
  }
  async overview(userId: string, id: string) {
    await this.permissions.requireProject(userId, id, 'read');
    const where: Prisma.TaskWhereInput = { archivedAt: null, column: { board: { projectId: id } } };
    const [tasks, completed, overdue, members, activities] = await this.prisma.$transaction(
      [
        this.prisma.task.count({ where }),
        this.prisma.task.count({
          where: { ...where, column: { kind: 'DONE', board: { projectId: id } } },
        }),
        this.prisma.task.count({
          where: {
            ...where,
            dueDate: { lt: new Date() },
            column: { kind: { not: 'DONE' }, board: { projectId: id } },
          },
        }),
        this.prisma.projectMember.count({ where: { projectId: id } }),
        this.prisma.activity.findMany({
          where: { projectId: id },
          take: 10,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: { id: true, action: true, createdAt: true, actor: { select: { name: true } } },
        }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      tasks,
      completed,
      overdue,
      members,
      recentActivities: activities.map((row) => ({
        id: row.id,
        action: row.action,
        createdAt: row.createdAt.toISOString(),
        actorName: row.actor?.name ?? null,
      })),
    };
  }
  async members(userId: string, id: string, query: ListQuery) {
    await this.permissions.requireProject(userId, id, 'read');
    const where: Prisma.ProjectMemberWhereInput = {
      projectId: id,
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
        this.prisma.projectMember.findMany({
          where,
          select: publicMemberSelect,
          orderBy:
            query.sort === 'name'
              ? [{ user: { name: query.order } }, { userId: 'asc' }]
              : [{ joinedAt: query.order }, { userId: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        this.prisma.projectMember.count({ where }),
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
    const result = await this.mutate(userId, id, async (tx, project) => {
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: project.workspaceId },
      });
      const eligible = await tx.workspaceMember.findFirst({
        where: {
          workspaceId: project.workspaceId,
          userId: targetId,
          user: { organizations: { some: { organizationId: workspace.organizationId } } },
        },
      });
      if (!eligible) throw new NotFoundException('Workspace member not found');
      const row = await tx.projectMember.create({
        data: { projectId: id, userId: targetId },
        select: publicMemberSelect,
      });
      await this.notifications.recordScope(tx, userId, targetId, {
        projectId: id,
        name: project.name,
      });
      return { ...row, joinedAt: row.joinedAt.toISOString() };
    });
    await this.notifications.afterCommit([targetId]);
    return result;
  }
  removeMember(userId: string, id: string, targetId: string) {
    return this.mutate(userId, id, async (tx, project) => {
      if (project.ownerId === targetId)
        throw new ConflictException('Transfer ownership before removing the project owner');
      if (
        !(await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: id, userId: targetId } },
        }))
      )
        throw new NotFoundException('Project member not found');
      await tx.task.updateMany({
        where: { assignees: { some: { userId: targetId } }, column: { board: { projectId: id } } },
        data: { version: { increment: 1 } },
      });
      await tx.taskAssignee.deleteMany({
        where: { userId: targetId, task: { column: { board: { projectId: id } } } },
      });
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId: id, userId: targetId } },
      });
      return { success: true };
    });
  }
  transfer(userId: string, id: string, targetId: string) {
    return this.mutate(userId, id, async (tx, project) => {
      if (targetId === project.ownerId) throw new ConflictException('Select a different owner');
      if (
        !(await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: id, userId: targetId } },
        }))
      )
        throw new NotFoundException('The new owner must already be a project member');
      await this.permissions.requireProject(targetId, id, 'read', tx);
      const row = await tx.project.update({ where: { id }, data: { ownerId: targetId } });
      const actor = await this.permissions.requireProject(userId, id, 'read', tx);
      return projectView(row, actor.canManage);
    });
  }
}
