import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AttachmentList } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { PaginatedResult } from '../../common/pagination';
import { TasksService } from '../kanban/tasks.service';
import { KanbanAccessService } from '../kanban/kanban-access.service';
import { ActivityService } from '../activity/activity.service';
import { OBJECT_STORAGE, type ObjectStorage } from './storage.module';
import { FileCleanupService } from './file-cleanup.service';
import { validateAttachment } from './attachment-validation';
const include = { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } } as const;
type Row = Prisma.AttachmentGetPayload<{ include: typeof include }>;
function view(row: Row, userId: string, canArchive: boolean) {
  const { objectKey: _privateKey, uploadedById: _uploaderId, ...data } = row;
  return {
    ...data,
    createdAt: row.createdAt.toISOString(),
    canDelete: canArchive || row.uploadedById === userId,
  };
}
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly access: KanbanAccessService,
    private readonly activity: ActivityService,
    private readonly cleanup: FileCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  async list(userId: string, taskId: string, query: AttachmentList) {
    const initial = await this.tasks.locate(userId, taskId);
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.access.board(userId, initial.board.id, 'read', tx);
        const task = await tx.task.findFirst({
          where: { id: taskId, column: { boardId: actor.board.id } },
          select: { createdById: true },
        });
        if (!task) throw new NotFoundException('Task not found');
        const where: Prisma.AttachmentWhereInput = {
          taskId,
          ...(query.search ? { filename: { contains: query.search, mode: 'insensitive' } } : {}),
        };
        const rows = await tx.attachment.findMany({
          where,
          include,
          orderBy: [{ createdAt: query.order }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        });
        const total = await tx.attachment.count({ where });
        return new PaginatedResult(
          rows.map((row) => view(row, userId, actor.canManage || task.createdById === userId)),
          query.page,
          query.limit,
          total,
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async upload(userId: string, taskId: string, file: Express.Multer.File | undefined) {
    const initial = await this.tasks.locate(userId, taskId);
    const validated = await validateAttachment(file);
    const key = `tasks/${taskId}/attachments/${randomUUID()}`;
    // Reservation survives a crash between storage upload and metadata commit.
    const cleanup = await this.prisma.$transaction((tx) => this.cleanup.reserve(tx, key, 3600000));
    try {
      await this.storage.put(key, validated.bytes, validated.mimeType);
      return await this.access.mutate(
        userId,
        initial.board.id,
        'read',
        async (tx, actor) => {
          const task = await tx.task.findFirst({
            where: { id: taskId, column: { boardId: actor.board.id } },
            select: { createdById: true, title: true, archivedAt: true },
          });
          if (!task) throw new NotFoundException('Task not found');
          if (task.archivedAt)
            throw new ConflictException('Restore this task before adding attachments');
          if ((await tx.attachment.count({ where: { taskId } })) >= 20)
            throw new ConflictException('A task supports at most 20 attachments');
          const row = await tx.attachment.create({
            data: {
              taskId,
              uploadedById: userId,
              objectKey: key,
              filename: validated.filename,
              mimeType: validated.mimeType,
              size: validated.bytes.length,
            },
            include,
          });
          await tx.objectCleanup.delete({ where: { id: cleanup.id } });
          await this.activity.record(tx, {
            organizationId: actor.workspace.organizationId,
            projectId: actor.project.id,
            taskId,
            actorId: userId,
            action: 'ATTACHMENT_ADDED',
            metadata: { title: task.title, filename: row.filename, attachmentId: row.id },
          });
          return view(row, userId, actor.canManage || task.createdById === userId);
        },
        { activity: false },
      );
    } catch (error) {
      await this.prisma.objectCleanup.updateMany({
        where: { id: cleanup.id },
        data: { nextAttemptAt: new Date() },
      });
      await this.cleanup.run(cleanup.id).catch(() => false);
      throw error;
    }
  }
  async download(userId: string, taskId: string, id: string) {
    const initial = await this.tasks.locate(userId, taskId);
    const row = await this.prisma.$transaction(
      async (tx) => {
        await this.access.board(userId, initial.board.id, 'read', tx);
        const attachment = await tx.attachment.findFirst({ where: { id, taskId } });
        if (!attachment) throw new NotFoundException('Attachment not found');
        return attachment;
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return { url: await this.storage.signedUrl(row.objectKey, row.filename), expiresIn: 300 };
  }
  async remove(userId: string, taskId: string, id: string) {
    const initial = await this.tasks.locate(userId, taskId);
    const result = await this.access.mutate(
      userId,
      initial.board.id,
      'read',
      async (tx, actor) => {
        const row = await tx.attachment.findFirst({
          where: { id, taskId },
          include: { task: { select: { createdById: true, title: true } } },
        });
        if (!row) throw new NotFoundException('Attachment not found');
        if (!(actor.canManage || row.uploadedById === userId || row.task.createdById === userId))
          throw new ForbiddenException('You cannot remove this attachment');
        const cleanup = await this.cleanup.reserve(tx, row.objectKey);
        await tx.attachment.delete({ where: { id } });
        await this.activity.record(tx, {
          organizationId: actor.workspace.organizationId,
          projectId: actor.project.id,
          taskId,
          actorId: userId,
          action: 'ATTACHMENT_REMOVED',
          metadata: { title: row.task.title, filename: row.filename, attachmentId: id },
        });
        return cleanup.id;
      },
      { activity: false },
    );
    await this.cleanup.run(result).catch(() => false);
    return { success: true };
  }
}
