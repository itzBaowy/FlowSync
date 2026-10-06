import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { authSessionSchema, userSchema } from '@flowsync/contracts';
import * as argon2 from 'argon2';

config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const suffix = randomUUID();
const emails = [`e2e-${suffix}@example.com`, `race-${suffix}@example.com`];
const password = 'test-only-long-password';
let server: ChildProcess | undefined;
let baseUrl: string;
let cookie: string;
let access: string;
async function request(path: string, body?: unknown, token?: string, bearer?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Cookie: token } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const sessionCookie = (response: Response) => {
  const value = response.headers.get('set-cookie');
  if (!value) throw new Error('Expected session cookie');
  return value.split(';')[0]!;
};

beforeAll(async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  baseUrl = `http://127.0.0.1:${port}/api`;
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', API_PORT: String(port) },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null)
      throw new Error('Test API exited during startup; check local infrastructure and ENV.');
    try {
      const response = await fetch(`${baseUrl}/health/live`);
      if (response.ok) return;
    } catch {
      /* Wait for the API to bind. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Test API did not become live');
});
afterAll(async () => {
  server?.kill();
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe('real HTTP authentication + PostgreSQL/Redis/MinIO', () => {
  it('is ready only when all infrastructure services respond', async () => {
    const response = await request('/health/ready');
    expect(response.status).toBe(200);
    expect((await response.json()).data.checks).toEqual({
      postgres: 'up',
      redis: 'up',
      storage: 'up',
    });
  });
  it('validates register, persists Argon2 hash, and never leaks secrets', async () => {
    const invalid = await request('/auth/register', {
      name: 'A',
      email: 'wrong',
      password: 'short',
      role: 'OWNER',
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('VALIDATION_ERROR');
    const response = await request('/auth/register', {
      name: 'Long',
      email: emails[0]!.toUpperCase(),
      password,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/);
    expect(response.headers.get('set-cookie')).toMatch(/Path=\/api\/auth/);
    cookie = sessionCookie(response);
    const body = await response.json();
    const session = authSessionSchema.parse(body.data);
    access = session.accessToken;
    expect(session.user.email).toBe(emails[0]);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(JSON.stringify(body)).not.toContain('refreshToken');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(user.passwordHash!, password)).toBe(true);
    const token = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(token.tokenHash).toHaveLength(64);
    expect(token.tokenHash).not.toBe(cookie.split('=')[1]);
  });
  it('rejects duplicate registration and anonymous/forged current-user calls', async () => {
    expect(
      (await request('/auth/register', { name: 'Long', email: emails[0], password })).status,
    ).toBe(409);
    expect((await request('/auth/me')).status).toBe(401);
    expect((await request('/auth/me', undefined, undefined, `${access}corrupted`)).status).toBe(
      401,
    );
    const response = await request('/auth/me', undefined, undefined, access);
    expect(response.status).toBe(200);
    expect(userSchema.parse((await response.json()).data).email).toBe(emails[0]);
  });
  it('rotates once and commits family revocation on replay', async () => {
    const original = cookie;
    const rotated = await request('/auth/refresh', {}, original);
    expect(rotated.status).toBe(200);
    cookie = sessionCookie(rotated);
    expect(cookie).not.toBe(original);
    expect((await request('/auth/refresh', {}, original)).status).toBe(401);
    expect((await request('/auth/refresh', {}, cookie)).status).toBe(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
  });
  it('handles two simultaneous refresh requests without two surviving tokens', async () => {
    const login = await request('/auth/login', { email: emails[0], password });
    const original = sessionCookie(login);
    const results = await Promise.all([
      request('/auth/refresh', {}, original),
      request('/auth/refresh', {}, original),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const winner = results.find((result) => result.status === 200)!;
    expect((await request('/auth/refresh', {}, sessionCookie(winner))).status).toBe(401);
  });
  it('rejects hostile origins, supports logout and revokes its session', async () => {
    const hostile = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emails[0], password }),
    });
    expect(hostile.status).toBe(403);
    expect((await request('/auth/login', { email: emails[0], password: 'wrong' })).status).toBe(
      401,
    );
    const login = await request('/auth/login', { email: emails[0], password });
    expect(login.status).toBe(200);
    const loginBody = await login.json();
    expect(JSON.stringify(loginBody)).not.toContain('passwordHash');
    expect(JSON.stringify(loginBody)).not.toContain('refreshToken');
    const current = sessionCookie(login);
    const logout = await request('/auth/logout', {}, current);
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await request('/auth/refresh', {}, current)).status).toBe(401);
  });
  it('uses Redis to rate-limit repeated login attempts', async () => {
    let status = 0;
    for (let index = 0; index < 12; index++) {
      status = (await request('/auth/login', { email: `missing-${suffix}@example.com`, password }))
        .status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  });
});
