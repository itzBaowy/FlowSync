import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { io, type Socket } from 'socket.io-client';
import { JwtService } from '@nestjs/jwt';
import { boardJoinedSchema } from '@flowsync/contracts';
import { startTestApi } from './helpers/api-server';
config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const users: { id: string; token: string }[] = [];
const connections: Socket[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let organizationId: string;
let boardId: string;
let projectId: string;
async function connect(token: string, origin = process.env.WEB_URL) {
  const socket = io(`${api.baseUrl.replace(/\/api$/, '')}/realtime`, {
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
