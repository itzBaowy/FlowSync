import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/environment';
import { startEmailWorker } from '../src/modules/queue/email-worker';
import { decryptInvitation } from '../src/modules/queue/invitation-payload';
import { startTestApi } from './helpers/api-server';
import { Queue } from 'bullmq';

config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const env = validateEnvironment({
  ...process.env,
  NODE_ENV: 'test',
  SMTP_URL: `smtp://127.0.0.1:${process.env.MAILPIT_SMTP_PORT ?? '1025'}`,
});
const mailpitUrl = `http://127.0.0.1:${process.env.MAILPIT_HTTP_PORT ?? '8025'}`;
const suffix = randomUUID();
const accounts: { id: string; token: string; email: string }[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let worker: Awaited<ReturnType<typeof startEmailWorker>> | undefined;
let organizationId: string;
let otherOrganization: string;
let invitationId: string;
let deliveredToken: string;
const capturedMessages: string[] = [];
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
async function createInvite(email: string, role = 'MEMBER', actor = 0) {
  return request(`/organizations/${organizationId}/invitations`, actor, 'POST', { email, role });
}
async function undeliveredToken(id: string) {
  const entry = await prisma.emailOutbox.findUniqueOrThrow({ where: { invitationId: id } });
  if (!entry.encryptedPayload) throw new Error('Expected undelivered encrypted token');
  return decryptInvitation(entry.encryptedPayload, env.EMAIL_ENCRYPTION_KEY).token;
}
beforeAll(async () => {
  api = await startTestApi();
  worker = await startEmailWorker(env);
  for (const name of ['Owner', 'Invitee', 'Outsider', 'Admin', 'Member']) {
    const email = `${name.toLowerCase()}-${suffix}@example.com`;
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'invitation-test-password' }),
    });
    if (!response.ok) throw new Error('Could not register invitation test account');
    const { data } = await response.json();
    accounts.push({ id: data.user.id, token: data.accessToken, email });
  }
  organizationId = (
    await (
      await request('/organizations', 0, 'POST', {
        name: `Invite team ${suffix}`,
        slug: `invite-${suffix}`,
      })
    ).json()
  ).data.id;
  otherOrganization = (
    await (
      await request('/organizations', 2, 'POST', {
        name: 'Other tenant',
        slug: `invite-${suffix}-other`,
      })
    ).json()
  ).data.id;
  await prisma.organizationMember.createMany({
    data: [
      { organizationId, userId: accounts[3]!.id, role: 'ADMIN' },
      { organizationId, userId: accounts[4]!.id, role: 'MEMBER' },
    ],
  });
});
afterAll(async () => {
  await worker?.stop();
  api?.stop();
  if (capturedMessages.length)
    await fetch(`${mailpitUrl}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: capturedMessages }),
    });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `invite-${suffix}` } } });
  await prisma.user.deleteMany({ where: { id: { in: accounts.map((account) => account.id) } } });
  await prisma.$disconnect();
});
describe('Invitation lifecycle, RBAC and real SMTP delivery', () => {
  it('binds delivery to the API environment', async () => {
    await worker!.stop();
    worker = undefined;
    const email = `isolated-${suffix}@example.com`;
    const created = await (await createInvite(email)).json();
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({
      where: { invitationId: created.data.id },
    });
    expect(outbox.environment).toBe('test');
    // Even a manually misrouted job must not deliver a token from another environment.
    const development = await startEmailWorker({ ...env, NODE_ENV: 'development' });
    const queue = new Queue('flowsync-email-development', {
      connection: { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD },
    });
    try {
      const job = await queue.add('invitation', { outboxId: outbox.id }, { jobId: outbox.id });
      for (let attempt = 0; attempt < 40 && (await job.getState()) !== 'completed'; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await job.getState()).toBe('completed');
      expect(
        (await prisma.emailOutbox.findUniqueOrThrow({ where: { id: outbox.id } })).deliveredAt,
      ).toBeNull();
      await job.remove();
    } finally {
      await development.stop();
      await queue.close();
      await request(
        `/organizations/${organizationId}/invitations/${created.data.id}/revoke`,
        0,
        'POST',
      );
      worker = await startEmailWorker(env);
    }
  });
  it('enforces owner/admin/member invitation permissions and admin settings', async () => {
    expect((await createInvite(accounts[1]!.email, 'MEMBER', 4)).status).toBe(403);
    expect((await createInvite(accounts[1]!.email, 'ADMIN', 3)).status).toBe(403);
    await request(`/organizations/${organizationId}`, 0, 'PATCH', { allowAdminInvites: false });
    expect((await createInvite(accounts[1]!.email, 'MEMBER', 3)).status).toBe(403);
    await request(`/organizations/${organizationId}`, 0, 'PATCH', { allowAdminInvites: true });
  });
  it('atomically creates one pending invitation/outbox for concurrent duplicate requests', async () => {
    const responses = await Promise.all([
      createInvite(accounts[1]!.email, 'ADMIN'),
      createInvite(accounts[1]!.email, 'ADMIN'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const body = await responses.find((response) => response.status === 201)!.json();
    invitationId = body.data.id;
    expect(JSON.stringify(body)).not.toContain('tokenHash');
    expect(JSON.stringify(body)).not.toContain('encryptedPayload');
    expect(await prisma.emailOutbox.count({ where: { invitationId } })).toBe(1);
  });
  it('delivers the real token via BullMQ and local SMTP, then clears encrypted delivery data', async () => {
    for (let attempt = 0; attempt < 75; attempt++) {
      const result = await (
        await fetch(
          `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${accounts[1]!.email}`)}`,
        )
      ).json();
      const message = result.messages?.[0] as { ID: string } | undefined;
      if (message) {
        capturedMessages.push(message.ID);
        const details = await (await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`)).json();
        const text = String(details.Text);
        deliveredToken = text.match(/token=([a-f0-9]{64})/)?.[1] ?? '';
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(deliveredToken).toHaveLength(64);
    await worker!.stop();
    worker = undefined;
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({ where: { invitationId } });
    expect(outbox.deliveredAt).not.toBeNull();
    expect(outbox.encryptedPayload).toBeNull();
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(invitation.tokenHash).not.toBe(deliveredToken);
  });
  it('requires matching authenticated email and accepts once under concurrent requests', async () => {
    expect(
      (await request('/invitations/preview', 2, 'POST', { token: deliveredToken })).status,
    ).toBe(403);
    expect(
      (await request('/invitations/accept', 2, 'POST', { token: deliveredToken })).status,
    ).toBe(403);
    expect(
      (await request('/invitations/preview', 1, 'POST', { token: deliveredToken })).status,
    ).toBe(200);
    const results = await Promise.all([
      request('/invitations/accept', 1, 'POST', { token: deliveredToken }),
      request('/invitations/accept', 1, 'POST', { token: deliveredToken }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.organizationMember.count({
        where: { organizationId, userId: accounts[1]!.id, role: 'ADMIN' },
      }),
    ).toBe(1);
    expect(
      (await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } })).status,
    ).toBe('ACCEPTED');
    expect((await createInvite(accounts[1]!.email)).status).toBe(409);
  });
  it('rejects cross-tenant revoke and makes revoked tokens unusable', async () => {
    const response = await createInvite(accounts[2]!.email);
    const id = (await response.json()).data.id as string;
    const token = await undeliveredToken(id);
    expect(
      (await request(`/organizations/${otherOrganization}/invitations/${id}/revoke`, 2, 'POST', {}))
        .status,
    ).toBe(404);
    expect(
      (await request(`/organizations/${organizationId}/invitations/${id}/revoke`, 0, 'POST', {}))
        .status,
    ).toBe(200);
    expect((await request('/invitations/accept', 2, 'POST', { token })).status).toBe(409);
    expect(
      (await prisma.emailOutbox.findUniqueOrThrow({ where: { invitationId: id } }))
        .encryptedPayload,
    ).toBeNull();
  });
  it('commits expiration on rejection and permits a fresh invitation afterward', async () => {
    const id = (await (await createInvite(accounts[2]!.email)).json()).data.id as string;
    const token = await undeliveredToken(id);
    await prisma.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await request('/invitations/accept', 2, 'POST', { token })).status).toBe(410);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRED');
    expect((await createInvite(accounts[2]!.email)).status).toBe(201);
  });
  it('rejects stale inviter permissions and does not leak tokens in invitation listings', async () => {
    const existing = await prisma.invitation.findFirstOrThrow({
      where: { organizationId, email: accounts[2]!.email, status: 'PENDING' },
    });
    await request(
      `/organizations/${organizationId}/invitations/${existing.id}/revoke`,
      0,
      'POST',
      {},
    );
    const id = (await (await createInvite(accounts[2]!.email, 'MEMBER', 3)).json()).data
      .id as string;
    const token = await undeliveredToken(id);
    await request(`/organizations/${organizationId}/members/${accounts[3]!.id}`, 0, 'PATCH', {
      role: 'MEMBER',
    });
    expect((await request('/invitations/accept', 2, 'POST', { token })).status).toBe(410);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).status).toBe('REVOKED');
    const response = await request(`/organizations/${organizationId}/invitations?limit=100`);
    const body = await response.json();
    expect(body.meta.total).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('tokenHash');
    expect(JSON.stringify(body)).not.toContain(token);
  });
});
