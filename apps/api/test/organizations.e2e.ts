import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { organizationSchema } from '@flowsync/contracts';
import { startTestApi } from './helpers/api-server';

config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const suffix = randomUUID();
const accounts: { id: string; token: string; email: string }[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let organizationId: string;
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
beforeAll(async () => {
  api = await startTestApi();
  for (const name of ['Owner', 'Member', 'Outsider', 'Admin']) {
    const email = `${name.toLowerCase()}-${suffix}@example.com`;
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'organization-test-password' }),
    });
    if (!response.ok) throw new Error('Failed to create test account');
    const { data } = await response.json();
    accounts.push({ id: data.user.id, token: data.accessToken, email });
  }
});
afterAll(async () => {
  api?.stop();
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `test-${suffix}` } } });
  await prisma.user.deleteMany({ where: { id: { in: accounts.map((account) => account.id) } } });
  await prisma.$disconnect();
});
describe.sequential('Organization CRUD and tenant boundaries', () => {
  it('creates an organization with exactly one OWNER membership', async () => {
    const response = await request('/organizations', 0, 'POST', {
      name: 'Test team',
      slug: `test-${suffix}`,
    });
    expect(response.status).toBe(201);
    const organization = organizationSchema.parse((await response.json()).data);
    organizationId = organization.id;
    expect(organization.ownerId).toBe(accounts[0]!.id);
    expect(organization.role).toBe('OWNER');
    expect(
      await prisma.organizationMember.count({ where: { organizationId, role: 'OWNER' } }),
    ).toBe(1);
    await prisma.organizationMember.createMany({
      data: [
        { organizationId, userId: accounts[1]!.id, role: 'MEMBER' },
        { organizationId, userId: accounts[3]!.id, role: 'ADMIN' },
      ],
    });
  });
  it('scopes listing/filtering/pagination to membership', async () => {
    const response = await request('/organizations?limit=1&page=1&search=Test&sort=name&order=asc');
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect((await (await request('/organizations', 2)).json()).data).toEqual([]);
    expect((await request('/organizations?limit=101')).status).toBe(400);
  });
  it('rejects cross-tenant access, malformed IDs and role escalation', async () => {
    expect((await request(`/organizations/${organizationId}`, 2)).status).toBe(404);
    expect((await request('/organizations/not-a-uuid')).status).toBe(400);
    expect(
      (await request(`/organizations/${organizationId}`, 1, 'PATCH', { name: 'Hijack' })).status,
    ).toBe(403);
    expect((await request(`/organizations/${organizationId}`, 3, 'DELETE')).status).toBe(403);
    expect(
      (await request(`/organizations/${organizationId}`, 0, 'PATCH', { role: 'OWNER' })).status,
    ).toBe(400);
  });
  it('lets owner update settings and rejects duplicate slugs', async () => {
    const response = await request(`/organizations/${organizationId}`, 0, 'PATCH', {
      name: 'Updated team',
      allowAdminInvites: false,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.allowAdminInvites).toBe(false);
    expect(
      (await request('/organizations', 0, 'POST', { name: 'Duplicate', slug: `test-${suffix}` }))
        .status,
    ).toBe(409);
  });
  it('deletes an empty organization only as owner', async () => {
    expect((await request(`/organizations/${organizationId}`, 1, 'DELETE')).status).toBe(403);
    expect((await request(`/organizations/${organizationId}`, 0, 'DELETE')).status).toBe(200);
    expect((await request(`/organizations/${organizationId}`)).status).toBe(404);
  });
});
