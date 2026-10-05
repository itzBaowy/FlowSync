import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { boardSnapshotSchema, taskDetailSchema, taskSchema } from '@flowsync/contracts';
import { startTestApi } from './helpers/api-server';
config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const suffix = randomUUID();
const users: { id: string; token: string }[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let organizationId: string;
let workspaceId: string;
let projectId: string;
let boardId: string;
let columns: { id: string; kind: string }[];
async function request(path: string, actor = 0, method = 'GET', body?: unknown) {
  return fetch(`${api.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${users[actor]!.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  api = await startTestApi();
  for (const name of ['Owner', 'Member', 'Colleague', 'Outsider']) {
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `kanban-${name}-${suffix}@example.com`,
        password: 'kanban-integration-password',
      }),
    });
    if (!response.ok) throw new Error('Could not register fixture');
    const { data } = await response.json();
    users.push({ id: data.user.id, token: data.accessToken });
  }
  const { data: org } = await (
    await request('/organizations', 0, 'POST', {
      name: 'Kanban fixtures',
      slug: `kanban-${suffix}`,
    })
  ).json();
  organizationId = org.id;
  const { data: workspace } = await (
    await request('/workspaces', 0, 'POST', { organizationId, name: 'Product', slug: 'product' })
  ).json();
  workspaceId = workspace.id;
  const { data: project } = await (
    await request('/projects', 0, 'POST', { workspaceId, name: 'Release' })
  ).json();
  projectId = project.id;
  for (const actor of [1, 2]) {
    await prisma.organizationMember.create({ data: { organizationId, userId: users[actor]!.id } });
    await request(`/workspaces/${workspaceId}/members`, 0, 'POST', { userId: users[actor]!.id });
    await request(`/projects/${projectId}/members`, 0, 'POST', { userId: users[actor]!.id });
  }
});
afterAll(async () => {
  api?.stop();
  if (organizationId) {
    const projects = { workspace: { organizationId } };
    await prisma.task.deleteMany({ where: { column: { board: { project: projects } } } });
    await prisma.column.deleteMany({ where: { board: { project: projects } } });
    await prisma.board.deleteMany({ where: { project: projects } });
    await prisma.project.deleteMany({ where: projects });
    await prisma.workspace.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
});
describe.sequential('Kanban board boundaries and atomic ordering', () => {
  it('creates four default columns and protects management and private scope', async () => {
    const body = { projectId, name: 'Delivery' };
    expect((await request('/boards', 1, 'POST', body)).status).toBe(403);
    expect((await request('/boards', 3, 'POST', body)).status).toBe(404);
    const response = await request('/boards', 0, 'POST', body);
    expect(response.status).toBe(201);
    boardId = (await response.json()).data.id;
    const snapshot = boardSnapshotSchema.parse(
      (await (await request(`/boards/${boardId}`, 1)).json()).data,
    );
    columns = snapshot.columns;
    expect(columns.map((column) => column.kind)).toEqual(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
    expect(snapshot.canManage).toBe(false);
    expect((await request(`/boards/${boardId}`, 3)).status).toBe(404);
    expect((await request(`/boards/${boardId}`, 1, 'PATCH', { name: 'No' })).status).toBe(403);
    const list = await (
      await request(`/boards?projectId=${projectId}&search=Delivery&limit=1`)
    ).json();
    expect(list.meta.total).toBe(1);
    expect((await request('/boards?projectId=invalid')).status).toBe(400);
  });
  it('adds, edits and removes scoped columns without resetting their kind', async () => {
    expect(
      (await request(`/boards/${boardId}/columns`, 1, 'POST', { name: 'Blocked' })).status,
    ).toBe(403);
    const response = await request(`/boards/${boardId}/columns`, 0, 'POST', {
      name: 'Blocked',
      kind: 'REVIEW',
    });
    expect(response.status).toBe(201);
    const { data: column } = await response.json();
    const edited = await (
      await request(`/boards/${boardId}/columns/${column.id}`, 0, 'PATCH', { name: 'Waiting' })
    ).json();
    expect(edited.data.kind).toBe('REVIEW');
    expect(
      (await request(`/boards/${boardId}/columns/${randomUUID()}`, 0, 'PATCH', { name: 'No' }))
        .status,
    ).toBe(404);
    expect((await request(`/boards/${boardId}/columns/${column.id}`, 0, 'DELETE')).status).toBe(
      200,
    );
  });
  it('swaps positions atomically and rejects concurrent or malformed reorders', async () => {
    const snapshot = (await (await request(`/boards/${boardId}`)).json()).data;
    const ids = columns.map((column) => column.id).reverse();
    const body = { columnIds: ids, expectedRevision: snapshot.revision };
    const responses = await Promise.all([
      request(`/boards/${boardId}/columns/order`, 0, 'PATCH', body),
      request(`/boards/${boardId}/columns/order`, 0, 'PATCH', body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = boardSnapshotSchema.parse(
      (await (await request(`/boards/${boardId}`)).json()).data,
    );
    expect(saved.columns.map((column) => column.id)).toEqual(ids);
    expect(saved.columns.map((column) => column.position)).toEqual([0, 1, 2, 3]);
    expect(
      (
        await request(`/boards/${boardId}/columns/order`, 0, 'PATCH', {
          columnIds: ids.slice(1),
          expectedRevision: saved.revision,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/boards/${boardId}/columns/order`, 0, 'PATCH', {
          columnIds: [randomUUID(), ...ids.slice(1)],
          expectedRevision: saved.revision,
        })
      ).status,
    ).toBe(400);
    expect((await (await request(`/boards/${boardId}`)).json()).data.revision).toBe(saved.revision);
  });
  it('prevents deleting retained tasks, including archived tasks', async () => {
    const task = await prisma.task.create({
      data: { columnId: columns[0]!.id, title: 'Retained', position: 1024, archivedAt: new Date() },
    });
    expect(
      (await request(`/boards/${boardId}/columns/${columns[0]!.id}`, 0, 'DELETE')).status,
    ).toBe(409);
    expect((await request(`/boards/${boardId}`, 0, 'DELETE')).status).toBe(409);
    await prisma.task.delete({ where: { id: task.id } });
    const extra = await (
      await request('/boards', 0, 'POST', { projectId, name: 'Temporary' })
    ).json();
    expect((await request(`/boards/${extra.data.id}`, 0, 'DELETE')).status).toBe(200);
    expect((await request(`/boards/${extra.data.id}`)).status).toBe(404);
  });
});
let taskId: string;
async function currentTask() {
  return taskDetailSchema.parse((await (await request(`/tasks/${taskId}`, 1)).json()).data);
}
async function revision() {
  return (await (await request(`/boards/${boardId}`)).json()).data.revision as number;
}
describe.sequential('Task permissions, optimistic concurrency and ranking', () => {
  it('allows project members to create tasks and validates all referenced scopes', async () => {
    const input = {
      columnId: columns[0]!.id,
      title: 'Ship release',
      priority: 'HIGH',
      description: 'Careful rollout',
      dueDate: '2026-10-10T00:00:00.000Z',
      assigneeIds: [users[1]!.id],
    };
    expect((await request('/tasks', 3, 'POST', input)).status).toBe(404);
    expect((await request('/tasks', 1, 'POST', { ...input, position: 1 })).status).toBe(400);
    expect(
      (await request('/tasks', 1, 'POST', { ...input, assigneeIds: [users[3]!.id] })).status,
    ).toBe(400);
    const other = await prisma.project.create({
      data: { workspaceId, ownerId: users[0]!.id, name: 'Other private project' },
    });
    const foreignLabel = await prisma.label.create({
      data: { projectId: other.id, name: 'Foreign', color: '#123456' },
    });
    expect(
      (await request('/tasks', 1, 'POST', { ...input, labelIds: [foreignLabel.id] })).status,
    ).toBe(400);
    const response = await request('/tasks', 1, 'POST', input);
    expect(response.status).toBe(201);
    const task = taskSchema.parse((await response.json()).data);
    taskId = task.id;
    expect(task.canEdit).toBe(true);
    expect(task.version).toBe(0);
    expect(task.assignees.map((user) => user.id)).toEqual([users[1]!.id]);
    expect(JSON.stringify(task)).not.toContain('passwordHash');
    expect((await request(`/tasks/${taskId}`, 3)).status).toBe(404);
    const list = await (
      await request(
        `/tasks?boardId=${boardId}&priority=HIGH&assigneeId=${users[1]!.id}&search=rollout&limit=1`,
        2,
      )
    ).json();
    expect(list.meta.total).toBe(1);
    expect(list.data[0].canEdit).toBe(false);
  });
  it('protects edits and detects simultaneous writes without resetting unspecified fields', async () => {
    expect(
      (await request(`/tasks/${taskId}`, 2, 'PATCH', { title: 'No', expectedVersion: 0 })).status,
    ).toBe(403);
    const responses = await Promise.all([
      request(`/tasks/${taskId}`, 1, 'PATCH', { title: 'Release v2', expectedVersion: 0 }),
      request(`/tasks/${taskId}`, 1, 'PATCH', { title: 'Release v3', expectedVersion: 0 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const task = await currentTask();
    expect(task.version).toBe(1);
    expect(task.priority).toBe('HIGH');
    expect(task.dueDate).toBe('2026-10-10T00:00:00.000Z');
    expect(task.description).toBe('Careful rollout');
    expect(
      (
        await request(`/tasks/${taskId}`, 1, 'PATCH', {
          assigneeIds: [users[1]!.id, users[2]!.id],
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/tasks/${taskId}`, 2, 'PATCH', { priority: 'URGENT', expectedVersion: 2 }))
        .status,
    ).toBe(200);
    expect(
      (
        await request(`/tasks/${taskId}/archive`, 2, 'PATCH', {
          archived: true,
          expectedVersion: 3,
        })
      ).status,
    ).toBe(403);
  });
  it('moves across columns once for simultaneous clients and maintains relative order', async () => {
    const task = await currentTask();
    const destination = await prisma.task.create({
      data: { columnId: columns[1]!.id, title: 'Destination', position: 1024 },
    });
    const body = {
      columnId: columns[1]!.id,
      beforeTaskId: destination.id,
      expectedVersion: task.version,
      expectedRevision: await revision(),
    };
    const responses = await Promise.all([
      request(`/tasks/${taskId}/move`, 1, 'PATCH', body),
      request(`/tasks/${taskId}/move`, 2, 'PATCH', body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await currentTask();
    expect(saved.columnId).toBe(columns[1]!.id);
    expect(saved.status).toBe('IN_PROGRESS');
    const list = await (
      await request(`/tasks?boardId=${boardId}&columnId=${columns[1]!.id}`)
    ).json();
    expect(list.data.map((row: { id: string }) => row.id)).toEqual([taskId, destination.id]);
    const foreignBoard = await prisma.board.create({
      data: {
        projectId,
        name: 'Another board',
        columns: { create: { name: 'Other', position: 0 } },
      },
      include: { columns: true },
    });
    expect(
      (
        await request(`/tasks/${taskId}/move`, 1, 'PATCH', {
          ...body,
          expectedVersion: saved.version,
          expectedRevision: await revision(),
          columnId: foreignBoard.columns[0]!.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/tasks/${taskId}/move`, 1, 'PATCH', {
          ...body,
          expectedVersion: saved.version,
          expectedRevision: await revision(),
          beforeTaskId: taskId,
        })
      ).status,
    ).toBe(400);
    await prisma.task.delete({ where: { id: destination.id } });
  });
  it('rebalances exhausted fractional gaps while retaining archived task positions', async () => {
    const first = await prisma.task.create({
      data: {
        columnId: columns[2]!.id,
        title: 'Archived rank',
        position: '0.0000000001',
        archivedAt: new Date(),
      },
    });
    const next = await prisma.task.create({
      data: { columnId: columns[2]!.id, title: 'Tiny gap', position: '0.0000000002' },
    });
    const task = await currentTask();
    const response = await request(`/tasks/${taskId}/move`, 1, 'PATCH', {
      columnId: columns[2]!.id,
      beforeTaskId: next.id,
      expectedVersion: task.version,
      expectedRevision: await revision(),
    });
    expect(response.status).toBe(200);
    const rows = await prisma.task.findMany({
      where: { columnId: columns[2]!.id },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((row) => row.id)).toEqual([first.id, taskId, next.id]);
    expect(new Set(rows.map((row) => row.position.toString())).size).toBe(3);
    const snapshot = boardSnapshotSchema.parse(
      (await (await request(`/boards/${boardId}`)).json()).data,
    );
    expect(snapshot.columns.find((column) => column.id === columns[2]!.id)!.totalTasks).toBe(2);
    await prisma.task.deleteMany({ where: { id: { in: [first.id, next.id] } } });
  });
  it('archives, restores and deletes with version checks and scope permissions', async () => {
    let task = await currentTask();
    expect(
      (
        await request(`/tasks/${taskId}/archive`, 1, 'PATCH', {
          archived: true,
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(200);
    task = await currentTask();
    expect(task.archivedAt).not.toBeNull();
    expect(
      (
        await request(`/tasks/${taskId}`, 1, 'PATCH', {
          title: 'No',
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(409);
    const list = await (await request(`/tasks?boardId=${boardId}&archived=true`)).json();
    expect(list.meta.total).toBe(1);
    expect(
      (
        await request(`/tasks/${taskId}/archive`, 0, 'PATCH', {
          archived: false,
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(200);
    task = await currentTask();
    expect(
      (await request(`/tasks/${taskId}`, 2, 'DELETE', { expectedVersion: task.version })).status,
    ).toBe(403);
    expect(
      (await request(`/tasks/${taskId}`, 1, 'DELETE', { expectedVersion: task.version - 1 }))
        .status,
    ).toBe(409);
    expect(
      (await request(`/tasks/${taskId}`, 1, 'DELETE', { expectedVersion: task.version })).status,
    ).toBe(200);
    expect((await request(`/tasks/${taskId}`, 1)).status).toBe(404);
  });
});
describe.sequential('Project labels and versioned task checklists', () => {
  it('scopes label management and assigns multiple labels atomically', async () => {
    const path = `/projects/${projectId}/labels`;
    expect((await request(path, 1, 'POST', { name: 'Bug', color: '#AABBCC' })).status).toBe(403);
    expect((await request(path, 3)).status).toBe(404);
    expect((await request(path, 0, 'POST', { name: 'Bad', color: 'red' })).status).toBe(400);
    const label = (await (await request(path, 0, 'POST', { name: 'Bug', color: '#AABBCC' })).json())
      .data;
    expect(label.color).toBe('#aabbcc');
    expect((await request(path, 0, 'POST', { name: 'Bug', color: '#112233' })).status).toBe(409);
    const task = (
      await (
        await request('/tasks', 1, 'POST', {
          columnId: columns[0]!.id,
          title: 'Checklist task',
          assigneeIds: [users[1]!.id, users[2]!.id],
          labelIds: [label.id],
        })
      ).json()
    ).data;
    taskId = task.id;
    expect(task.labels[0].name).toBe('Bug');
    expect(
      (await request(`${path}/${label.id}`, 0, 'PATCH', { name: 'Issue', color: '#123456' }))
        .status,
    ).toBe(200);
    expect((await currentTask()).labels[0]!.name).toBe('Issue');
    expect((await request(`${path}/${label.id}`, 0, 'DELETE')).status).toBe(200);
    expect((await currentTask()).labels).toHaveLength(0);
    expect((await request(`${path}/${label.id}`, 0, 'DELETE')).status).toBe(404);
  });
  it('increments task versions for checklist changes and rejects foreign child IDs', async () => {
    const path = `/tasks/${taskId}/checklists`;
    expect((await request(path, 3, 'POST', { title: 'Ship', expectedVersion: 0 })).status).toBe(
      404,
    );
    const added = await request(path, 1, 'POST', { title: 'Ship', expectedVersion: 0 });
    expect(added.status).toBe(201);
    const task = taskDetailSchema.parse((await added.json()).data);
    const checklist = task.checklists[0]!;
    expect(task.version).toBe(1);
    expect(
      (
        await request(`${path}/${checklist.id}/items`, 2, 'POST', {
          text: 'Review',
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
    const itemResponse = await request(`${path}/${checklist.id}/items`, 2, 'POST', {
      text: 'Review',
      expectedVersion: 1,
    });
    expect(itemResponse.status).toBe(201);
    const saved = taskDetailSchema.parse((await itemResponse.json()).data);
    const item = saved.checklists[0]!.items[0]!;
    const foreign = await prisma.task.create({
      data: {
        columnId: columns[0]!.id,
        title: 'Foreign child',
        position: 2048,
        checklists: {
          create: {
            title: 'Other',
            position: 0,
            items: { create: { text: 'Other', position: 0 } },
          },
        },
      },
      include: { checklists: { include: { items: true } } },
    });
    expect(
      (
        await request(
          `/tasks/${taskId}/checklist-items/${foreign.checklists[0]!.items[0]!.id}`,
          1,
          'PATCH',
          { completed: true, expectedVersion: 2 },
        )
      ).status,
    ).toBe(404);
    expect((await currentTask()).version).toBe(2);
    expect(
      (
        await request(`/tasks/${taskId}/checklist-items/${item.id}`, 2, 'PATCH', {
          completed: true,
          expectedVersion: 2,
        })
      ).status,
    ).toBe(200);
    expect((await currentTask()).checklists[0]!.items[0]!.completed).toBe(true);
    expect(
      (
        await request(`/tasks/${taskId}/checklist-items/${item.id}`, 1, 'DELETE', {
          expectedVersion: 3,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`${path}/${checklist.id}`, 1, 'DELETE', { expectedVersion: 4 })).status,
    ).toBe(200);
    expect((await currentTask()).checklists).toHaveLength(0);
    await prisma.task.delete({ where: { id: foreign.id } });
  });
});
