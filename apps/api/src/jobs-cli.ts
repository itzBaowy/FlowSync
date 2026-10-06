import { config } from 'dotenv';
import { Queue } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { validateEnvironment } from './config/environment';
import { jobQueueNames, queueKind, retryJob } from './modules/queue/job-maintenance';
config({ path: '../../.env', quiet: true });
async function main() {
  const args = process.argv.slice(2);
  if (
    !(args.length === 1 && args[0] === 'status') &&
    !(args.length === 3 && args[0] === 'retry' && queueKind.safeParse(args[1]).success)
  )
    throw new Error(
      'Usage: jobs-cli status | jobs-cli retry email|reminders|files|invitations <job-id>',
    );
  const env = validateEnvironment(process.env);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 }),
  });
  const connection = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 5000,
  };
  const queues = Object.entries(jobQueueNames(env.NODE_ENV)).map(([kind, name]) => {
    const queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: kind === 'files' ? 5000 : 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
      },
    });
    queue.on('error', () => {});
    return { kind, queue };
  });
  try {
    if (args[0] === 'retry') {
      const kind = queueKind.parse(args[1]);
      const target = queues.find((entry) => entry.kind === kind)!;
      console.log(JSON.stringify(await retryJob(prisma, env, kind, target.queue, args[2]!)));
    } else {
      const status = await Promise.all(
        queues.map(async ({ kind, queue }) => ({
          queue: kind,
          counts: await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
        })),
      );
      const [deliveries, reminders, pendingFiles] = await Promise.all([
        prisma.notificationDelivery.groupBy({
          by: ['status'],
          where: { environment: env.NODE_ENV },
          _count: true,
        }),
        prisma.dueReminder.groupBy({
          by: ['status'],
          where: { environment: env.NODE_ENV },
          _count: true,
        }),
        prisma.objectCleanup.count({ where: { environment: env.NODE_ENV, completedAt: null } }),
      ]);
      console.log(
        JSON.stringify(
          { environment: env.NODE_ENV, queues: status, deliveries, reminders, pendingFiles },
          null,
          2,
        ),
      );
    }
  } finally {
    await Promise.all(queues.map(({ queue }) => queue.close()));
    await prisma.$disconnect();
  }
}
main().catch(() => {
  console.error('Job command failed. Check arguments, job state, environment and infrastructure.');
  process.exitCode = 1;
});
