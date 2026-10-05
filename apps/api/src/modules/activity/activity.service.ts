import { Injectable, NotFoundException } from '@nestjs/common';
import type { ActivityList } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { PermissionService } from '../authorization/permission.service';
import { PaginatedResult } from '../../common/pagination';
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}
  record(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      projectId: string;
      actorId: string;
      taskId?: string;
      action: string;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    return tx.activity.create({ data });
  }
  async task(userId: string, taskId: string, query: ActivityList) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { column: { select: { board: { select: { projectId: true } } } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return this.list(userId, task.column.board.projectId, { ...query, taskId });
  }
  list(userId: string, projectId: string, query: ActivityList) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.permissions.requireProject(userId, projectId, 'read', tx);
        if (
          query.taskId &&
          !(await tx.task.findFirst({
            where: { id: query.taskId, column: { board: { projectId } } },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Task not found');
        const where: Prisma.ActivityWhereInput = {
          projectId,
          ...(query.taskId ? { taskId: query.taskId } : {}),
          ...(query.search ? { action: { contains: query.search, mode: 'insensitive' } } : {}),
        };
        const rows = await tx.activity.findMany({
          where,
          take: query.limit,
          skip: (query.page - 1) * query.limit,
          orderBy: [{ createdAt: query.order }, { id: 'asc' }],
          select: {
            id: true,
            projectId: true,
            taskId: true,
            action: true,
            metadata: true,
            createdAt: true,
            actor: { select: { id: true, name: true, avatarUrl: true } },
          },
        });
        const total = await tx.activity.count({ where });
        return new PaginatedResult(
          rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          query.page,
          query.limit,
          total,
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
