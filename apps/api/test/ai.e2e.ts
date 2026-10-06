import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/environment';
import { aiRunSchema, type AIOutput } from '@flowsync/contracts';
import { startTestApi } from './helpers/api-server';
import { AIProviderError } from '../src/modules/ai/ai-provider';
const compiled = createRequire(`${process.cwd()}/test/ai.e2e.ts`);
const { startBackgroundWorker } = compiled(
  '../dist/modules/queue/background-worker.js',
) as typeof import('../src/modules/queue/background-worker');
const { AIProviderError: CompiledProviderError } = compiled(
  '../dist/modules/ai/ai-provider.js',
) as typeof import('../src/modules/ai/ai-provider');
config({ path: '../../.env', quiet: true });
const env = validateEnvironment({
  ...process.env,
  NODE_ENV: 'test',
  AI_PROVIDER: 'openai',
  AI_MODEL: 'test-model',
  OPENAI_API_KEY: 'test-only-key',
  SMTP_URL: `smtp://127.0.0.1:${process.env.MAILPIT_SMTP_PORT ?? '1025'}`,
});
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const users: { id: string; token: string }[] = [];
const suffix = randomUUID();
let api: Awaited<ReturnType<typeof startTestApi>>;
let worker: Awaited<ReturnType<typeof startBackgroundWorker>> | undefined;
let organizationId: string;
let workspaceId: string;
let projectId: string;
let columnId: string;
let summaryId: string;
let notesId: string;
let generationCount = 0;
let failOnce = false;
async function request(path: string, actor = 0, method = 'GET', body?: unknown, target = api) {
  return fetch(`${target.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${users[actor]!.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create(kind = 'SUMMARY', prompt = 'Summarize project progress', actor = 0) {
  const response = await request(`/projects/${projectId}/ai/requests`, actor, 'POST', {
    kind,
    prompt,
  });
  expect(response.status).toBe(201);
  return aiRunSchema.parse((await response.json()).data);
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Assistant worker result missing');
}
beforeAll(async () => {
  api = await startTestApi({
    AI_PROVIDER: 'openai',
    AI_MODEL: 'test-model',
    OPENAI_API_KEY: 'test-only-key',
  });
  for (const name of ['Owner', 'Member', 'Outsider']) {
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `ai-${name}-${suffix}@example.com`,
        password: 'ai-integration-password',
      }),
    });
    expect(response.status).toBe(201);
    const { data } = await response.json();
    users.push({ id: data.user.id, token: data.accessToken });
  }
  const org = await db.organization.create({
    data: {
      name: 'AI team',
      slug: `ai-${suffix}`,
      ownerId: users[0]!.id,
      members: { create: [{ userId: users[0]!.id, role: 'OWNER' }, { userId: users[1]!.id }] },
    },
  });
  organizationId = org.id;
  const workspace = await db.workspace.create({
    data: {
      organizationId,
      name: 'AI',
      slug: 'ai',
      members: { create: users.slice(0, 2).map((user) => ({ userId: user.id })) },
    },
  });
  workspaceId = workspace.id;
  const project = await db.project.create({
    data: {
      workspaceId,
      name: 'AI project',
      ownerId: users[0]!.id,
      members: { create: users.slice(0, 2).map((user) => ({ userId: user.id })) },
    },
  });
  projectId = project.id;
  const board = await db.board.create({
    data: { projectId, name: 'AI board', columns: { create: { name: 'TODO', position: 0 } } },
    include: { columns: true },
  });
  columnId = board.columns[0]!.id;
  await db.task.create({
    data: {
      columnId,
      title: 'Existing task',
      position: 1024,
      dueDate: new Date(Date.now() - 86400000),
    },
  });
  worker = await startBackgroundWorker(env, {
    aiProvider: {
      async generate(input) {
        generationCount++;
        if (failOnce) {
          failOnce = false;
          throw new CompiledProviderError(true);
        }
        const context = JSON.parse(input.context);
        const output: AIOutput = {
          headline: 'Project progress',
          bullets: ['Existing task needs attention'],
          risks: [],
          references: [{ taskId: context.context.tasks[0].id, reason: 'Overdue task' }],
          suggestions: [],
        };
        if (context.kind === 'MEETING_NOTES')
          output.suggestions = [
            {
              title: 'Follow up on notes',
              description: 'Review together',
              priority: 'HIGH',
              dueDate: null,
              assigneeIds: [context.prompt.includes('invalid') ? users[2]!.id : users[1]!.id],
            },
          ];
        return output;
      },
    },
  });
});
afterAll(async () => {
  if (worker) {
    await worker.queues.ai.resume();
    await worker.stop();
  }
  api?.stop();
  const scope = { workspaceId };
  if (projectId) {
    await db.aIConversation.deleteMany({ where: { projectId } });
    await db.activity.deleteMany({ where: { organizationId } });
    await db.task.deleteMany({ where: { columnId } });
    await db.column.deleteMany({ where: { id: columnId } });
    await db.board.deleteMany({ where: { projectId } });
    await db.project.deleteMany({ where: scope });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
  }
  await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await db.$disconnect();
});
describe.sequential('Private queued project assistant', () => {
  it('reports disabled configuration without writing a request or calling a provider', async () => {
    const disabled = await startTestApi({ AI_PROVIDER: 'disabled' });
    try {
      expect(
        (
          await (
            await request(`/projects/${projectId}/ai/availability`, 0, 'GET', undefined, disabled)
          ).json()
        ).data.enabled,
      ).toBe(false);
      expect(
        (
          await request(
            `/projects/${projectId}/ai/requests`,
            0,
            'POST',
            { kind: 'SUMMARY', prompt: 'Summarize' },
            disabled,
          )
        ).status,
      ).toBe(503);
      expect(await db.aIRun.count({ where: { conversation: { projectId } } })).toBe(0);
    } finally {
      disabled.stop();
    }
  });
  it('queues a private summary, stores validated output and skips duplicate execution', async () => {
    const run = await create();
    summaryId = run.id;
    await worker!.pump();
    await until(
      async () => (await db.aIRun.findUnique({ where: { id: run.id } }))?.status === 'COMPLETED',
    );
    const result = aiRunSchema.parse(
      (await (await request(`/projects/${projectId}/ai/requests/${run.id}`)).json()).data,
    );
    expect(result.output!.headline).toBe('Project progress');
    expect(result.output!.suggestions).toEqual([]);
    const count = generationCount;
    await worker!.ai.run({ runId: run.id });
    expect(generationCount).toBe(count);
    expect(
      await db.aIMessage.count({
        where: { conversation: { run: { id: run.id } }, role: 'ASSISTANT' },
      }),
    ).toBe(1);
    expect((await request(`/projects/${projectId}/ai/requests/${run.id}`, 1)).status).toBe(404);
    expect((await request(`/projects/${projectId}/ai/requests/${run.id}`, 2)).status).toBe(404);
  });
  it('returns meeting-note suggestions without creating tasks automatically', async () => {
    const before = await db.task.count({ where: { columnId } });
    const run = await create('MEETING_NOTES', 'Member should review the notes');
    notesId = run.id;
    await worker!.pump();
    await until(
      async () => (await db.aIRun.findUnique({ where: { id: run.id } }))?.status === 'COMPLETED',
    );
    const result = aiRunSchema.parse(
      (await (await request(`/projects/${projectId}/ai/requests/${run.id}`)).json()).data,
    );
    expect(result.output!.suggestions).toHaveLength(1);
    expect(await db.task.count({ where: { columnId } })).toBe(before);
  });
  it('rejects hallucinated assignment IDs without persisting executable suggestions', async () => {
    const run = await create('MEETING_NOTES', 'invalid foreign assignment');
    await worker!.pump();
    await until(
      async () => (await db.aIRun.findUnique({ where: { id: run.id } }))?.status === 'FAILED',
    );
    const result = aiRunSchema.parse(
      (await (await request(`/projects/${projectId}/ai/requests/${run.id}`)).json()).data,
    );
    expect(result.output).toBeNull();
    expect(result.error).not.toContain(users[2]!.id);
  });
  it('cancels a queued request when parent membership is revoked', async () => {
    await worker!.queues.ai.pause();
    const run = await create('SUMMARY', 'Summarize after revocation', 1);
    await db.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: users[1]!.id } },
    });
    try {
      await worker!.ai.run({ runId: run.id });
      expect((await db.aIRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
        'CANCELLED',
      );
      expect((await request(`/projects/${projectId}/ai/requests/${run.id}`, 1)).status).toBe(404);
    } finally {
      await db.workspaceMember.create({ data: { workspaceId, userId: users[1]!.id } });
      await worker!.queues.ai.resume();
    }
  });
  it('resets a transient provider failure to pending and completes on retry', async () => {
    await worker!.queues.ai.pause();
    const run = await create('OVERDUE', 'Which important tasks are overdue?');
    failOnce = true;
    try {
      await expect(worker!.ai.run({ runId: run.id })).rejects.toThrow('AI provider unavailable');
      expect((await db.aIRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('PENDING');
      await worker!.ai.run({ runId: run.id });
      expect((await db.aIRun.findUniqueOrThrow({ where: { id: run.id } })).attempts).toBe(2);
    } finally {
      await worker!.queues.ai.resume();
    }
    expect(
      (await (await request(`/projects/${projectId}/ai/requests?limit=1`)).json()).meta.total,
    ).toBe(4);
    expect(summaryId).toBeTruthy();
    expect(notesId).toBeTruthy();
    // Both adapters use the same error contract; no external requests are made in this suite.
    expect(new AIProviderError(false).message).toBe('AI provider unavailable');
  });
});
