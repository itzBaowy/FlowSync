import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import type { Transporter } from 'nodemailer';
import type { Environment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { PermissionService } from '../authorization/permission.service';
import { visibleTasks } from '../authorization/scope-visibility';
import { NotificationOutboxService } from './notification-outbox.service';

export const deliveryJob = z.object({ notificationId: z.string().uuid() }).strict();
export const reminderJob = z
  .object({ reminderId: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
export const cleanupJob = z.object({ cleanupId: z.string().uuid() }).strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new UnrecoverableError('Invalid job payload');
  return result.data;
}
@Injectable()
export class NotificationJobsService {
  readonly environment: string;
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly outbox: NotificationOutboxService,
    private readonly config: ConfigService<Environment, true>,
  ) {
    this.environment = config.get('NODE_ENV', { infer: true });
  }
  async remind(input: unknown) {
    const data = parse(reminderJob, input);
    const initial = await this.prisma.dueReminder.findFirst({
      where: { id: data.reminderId, environment: this.environment },
      select: {
        task: { select: { column: { select: { board: { select: { projectId: true } } } } } },
      },
    });
    if (!initial) return [];
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProject(tx, initial.task.column.board.projectId);
      const row = await tx.dueReminder.findFirst({
        where: {
          id: data.reminderId,
          environment: this.environment,
          version: data.version,
          status: 'PENDING',
        },
        include: { task: { include: { column: true, assignees: true } } },
      });
      if (!row || row.runAt > new Date()) return [];
      const task = row.task;
      if (
        task.archivedAt ||
        task.column.kind === 'DONE' ||
        !task.dueDate ||
        task.dueDate.getTime() !== row.dueDate.getTime() ||
        task.dueDate <= new Date()
      ) {
        await tx.dueReminder.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
        return [];
      }
      const recipients: string[] = [];
      for (const assignee of task.assignees)
        if (await tx.task.count({ where: { id: task.id, ...visibleTasks(assignee.userId) } }))
          recipients.push(assignee.userId);
      const notifications = recipients.length
        ? await tx.notification.createManyAndReturn({
            data: recipients.map((userId) => ({
              userId,
              taskId: task.id,
              type: 'DUE_DATE' as const,
              title: [...`Due within 24 hours: ${task.title}`].slice(0, 240).join(''),
              dedupeKey: `${userId}:${task.id}:DUE_DATE:${row.dueDate.toISOString()}`,
            })),
            skipDuplicates: true,
            select: { id: true, type: true, userId: true },
          })
        : [];
      await this.outbox.emails(tx, notifications);
      await tx.dueReminder.update({ where: { id: row.id }, data: { status: 'SENT' } });
      return notifications.map((row) => row.userId);
    });
  }
  async email(input: unknown, transport: Transporter) {
    const { notificationId } = parse(deliveryJob, input);
    const delivery = await this.prisma.notificationDelivery.findFirst({
      where: { notificationId, environment: this.environment, status: 'PENDING' },
      include: { notification: { include: { user: { select: { email: true } } } } },
    });
    if (!delivery) return;
    // Check current scope at delivery time, even when a job was queued before revocation.
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId: delivery.notification.userId,
        task: { is: visibleTasks(delivery.notification.userId) },
      },
      include: {
        task: {
          select: {
            id: true,
            column: { select: { boardId: true, board: { select: { projectId: true } } } },
          },
        },
      },
    });
    if (!notification?.task || notification.readAt) {
      await this.prisma.notificationDelivery.update({
        where: { notificationId },
        data: { status: 'SKIPPED' },
      });
      return;
    }
    await this.prisma.notificationDelivery.update({
      where: { notificationId },
      data: { attempts: { increment: 1 } },
    });
    const link = new URL('/boards', this.config.get('WEB_URL', { infer: true }));
    link.searchParams.set('projectId', notification.task.column.board.projectId);
    link.searchParams.set('id', notification.task.column.boardId);
    link.searchParams.set('taskId', notification.task.id);
    await transport.sendMail({
      from: this.config.get('EMAIL_FROM', { infer: true }),
      to: delivery.notification.user.email,
      subject: notification.title.replace(/[\r\n]/g, ' '),
      text: `${notification.title}\n\nOpen in FlowSync:\n${link.toString()}`,
      messageId: `<notification-${notificationId}@flowsync.local>`,
    });
    await this.prisma.notificationDelivery.update({
      where: { notificationId },
      data: { status: 'SENT', deliveredAt: new Date(), lastError: null },
    });
  }
}
