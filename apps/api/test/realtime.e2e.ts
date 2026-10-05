import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { io, type Socket } from 'socket.io-client';
import { JwtService } from '@nestjs/jwt';
import { boardJoinedSchema, presenceSchema, notificationSchema } from '@flowsync/contracts';
import Redis from 'ioredis';
import { startTestApi } from './helpers/api-server';
config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const users: { id: string; token: string }[] = [];
const connections: Socket[] = [];
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 1,
});
let api: Awaited<ReturnType<typeof startTestApi>>;
let replica: Awaited<ReturnType<typeof startTestApi>> | undefined;
let organizationId: string;
let boardId: string;
let projectId: string;
async function connect(token: string, origin = process.env.WEB_URL, target = api) {
  const socket = io(`${target.baseUrl.replace(/\/api$/, '')}/realtime`, {
    transports: ['websocket'],
    auth: { token },
    extraHeaders: { Origin: origin! },
    reconnection: false,
    timeout: 3000,
  });
  connections.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
async function join(socket: Socket, id: string) {
  return boardJoinedSchema.parse(
    await socket.timeout(3000).emitWithAck('board:join', { boardId: id }),
  );
}
beforeAll(async () => {
  api = await startTestApi();
  for (const name of ['Owner', 'Member', 'Outsider']) {
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `socket-${name}-${randomUUID()}@example.com`,
        password: 'socket-integration-password',
      }),
    });
    if (!response.ok) throw new Error('Fixture registration failed');
    const { data } = await response.json();
    users.push({ id: data.user.id, token: data.accessToken });
  }
  const org = await prisma.organization.create({
    data: {
      name: 'Realtime team',
      slug: `socket-${randomUUID()}`,
      ownerId: users[0]!.id,
      members: { create: [{ userId: users[0]!.id, role: 'OWNER' }, { userId: users[1]!.id }] },
    },
  });
  organizationId = org.id;
  const workspace = await prisma.workspace.create({
    data: {
      organizationId,
      name: 'Product',
      slug: 'product',
      members: { create: users.slice(0, 2).map((user) => ({ userId: user.id })) },
    },
  });
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      ownerId: users[0]!.id,
      name: 'Release',
      members: { create: users.slice(0, 2).map((user) => ({ userId: user.id })) },
    },
  });
  projectId = project.id;
  boardId = (
    await prisma.board.create({
      data: { projectId, name: 'Realtime', columns: { create: { name: 'To do', position: 0 } } },
    })
  ).id;
});
afterAll(async () => {
  connections.forEach((socket) => socket.disconnect());
  api?.stop();
  replica?.stop();
  if (organizationId) {
    const projects = { workspace: { organizationId } };
    await prisma.activity.deleteMany({ where: { organizationId } });
    await prisma.task.deleteMany({ where: { column: { board: { project: projects } } } });
    await prisma.column.deleteMany({ where: { board: { project: projects } } });
    await prisma.board.deleteMany({ where: { project: projects } });
    await prisma.project.deleteMany({ where: projects });
    await prisma.workspace.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
  redis.disconnect();
});
describe.sequential('Authenticated board subscriptions', () => {
  it('rejects absent, tampered, expired tokens and foreign browser origins', async () => {
    await expect(connect('')).rejects.toThrow('UNAUTHORIZED');
    await expect(connect(`${users[0]!.token}broken`)).rejects.toThrow('UNAUTHORIZED');
    await expect(connect(users[0]!.token, 'https://untrusted.example')).rejects.toThrow(
      'UNAUTHORIZED',
    );
    const expired = await new JwtService().signAsync(
      { sub: users[0]!.id, type: 'access' },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        algorithm: 'HS256',
        expiresIn: -1,
      },
    );
    await expect(connect(expired)).rejects.toThrow('UNAUTHORIZED');
  });
  it('authorizes every join against current parent memberships and validates payloads', async () => {
    const member = await connect(users[1]!.token);
    expect(await join(member, boardId)).toEqual({ ok: true, boardId, revision: 0 });
    const outsider = await connect(users[2]!.token);
    expect(await join(outsider, boardId)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await join(outsider, randomUUID())).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(
      await member.timeout(3000).emitWithAck('board:join', { boardId, room: 'other' }),
    ).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: users[1]!.id } },
    });
    expect(await join(member, boardId)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await prisma.projectMember.create({ data: { projectId, userId: users[1]!.id } });
    expect(await member.timeout(3000).emitWithAck('board:leave', { boardId })).toEqual({
      ok: true,
    });
  });
  it('disconnects when an access token expires instead of keeping a permanent session', async () => {
    const short = await new JwtService().signAsync(
      { sub: users[0]!.id, type: 'access' },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        algorithm: 'HS256',
        expiresIn: 2,
      },
    );
    const socket = await connect(short);
    await new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    expect(socket.connected).toBe(false);
  });
});
function nextEvent(socket: Socket, name: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Missing event ${name}`)), 3000);
    socket.once(name, (event) => {
      clearTimeout(timeout);
      resolve(event);
    });
  });
}
describe.sequential('Committed board changes across API replicas', () => {
  it('fans out through Redis after commit and emits nothing for rolled back mutations', async () => {
    replica = await startTestApi();
    const local = await connect(users[0]!.token);
    const remote = await connect(users[1]!.token, process.env.WEB_URL, replica);
    await join(local, boardId);
    await join(remote, boardId);
    const column = await prisma.column.findFirstOrThrow({ where: { boardId } });
    const localEvent = nextEvent(local, 'board:changed');
    const remoteEvent = nextEvent(remote, 'board:changed');
    const response = await fetch(`${api.baseUrl}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${users[0]!.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: column.id, title: 'Committed task' }),
    });
    expect(response.status).toBe(201);
    const event = await remoteEvent;
    expect(await localEvent).toEqual(event);
    expect(event).toEqual({ boardId, revision: 1 });
    expect(await prisma.task.count({ where: { columnId: column.id } })).toBe(1);
    const received: unknown[] = [];
    remote.on('board:changed', (event) => received.push(event));
    const rejected = await fetch(`${api.baseUrl}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${users[0]!.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columnId: column.id,
        title: 'Invalid task',
        assigneeIds: [users[2]!.id],
      }),
    });
    expect(rejected.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toHaveLength(0);
    expect((await prisma.board.findUniqueOrThrow({ where: { id: boardId } })).revision).toBe(1);
    // An already-connected member loses access before the next event is delivered.
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: users[1]!.id } },
    });
    const revoked = nextEvent(remote, 'board:revoked');
    const changed = nextEvent(local, 'board:changed');
    expect(
      (
        await fetch(`${api.baseUrl}/boards/${boardId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${users[0]!.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Changed board' }),
        })
      ).status,
    ).toBe(200);
    expect(await revoked).toEqual({ boardId });
    expect((await changed).revision).toBe(2);
    expect(received).toHaveLength(0);
    await prisma.projectMember.create({ data: { projectId, userId: users[1]!.id } });
    await join(remote, boardId);
    const removed = nextEvent(remote, 'board:revoked');
    const task = await prisma.task.findFirstOrThrow({ where: { column: { boardId } } });
    await prisma.taskAssignee.create({ data: { taskId: task.id, userId: users[1]!.id } });
    expect(
      (
        await fetch(`${api.baseUrl}/projects/${projectId}/members/${users[1]!.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${users[0]!.token}` },
        })
      ).status,
    ).toBe(200);
    expect(await removed).toEqual({ boardId });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(
      task.version + 1,
    );
    await prisma.projectMember.create({ data: { projectId, userId: users[1]!.id } });
  });
});
describe.sequential('Distributed online presence and connection leases', () => {
  it('deduplicates multiple tabs, shares presence between replicas and expires stale leases', async () => {
    connections.forEach((socket) => socket.disconnect());
    await expect
      .poll(async () => redis.zcard(`flowsync:test:presence:connections:${users[1]!.id}`), {
        timeout: 3000,
      })
      .toBe(0);
    const owner = await connect(users[0]!.token);
    const ownerTab = await connect(users[0]!.token, process.env.WEB_URL, replica!);
    const member = await connect(users[1]!.token, process.env.WEB_URL, replica!);
    let latest: unknown;
    owner.on('presence:changed', (snapshot) => {
      latest = snapshot;
    });
    await join(owner, boardId);
    await join(ownerTab, boardId);
    await join(member, boardId);
    await expect
      .poll(
        () => presenceSchema.safeParse(latest).success && presenceSchema.parse(latest).totalOnline,
      )
      .toBe(2);
    expect(
      presenceSchema
        .parse(latest)
        .members.map((user) => user.id)
        .sort(),
    ).toEqual(
      users
        .slice(0, 2)
        .map((user) => user.id)
        .sort(),
    );
    expect(JSON.stringify(latest)).not.toContain('password');
    const key = `flowsync:test:presence:board:${boardId}`;
    const expiredLease = `${randomUUID()}:expired`;
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    await redis.zadd(
      key,
      Date.now() - 1,
      expiredLease,
      Date.now() + 45000,
      `${users[2]!.id}:foreign`,
    );
    await join(owner, boardId);
    await expect.poll(async () => redis.zscore(key, `${users[2]!.id}:foreign`)).not.toBeNull();
    expect(presenceSchema.parse(latest).members.some((user) => user.id === users[2]!.id)).toBe(
      false,
    );
    await expect.poll(async () => redis.zscore(key, expiredLease)).toBeNull();
    member.disconnect();
    await expect.poll(() => presenceSchema.parse(latest).totalOnline).toBe(1);
    ownerTab.disconnect();
    await expect.poll(() => presenceSchema.parse(latest).totalOnline).toBe(1);
    await redis.zrem(key, `${users[2]!.id}:foreign`);
  });
  it('cleans a failed Redis subscription and allows a later retry', async () => {
    const board = await prisma.board.create({ data: { projectId, name: 'Recover subscription' } });
    const key = `flowsync:test:presence:board:${board.id}`;
    const socket = await connect(users[0]!.token);
    try {
      await redis.set(key, 'fault-injected-wrong-type');
      expect(await join(socket, board.id)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
      await redis.del(key);
      expect(await join(socket, board.id)).toMatchObject({ ok: true, boardId: board.id });
    } finally {
      socket.disconnect();
      await redis.del(key);
      await prisma.board.delete({ where: { id: board.id } });
    }
  });
  it('limits active connections per user across replicas', async () => {
    for (let index = 0; index < 10; index++)
      await connect(users[2]!.token, process.env.WEB_URL, index % 2 ? replica! : api);
    await expect(connect(users[2]!.token)).rejects.toThrow('RATE_LIMITED');
  });
});
async function notifyRequest(path: string, actor = 1, method = 'GET', body?: unknown) {
  return fetch(`${api.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${users[actor]!.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe.sequential('Transactional and private task notifications', () => {
  it('persists assignment notifications, fans out per user and rejects stale duplicate updates', async () => {
    const member = await connect(users[1]!.token, process.env.WEB_URL, replica!);
    const event = nextEvent(member, 'notification:changed');
    const column = await prisma.column.findFirstOrThrow({ where: { boardId } });
    const response = await notifyRequest('/tasks', 0, 'POST', {
      columnId: column.id,
      title: 'Notify assignment',
      assigneeIds: [users[0]!.id, users[1]!.id],
    });
    expect(response.status).toBe(201);
    expect(await event).toEqual({});
    const task = (await response.json()).data;
    const count = await (await notifyRequest('/notifications/unread-count')).json();
    expect(count.data.unread).toBe(1);
    expect((await (await notifyRequest('/notifications/unread-count', 0)).json()).data.unread).toBe(
      0,
    );
    const list = await (
      await notifyRequest('/notifications?unread=true&search=Notify&limit=1')
    ).json();
    expect(list.meta.total).toBe(1);
    const notification = notificationSchema.parse(list.data[0]);
    expect(notification.type).toBe('TASK_ASSIGNED');
    expect(notification.taskId).toBe(task.id);
    expect(notification.title).toContain('Owner assigned you to');
    expect(
      (await notifyRequest(`/notifications/${notification.id}/read`, 0, 'PATCH', { read: true }))
        .status,
    ).toBe(404);
    expect(
      (await notifyRequest(`/notifications/${notification.id}/read`, 2, 'PATCH', { read: true }))
        .status,
    ).toBe(404);
    expect(
      (await notifyRequest(`/notifications/${notification.id}/read`, 1, 'PATCH', { read: true }))
        .status,
    ).toBe(200);
    expect((await (await notifyRequest('/notifications/unread-count')).json()).data.unread).toBe(0);
    const updated = nextEvent(member, 'notification:changed');
    expect(
      (
        await notifyRequest(`/tasks/${task.id}`, 0, 'PATCH', {
          title: 'Updated notification',
          expectedVersion: 0,
        })
      ).status,
    ).toBe(200);
    await updated;
    expect(
      (
        await notifyRequest(`/tasks/${task.id}`, 0, 'PATCH', {
          title: 'Duplicate',
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
    expect((await (await notifyRequest('/notifications')).json()).meta.total).toBe(2);
    expect((await notifyRequest('/notifications/read-all', 1, 'POST')).status).toBe(201);
    expect((await (await notifyRequest('/notifications/unread-count')).json()).data.unread).toBe(0);
    expect(
      (await notifyRequest(`/notifications/${notification.id}/read`, 1, 'PATCH', { read: false }))
        .status,
    ).toBe(200);
    expect((await (await notifyRequest('/notifications/unread-count')).json()).data.unread).toBe(1);
    // Retained notification titles must disappear when the recipient loses parent scope.
    await prisma.workspaceMember.deleteMany({
      where: { userId: users[1]!.id, workspace: { organizationId } },
    });
    expect((await (await notifyRequest('/notifications')).json()).meta.total).toBe(0);
    expect((await (await notifyRequest('/notifications/unread-count')).json()).data.unread).toBe(0);
    expect(
      (await notifyRequest(`/notifications/${notification.id}/read`, 1, 'PATCH', { read: true }))
        .status,
    ).toBe(404);
  });
});
