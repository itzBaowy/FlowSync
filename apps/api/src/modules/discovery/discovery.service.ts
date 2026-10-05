import { Injectable } from '@nestjs/common';
import type { MyTasksQuery, SearchQuery } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { visibleProjects, visibleTasks } from '../authorization/scope-visibility';
import { PaginatedResult } from '../../common/pagination';
const route = (task: { id: string; column: { boardId: string; board: { projectId: string } } }) =>
  `/boards?projectId=${task.column.board.projectId}&id=${task.column.boardId}&taskId=${task.id}`;
const taskRouteSelect = {
  id: true,
  column: { select: { boardId: true, board: { select: { projectId: true } } } },
} as const;
@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}
  search(userId: string, query: SearchQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        const paging = {
          take: query.limit,
          skip: (query.page - 1) * query.limit,
          orderBy: [{ createdAt: query.order }, { id: 'asc' as const }],
        };
        const match = { contains: query.search, mode: 'insensitive' as const };
        if (query.type === 'projects') {
          const where: Prisma.ProjectWhereInput = {
            AND: [visibleProjects(userId), { OR: [{ name: match }, { description: match }] }],
          };
          const rows = await tx.project.findMany({
            where,
            ...paging,
            select: {
              id: true,
              name: true,
              workspaceId: true,
              createdAt: true,
              workspace: { select: { name: true } },
            },
          });
          return new PaginatedResult(
            rows.map((row) => ({
              id: row.id,
              type: query.type,
              title: row.name,
              context: row.workspace.name,
              href: `/projects?workspaceId=${row.workspaceId}&id=${row.id}`,
              createdAt: row.createdAt.toISOString(),
            })),
            query.page,
            query.limit,
            await tx.project.count({ where }),
          );
        }
        if (query.type === 'members') {
          const sharedOrganization = { organization: { members: { some: { userId } } } };
          const where: Prisma.UserWhereInput = {
            organizations: { some: sharedOrganization },
            OR: [{ name: match }, { email: match }],
          };
          const rows = await tx.user.findMany({
            where,
            ...paging,
            select: {
              id: true,
              name: true,
              email: true,
              createdAt: true,
              organizations: {
                where: sharedOrganization,
                take: 1,
                orderBy: { organizationId: 'asc' },
                select: { organizationId: true },
              },
            },
          });
          return new PaginatedResult(
            rows.map((row) => ({
              id: row.id,
              type: query.type,
              title: row.name,
              context: row.email,
              href: `/organizations?id=${row.organizations[0]!.organizationId}`,
              createdAt: row.createdAt.toISOString(),
            })),
            query.page,
            query.limit,
            await tx.user.count({ where }),
          );
        }
        if (query.type === 'comments') {
          const where: Prisma.CommentWhereInput = {
            text: match,
            task: { ...visibleTasks(userId), archivedAt: null },
          };
          const rows = await tx.comment.findMany({
            where,
            ...paging,
            select: {
              id: true,
              text: true,
              createdAt: true,
              task: { select: { ...taskRouteSelect, title: true } },
            },
          });
          return new PaginatedResult(
            rows.map((row) => ({
              id: row.id,
              type: query.type,
              title: row.text.replace(/@\[([^\]\r\n]+)\]\([0-9a-f-]{36}\)/gi, '@$1').slice(0, 300),
              context: row.task.title,
              href: route(row.task),
              createdAt: row.createdAt.toISOString(),
            })),
            query.page,
            query.limit,
            await tx.comment.count({ where }),
          );
        }
        const where: Prisma.TaskWhereInput = {
          AND: [
            visibleTasks(userId),
            { archivedAt: null, OR: [{ title: match }, { description: match }] },
          ],
        };
        const rows = await tx.task.findMany({
          where,
          ...paging,
          select: {
            ...taskRouteSelect,
            title: true,
            createdAt: true,
            column: {
              select: {
                boardId: true,
                board: { select: { projectId: true, project: { select: { name: true } } } },
              },
            },
          },
        });
        return new PaginatedResult(
          rows.map((row) => ({
            id: row.id,
            type: query.type,
            title: row.title,
            context: row.column.board.project.name,
            href: route(row),
            createdAt: row.createdAt.toISOString(),
          })),
          query.page,
          query.limit,
          await tx.task.count({ where }),
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async myTasks(userId: string, query: MyTasksQuery) {
    const now = new Date();
    const where: Prisma.TaskWhereInput = {
      AND: [
        visibleTasks(userId),
        {
          assignees: { some: { userId } },
          archivedAt: null,
          ...(query.priority ? { priority: query.priority } : {}),
          ...(query.search
            ? {
                OR: [
                  { title: { contains: query.search, mode: 'insensitive' } },
                  { description: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        ...(query.status ? [{ column: { kind: query.status } }] : []),
        ...(query.due === 'all'
          ? []
          : [
              {
                column: { kind: { not: 'DONE' as const } },
                dueDate:
                  query.due === 'overdue'
                    ? { lt: now }
                    : { gte: now, lte: new Date(now.getTime() + 7 * 86400000) },
              },
            ]),
      ],
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.task.findMany({
          where,
          orderBy: [
            {
              [query.sort]:
                query.sort === 'dueDate' ? { sort: query.order, nulls: 'last' } : query.order,
            },
            { id: 'asc' },
          ],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
          select: {
            id: true,
            title: true,
            priority: true,
            dueDate: true,
            column: {
              select: {
                kind: true,
                boardId: true,
                board: { select: { projectId: true, project: { select: { name: true } } } },
              },
            },
          },
        }),
        this.prisma.task.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map(({ column, dueDate, ...row }) => ({
        ...row,
        dueDate: dueDate?.toISOString() ?? null,
        status: column.kind,
        boardId: column.boardId,
        projectId: column.board.projectId,
        projectName: column.board.project.name,
      })),
      query.page,
      query.limit,
      total,
    );
  }
  dashboard(userId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const projects = visibleProjects(userId);
        const tasks: Prisma.TaskWhereInput = { ...visibleTasks(userId), archivedAt: null };
        const open: Prisma.TaskWhereInput = { AND: [tasks, { column: { kind: { not: 'DONE' } } }] };
        const now = new Date();
        const activeProjects = await tx.project.count({
          where: { AND: [projects, { status: 'ACTIVE' }] },
        });
        const openTasks = await tx.task.count({ where: open });
        const completedTasks = await tx.task.count({
          where: { AND: [tasks, { column: { kind: 'DONE' } }] },
        });
        const dueSoon = await tx.task.count({
          where: {
            AND: [open, { dueDate: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) } }],
          },
        });
        const overdue = await tx.task.count({ where: { AND: [open, { dueDate: { lt: now } }] } });
        const grouped = await tx.task.groupBy({ by: ['priority'], where: tasks, _count: true });
        const recent = await tx.project.findMany({
          where: projects,
          take: 6,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          select: { id: true, name: true, workspaceId: true, status: true },
        });
        const recentProjects = [];
        for (const project of recent) {
          const scoped = { archivedAt: null, column: { board: { projectId: project.id } } };
          const total = await tx.task.count({ where: scoped });
          const done = await tx.task.count({
            where: { ...scoped, column: { kind: 'DONE', board: { projectId: project.id } } },
          });
          recentProjects.push({ ...project, openTasks: total - done, completedTasks: done });
        }
        const recentActivities = await tx.activity.findMany({
          where: { project: { is: projects } },
          take: 10,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            action: true,
            projectId: true,
            taskId: true,
            metadata: true,
            createdAt: true,
            actor: { select: { id: true, name: true, avatarUrl: true } },
          },
        });
        return {
          activeProjects,
          openTasks,
          completedTasks,
          dueSoon,
          overdue,
          byPriority: grouped.map((row) => ({ priority: row.priority, count: row._count })),
          recentProjects,
          recentActivities: recentActivities.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
