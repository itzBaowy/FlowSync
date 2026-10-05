import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { projectSchema, projectOverviewSchema } from '@flowsync/contracts';
import { startTestApi } from './helpers/api-server';
config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const suffix = randomUUID();
const users: { id: string; token: string }[] = [];
const orgs: string[] = [];
const workspaces: string[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let projectId: string;
async function request(path: string, actor = 0, method = 'GET', body?: unknown) {
  return fetch(`${api.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${users[actor]!.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  api = await startTestApi();
  for (const name of ['Owner', 'Admin', 'Member', 'Outsider']) {
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `project-${name.toLowerCase()}-${suffix}@example.com`,
        password: 'project-integration-password',
      }),
    });
    if (!response.ok) throw new Error('Could not register fixture');
    const { data } = await response.json();
    users.push({ id: data.user.id, token: data.accessToken });
  }
  for (const actor of [0, 3]) {
    const { data } = await (
      await request('/organizations', actor, 'POST', {
        name: `Projects ${actor}`,
        slug: `project-${suffix}-${actor}`,
      })
    ).json();
    orgs.push(data.id);
    const ws = await (
      await request('/workspaces', actor, 'POST', {
        name: 'Product',
        slug: 'product',
        organizationId: data.id,
      })
    ).json();
    workspaces.push(ws.data.id);
  }
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: orgs[0]!, userId: users[1]!.id, role: 'ADMIN' },
      { organizationId: orgs[0]!, userId: users[2]!.id, role: 'MEMBER' },
    ],
  });
  await request(`/workspaces/${workspaces[0]}/members`, 0, 'POST', { userId: users[2]!.id });
});
afterAll(async () => {
  api?.stop();
  const projects = { workspace: { organizationId: { in: orgs } } };
  await prisma.activity.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.task.deleteMany({ where: { column: { board: { project: projects } } } });
  await prisma.column.deleteMany({ where: { board: { project: projects } } });
  await prisma.board.deleteMany({ where: { project: projects } });
  await prisma.project.deleteMany({ where: projects });
  await prisma.workspace.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
});
describe.sequential('Project CRUD, membership and overview', () => {
  it('creates with explicit parent scope and protects ordinary/foreign members', async () => {
    const body = {
      workspaceId: workspaces[0],
      name: 'Release plan',
      status: 'ACTIVE',
      description: 'Ship carefully',
      startDate: '2026-10-06T00:00:00.000Z',
      dueDate: '2026-10-10T00:00:00.000Z',
    };
    expect((await request('/projects', 2, 'POST', body)).status).toBe(403);
    expect((await request('/projects', 3, 'POST', body)).status).toBe(404);
    expect(
      (await request('/projects', 0, 'POST', { ...body, dueDate: '2026-10-05T00:00:00.000Z' }))
        .status,
    ).toBe(400);
    const response = await request('/projects', 0, 'POST', body);
    expect(response.status).toBe(201);
    projectId = projectSchema.parse((await response.json()).data).id;
    expect((await request(`/projects/${projectId}`, 2)).status).toBe(404);
    const foreign = await request(`/projects/${projectId}`, 3);
    const missing = await request(`/projects/${randomUUID()}`, 3);
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).message).toBe((await missing.json()).message);
    expect((await request('/projects/not-a-uuid')).status).toBe(400);
    expect(
      (
        await (
          await request(
            `/projects?workspaceId=${workspaces[0]}&status=ACTIVE&search=release&limit=1`,
          )
        ).json()
      ).meta.total,
    ).toBe(1);
    expect(
      (await (await request(`/projects?workspaceId=${workspaces[0]}`, 2)).json()).meta.total,
    ).toBe(0);
  });
  it('preserves omitted fields and validates patched dates against existing dates', async () => {
    expect(
      (await request(`/projects/${projectId}`, 1, 'PATCH', { name: 'Release v2' })).status,
    ).toBe(200);
    const updated = projectSchema.parse(
      (await (await request(`/projects/${projectId}`)).json()).data,
    );
    expect(updated.status).toBe('ACTIVE');
    expect(updated.description).toBe('Ship carefully');
    expect(updated.startDate).toBe('2026-10-06T00:00:00.000Z');
    expect(
      (await request(`/projects/${projectId}`, 0, 'PATCH', { dueDate: '2026-10-05T00:00:00.000Z' }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(`/projects/${projectId}`, 0, 'PATCH', {
          startDate: '2026-10-11T00:00:00.000Z',
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(`/projects/${projectId}`, 0, 'PATCH', { workspaceId: workspaces[1] })).status,
    ).toBe(400);
    expect((await request(`/projects/${projectId}`, 0, 'PATCH', { dueDate: null })).status).toBe(
      200,
    );
  });
  it('requires parent membership, returns only public profiles and protects the current owner', async () => {
    expect(
      (await request(`/projects/${projectId}/members`, 0, 'POST', { userId: users[3]!.id })).status,
    ).toBe(404);
    expect(
      (await request(`/projects/${projectId}/members`, 0, 'POST', { userId: users[1]!.id })).status,
    ).toBe(404);
    await request(`/workspaces/${workspaces[0]}/members`, 0, 'POST', { userId: users[1]!.id });
    expect(
      (await request(`/projects/${projectId}/members`, 1, 'POST', { userId: users[2]!.id })).status,
    ).toBe(201);
    expect((await request(`/projects/${projectId}`, 2)).status).toBe(200);
    expect(
      (await request(`/projects/${projectId}`, 2, 'PATCH', { status: 'ARCHIVED' })).status,
    ).toBe(403);
    expect(
      (await request(`/projects/${projectId}/members`, 0, 'POST', { userId: users[2]!.id })).status,
    ).toBe(409);
    const result = await (
      await request(`/projects/${projectId}/members?limit=1&sort=name`, 2)
    ).json();
    expect(result.meta.total).toBe(2);
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(
      (await request(`/projects/${projectId}/members/${users[0]!.id}`, 1, 'DELETE')).status,
    ).toBe(409);
    expect(
      (
        await request(`/projects/${projectId}/transfer-ownership`, 0, 'POST', {
          userId: users[2]!.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (await request(`/projects/${projectId}`, 2, 'PATCH', { status: 'COMPLETED' })).status,
    ).toBe(200);
    expect(
      (await request(`/workspaces/${workspaces[0]}/members/${users[2]!.id}`, 0, 'DELETE')).status,
    ).toBe(409);
    await request(`/projects/${projectId}/members`, 0, 'POST', { userId: users[1]!.id });
    const transfers = await Promise.all([
      request(`/projects/${projectId}/transfer-ownership`, 2, 'POST', { userId: users[0]!.id }),
      request(`/projects/${projectId}/transfer-ownership`, 2, 'POST', { userId: users[1]!.id }),
    ]);
    expect(transfers.map((response) => response.status).sort()).toEqual([201, 403]);
    expect(
      (await request(`/projects/${projectId}`, 2, 'PATCH', { name: 'No longer owner' })).status,
    ).toBe(403);
  });
  it('computes overview from actual non-archived tasks and protects structural/history deletes', async () => {
    const board = await prisma.board.create({
      data: {
        projectId,
        name: 'Delivery',
        columns: {
          create: [
            {
              name: 'TODO',
              kind: 'TODO',
              position: 0,
              tasks: {
                create: [
                  { title: 'Overdue', position: 1, dueDate: new Date('2020-01-01') },
                  { title: 'Archived', position: 2, archivedAt: new Date() },
                ],
              },
            },
            {
              name: 'Done',
              kind: 'DONE',
              position: 1,
              tasks: { create: { title: 'Done', position: 1, dueDate: new Date('2020-01-01') } },
            },
          ],
        },
      },
    });
    await prisma.activity.create({
      data: {
        organizationId: orgs[0]!,
        projectId,
        actorId: users[0]!.id,
        action: 'project.created',
      },
    });
    const overview = projectOverviewSchema.parse(
      (await (await request(`/projects/${projectId}/overview`, 2)).json()).data,
    );
    expect(overview).toMatchObject({ tasks: 2, completed: 1, overdue: 1, members: 3 });
    expect(overview.recentActivities).toHaveLength(1);
    expect((await request(`/projects/${projectId}/overview`, 3)).status).toBe(404);
    expect((await request(`/projects/${projectId}`, 1, 'DELETE')).status).toBe(409);
    await prisma.task.deleteMany({ where: { column: { boardId: board.id } } });
    await prisma.column.deleteMany({ where: { boardId: board.id } });
    await prisma.board.delete({ where: { id: board.id } });
    expect((await request(`/projects/${projectId}`, 1, 'DELETE')).status).toBe(409);
    await prisma.activity.deleteMany({ where: { projectId } });
  });
  it('revokes membership access and safely deletes an empty project', async () => {
    expect(
      (await request(`/projects/${projectId}/members/${users[2]!.id}`, 0, 'DELETE')).status,
    ).toBe(200);
    expect((await request(`/projects/${projectId}`, 2)).status).toBe(404);
    expect((await request(`/projects/${projectId}`, 1, 'DELETE')).status).toBe(200);
  });
});
