import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationList } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import type { NotificationType, Prisma } from '../../generated/prisma/client';
import { PaginatedResult } from '../../common/pagination';
import { PermissionService } from '../authorization/permission.service';
import { RealtimeEventsService } from '../realtime/realtime-events.service';
import { NotificationOutboxService } from '../queue/notification-outbox.service';
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly events: RealtimeEventsService,
    private readonly outbox: NotificationOutboxService,
  ) {}
  visible(userId: string): Prisma.NotificationWhereInput {
    return {
      userId,
      task: {
        is: {
          column: {
            board: {
              project: {
                workspace: { organization: { members: { some: { userId } } } },
                OR: [
                  {
                    workspace: {
                      organization: {
                        members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } },
                      },
                    },
                  },
                  { members: { some: { userId } }, workspace: { members: { some: { userId } } } },
                ],
              },
            },
          },
        },
      },
    };
  }
  async list(userId: string, query: NotificationList) {
    const where: Prisma.NotificationWhereInput = {
      ...this.visible(userId),
      ...(query.unread === 'all' ? {} : { readAt: query.unread === 'true' ? null : { not: null } }),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.notification.findMany({
          where,
          orderBy: [{ createdAt: query.order }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
          select: {
            id: true,
            taskId: true,
            type: true,
            title: true,
            readAt: true,
            createdAt: true,
            task: {
              select: {
                column: { select: { boardId: true, board: { select: { projectId: true } } } },
              },
            },
          },
        }),
        this.prisma.notification.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map(({ task, ...row }) => ({
        ...row,
        boardId: task!.column.boardId,
        projectId: task!.column.board.projectId,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      query.page,
      query.limit,
      total,
    );
  }
  async count(userId: string) {
    return {
      unread: await this.prisma.notification.count({
        where: { ...this.visible(userId), readAt: null },
      }),
    };
  }
  async mark(userId: string, id: string, read: boolean) {
    const initial = await this.prisma.notification.findFirst({
      where: { ...this.visible(userId), id },
      select: {
        task: { select: { column: { select: { board: { select: { projectId: true } } } } } },
      },
    });
    if (!initial?.task) throw new NotFoundException('Notification not found');
    await this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProject(tx, initial.task!.column.board.projectId);
      if (
        !(await tx.notification.findFirst({
          where: { ...this.visible(userId), id },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Notification not found');
      await tx.notification.update({ where: { id }, data: { readAt: read ? new Date() : null } });
    });
    await this.afterCommit([userId]);
    return { success: true };
  }
  async markAll(userId: string) {
    await this.prisma.notification.updateMany({
      where: { ...this.visible(userId), readAt: null },
      data: { readAt: new Date() },
    });
    await this.afterCommit([userId]);
    return { success: true };
  }
  async record(
    tx: Prisma.TransactionClient,
    actorId: string,
    taskId: string,
    userIds: string[],
    type: NotificationType,
    title: string,
  ) {
    const candidates = [...new Set(userIds)].filter((id) => id !== actorId);
    if (!candidates.length) return [];
    const task = await tx.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        column: {
          select: {
            board: {
              select: {
                projectId: true,
                project: {
                  select: { workspaceId: true, workspace: { select: { organizationId: true } } },
                },
              },
            },
          },
        },
      },
    });
    const project = task.column.board.project;
    const members = await tx.user.findMany({
      where: {
        id: { in: candidates },
        organizations: { some: { organizationId: project.workspace.organizationId } },
        OR: [
          {
            organizations: {
              some: {
                organizationId: project.workspace.organizationId,
                role: { in: ['OWNER', 'ADMIN'] },
              },
            },
          },
          {
            workspaces: { some: { workspaceId: project.workspaceId } },
            projects: { some: { projectId: task.column.board.projectId } },
          },
        ],
      },
      select: { id: true },
    });
    const recipients = members.map((member) => member.id);
    if (!recipients.length) return recipients;
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { name: true },
    });
    const verb =
      type === 'TASK_ASSIGNED'
        ? 'assigned you to'
        : type === 'MENTION'
          ? 'mentioned you in'
          : type === 'TASK_COMMENT'
            ? 'commented on'
            : 'updated';
    const message = [...`${actor.name} ${verb} "${title}"`].slice(0, 240).join('');
    const notifications = await tx.notification.createManyAndReturn({
      data: recipients.map((userId) => ({ userId, taskId, type, title: message })),
      select: { id: true, type: true },
    });
    await this.outbox.emails(tx, notifications);
    return recipients;
  }
  afterCommit(userIds: string[]) {
    return this.events.notificationsChanged(userIds);
  }
}
