import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment, type Environment } from '../src/config/environment';
const requireCompiled = createRequire(`${process.cwd()}/test/ai-context.e2e.ts`);
const { PrismaService } = requireCompiled(
  '../dist/database/prisma.service.js',
) as typeof import('../src/database/prisma.service');
const { PermissionService } = requireCompiled(
  '../dist/modules/authorization/permission.service.js',
) as typeof import('../src/modules/authorization/permission.service');
const { AIContextService } = requireCompiled(
  '../dist/modules/ai/ai-context.service.js',
) as typeof import('../src/modules/ai/ai-context.service');
config({ path: '../../.env', quiet: true });
const env = validateEnvironment({ ...process.env, NODE_ENV: 'test' });
const db = new PrismaService(new ConfigService<Environment, true>(env));
const contexts = new AIContextService(db, new PermissionService(db));
const suffix = randomUUID();
const userIds: string[] = [];
const organizationIds: string[] = [];
let workspaceId: string;
let projectId: string;
let taskId: string;
beforeAll(async () => {
  await db.$connect();
  for (const name of ['Owner', 'Member', 'Outsider']) {
    const user = await db.user.create({
      data: {
        name,
        email: `ai-context-${name}-${suffix}@example.com`,
        passwordHash: 'private-password-marker',
      },
    });
    userIds.push(user.id);
  }
  for (const owner of [userIds[0]!, userIds[2]!]) {
    const org = await db.organization.create({
      data: {
        name: 'AI context',
        slug: `ai-context-${owner}-${suffix}`,
        ownerId: owner,
        members: { create: { userId: owner, role: 'OWNER' } },
      },
    });
    organizationIds.push(org.id);
    const workspace = await db.workspace.create({
      data: {
        organizationId: org.id,
        name: 'Workspace',
        slug: 'ai',
        members: { create: { userId: owner } },
      },
    });
    const project = await db.project.create({
      data: {
        workspaceId: workspace.id,
        ownerId: owner,
        name: 'Project',
        members: { create: { userId: owner } },
      },
    });
    const board = await db.board.create({
      data: {
        projectId: project.id,
        name: 'Board',
        columns: { create: { name: 'TODO', position: 0 } },
      },
      include: { columns: true },
    });
    const task = await db.task.create({
      data: {
        columnId: board.columns[0]!.id,
        title: owner === userIds[0] ? 'Accessible task' : 'foreign-task-marker',
        position: 1024,
        description: 'x'.repeat(10000),
        dueDate: new Date(Date.now() - 3600000),
      },
    });
    if (owner === userIds[0]) {
      workspaceId = workspace.id;
      projectId = project.id;
      taskId = task.id;
    }
  }
  await db.organizationMember.create({
    data: { organizationId: organizationIds[0]!, userId: userIds[1]! },
  });
  await db.workspaceMember.create({ data: { workspaceId, userId: userIds[1]! } });
  await db.projectMember.create({ data: { projectId, userId: userIds[1]! } });
  await db.activity.create({
    data: {
      organizationId: organizationIds[0]!,
      projectId,
      taskId,
      actorId: userIds[0]!,
      action: 'TASK_UPDATED',
      metadata: { title: 'Accessible task', token: 'private-token-marker' },
    },
  });
});
afterAll(async () => {
  const scope = { workspace: { organizationId: { in: organizationIds } } };
  await db.activity.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await db.task.deleteMany({ where: { column: { board: { project: scope } } } });
  await db.column.deleteMany({ where: { board: { project: scope } } });
  await db.board.deleteMany({ where: { project: scope } });
  await db.project.deleteMany({ where: scope });
  await db.workspace.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
describe.sequential('Tenant-scoped and bounded AI context', () => {
  it('contains current project activity/tasks without emails, credentials or another tenant', async () => {
    const context = await contexts.build(userIds[1]!, projectId);
    expect(context.tasks.map((row) => row.id)).toEqual([taskId]);
    expect(context.overdue).toHaveLength(1);
    expect(context.totals.TODO).toBe(1);
    expect(context.tasks[0]!.description).toHaveLength(500);
    const serialized = JSON.stringify(context);
    for (const marker of [
      'foreign-task-marker',
      'private-password-marker',
      'private-token-marker',
      '@example.com',
    ])
      expect(serialized).not.toContain(marker);
  });
  it('rechecks parent memberships and returns private 404s after revocation', async () => {
    await expect(contexts.build(userIds[2]!, projectId)).rejects.toMatchObject({ status: 404 });
    await db.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: userIds[1]! } },
    });
    await expect(contexts.build(userIds[1]!, projectId)).rejects.toMatchObject({ status: 404 });
    expect((await contexts.build(userIds[0]!, projectId)).project.id).toBe(projectId);
  });
  it('prioritizes open overdue work even when old completed tasks exceed the sampling limit', async () => {
    const initial = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { column: true },
    });
    const done = await db.column.create({
      data: { boardId: initial.column.boardId, name: 'Done', kind: 'DONE', position: 1 },
    });
    await db.task.createMany({
      data: Array.from({ length: 45 }, (_, index) => ({
        columnId: done.id,
        title: `Old completed work ${index}`,
        dueDate: new Date(Date.now() - 30 * 86400000),
        position: (index + 1) * 1024,
      })),
    });
    const urgent = await db.task.create({
      data: {
        columnId: initial.columnId,
        title: 'Urgent overdue work',
        priority: 'URGENT',
        dueDate: new Date(Date.now() - 10000),
        position: 2048,
      },
    });
    const context = await contexts.build(userIds[0]!, projectId, 'OVERDUE');
    expect(context.tasks.map((row) => row.id)).toEqual([urgent.id, taskId]);
    expect(context.overdue).toHaveLength(2);
    expect(context.totals.DONE).toBe(45);
    expect(context.tasks.some((row) => row.status === 'DONE')).toBe(false);
  });
});
