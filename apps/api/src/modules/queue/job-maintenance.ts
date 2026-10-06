import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { Environment } from '../../config/environment';
export const queueKind = z.enum(['email', 'reminders', 'files', 'invitations', 'ai']);
export type QueueKind = z.infer<typeof queueKind>;
export function jobQueueNames(environment: string) {
  return {
    reminders: `flowsync-notifications-${environment}`,
    email: `flowsync-notification-email-${environment}`,
    files: `flowsync-files-${environment}`,
    invitations: `flowsync-email-${environment}`,
    ai: `flowsync-ai-${environment}`,
  };
}
export async function retryJob(
  db: Prisma.TransactionClient,
  env: Environment,
  kind: QueueKind,
  queue: Queue,
  id: string,
) {
  if (queue.name !== jobQueueNames(env.NODE_ENV)[kind])
    throw new Error('Queue environment mismatch');
  const identifier =
    kind === 'reminders'
      ? z
          .string()
          .regex(/^[a-f0-9-]{36}-\d+$/)
          .safeParse(id)
      : z.string().uuid().safeParse(id);
  if (!identifier.success) throw new Error('Invalid job ID');
  const job = await queue.getJob(id);
  if (job && (await job.getState()) !== 'failed')
    throw new Error('Only failed jobs can be retried');
  let data: Record<string, string | number>;
  let name: string;
  if (kind === 'email') {
    const row = await db.notificationDelivery.findFirst({
      where: {
        notificationId: id,
        environment: env.NODE_ENV,
        status: { in: ['FAILED', 'PENDING'] },
      },
    });
    if (!row) throw new Error('Delivery is not retryable in this environment');
    await db.notificationDelivery.update({
      where: { notificationId: id },
      data: { status: 'PENDING', lastError: null },
    });
    data = { notificationId: id };
    name = 'notification';
  } else if (kind === 'reminders') {
    const reminderId = id.slice(0, 36);
    const version = Number(id.slice(37));
    const row = await db.dueReminder.findFirst({
      where: {
        id: reminderId,
        version,
        environment: env.NODE_ENV,
        status: { in: ['FAILED', 'PENDING'] },
      },
    });
    if (!row) throw new Error('Reminder version is no longer retryable');
    await db.dueReminder.update({ where: { id: reminderId }, data: { status: 'PENDING' } });
    data = { reminderId, version };
    name = 'due';
  } else if (kind === 'files') {
    const row = await db.objectCleanup.findFirst({
      where: { id, environment: env.NODE_ENV, completedAt: null },
    });
    if (!row) throw new Error('Cleanup is not retryable in this environment');
    await db.objectCleanup.update({
      where: { id },
      data: { nextAttemptAt: new Date(), lastError: null },
    });
    data = { cleanupId: id };
    name = 'cleanup';
  } else if (kind === 'ai') {
    const row = await db.aIRun.findFirst({
      where: { id, environment: env.NODE_ENV, status: { in: ['FAILED', 'PENDING'] } },
    });
    if (!row) throw new Error('Assistant request is not retryable in this environment');
    await db.aIRun.update({
      where: { id },
      data: { status: 'PENDING', claimedAt: null, leaseId: null, lastError: null },
    });
    data = { runId: id };
    name = 'assistant';
  } else {
    const row = await db.emailOutbox.findFirst({
      where: {
        id,
        environment: env.NODE_ENV,
        deliveredAt: null,
        encryptedPayload: { not: null },
        invitation: { status: 'PENDING', expiresAt: { gt: new Date() } },
      },
    });
    if (!row) throw new Error('Invitation is not retryable in this environment');
    data = { outboxId: id };
    name = 'invitation';
  }
  if (job) await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
  else await queue.add(name, data, { jobId: id });
  return { queue: kind, jobId: id, retried: true };
}
export async function pruneCompletedJobs(db: Prisma.TransactionClient, environment: string) {
  const before = new Date(Date.now() - 7 * 86400000);
  await db.objectCleanup.deleteMany({ where: { environment, completedAt: { lt: before } } });
  await db.notificationDelivery.deleteMany({
    where: { environment, status: { in: ['SENT', 'SKIPPED'] }, createdAt: { lt: before } },
  });
  await db.emailOutbox.deleteMany({
    where: { environment, deliveredAt: { lt: before }, encryptedPayload: null },
  });
  // Keep replay-detection rows until the original token has expired plus a safety window.
  if (environment === 'production')
    await db.refreshToken.deleteMany({ where: { expiresAt: { lt: before } } });
}
