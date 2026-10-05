import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { boardSnapshotSchema } from '@flowsync/contracts';
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
