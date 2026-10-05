import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TaskInput, TaskList, TaskMove, TaskUpdate } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PaginatedResult } from '../../common/pagination';
import { KanbanAccessService, type BoardActor } from './kanban-access.service';
import { taskInclude, taskView, type TaskRow } from './kanban-view';
const MAX_COLUMN_TASKS = 10000;
export type TaskActor = { row: TaskRow; board: BoardActor; view: ReturnType<typeof taskView> };
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
  ) {}
  async locate(userId: string, id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { column: { select: { boardId: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    const board = await this.access
      .board(userId, task.column.boardId, 'read')
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) throw new NotFoundException('Task not found');
        throw error;
      });
    return board;
  }
  async detail(tx: Prisma.TransactionClient, id: string, userId: string, canManage: boolean) {
    const row = await tx.task.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        checklists: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            title: true,
            position: true,
            items: {
              orderBy: { position: 'asc' },
              select: { id: true, text: true, completed: true, position: true },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Task not found');
    return { ...taskView(row, userId, canManage), checklists: row.checklists };
  }
  async mutate<T>(
    userId: string,
    id: string,
    expectedVersion: number,
    permission: 'edit' | 'archive',
    run: (tx: Prisma.TransactionClient, actor: TaskActor) => Promise<T>,
    options: { expectedRevision?: number; allowArchived?: boolean } = {},
  ) {
    const initial = await this.locate(userId, id);
    return this.access.mutate(
      userId,
      initial.board.id,
      'read',
      async (tx, board) => {
        const row = await tx.task.findFirst({
          where: { id, column: { boardId: board.board.id } },
          include: taskInclude,
        });
        if (!row) throw new NotFoundException('Task not found');
        const view = taskView(row, userId, board.canManage);
        if (!(permission === 'archive' ? view.canArchive : view.canEdit))
          throw new ForbiddenException('You cannot change this task');
        if (row.version !== expectedVersion)
          throw new ConflictException('Task changed. Reload and try again');
        if (row.archivedAt && !options.allowArchived)
          throw new ConflictException('Restore this task before editing it');
        await tx.task.update({ where: { id }, data: { version: { increment: 1 } } });
        return run(tx, { row, board, view });
      },
      { expectedRevision: options.expectedRevision },
    );
  }
  private async validateLinks(
    tx: Prisma.TransactionClient,
    actor: BoardActor,
    assigneeIds?: string[],
    labelIds?: string[],
  ) {
    if (assigneeIds?.length) {
      const eligible = await tx.projectMember.count({
        where: {
          projectId: actor.project.id,
          userId: { in: assigneeIds },
          user: {
            workspaces: { some: { workspaceId: actor.workspace.id } },
            organizations: { some: { organizationId: actor.workspace.organizationId } },
          },
        },
      });
      if (eligible !== assigneeIds.length)
        throw new BadRequestException(
          'Assignees must be current members of this project and its parent scopes',
        );
    }
    if (
      labelIds?.length &&
      (await tx.label.count({ where: { id: { in: labelIds }, projectId: actor.project.id } })) !==
        labelIds.length
    )
      throw new BadRequestException('Labels must belong to this project');
  }
  async create(userId: string, input: TaskInput) {
    const column = await this.access.column(userId, input.columnId);
    return this.access.mutate(userId, column.boardId, 'read', async (tx, actor) => {
      if (!(await tx.column.findFirst({ where: { id: input.columnId, boardId: actor.board.id } })))
        throw new NotFoundException('Column not found');
      await this.validateLinks(tx, actor, input.assigneeIds, input.labelIds);
      if ((await tx.task.count({ where: { columnId: input.columnId } })) >= MAX_COLUMN_TASKS)
        throw new ConflictException('This column reached its task limit');
      const last = await tx.task.findFirst({
        where: { columnId: input.columnId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const { assigneeIds, labelIds, ...fields } = input;
      const row = await tx.task.create({
        data: {
          ...fields,
          createdById: userId,
          position: (last?.position ?? new Prisma.Decimal(0)).plus(1024),
          assignees: { create: assigneeIds.map((id) => ({ userId: id })) },
          labels: { create: labelIds.map((id) => ({ labelId: id })) },
        },
        include: taskInclude,
      });
      return taskView(row, userId, actor.canManage);
    });
  }
  async get(userId: string, id: string) {
    const initial = await this.locate(userId, id);
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.access.board(userId, initial.board.id, 'read', tx);
        return this.detail(tx, id, userId, actor.canManage);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async list(userId: string, query: TaskList) {
    const actor = await this.access.board(userId, query.boardId, 'read');
    if (
      query.columnId &&
      !(await this.prisma.column.findFirst({
        where: { id: query.columnId, boardId: query.boardId },
      }))
    )
      throw new NotFoundException('Column not found');
    const where: Prisma.TaskWhereInput = {
      column: { boardId: query.boardId },
      ...(query.columnId ? { columnId: query.columnId } : {}),
      archivedAt: query.archived === 'true' ? { not: null } : null,
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId ? { assignees: { some: { userId: query.assigneeId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.task.findMany({
          where,
          include: taskInclude,
          orderBy: [
            ...(query.sort === 'position' ? [{ column: { position: query.order } }] : []),
            { [query.sort]: query.order },
            { id: 'asc' },
          ],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        this.prisma.task.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      rows.map((row) => taskView(row, userId, actor.canManage)),
      query.page,
      query.limit,
      total,
    );
  }
  update(userId: string, id: string, input: TaskUpdate) {
    return this.mutate(userId, id, input.expectedVersion, 'edit', async (tx, actor) => {
      const { expectedVersion: _version, assigneeIds, labelIds, ...fields } = input;
      await this.validateLinks(tx, actor.board, assigneeIds, labelIds);
      if (assigneeIds !== undefined) {
        await tx.taskAssignee.deleteMany({ where: { taskId: id } });
        await tx.taskAssignee.createMany({
          data: assigneeIds.map((userId) => ({ taskId: id, userId })),
        });
      }
      if (labelIds !== undefined) {
        await tx.taskLabel.deleteMany({ where: { taskId: id } });
        await tx.taskLabel.createMany({
          data: labelIds.map((labelId) => ({ taskId: id, labelId })),
        });
      }
      await tx.task.update({ where: { id }, data: fields });
      return this.detail(tx, id, userId, actor.board.canManage);
    });
  }
  move(userId: string, id: string, input: TaskMove) {
    return this.mutate(
      userId,
      id,
      input.expectedVersion,
      'edit',
      async (tx, actor) => {
        if (
          !(await tx.column.findFirst({
            where: { id: input.columnId, boardId: actor.board.board.id },
          }))
        )
          throw new BadRequestException('The target column must belong to this board');
        if (input.beforeTaskId === id)
          throw new BadRequestException('A task cannot be placed before itself');
        const rows = await tx.task.findMany({
          where: { columnId: input.columnId, id: { not: id } },
          orderBy: { position: 'asc' },
          select: { id: true, position: true, archivedAt: true },
        });
        if (rows.length >= MAX_COLUMN_TASKS)
          throw new ConflictException('The target column reached its task limit');
        const index = input.beforeTaskId
          ? rows.findIndex((row) => row.id === input.beforeTaskId && !row.archivedAt)
          : rows.length;
        if (index === -1)
          throw new BadRequestException('The destination task must be active in the target column');
        const previous = rows[index - 1]?.position ?? new Prisma.Decimal(0);
        const next = rows[index]?.position;
        let position = next
          ? previous.plus(next).dividedBy(2).toDecimalPlaces(10)
          : previous.plus(1024);
        if (next && (position.lte(previous) || position.gte(next))) {
          // Rebalance only when the fractional gap is exhausted. Deferred uniqueness makes swaps atomic.
          const values = rows.map(
            (row, offset) => Prisma.sql`(${row.id}::uuid, ${(offset + 1) * 1024}::numeric)`,
          );
          if (values.length)
            await tx.$executeRaw(
              Prisma.sql`UPDATE "Task" AS t SET position = ranks.position FROM (VALUES ${Prisma.join(values)}) AS ranks(id, position) WHERE t.id = ranks.id`,
            );
          position = new Prisma.Decimal(index === 0 ? 512 : index * 1024 + 512);
        }
        await tx.task.update({ where: { id }, data: { columnId: input.columnId, position } });
        return {
          task: await this.detail(tx, id, userId, actor.board.canManage),
          revision: actor.board.board.revision,
        };
      },
      { expectedRevision: input.expectedRevision },
    );
  }
  archive(userId: string, id: string, archived: boolean, expectedVersion: number) {
    return this.mutate(
      userId,
      id,
      expectedVersion,
      'archive',
      async (tx, actor) => {
        await tx.task.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
        return this.detail(tx, id, userId, actor.board.canManage);
      },
      { allowArchived: true },
    );
  }
  remove(userId: string, id: string, expectedVersion: number) {
    return this.mutate(
      userId,
      id,
      expectedVersion,
      'archive',
      async (tx) => {
        if (await tx.attachment.count({ where: { taskId: id } }))
          throw new ConflictException('Remove attachments before deleting this task');
        await tx.task.delete({ where: { id } });
        return { success: true };
      },
      { allowArchived: true },
    );
  }
}
