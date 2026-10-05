import { Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { Environment } from '../../config/environment';
import { decryptInvitation } from './invitation-payload';
import { canAccessOrganization } from '../authorization/organization.policy';

export async function startEmailWorker(env: Environment) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 }),
  });
  await prisma.$connect();
  const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD };
  const queueName = `flowsync-email-${env.NODE_ENV}`;
  const queue = new Queue(queueName, {
    connection: { ...connection, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 604800, count: 1000 },
    },
  });
  const smtp = new URL(env.SMTP_URL);
  const transport = nodemailer.createTransport({
    host: smtp.hostname,
    port: Number(smtp.port || (smtp.protocol === 'smtps:' ? 465 : 587)),
    secure: smtp.protocol === 'smtps:',
    requireTLS: env.NODE_ENV === 'production',
    ...(smtp.username
      ? {
          auth: {
            user: decodeURIComponent(smtp.username),
            pass: decodeURIComponent(smtp.password),
          },
        }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  });
  const log = (event: string, fields: Record<string, unknown> = {}) => {
    if (env.NODE_ENV !== 'test')
      process.stdout.write(
        `${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`,
      );
  };
  const worker = new Worker<{ outboxId: string }>(
    queueName,
    async (job) => {
      const entry = await prisma.emailOutbox.findUnique({
        where: { id: job.data.outboxId },
        include: { invitation: { include: { organization: true } } },
      });
      if (!entry?.encryptedPayload || entry.deliveredAt) return;
      const invite = entry.invitation;
      if (invite.status !== 'PENDING' || invite.expiresAt <= new Date()) return;
      const sender = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invite.organizationId,
            userId: invite.invitedById,
          },
        },
      });
      if (
        !sender ||
        !canAccessOrganization(sender.role, 'invite', invite.organization.allowAdminInvites)
      ) {
        await prisma.$transaction([
          prisma.invitation.updateMany({
            where: { id: invite.id, status: 'PENDING' },
            data: { status: 'REVOKED' },
          }),
          prisma.emailOutbox.update({ where: { id: entry.id }, data: { encryptedPayload: null } }),
        ]);
        return;
      }
      const payload = decryptInvitation(entry.encryptedPayload, env.EMAIL_ENCRYPTION_KEY);
      const link = new URL('/invite', env.WEB_URL);
      link.searchParams.set('token', payload.token);
      await transport.sendMail({
        from: env.EMAIL_FROM,
        to: payload.email,
        subject: `Join ${payload.organizationName.replace(/[\r\n]/g, ' ')} on FlowSync`,
        text: `${payload.inviterName} invited you to join ${payload.organizationName}.\n\nOpen this link and sign in with the invited email:\n${link.toString()}\n\nThis invitation expires on ${invite.expiresAt.toISOString()}.`,
        messageId: `<${entry.id}@flowsync.local>`,
      });
      await prisma.emailOutbox.update({
        where: { id: entry.id },
        data: { deliveredAt: new Date(), encryptedPayload: null },
      });
      log('email.delivered', { outboxId: entry.id });
    },
    { connection, concurrency: 3 },
  );
  worker.on('failed', (job) =>
    log('email.failed', { jobId: job?.id, attemptsMade: job?.attemptsMade }),
  );
  worker.on('error', () => log('email.worker_unavailable'));
  queue.on('error', () => log('email.queue_unavailable'));
  let pumping: Promise<void> | undefined;
  let stopping = false;
  const pump = () => {
    if (pumping || stopping) return;
    pumping = (async () => {
      await prisma.invitation.updateMany({
        where: { status: 'PENDING', expiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED' },
      });
      await prisma.emailOutbox.updateMany({
        where: { encryptedPayload: { not: null }, invitation: { status: { not: 'PENDING' } } },
        data: { encryptedPayload: null },
      });
      const entries = await prisma.emailOutbox.findMany({
        where: {
          deliveredAt: null,
          encryptedPayload: { not: null },
          invitation: { status: 'PENDING', expiresAt: { gt: new Date() } },
        },
        take: 50,
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      for (const entry of entries) {
        if (stopping) break;
        // Only an opaque outbox ID reaches Redis; confidential token remains encrypted in PostgreSQL.
        await queue.add('invitation', { outboxId: entry.id }, { jobId: entry.id });
        await prisma.emailOutbox.updateMany({
          where: { id: entry.id, enqueuedAt: null },
          data: { enqueuedAt: new Date() },
        });
      }
    })()
      .catch(() => log('email.outbox_retry'))
      .finally(() => {
        pumping = undefined;
      });
  };
  pump();
  const timer = setInterval(pump, 3000);
  log('email.worker_started');
  return {
    async stop() {
      stopping = true;
      clearInterval(timer);
      await pumping;
      await worker.close();
      await queue.close();
      transport.close();
      await prisma.$disconnect();
    },
  };
}
