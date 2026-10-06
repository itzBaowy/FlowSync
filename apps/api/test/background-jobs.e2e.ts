import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/environment';
import { startTestApi } from './helpers/api-server';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { io, type Socket } from 'socket.io-client';
import type { Job } from 'bullmq';
import { retryJob, pruneCompletedJobs } from '../src/modules/queue/job-maintenance';
import { notificationSchema } from '@flowsync/contracts';
// Tests use the compiled Nest providers so TypeScript decorator metadata matches production.
const { startBackgroundWorker } = createRequire(`${process.cwd()}/test/background-jobs.e2e.ts`)(
  '../dist/modules/queue/background-worker.js',
) as typeof import('../src/modules/queue/background-worker');
config({ path: '../../.env', quiet: true });
const env = validateEnvironment({
  ...process.env,
  NODE_ENV: 'test',
  SMTP_URL: `smtp://127.0.0.1:${process.env.MAILPIT_SMTP_PORT ?? '1025'}`,
});
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const storage = new S3Client({
  endpoint: env.MINIO_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.MINIO_ACCESS_KEY, secretAccessKey: env.MINIO_SECRET_KEY },
});
const mailpit = `http://127.0.0.1:${process.env.MAILPIT_HTTP_PORT ?? '8025'}`;
const suffix = randomUUID();
const accounts: { id: string; email: string; token: string }[] = [];
const messages: string[] = [];
const keys: string[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let worker: Awaited<ReturnType<typeof startBackgroundWorker>> | undefined;
let socket: Socket | undefined;
let organizationId: string;
let workspaceId: string;
let projectId: string;
let columnId: string;
let notificationsChanged = 0;
let position = 0;
async function until(check: () => Promise<boolean>, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Expected background job result was not observed');
}
async function finished(job: Job, state = 'completed') {
  await until(async () => (await job.getState()) === state);
}
async function task() {
  return prisma.task.create({
    data: {
      columnId,
      title: `Due task ${suffix}`,
      position: ++position * 1024,
      createdById: accounts[0]!.id,
      dueDate: new Date(Date.now() + 12 * 3600000),
      assignees: { create: { userId: accounts[1]!.id } },
    },
  });
}
async function notification(type: 'MENTION' | 'TASK_ASSIGNED' = 'MENTION') {
  const target = await task();
  return prisma.notification.create({
    data: {
      taskId: target.id,
      userId: accounts[1]!.id,
      type,
      title: `Notification ${suffix}`,
      delivery: { create: { environment: 'test' } },
    },
  });
}
beforeAll(async () => {
  api = await startTestApi();
  for (const name of ['Owner', 'Member']) {
    const email = `jobs-${name.toLowerCase()}-${suffix}@example.com`;
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'background-test-password' }),
    });
    expect(response.status).toBe(201);
    const { data } = await response.json();
    accounts.push({ id: data.user.id, email, token: data.accessToken });
  }
  const org = await prisma.organization.create({
    data: {
      name: 'Jobs team',
      slug: `jobs-${suffix}`,
      ownerId: accounts[0]!.id,
      members: {
        create: accounts.map((user, index) => ({
          userId: user.id,
          role: index === 0 ? ('OWNER' as const) : ('MEMBER' as const),
        })),
      },
    },
  });
  organizationId = org.id;
  const workspace = await prisma.workspace.create({
    data: {
      organizationId,
      name: 'Jobs',
      slug: 'jobs',
      members: { create: accounts.map((user) => ({ userId: user.id })) },
    },
  });
  workspaceId = workspace.id;
  const project = await prisma.project.create({
    data: {
      workspaceId,
      ownerId: accounts[0]!.id,
      name: 'Jobs',
      members: { create: accounts.map((user) => ({ userId: user.id })) },
    },
  });
  projectId = project.id;
  const board = await prisma.board.create({
    data: {
      projectId,
      name: 'Jobs',
      columns: { create: { name: 'Todo', kind: 'TODO', position: 0 } },
    },
    include: { columns: true },
  });
  columnId = board.columns[0]!.id;
  socket = io(`${api.baseUrl.replace(/\/api$/, '')}/realtime`, {
    transports: ['websocket'],
    auth: { token: accounts[1]!.token },
  });
  socket.on('notification:changed', () => {
    notificationsChanged++;
  });
  await until(async () => !!socket?.connected);
  worker = await startBackgroundWorker(env);
});
afterAll(async () => {
  socket?.disconnect();
  await worker?.stop();
  api?.stop();
  if (messages.length)
    await fetch(`${mailpit}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: messages }),
    });
  for (const key of keys)
    await storage.send(new DeleteObjectCommand({ Bucket: env.MINIO_BUCKET, Key: key }));
  await prisma.objectCleanup.deleteMany({
    where: { objectKey: { startsWith: `jobs/${suffix}/` } },
  });
  if (columnId) {
    await prisma.task.deleteMany({ where: { columnId } });
    await prisma.column.deleteMany({ where: { id: columnId } });
    await prisma.board.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: accounts.map((user) => user.id) } } });
  storage.destroy();
  await prisma.$disconnect();
});
describe.sequential('Durable queues with real Redis, SMTP and object storage', () => {
  it('creates one due notification/email and sends a realtime invalidation across worker/API', async () => {
    const target = await task();
    const reminder = await prisma.dueReminder.create({
      data: {
        taskId: target.id,
        dueDate: target.dueDate!,
        runAt: new Date(Date.now() - 1000),
        environment: 'test',
      },
    });
    const data = { reminderId: reminder.id, version: 0 };
    const before = notificationsChanged;
    const [first, duplicate] = await Promise.all([
      worker!.queues.reminders.add('due', data, { jobId: `${reminder.id}-0` }),
      worker!.queues.reminders.add('due', data, { jobId: `${reminder.id}-0` }),
    ]);
    expect(first.id).toBe(duplicate.id);
    await finished(first);
    await until(async () => notificationsChanged > before);
    const row = await prisma.notification.findFirstOrThrow({
      where: { taskId: target.id, type: 'DUE_DATE' },
    });
    await worker!.jobs.remind(data);
    expect(
      await prisma.notification.count({ where: { taskId: target.id, type: 'DUE_DATE' } }),
    ).toBe(1);
    await worker!.pump();
    await until(
      async () =>
        (await prisma.notificationDelivery.findUnique({ where: { notificationId: row.id } }))
          ?.status === 'SENT',
    );
    const result = await (
      await fetch(
        `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${accounts[1]!.email}`)}`,
      )
    ).json();
    const matching: string[] = [];
    for (const message of result.messages ?? []) {
      messages.push(message.ID);
      const detail = await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json();
      if (String(detail.Text).includes(target.id)) matching.push(detail.Text);
    }
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain('Open in FlowSync:');
    const emailJob = await worker!.queues.email.getJob(row.id);
    await emailJob!.retry('completed');
    await finished(emailJob!);
    expect(
      (await prisma.notificationDelivery.findUniqueOrThrow({ where: { notificationId: row.id } }))
        .attempts,
    ).toBe(1);
  });
  it('ignores stale deadlines, cancelled jobs and jobs from another environment', async () => {
    const target = await task();
    const reminder = await prisma.dueReminder.create({
      data: {
        taskId: target.id,
        dueDate: target.dueDate!,
        runAt: new Date(Date.now() - 1000),
        environment: 'production',
        version: 1,
      },
    });
    expect(await worker!.jobs.remind({ reminderId: reminder.id, version: 1 })).toEqual([]);
    await prisma.dueReminder.update({ where: { id: reminder.id }, data: { environment: 'test' } });
    expect(await worker!.jobs.remind({ reminderId: reminder.id, version: 0 })).toEqual([]);
    await prisma.task.update({
      where: { id: target.id },
      data: { dueDate: new Date(Date.now() + 72 * 3600000) },
    });
    expect(await worker!.jobs.remind({ reminderId: reminder.id, version: 1 })).toEqual([]);
    expect(
      (await prisma.dueReminder.findUniqueOrThrow({ where: { id: reminder.id } })).status,
    ).toBe('CANCELLED');
    expect(await prisma.notification.count({ where: { taskId: target.id } })).toBe(0);
  });
  it('filters revoked recipients and skips notifications already read before email delivery', async () => {
    const read = await notification();
    await prisma.notification.update({ where: { id: read.id }, data: { readAt: new Date() } });
    const revoked = await notification('TASK_ASSIGNED');
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: accounts[1]!.id } },
    });
    try {
      await worker!.pump();
      await until(
        async () =>
          (await prisma.notificationDelivery.count({
            where: {
              notificationId: { in: [read.id, revoked.id] },
              status: 'SKIPPED',
            },
          })) === 2,
      );
      const target = await task();
      const reminder = await prisma.dueReminder.create({
        data: {
          taskId: target.id,
          dueDate: target.dueDate!,
          runAt: new Date(Date.now() - 1000),
          environment: 'test',
        },
      });
      expect(await worker!.jobs.remind({ reminderId: reminder.id, version: 0 })).toEqual([]);
      expect(await prisma.notification.count({ where: { taskId: target.id } })).toBe(0);
    } finally {
      await prisma.projectMember.create({ data: { projectId, userId: accounts[1]!.id } });
    }
  });
  it('rejects poisoned job payloads without exposing confidential values in failed jobs', async () => {
    const job = await worker!.queues.email.add(
      'notification',
      { notificationId: 'bad', token: 'sensitive-marker' },
      { jobId: randomUUID() },
    );
    await finished(job, 'failed');
    const failed = await worker!.queues.email.getJob(job.id!);
    expect(failed!.failedReason).toBe('Invalid job payload');
    expect(failed!.stacktrace?.join('')).not.toContain('sensitive-marker');
    expect(failed!.attemptsMade).toBe(1);
    await failed!.remove();
  });
  it('retains failed SMTP jobs and supports a full manual retry after worker restart', async () => {
    await worker!.stop();
    worker = undefined;
    let row: Awaited<ReturnType<typeof notification>> | undefined;
    try {
      worker = await startBackgroundWorker({ ...env, SMTP_URL: 'smtp://127.0.0.1:1' });
      await worker.pump();
      await worker.queues.email.pause();
      row = await notification();
      const job = await worker.queues.email.add(
        'notification',
        { notificationId: row.id },
        { jobId: row.id, attempts: 2, backoff: { type: 'fixed', delay: 50 } },
      );
      await worker.queues.email.resume();
      await finished(job, 'failed');
      await until(
        async () =>
          (await prisma.notificationDelivery.findUnique({ where: { notificationId: row!.id } }))
            ?.status === 'FAILED',
      );
      const failed = await worker.queues.email.getJob(row.id);
      expect(failed!.attemptsMade).toBe(2);
      expect(failed!.failedReason).toBe('Background job unavailable');
      await worker.stop();
      worker = await startBackgroundWorker(env);
      await retryJob(prisma, env, 'email', worker.queues.email, row.id);
      await until(
        async () =>
          (await prisma.notificationDelivery.findUnique({ where: { notificationId: row!.id } }))
            ?.status === 'SENT',
      );
      const delivered = await prisma.notificationDelivery.findUniqueOrThrow({
        where: { notificationId: row.id },
      });
      expect(delivered.attempts).toBe(3);
      expect(delivered.lastError).toBeNull();
      await expect(retryJob(prisma, env, 'email', worker.queues.email, row.id)).rejects.toThrow();
      const mail = await (
        await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${accounts[1]!.email}`)}`,
        )
      ).json();
      messages.push(...mail.messages.map((message: { ID: string }) => message.ID));
    } finally {
      if (worker) {
        await worker.queues.email.resume();
        await worker.stop();
      }
      worker = await startBackgroundWorker(env);
    }
  });
  it('prunes completed bookkeeping only in the selected environment and retains failed work', async () => {
    const old = new Date(Date.now() - 8 * 86400000);
    const rows = await Promise.all([
      prisma.objectCleanup.create({
        data: { objectKey: `jobs/${suffix}/old-test`, environment: 'test', completedAt: old },
      }),
      prisma.objectCleanup.create({
        data: {
          objectKey: `jobs/${suffix}/old-other`,
          environment: 'production',
          completedAt: old,
        },
      }),
      prisma.objectCleanup.create({
        data: {
          objectKey: `jobs/${suffix}/pending`,
          environment: 'test',
          createdAt: old,
          nextAttemptAt: new Date(Date.now() + 3600000),
          lastError: 'StorageError',
        },
      }),
    ]);
    await pruneCompletedJobs(prisma, 'test');
    expect(await prisma.objectCleanup.findUnique({ where: { id: rows[0]!.id } })).toBeNull();
    expect(
      await prisma.objectCleanup.count({
        where: { id: { in: rows.slice(1).map((row) => row.id) } },
      }),
    ).toBe(2);
  });
  it('emits private workspace/project invitations and hides them after membership revocation', async () => {
    async function request(path: string, actor = 0, method = 'GET', body?: unknown) {
      return fetch(`${api.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accounts[actor]!.token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    expect(
      (await request(`/workspaces/${workspaceId}/members/${accounts[1]!.id}`, 0, 'DELETE')).status,
    ).toBe(200);
    const before = notificationsChanged;
    expect(
      (await request(`/workspaces/${workspaceId}/members`, 0, 'POST', { userId: accounts[1]!.id }))
        .status,
    ).toBe(201);
    expect(
      (await request(`/projects/${projectId}/members`, 0, 'POST', { userId: accounts[1]!.id }))
        .status,
    ).toBe(201);
    expect(
      (await request(`/projects/${projectId}/members`, 0, 'POST', { userId: accounts[1]!.id }))
        .status,
    ).toBe(409);
    await until(async () => notificationsChanged >= before + 2);
    const result = await (await request('/notifications?limit=100', 1)).json();
    const rows = result.data.map((row: unknown) => notificationSchema.parse(row));
    const project = rows.find((row: { type: string }) => row.type === 'PROJECT_INVITE')!;
    const workspace = rows.find((row: { type: string }) => row.type === 'WORKSPACE_INVITE')!;
    expect(project.href).toBe(`/projects?workspaceId=${workspaceId}&id=${projectId}`);
    expect(workspace.href).toBe(`/workspaces?organizationId=${organizationId}&id=${workspaceId}`);
    expect(project.boardId).toBeNull();
    expect(await prisma.notification.count({ where: { projectId, type: 'PROJECT_INVITE' } })).toBe(
      1,
    );
    expect(
      await prisma.notificationDelivery.count({
        where: { notificationId: { in: [project.id, workspace.id] }, environment: 'test' },
      }),
    ).toBe(2);
    expect(
      (await request(`/notifications/${project.id}/read`, 0, 'PATCH', { read: true })).status,
    ).toBe(404);
    expect(
      (await request(`/notifications/${workspace.id}/read`, 1, 'PATCH', { read: true })).status,
    ).toBe(200);
    await worker!.pump();
    await until(
      async () =>
        (await prisma.notificationDelivery.count({
          where: {
            notificationId: { in: [project.id, workspace.id] },
            status: { in: ['SENT', 'SKIPPED'] },
          },
        })) === 2,
    );
    expect(
      (await request(`/projects/${projectId}/members/${accounts[1]!.id}`, 0, 'DELETE')).status,
    ).toBe(200);
    expect(
      (await request(`/notifications/${project.id}/read`, 1, 'PATCH', { read: true })).status,
    ).toBe(404);
    expect(
      (await request(`/notifications/${workspace.id}/read`, 1, 'PATCH', { read: true })).status,
    ).toBe(200);
    expect(
      (await request(`/workspaces/${workspaceId}/members/${accounts[1]!.id}`, 0, 'DELETE')).status,
    ).toBe(200);
    expect(
      (await request(`/notifications/${workspace.id}/read`, 1, 'PATCH', { read: true })).status,
    ).toBe(404);
    expect((await (await request('/notifications', 1)).json()).meta.total).toBe(0);
    const mail = await (
      await fetch(
        `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${accounts[1]!.email}`)}`,
      )
    ).json();
    messages.push(...mail.messages.map((message: { ID: string }) => message.ID));
  });
  it('removes abandoned objects but preserves keys referenced by committed attachments', async () => {
    const target = await task();
    for (const retained of [false, true]) {
      const key = `jobs/${suffix}/${randomUUID()}`;
      keys.push(key);
      await storage.send(
        new PutObjectCommand({ Bucket: env.MINIO_BUCKET, Key: key, Body: Buffer.from('fixture') }),
      );
      if (retained)
        await prisma.attachment.create({
          data: {
            taskId: target.id,
            objectKey: key,
            filename: 'fixture.pdf',
            mimeType: 'application/pdf',
            size: 7,
          },
        });
      const row = await prisma.objectCleanup.create({
        data: { objectKey: key, environment: 'test' },
      });
      await worker!.pump();
      await until(
        async () =>
          !!(await prisma.objectCleanup.findUnique({ where: { id: row.id } }))?.completedAt,
      );
      const probe = storage.send(new HeadObjectCommand({ Bucket: env.MINIO_BUCKET, Key: key }));
      if (retained) expect((await probe).ContentLength).toBe(7);
      else await expect(probe).rejects.toMatchObject({ name: 'NotFound' });
    }
  });
});
