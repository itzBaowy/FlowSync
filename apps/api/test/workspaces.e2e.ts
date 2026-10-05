import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { workspaceSchema } from '@flowsync/contracts';
import { startTestApi } from './helpers/api-server';
config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const suffix = randomUUID();
const users: { id: string; token: string }[] = [];
const orgs: string[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let workspaceId: string;
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
        email: `workspace-${name.toLowerCase()}-${suffix}@example.com`,
        password: 'workspace-integration-password',
      }),
    });
    if (!response.ok) throw new Error('Could not register fixture');
    const { data } = await response.json();
    users.push({ id: data.user.id, token: data.accessToken });
  }
  for (const actor of [0, 3]) {
    const { data } = await (
      await request('/organizations', actor, 'POST', {
        name: `Workspace org ${actor}`,
        slug: `workspace-${suffix}-${actor}`,
      })
    ).json();
    orgs.push(data.id);
  }
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: orgs[0]!, userId: users[1]!.id, role: 'ADMIN' },
      { organizationId: orgs[0]!, userId: users[2]!.id, role: 'MEMBER' },
    ],
  });
});
afterAll(async () => {
  api?.stop();
  await prisma.project.deleteMany({ where: { workspace: { organizationId: { in: orgs } } } });
  await prisma.workspace.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
});
describe.sequential('Workspace CRUD and private membership', () => {
  it('allows admins to create, blocks members/foreign tenants and validates parent IDs', async () => {
    const body = {
      organizationId: orgs[0],
      name: 'Private Product',
      slug: 'product',
      description: 'Focused work',
      icon: 'P',
    };
    expect((await request('/workspaces', 2, 'POST', body)).status).toBe(403);
    expect((await request('/workspaces', 3, 'POST', body)).status).toBe(404);
    expect(
      (await request('/workspaces', 0, 'POST', { ...body, organizationId: 'invalid' })).status,
    ).toBe(400);
    const created = await request('/workspaces', 1, 'POST', body);
    expect(created.status).toBe(201);
    const workspace = workspaceSchema.parse((await created.json()).data);
    workspaceId = workspace.id;
    expect(workspace.canManage).toBe(true);
    expect((await request('/workspaces', 0, 'POST', body)).status).toBe(409);
    expect(
      (await request('/workspaces', 3, 'POST', { ...body, organizationId: orgs[1] })).status,
    ).toBe(201);
  });
  it('scopes list/detail, supports pagination/search and rejects slug collisions or parent reassignment', async () => {
    expect((await request(`/workspaces/${workspaceId}`, 2)).status).toBe(404);
    expect((await request(`/workspaces/${workspaceId}`, 3)).status).toBe(404);
    expect((await request('/workspaces/not-a-uuid')).status).toBe(400);
    const { data, meta } = await (
      await request(
        `/workspaces?organizationId=${orgs[0]}&search=product&limit=1&sort=name&order=asc`,
      )
    ).json();
    expect(data).toHaveLength(1);
    expect(meta.total).toBe(1);
    expect((await (await request(`/workspaces?organizationId=${orgs[0]}`, 2)).json()).data).toEqual(
      [],
    );
    expect((await request(`/workspaces?organizationId=${orgs[0]}`, 3)).status).toBe(404);
    expect(
      (await request(`/workspaces/${workspaceId}`, 1, 'PATCH', { organizationId: orgs[1] })).status,
    ).toBe(400);
    expect(
      (await request(`/workspaces/${workspaceId}`, 1, 'PATCH', { name: 'Product Studio' })).status,
    ).toBe(200);
    expect((await (await request(`/workspaces/${workspaceId}`)).json()).data.description).toBe(
      'Focused work',
    );
  });
  it('adds only organization members and revokes private access immediately on removal', async () => {
    expect(
      (await request(`/workspaces/${workspaceId}/members`, 0, 'POST', { userId: users[3]!.id }))
        .status,
    ).toBe(404);
    expect(
      (await request(`/workspaces/${workspaceId}/members`, 0, 'POST', { userId: users[2]!.id }))
        .status,
    ).toBe(201);
    expect(
      (await request(`/workspaces/${workspaceId}/members`, 0, 'POST', { userId: users[2]!.id }))
        .status,
    ).toBe(409);
    const visible = workspaceSchema.parse(
      (await (await request(`/workspaces/${workspaceId}`, 2)).json()).data,
    );
    expect(visible.canManage).toBe(false);
    expect(
      (await request(`/workspaces/${workspaceId}`, 2, 'PATCH', { name: 'Hijacked' })).status,
    ).toBe(403);
    const members = await (await request(`/workspaces/${workspaceId}/members?limit=1`, 2)).json();
    expect(members.meta.total).toBe(2);
    expect(JSON.stringify(members)).not.toContain('passwordHash');
    expect(
      (await request(`/workspaces/${workspaceId}/members/${users[2]!.id}`, 0, 'DELETE')).status,
    ).toBe(200);
    expect((await request(`/workspaces/${workspaceId}`, 2)).status).toBe(404);
  });
  it('protects project ownership, clears descendant memberships and refuses structural deletion', async () => {
    await request(`/workspaces/${workspaceId}/members`, 0, 'POST', { userId: users[2]!.id });
    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: 'Owned project',
        ownerId: users[2]!.id,
        members: { create: { userId: users[2]!.id } },
      },
    });
    expect(
      (await request(`/workspaces/${workspaceId}/members/${users[2]!.id}`, 0, 'DELETE')).status,
    ).toBe(409);
    expect((await request(`/workspaces/${workspaceId}`, 0, 'DELETE')).status).toBe(409);
    await prisma.project.update({ where: { id: project.id }, data: { ownerId: users[0]!.id } });
    expect(
      (await request(`/workspaces/${workspaceId}/members/${users[2]!.id}`, 0, 'DELETE')).status,
    ).toBe(200);
    expect(
      await prisma.projectMember.count({ where: { projectId: project.id, userId: users[2]!.id } }),
    ).toBe(0);
    await prisma.project.delete({ where: { id: project.id } });
    expect((await request(`/workspaces/${workspaceId}`, 1, 'DELETE')).status).toBe(200);
  });
});
