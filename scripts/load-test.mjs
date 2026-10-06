import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { authSessionSchema, boardSnapshotSchema, taskSchema } from '@flowsync/contracts';
import { z } from 'zod';

config({ path: '.env', quiet: true });
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1'].includes(databaseUrl.hostname)
)
  throw new Error('Load smoke test requires a local development/test database');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../apps/api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl.toString() }),
});
const suffix = randomUUID();
const fixtureSlug = `load-${suffix}`;
const fixtureEmail = `load-${suffix}@example.com`;
const concurrency = 5;
const iterations = 10;
const samples = [];
let server;
let serverExit;
let baseUrl;
let token;
let organizationId;
const resource = z.object({ id: z.string().uuid() });

async function request(path, method = 'GET', body, measured = false) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const envelope = await response.json();
  if (measured)
    samples.push({ method, status: response.status, durationMs: performance.now() - started });
  if (!response.ok) throw new Error(`Load request failed with HTTP ${response.status}`);
  if (!envelope || typeof envelope !== 'object' || !('data' in envelope))
    throw new Error('Unexpected envelope');
  return envelope.data;
}
async function startApi() {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  baseUrl = `http://127.0.0.1:${port}/api`;
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: resolve('apps/api'),
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'test', API_PORT: String(port), AI_PROVIDER: 'disabled' },
  });
  serverExit = new Promise((done) => {
    server.once('exit', done);
    server.once('error', done);
  });
  for (let index = 0; index < 100; index++) {
    if (server.exitCode !== null) throw new Error('Benchmark API exited during startup');
    try {
      if ((await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok)
        return;
    } catch {
      /* Wait for infrastructure readiness. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Benchmark API startup timed out');
}
function distribution(entries) {
  const values = entries.map((entry) => entry.durationMs).sort((left, right) => left - right);
  const percentile = (fraction) =>
    Math.round(values[Math.max(0, Math.ceil(values.length * fraction) - 1)] * 100) / 100;
  return {
    requests: entries.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
  };
}
async function benchmark() {
  await startApi();
  const session = authSessionSchema.parse(
    await request('/auth/register', 'POST', {
      name: 'Load fixture',
      email: fixtureEmail,
      password: `fixture-only-${randomUUID()}`,
    }),
  );
  token = session.accessToken;
  organizationId = resource.parse(
    await request('/organizations', 'POST', { name: 'Load fixture', slug: fixtureSlug }),
  ).id;
  const workspaceId = resource.parse(
    await request('/workspaces', 'POST', { organizationId, name: 'Benchmark', slug: 'benchmark' }),
  ).id;
  const projectId = resource.parse(
    await request('/projects', 'POST', { workspaceId, name: 'Benchmark' }),
  ).id;
  const boardId = resource.parse(
    await request('/boards', 'POST', { projectId, name: 'Benchmark' }),
  ).id;
  const initial = boardSnapshotSchema.parse(await request(`/boards/${boardId}`));
  const tasks = [];
  for (let index = 0; index < 25; index++)
    tasks.push(
      taskSchema.parse(
        await request('/tasks', 'POST', {
          columnId: initial.columns[0].id,
          title: `Fixture task ${index}`,
          description: 'Local bounded workload',
        }),
      ),
    );
  const before = boardSnapshotSchema.parse(await request(`/boards/${boardId}`));
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async (_, client) => {
      let task = tasks[client];
      for (let index = 0; index < iterations; index++) {
        boardSnapshotSchema.parse(await request(`/boards/${boardId}`, 'GET', undefined, true));
        if (index % 4 === 0)
          task = taskSchema.parse(
            await request(
              `/tasks/${task.id}`,
              'PATCH',
              {
                title: `Client ${client} edit ${index}`,
                expectedVersion: task.version,
              },
              true,
            ),
          );
      }
      if (task.version !== tasks[client].version + 3) throw new Error('Lost task update');
    }),
  );
  const durationMs = Math.round(performance.now() - started);
  const after = boardSnapshotSchema.parse(await request(`/boards/${boardId}`));
  if (
    after.revision !== before.revision + 15 ||
    after.columns.reduce((sum, column) => sum + column.tasks.length, 0) !== 25
  )
    throw new Error('Board revision or task count changed unexpectedly');
  const result = {
    profile: 'local-bounded-kanban',
    measuredAt: new Date().toISOString(),
    node: process.version,
    concurrency,
    datasetTasks: tasks.length,
    durationMs,
    reads: distribution(samples.filter((entry) => entry.method === 'GET')),
    writes: distribution(samples.filter((entry) => entry.method === 'PATCH')),
    errorRate: samples.filter((entry) => entry.status >= 400).length / samples.length,
    requestsPerSecond: Math.round((samples.length / (durationMs / 1000)) * 100) / 100,
    finalBoardRevisionDelta: after.revision - before.revision,
  };
  if (result.reads.p95Ms > 2000 || result.writes.p95Ms > 2000 || result.errorRate !== 0)
    throw new Error('Bounded load smoke threshold exceeded');
  await mkdir('.local', { recursive: true });
  await writeFile(`.local/load-${suffix}.json`, `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
}
try {
  await benchmark();
} catch {
  console.error('Local load smoke failed; inspect development infrastructure and test report.');
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill();
    await serverExit;
  }
  try {
    const organization = organizationId
      ? { id: organizationId }
      : await prisma.organization.findUnique({ where: { slug: fixtureSlug } });
    if (organization) {
      const projects = { workspace: { organizationId: organization.id } };
      await prisma.activity.deleteMany({ where: { organizationId: organization.id } });
      await prisma.task.deleteMany({ where: { column: { board: { project: projects } } } });
      await prisma.column.deleteMany({ where: { board: { project: projects } } });
      await prisma.board.deleteMany({ where: { project: projects } });
      await prisma.project.deleteMany({ where: projects });
      await prisma.workspace.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }
    await prisma.user.deleteMany({ where: { email: fixtureEmail } });
  } finally {
    await prisma.$disconnect();
  }
}
