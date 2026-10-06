import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PermissionService } from '../authorization/permission.service';
import { visibleProjects } from '../authorization/scope-visibility';
@Injectable()
export class AIContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}
  async build(userId: string, projectId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.permissions.requireProject(userId, projectId, 'read', tx);
        const now = new Date();
        const [tasks, activity, members, statusCounts] = await Promise.all([
          tx.task.findMany({
            where: { archivedAt: null, column: { board: { projectId } } },
            orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { id: 'asc' }],
            take: 40,
            select: {
              id: true,
              title: true,
              description: true,
              priority: true,
              dueDate: true,
              column: { select: { kind: true } },
              assignees: { select: { userId: true } },
            },
          }),
          tx.activity.findMany({
            where: { projectId, createdAt: { gte: new Date(now.getTime() - 86400000) } },
            orderBy: { createdAt: 'desc' },
            take: 60,
            select: {
              action: true,
              createdAt: true,
              taskId: true,
              metadata: true,
              actor: { select: { name: true } },
            },
          }),
          tx.user.findMany({
            where: {
              projects: { some: { projectId, project: visibleProjects(userId) } },
              workspaces: { some: { workspaceId: actor.project.workspaceId } },
              organizations: { some: { organizationId: actor.workspace.organizationId } },
            },
            take: 100,
            orderBy: { id: 'asc' },
            select: { id: true, name: true },
          }),
          tx.column.findMany({
            where: { board: { projectId } },
            select: { kind: true, _count: { select: { tasks: { where: { archivedAt: null } } } } },
          }),
        ]);
        const totals = { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 };
        for (const column of statusCounts) totals[column.kind] += column._count.tasks;
        const publicTasks = tasks.map(({ column, assignees, ...task }) => ({
          ...task,
          description: task.description?.slice(0, 500) ?? null,
          dueDate: task.dueDate?.toISOString() ?? null,
          status: column.kind,
          assigneeIds: assignees.map((assignee) => assignee.userId),
        }));
        return {
          project: {
            id: projectId,
            name: actor.project.name,
            description: actor.project.description?.slice(0, 1000) ?? null,
            status: actor.project.status,
          },
          asOf: now.toISOString(),
          totals,
          tasks: publicTasks,
          overdue: publicTasks.filter(
            (task) => task.status !== 'DONE' && task.dueDate && task.dueDate < now.toISOString(),
          ),
          activity: activity.map((row) => ({
            action: row.action,
            at: row.createdAt.toISOString(),
            taskId: row.taskId,
            actor: row.actor?.name ?? 'Former member',
            metadata:
              row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
                ? Object.fromEntries(
                    Object.entries(row.metadata)
                      .filter(([key]) => ['title', 'fromStatus', 'toStatus'].includes(key))
                      .map(([key, value]) => [
                        key,
                        typeof value === 'string' ? value.slice(0, 240) : null,
                      ]),
                  )
                : null,
          })),
          members,
          sampled: {
            tasks: tasks.length === 40,
            activity: activity.length === 60,
            members: members.length === 100,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
