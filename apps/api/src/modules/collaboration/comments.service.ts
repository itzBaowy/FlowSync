import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CommentList } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { PaginatedResult } from '../../common/pagination';
import { KanbanAccessService, type BoardActor } from '../kanban/kanban-access.service';
import { TasksService } from '../kanban/tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { mentionTokens } from './mention-parser';
const profile = { id: true, name: true, avatarUrl: true } as const;
const include = {
  author: { select: profile },
  mentions: { include: { user: { select: profile } }, orderBy: { userId: 'asc' as const } },
} as const;
type Row = Prisma.CommentGetPayload<{ include: typeof include }>;
const view = (row: Row, userId: string, manager: boolean) => ({
  id: row.id,
  taskId: row.taskId,
  text: row.text,
  version: row.version,
  author: row.author,
  mentions: row.mentions.map((mention) => mention.user),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  canEdit: row.authorId === userId,
  canDelete: row.authorId === userId || manager,
});
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}
  async list(userId: string, taskId: string, query: CommentList) {
    const initial = await this.tasks.locate(userId, taskId);
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.access.board(userId, initial.board.id, 'read', tx);
        if (
          !(await tx.task.findFirst({
            where: { id: taskId, column: { boardId: actor.board.id } },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Task not found');
        const where: Prisma.CommentWhereInput = {
          taskId,
          ...(query.search ? { text: { contains: query.search, mode: 'insensitive' } } : {}),
        };
        const rows = await tx.comment.findMany({
          where,
          include,
          orderBy: [{ createdAt: query.order }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        });
        const total = await tx.comment.count({ where });
        return new PaginatedResult(
          rows.map((row) => view(row, userId, actor.canManage)),
          query.page,
          query.limit,
          total,
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async mentions(tx: Prisma.TransactionClient, actor: BoardActor, text: string) {
    const { ids, handles } = mentionTokens(text);
    if (!ids.length && !handles.length) return [];
    const members = await tx.projectMember.findMany({
      where: {
        projectId: actor.project.id,
        user: {
          organizations: { some: { organizationId: actor.workspace.organizationId } },
          workspaces: { some: { workspaceId: actor.workspace.id } },
          OR: [
            { id: { in: ids } },
            { email: { in: handles, mode: 'insensitive' } },
            { name: { in: handles, mode: 'insensitive' } },
          ],
        },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    const found = new Set(ids);
    if (ids.some((id) => !members.some((member) => member.user.id === id)))
      throw new BadRequestException('Mention current members of this project');
    for (const handle of handles) {
      const matches = members.filter((member) =>
        [member.user.name.toLowerCase(), member.user.email.toLowerCase()].includes(handle),
      );
      if (matches.length > 1)
        throw new BadRequestException(
          'This mention is ambiguous. Select a member or use their full email',
        );
      if (matches[0]) found.add(matches[0].user.id);
    }
    if (found.size > 20) throw new BadRequestException('Use at most 20 mentions per comment');
    return [...found];
  }
  private async mutate(
    userId: string,
    taskId: string,
    text: string | undefined,
    commentId?: string,
    expectedVersion?: number,
  ) {
    const initial = await this.tasks.locate(userId, taskId);
    const recipients = new Set<string>();
    const result = await this.access.mutate(
      userId,
      initial.board.id,
      'read',
      async (tx, actor) => {
        const task = await tx.task.findFirst({
          where: { id: taskId, column: { boardId: actor.board.id } },
          select: {
            title: true,
            archivedAt: true,
            createdById: true,
            assignees: { select: { userId: true } },
          },
        });
        if (!task) throw new NotFoundException('Task not found');
        const old = commentId
          ? await tx.comment.findFirst({ where: { id: commentId, taskId }, include })
          : null;
        if (commentId && !old) throw new NotFoundException('Comment not found');
        if (old && !(old.authorId === userId || (text === undefined && actor.canManage)))
          throw new ForbiddenException('You cannot change this comment');
        if (old && old.version !== expectedVersion)
          throw new ConflictException('Comment changed. Reload and try again');
        if (text !== undefined && task.archivedAt)
          throw new ConflictException('Restore this task before commenting');
        if (text === undefined) {
          await tx.comment.delete({ where: { id: old!.id } });
          await this.activity.record(tx, {
            organizationId: actor.workspace.organizationId,
            projectId: actor.project.id,
            taskId,
            actorId: userId,
            action: 'COMMENT_DELETED',
            metadata: { commentId: old!.id, title: task.title },
          });
          return { success: true };
        }
        if (!old && (await tx.comment.count({ where: { taskId } })) >= 1000)
          throw new ConflictException('A task supports at most 1000 comments');
        const ids = await this.mentions(tx, actor, text);
        if (old) await tx.mention.deleteMany({ where: { commentId: old.id } });
        const row = old
          ? await tx.comment.update({
              where: { id: old.id },
              data: {
                text,
                version: { increment: 1 },
                mentions: { create: ids.map((userId) => ({ userId })) },
              },
              include,
            })
          : await tx.comment.create({
              data: {
                taskId,
                authorId: userId,
                text,
                mentions: { create: ids.map((userId) => ({ userId })) },
              },
              include,
            });
        const newlyMentioned = ids.filter(
          (id) => !old?.mentions.some((mention) => mention.userId === id),
        );
        for (const id of await this.notifications.record(
          tx,
          userId,
          taskId,
          newlyMentioned,
          'MENTION',
          task.title,
        ))
          recipients.add(id);
        if (!old) {
          const watchers = [
            ...task.assignees.map((user) => user.userId),
            ...(task.createdById ? [task.createdById] : []),
          ].filter((id) => !ids.includes(id));
          for (const id of await this.notifications.record(
            tx,
            userId,
            taskId,
            watchers,
            'TASK_COMMENT',
            task.title,
          ))
            recipients.add(id);
        }
        await this.activity.record(tx, {
          organizationId: actor.workspace.organizationId,
          projectId: actor.project.id,
          taskId,
          actorId: userId,
          action: old ? 'COMMENT_UPDATED' : 'COMMENT_CREATED',
          metadata: { commentId: row.id, title: task.title, mentionIds: ids },
        });
        return view(row, userId, actor.canManage);
      },
      { activity: false },
    );
    await this.notifications.afterCommit([...recipients]);
    return result;
  }
  create(userId: string, taskId: string, text: string) {
    return this.mutate(userId, taskId, text);
  }
  update(userId: string, taskId: string, id: string, text: string, version: number) {
    return this.mutate(userId, taskId, text, id, version);
  }
  remove(userId: string, taskId: string, id: string, version: number) {
    return this.mutate(userId, taskId, undefined, id, version);
  }
}
