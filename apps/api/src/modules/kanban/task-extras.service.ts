import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PermissionService } from '../authorization/permission.service';
import { TasksService } from './tasks.service';
@Injectable()
export class TaskExtrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly tasks: TasksService,
  ) {}
  async labels(userId: string, projectId: string) {
    await this.permissions.requireProject(userId, projectId, 'read');
    return this.prisma.label.findMany({
      where: { projectId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  private async labelMutation<T>(
    userId: string,
    projectId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.permissions.lockProject(tx, projectId);
        await this.permissions.requireProject(userId, projectId, 'manage', tx);
        const result = await run(tx);
        await tx.board.updateMany({ where: { projectId }, data: { revision: { increment: 1 } } });
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('A label with this name already exists in this project');
      throw error;
    }
  }
  addLabel(userId: string, projectId: string, input: { name: string; color: string }) {
    return this.labelMutation(userId, projectId, async (tx) => {
      if ((await tx.label.count({ where: { projectId } })) >= 200)
        throw new ConflictException('A project supports at most 200 labels');
      return tx.label.create({ data: { ...input, projectId } });
    });
  }
  updateLabel(
    userId: string,
    projectId: string,
    id: string,
    input: { name: string; color: string },
  ) {
    return this.labelMutation(userId, projectId, async (tx) => {
      if (!(await tx.label.findFirst({ where: { id, projectId } })))
        throw new NotFoundException('Label not found');
      return tx.label.update({ where: { id }, data: input });
    });
  }
  removeLabel(userId: string, projectId: string, id: string) {
    return this.labelMutation(userId, projectId, async (tx) => {
      if (!(await tx.label.findFirst({ where: { id, projectId } })))
        throw new NotFoundException('Label not found');
      await tx.label.delete({ where: { id } });
      return { success: true };
    });
  }
  addChecklist(userId: string, taskId: string, title: string, expectedVersion: number) {
    return this.tasks.mutate(userId, taskId, expectedVersion, 'edit', async (tx, actor) => {
      const rows = await tx.checklist.findMany({
        where: { taskId },
        select: { position: true },
        orderBy: { position: 'desc' },
      });
      if (rows.length >= 20) throw new ConflictException('A task supports at most 20 checklists');
      await tx.checklist.create({
        data: { taskId, title, position: (rows[0]?.position ?? -1) + 1 },
      });
      return this.tasks.detail(tx, taskId, userId, actor.board.canManage);
    });
  }
  removeChecklist(userId: string, taskId: string, id: string, expectedVersion: number) {
    return this.tasks.mutate(userId, taskId, expectedVersion, 'edit', async (tx, actor) => {
      if (!(await tx.checklist.findFirst({ where: { id, taskId } })))
        throw new NotFoundException('Checklist not found');
      await tx.checklist.delete({ where: { id } });
      return this.tasks.detail(tx, taskId, userId, actor.board.canManage);
    });
  }
  addItem(
    userId: string,
    taskId: string,
    checklistId: string,
    text: string,
    expectedVersion: number,
  ) {
    return this.tasks.mutate(userId, taskId, expectedVersion, 'edit', async (tx, actor) => {
      if (!(await tx.checklist.findFirst({ where: { id: checklistId, taskId } })))
        throw new NotFoundException('Checklist not found');
      const rows = await tx.checklistItem.findMany({
        where: { checklistId },
        select: { position: true },
        orderBy: { position: 'desc' },
      });
      if (rows.length >= 100) throw new ConflictException('A checklist supports at most 100 items');
      await tx.checklistItem.create({
        data: { checklistId, text, position: (rows[0]?.position ?? -1) + 1 },
      });
      return this.tasks.detail(tx, taskId, userId, actor.board.canManage);
    });
  }
  changeItem(
    userId: string,
    taskId: string,
    id: string,
    expectedVersion: number,
    input: { text?: string; completed?: boolean } | null,
  ) {
    return this.tasks.mutate(userId, taskId, expectedVersion, 'edit', async (tx, actor) => {
      if (!(await tx.checklistItem.findFirst({ where: { id, checklist: { taskId } } })))
        throw new NotFoundException('Checklist item not found');
      if (input) await tx.checklistItem.update({ where: { id }, data: input });
      else await tx.checklistItem.delete({ where: { id } });
      return this.tasks.detail(tx, taskId, userId, actor.board.canManage);
    });
  }
}
