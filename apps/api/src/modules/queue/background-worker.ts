import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { Queue, Worker, type Job } from 'bullmq';
import type { Environment } from '../../config/environment';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { AuthorizationModule } from '../authorization/authorization.module';
import { FileCleanupModule } from '../files/file-cleanup.module';
import { FileCleanupService } from '../files/file-cleanup.service';
import { NotificationOutboxService } from './notification-outbox.service';
import {
  NotificationJobsService,
  cleanupJob,
  deliveryJob,
  reminderJob,
} from './notification-jobs.service';
import { smtpTransport } from './smtp';
import { UnrecoverableError } from 'bullmq';

@Module({})
class WorkerContext {}
export function jobQueueNames(environment: string) {
  return {
    reminders: `flowsync-notifications-${environment}`,
    email: `flowsync-notification-email-${environment}`,
    files: `flowsync-files-${environment}`,
  };
}
export async function startBackgroundWorker(env: Environment) {
  const app = await NestFactory.createApplicationContext(
    {
      module: WorkerContext,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] }),
        LoggerModule.forRoot({ pinoHttp: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' } }),
        DatabaseModule,
        AuthorizationModule,
        FileCleanupModule,
      ],
      providers: [NotificationJobsService, NotificationOutboxService],
    },
    { logger: false },
  );
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const cleanup = app.get(FileCleanupService);
  const jobs = app.get(NotificationJobsService);
  const transport = smtpTransport(env);
  const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD };
  const names = jobQueueNames(env.NODE_ENV);
  const makeQueue = (name: string, delay: number) =>
    new Queue(name, {
      connection: { ...connection, maxRetriesPerRequest: 1 },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
      },
    });
  const queues = {
    reminders: makeQueue(names.reminders, 1000),
    email: makeQueue(names.email, 1000),
    files: makeQueue(names.files, 5000),
  };
  const log = (event: string, fields: Record<string, unknown> = {}) => {
    if (env.NODE_ENV !== 'test')
      process.stdout.write(
        `${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`,
      );
  };
  // BullMQ persists thrown error messages and stacks. Replace infrastructure errors with fixed text.
  const sanitized = async (run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof UnrecoverableError) throw error;
      throw new Error('Background job unavailable');
    }
  };
  const workers = {
    reminders: new Worker(
      names.reminders,
      (job: Job) =>
        sanitized(async () => {
          const users = await jobs.remind(job.data);
          if (users.length)
            await redis.client.publish(
              `flowsync:${env.NODE_ENV}:realtime:notifications`,
              JSON.stringify(users),
            );
        }),
      { connection, concurrency: 2 },
    ),
    email: new Worker(names.email, (job: Job) => sanitized(() => jobs.email(job.data, transport)), {
      connection,
      concurrency: 3,
    }),
    files: new Worker(
      names.files,
      (job: Job) =>
        sanitized(async () => {
          const data = cleanupJob.safeParse(job.data);
          if (!data.success) throw new UnrecoverableError('Invalid job payload');
          if (!(await cleanup.run(data.data.cleanupId))) throw new Error('Object cleanup pending');
        }),
      { connection, concurrency: 2 },
    ),
  };
  const failures = new Set<Promise<unknown>>();
  for (const [kind, worker] of Object.entries(workers)) {
    worker.on('error', () => log('jobs.worker_unavailable', { queue: kind }));
    worker.on('failed', (job, error) => {
      log('jobs.failed', { queue: kind, jobId: job?.id, attemptsMade: job?.attemptsMade });
      if (
        !job ||
        (job.attemptsMade < (job.opts.attempts ?? 1) && !(error instanceof UnrecoverableError))
      )
        return;
      const delivery = deliveryJob.safeParse(job.data);
      const reminder = reminderJob.safeParse(job.data);
      const update =
        kind === 'email' && delivery.success
          ? prisma.notificationDelivery.updateMany({
              where: {
                notificationId: delivery.data.notificationId,
                environment: env.NODE_ENV,
                status: 'PENDING',
              },
              data: { status: 'FAILED', lastError: 'DeliveryFailed' },
            })
          : kind === 'reminders' && reminder.success
            ? prisma.dueReminder.updateMany({
                where: {
                  id: reminder.data.reminderId,
                  version: reminder.data.version,
                  environment: env.NODE_ENV,
                  status: 'PENDING',
                },
                data: { status: 'FAILED' },
              })
            : Promise.resolve();
      const pending = Promise.resolve(update)
        .catch(() => log('jobs.failure_record_retry'))
        .finally(() => failures.delete(pending));
      failures.add(pending);
    });
  }
  for (const queue of Object.values(queues)) queue.on('error', () => log('jobs.queue_unavailable'));
  let pumping: Promise<void> | undefined;
  let stopping = false;
  async function dispatch() {
    const [deliveries, reminders, files] = await Promise.all([
      prisma.notificationDelivery.findMany({
        where: { environment: env.NODE_ENV, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { notificationId: true },
      }),
      prisma.dueReminder.findMany({
        where: { environment: env.NODE_ENV, status: 'PENDING', runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        take: 50,
        select: { id: true, version: true },
      }),
      prisma.objectCleanup.findMany({
        where: { environment: env.NODE_ENV, completedAt: null, nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: 50,
        select: { id: true },
      }),
    ]);
    for (const row of deliveries) {
      if (stopping) return;
      await queues.email.add(
        'notification',
        { notificationId: row.notificationId },
        { jobId: row.notificationId },
      );
      await prisma.notificationDelivery.updateMany({
        where: { notificationId: row.notificationId, enqueuedAt: null },
        data: { enqueuedAt: new Date() },
      });
    }
    for (const row of reminders) {
      if (stopping) return;
      await queues.reminders.add(
        'due',
        { reminderId: row.id, version: row.version },
        { jobId: `${row.id}-${row.version}` },
      );
    }
    for (const row of files) {
      if (stopping) return;
      await queues.files.add('cleanup', { cleanupId: row.id }, { jobId: row.id });
    }
  }
  const pump = () => {
    if (pumping || stopping) return pumping;
    pumping = dispatch()
      .catch(() => log('jobs.outbox_retry'))
      .finally(() => {
        pumping = undefined;
      });
    return pumping;
  };
  const timer = setInterval(() => {
    void pump();
  }, 3000);
  void pump();
  log('jobs.worker_started');
  return {
    queues,
    jobs,
    pump,
    async stop() {
      stopping = true;
      clearInterval(timer);
      await pumping;
      await Promise.all(Object.values(workers).map((worker) => worker.close()));
      await Promise.all([...failures]);
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
      transport.close();
      await app.close();
    },
  };
}
