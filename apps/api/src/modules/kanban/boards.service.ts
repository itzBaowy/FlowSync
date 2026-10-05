import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  boardListSchema,
  columnInputSchema,
  columnUpdateSchema,
  reorderColumnsSchema,
  type BoardInput,
} from '@flowsync/contracts';
import type { z } from 'zod';
import { PrismaService } from '../../database/prisma.service';
import { PaginatedResult } from '../../common/pagination';
import { PermissionService } from '../authorization/permission.service';
import { KanbanAccessService } from './kanban-access.service';
import { boardView, taskInclude, taskView } from './kanban-view';
import { ActivityService } from '../activity/activity.service';
@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly access: KanbanAccessService,
    private readonly activity: ActivityService,
  ) {}
  create(userId: string, input: BoardInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProject(tx, input.projectId);
      const actor = await this.permissions.requireProject(userId, input.projectId, 'manage', tx);
      const board = await tx.board.create({
        data: {
          ...input,
          columns: {
            create: [
              { name: 'To do', kind: 'TODO', position: 0 },
              { name: 'In progress', kind: 'IN_PROGRESS', position: 1 },
              { name: 'Review', kind: 'REVIEW', position: 2 },
              { name: 'Done', kind: 'DONE', position: 3 },
            ],
          },
        },
      });
      await this.activity.record(tx, {
        organizationId: actor.workspace.organizationId,
        projectId: actor.project.id,
        actorId: userId,
        action: 'BOARD_CREATED',
        metadata: { boardId: board.id, name: board.name },
      });
      return boardView(board, true);
    });
  }
  async list(userId: string, query: z.infer<typeof boardListSchema>) {
    const actor = await this.permissions.requireProject(userId, query.projectId, 'read');
    const where = {
      projectId: query.projectId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.board.findMany({
          where,
          orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        this.prisma.board.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map((row) => boardView(row, actor.canManage)),
      query.page,
      query.limit,
      total,
    );
  }
  snapshot(userId: string, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.access.board(userId, id, 'read', tx);
        const columns = await tx.column.findMany({
          where: { boardId: id },
          orderBy: { position: 'asc' },
          include: {
            tasks: {
              where: { archivedAt: null },
              orderBy: { position: 'asc' },
              take: 100,
              include: taskInclude,
            },
            _count: { select: { tasks: { where: { archivedAt: null } } } },
          },
        });
        return {
          ...boardView(actor.board, actor.canManage),
          columns: columns.map(({ tasks, _count, ...column }) => ({
            ...column,
            totalTasks: _count.tasks,
            tasks: tasks.map((task) => taskView(task, userId, actor.canManage)),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  update(userId: string, id: string, name: string) {
    return this.access.mutate(userId, id, 'manage', async (tx) =>
      boardView(await tx.board.update({ where: { id }, data: { name } }), true),
    );
  }
  remove(userId: string, id: string) {
    return this.access.mutate(
      userId,
      id,
      'manage',
      async (tx) => {
        if (await tx.task.count({ where: { column: { boardId: id } } }))
          throw new ConflictException(
            'Remove active and archived tasks before deleting this board',
          );
        await tx.column.deleteMany({ where: { boardId: id } });
        await tx.board.delete({ where: { id } });
        return { success: true };
      },
      { bump: false },
    );
  }
  addColumn(userId: string, id: string, input: z.infer<typeof columnInputSchema>) {
    return this.access.mutate(userId, id, 'manage', async (tx) => {
      const columns = await tx.column.findMany({
        where: { boardId: id },
        select: { position: true },
        orderBy: { position: 'desc' },
      });
      if (columns.length >= 50) throw new ConflictException('A board supports at most 50 columns');
      return tx.column.create({
        data: { ...input, boardId: id, position: (columns[0]?.position ?? -1) + 1 },
      });
    });
  }
  updateColumn(
    userId: string,
    id: string,
    columnId: string,
    input: z.infer<typeof columnUpdateSchema>,
  ) {
    return this.access.mutate(userId, id, 'manage', async (tx) => {
      if (!(await tx.column.findFirst({ where: { id: columnId, boardId: id } })))
        throw new NotFoundException('Column not found');
      return tx.column.update({ where: { id: columnId }, data: input });
    });
  }
  removeColumn(userId: string, id: string, columnId: string) {
    return this.access.mutate(userId, id, 'manage', async (tx) => {
      if (!(await tx.column.findFirst({ where: { id: columnId, boardId: id } })))
        throw new NotFoundException('Column not found');
      if (await tx.task.count({ where: { columnId } }))
        throw new ConflictException('Remove active and archived tasks before deleting this column');
      await tx.column.delete({ where: { id: columnId } });
      return { success: true };
    });
  }
  reorderColumns(userId: string, id: string, input: z.infer<typeof reorderColumnsSchema>) {
    return this.access.mutate(
      userId,
      id,
      'manage',
      async (tx, actor) => {
        const columns = await tx.column.findMany({ where: { boardId: id }, select: { id: true } });
        if (
          columns.length !== input.columnIds.length ||
          columns.some((column) => !input.columnIds.includes(column.id))
        )
          throw new BadRequestException('Provide every column of this board exactly once');
        for (const [position, columnId] of input.columnIds.entries())
          await tx.column.update({ where: { id: columnId }, data: { position } });
        return {
          revision: actor.board.revision,
          columns: await tx.column.findMany({
            where: { boardId: id },
            orderBy: { position: 'asc' },
          }),
        };
      },
      { expectedRevision: input.expectedRevision },
    );
  }
}
