import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpsRequest, Agent } from 'node:https';
import { request as httpRequest } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { io } from 'socket.io-client';
import { z } from 'zod';
import { authSessionSchema, organizationSchema } from '@flowsync/contracts';

const id = randomUUID().replaceAll('-', '').slice(0, 12);
const project = `flowsync-smoke-${id}`;
const directory = resolve('.local', project);
const environmentPath = `.local/${project}/environment.env`;
const overridePath = `.local/${project}/compose.yaml`;
let stage = 'prepare';
let created = false;
let ca;
let securePort;
let httpPort;
const compose = [
  'compose',
  '--env-file',
  environmentPath,
  '-p',
  project,
  '-f',
  'compose.production.yaml',
  '-f',
  overridePath,
];
async function docker(args, capture = false) {
  const child = spawn('docker', args, {
    windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'ignore'] : 'inherit',
  });
  let output = '';
  if (capture)
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
  await new Promise((done, reject) => {
    child.once('error', () => reject(new Error('Docker unavailable')));
    child.once('exit', (code) =>
      code === 0 ? done() : reject(new Error('Docker operation failed')),
    );
  });
  return output.trim();
}
async function freePort() {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}
async function request(host, path, method = 'GET', body, headers = {}) {
  return new Promise((done, reject) => {
    const call = httpsRequest(
      {
        hostname: '127.0.0.1',
        port: securePort,
        servername: host,
        ca,
        rejectUnauthorized: true,
        method,
        path,
        headers: {
          Host: `${host}:${securePort}`,
          ...(body ? { 'Content-Length': body.length } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          done({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );
    call.setTimeout(10000, () => call.destroy(new Error('Smoke request timed out')));
    call.on('error', reject);
    call.end(body);
  });
}
class SmokeError extends Error {}
const assert = (condition, message) => {
  if (!condition) throw new SmokeError(message);
};
const data = (response) => JSON.parse(response.body.toString('utf8')).data;
async function json(path, method = 'GET', body, headers = {}) {
  return request(
    'flowsync.localhost',
    path,
    method,
    body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    {
      'Content-Type': 'application/json',
      ...headers,
    },
  );
}
async function prepare() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  securePort = await freePort();
  httpPort = await freePort();
  const secret = () => randomBytes(32).toString('hex');
  const pgPassword = secret();
  const redisPassword = secret();
  const storageSecret = secret();
  const environment = {
    FLOWSYNC_ENV_FILE: environmentPath,
    FLOWSYNC_DOMAIN: 'flowsync.localhost',
    ACME_EMAIL: 'smoke@example.com',
    FLOWSYNC_RELEASE: id,
    FLOWSYNC_IMAGE_PREFIX: 'flowsync-smoke',
    NODE_ENV: 'production',
    API_PORT: '4000',
    WEB_URL: `https://flowsync.localhost:${securePort}`,
    NEXT_PUBLIC_API_URL: `https://flowsync.localhost:${securePort}/api`,
    DATABASE_URL: `postgresql://flowsync:${pgPassword}@smoke-postgres:5432/flowsync?schema=public`,
    REDIS_HOST: 'smoke-redis',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: redisPassword,
    JWT_ACCESS_SECRET: secret(),
    JWT_REFRESH_SECRET: secret(),
    JWT_ISSUER: project,
    JWT_AUDIENCE: project,
    MINIO_ENDPOINT: 'http://smoke-storage:9000',
    MINIO_PUBLIC_ENDPOINT: `https://storage.flowsync.localhost:${securePort}`,
    MINIO_ACCESS_KEY: 'flowsync-smoke',
    MINIO_SECRET_KEY: storageSecret,
    MINIO_BUCKET: 'flowsync-smoke',
    S3_REGION: 'us-east-1',
    SMTP_URL: 'smtp://127.0.0.1:1',
    EMAIL_FROM: 'smoke@example.com',
    EMAIL_ENCRYPTION_KEY: secret(),
    AI_PROVIDER: 'disabled',
    AI_MODEL: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    TRUST_PROXY_HOPS: '1',
  };
  await writeFile(
    resolve(directory, 'environment.env'),
    Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const caddyfile =
    (await readFile('docker/Caddyfile', 'utf8')) +
    '\nstorage.flowsync.localhost {\n\ttls internal\n\treverse_proxy smoke-storage:9000\n}\n';
  await writeFile(resolve(directory, 'Caddyfile'), caddyfile, { flag: 'wx' });
  const mount = resolve(directory, 'Caddyfile').replaceAll('\\', '/');
  const yaml = `services:
  migrate:
    image: flowsync-migrate:latest
    depends_on:
      smoke-postgres: { condition: service_healthy }
  api:
    image: flowsync-api:latest
    depends_on:
      smoke-redis: { condition: service_healthy }
      smoke-storage-init: { condition: service_completed_successfully }
  worker:
    image: flowsync-api:latest
  web:
    image: flowsync-smoke-web:${id}
    build:
      args:
        NEXT_PUBLIC_API_URL: https://flowsync.localhost:${securePort}/api
  proxy:
    ports: !override ['127.0.0.1:${securePort}:443', '127.0.0.1:${httpPort}:80']
    volumes: !override ['${mount}:/etc/caddy/Caddyfile:ro', 'caddy_data:/data', 'caddy_config:/config']
  smoke-postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: flowsync
      POSTGRES_PASSWORD: ${pgPassword}
      POSTGRES_DB: flowsync
    tmpfs: ['/var/lib/postgresql/data:size=512m']
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'flowsync', '-d', 'flowsync']
      interval: 2s
      timeout: 3s
      retries: 30
  smoke-redis:
    image: redis:7.4-alpine
    environment: { REDIS_PASSWORD: ${redisPassword} }
    command: ['sh', '-c', 'exec redis-server --save "" --appendonly no --requirepass "$$REDIS_PASSWORD"']
    healthcheck:
      test: ['CMD-SHELL', 'REDISCLI_AUTH=$$REDIS_PASSWORD redis-cli ping | grep -q PONG']
      interval: 2s
      timeout: 3s
      retries: 30
  smoke-storage:
    image: flowsync-minio:local
    command: server /data
    environment:
      MINIO_ROOT_USER: flowsync-smoke
      MINIO_ROOT_PASSWORD: ${storageSecret}
    tmpfs: ['/data:size=64m,uid=10001,gid=10001,mode=0700']
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']
      interval: 2s
      timeout: 3s
      retries: 30
  smoke-storage-init:
    image: flowsync-minio:local
    depends_on:
      smoke-storage: { condition: service_healthy }
    environment:
      MINIO_ACCESS_KEY: flowsync-smoke
      MINIO_SECRET_KEY: ${storageSecret}
    entrypoint: ['/bin/sh', '-ec']
    command: ['mc alias set smoke http://smoke-storage:9000 "$$MINIO_ACCESS_KEY" "$$MINIO_SECRET_KEY" >/dev/null; mc mb smoke/flowsync-smoke; mc anonymous set none smoke/flowsync-smoke']
`;
  await writeFile(resolve(directory, 'compose.yaml'), yaml, { flag: 'wx', mode: 0o600 });
}
async function verify() {
  const host = 'flowsync.localhost';
  const origin = `https://${host}:${securePort}`;
  const redirect = await new Promise((done, reject) => {
    const call = httpRequest(
      {
        hostname: '127.0.0.1',
        port: httpPort,
        path: '/login',
        headers: { Host: 'flowsync.localhost' },
      },
      (response) => {
        response.resume();
        done({ status: response.statusCode, location: response.headers.location });
      },
    );
    call.on('error', reject);
    call.setTimeout(5000, () => call.destroy(new SmokeError('HTTP redirect timed out')));
    call.end();
  });
  assert(
    redirect.status === 308 && redirect.location?.startsWith('https://flowsync.localhost/'),
    'HTTP did not redirect to HTTPS',
  );
  const health = await json('/api/health/ready');
  assert(
    health.status === 200 && Object.values(data(health).checks).every((check) => check === 'up'),
    'Readiness failed',
  );
  assert((await request(host, '/login')).status === 200, 'Frontend failed');
  assert(
    (await json('/api/docs')).status === 404 && (await json('/api/docs-json')).status === 404,
    'Swagger exposed',
  );
  const forbidden = await json(
    '/api/auth/register',
    'POST',
    { name: 'Smoke', email: `smoke-${id}@example.com`, password: 'smoke-only-long-password' },
    { Origin: 'https://attacker.example' },
  );
  assert(forbidden.status === 403, 'Hostile origin accepted');
  const registration = await json(
    '/api/auth/register',
    'POST',
    { name: 'Smoke', email: `smoke-${id}@example.com`, password: 'smoke-only-long-password' },
    { Origin: origin },
  );
  assert(registration.status === 201, 'Production registration failed');
  const session = authSessionSchema.parse(data(registration));
  const initialCookie = registration.headers['set-cookie']?.[0];
  assert(
    initialCookie &&
      /; Secure/i.test(initialCookie) &&
      /; HttpOnly/i.test(initialCookie) &&
      /; SameSite=Lax/i.test(initialCookie),
    'Cookie attributes incorrect',
  );
  assert(
    /max-age=31536000/.test(registration.headers['strict-transport-security'] ?? ''),
    'HSTS absent',
  );
  const refreshed = await json(
    '/api/auth/refresh',
    'POST',
    {},
    { Cookie: initialCookie.split(';')[0], Origin: origin },
  );
  assert(refreshed.status === 200, 'Production refresh failed');
  const rotated = authSessionSchema.parse(data(refreshed));
  const rotatedCookie = refreshed.headers['set-cookie']?.[0];
  assert(
    rotatedCookie && rotatedCookie.split(';')[0] !== initialCookie.split(';')[0],
    'Cookie did not rotate',
  );
  const authorization = { Authorization: `Bearer ${rotated.accessToken}`, Origin: origin };
  assert(
    (await json('/api/auth/me', 'GET', undefined, authorization)).status === 200,
    'Bearer profile failed',
  );
  const organization = await json(
    '/api/organizations',
    'POST',
    { name: 'Production smoke', slug: `smoke-${id}` },
    authorization,
  );
  assert(organization.status === 201, 'Organization creation failed');
  const organizationId = organizationSchema.parse(data(organization)).id;
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
  const boundary = `smoke-${id}`;
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const upload = await request(
    host,
    `/api/organizations/${organizationId}/logo`,
    'POST',
    multipart,
    { ...authorization, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  );
  assert(upload.status === 201, 'Private image upload failed');
  const logo = new URL(organizationSchema.parse(data(upload)).logoUrl);
  assert(
    logo.hostname === 'storage.flowsync.localhost' && logo.port === String(securePort),
    'Unexpected signed URL origin',
  );
  const download = await request(logo.hostname, `${logo.pathname}${logo.search}`);
  assert(download.status === 200 && download.body.length > 0, 'Signed HTTPS download failed');
  assert(
    (await request(logo.hostname, logo.pathname)).status === 403,
    'Bucket object became public',
  );
  const identifier = z.object({ id: z.uuid() });
  const workspace = await json(
    '/api/workspaces',
    'POST',
    { organizationId, name: 'Smoke', slug: 'smoke' },
    authorization,
  );
  assert(workspace.status === 201, 'Workspace creation failed');
  const projectResponse = await json(
    '/api/projects',
    'POST',
    { workspaceId: identifier.parse(data(workspace)).id, name: 'Smoke' },
    authorization,
  );
  assert(projectResponse.status === 201, 'Project creation failed');
  const board = await json(
    '/api/boards',
    'POST',
    { projectId: identifier.parse(data(projectResponse)).id, name: 'Smoke' },
    authorization,
  );
  assert(board.status === 201, 'Board creation failed');
  const agent = new Agent({ ca, servername: host });
  const socket = io(`https://127.0.0.1:${securePort}/realtime`, {
    transports: ['websocket'],
    auth: { token: rotated.accessToken },
    agent,
    ca,
    rejectUnauthorized: true,
    extraHeaders: { Origin: origin, Host: `${host}:${securePort}` },
    timeout: 5000,
    reconnection: false,
    autoConnect: false,
    forceNew: true,
  });
  try {
    await new Promise((done, reject) => {
      socket.once('connect', done);
      socket.once('connect_error', () => reject(new SmokeError('TLS WebSocket connection failed')));
      socket.connect();
    });
    const joined = await socket
      .timeout(5000)
      .emitWithAck('board:join', { boardId: identifier.parse(data(board)).id });
    assert(joined.ok === true, 'Scoped WebSocket subscription failed');
  } finally {
    socket.disconnect();
    agent.destroy();
  }
  const logout = await json(
    '/api/auth/logout',
    'POST',
    {},
    { Cookie: rotatedCookie.split(';')[0], Origin: origin },
  );
  assert(logout.status === 200, 'Production logout failed');
  assert(
    (
      await json(
        '/api/auth/refresh',
        'POST',
        {},
        { Cookie: rotatedCookie.split(';')[0], Origin: origin },
      )
    ).status === 401,
    'Logout did not revoke refresh',
  );
  const workerId = await docker([...compose, 'ps', '-q', 'worker'], true);
  assert(/^[a-f0-9]{12,64}$/.test(workerId), 'Missing worker container');
  await docker(['exec', workerId, 'node', 'dist/worker-health.js']);
  const settings = JSON.parse(
    await docker(['inspect', '--format', '{{json .HostConfig}}', workerId], true),
  );
  assert(
    settings.ReadonlyRootfs &&
      settings.CapDrop.includes('ALL') &&
      settings.SecurityOpt.includes('no-new-privileges:true'),
    'Worker hardening absent',
  );
  const report = {
    verifiedAt: new Date().toISOString(),
    project,
    tls: 'trusted-local-CA',
    nodeEnv: 'production',
    checks: [
      'readiness',
      'http-to-https',
      'frontend',
      'swagger-private',
      'origin-rejection',
      'secure-cookie',
      'refresh-rotation',
      'bearer-profile',
      'scoped-create',
      'private-upload',
      'signed-https-download',
      'anonymous-object-rejection',
      'tls-websocket-subscription',
      'logout-revocation',
      'worker-liveness',
      'readonly-capabilities',
    ],
    liveSmtpVerified: false,
    liveProviderVerified: false,
    cloudDeployed: false,
  };
  assert(session.user.id === rotated.user.id, 'Refresh user changed');
  await writeFile(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
}

try {
  await prepare();
  stage = 'build';
  console.log('Production smoke: building current application images.');
  await docker(['compose', '--progress', 'quiet', 'build', 'api']);
  await docker(['compose', '--progress', 'quiet', 'build', 'migrate']);
  await docker([...compose, '--progress', 'quiet', 'build', 'web']);
  stage = 'start';
  created = true;
  await docker([...compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120']);
  const proxyId = await docker([...compose, 'ps', '-q', 'proxy'], true);
  assert(/^[a-f0-9]{12,64}$/.test(proxyId), 'Missing proxy container');
  await docker([
    'cp',
    `${proxyId}:/data/caddy/pki/authorities/local/root.crt`,
    resolve(directory, 'root.crt'),
  ]);
  ca = await readFile(resolve(directory, 'root.crt'));
  stage = 'verify';
  await verify();
} catch (error) {
  console.error(
    `Isolated production smoke failed at ${stage}; check local Docker/resources and the generated configuration.`,
  );
  if (error instanceof SmokeError) console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) {
    assert(/^flowsync-smoke-[a-f0-9]{12}$/.test(project), 'Unsafe cleanup project');
    await docker([...compose, 'down', '--volumes', '--remove-orphans']).catch(() => {
      console.error(
        `Smoke cleanup failed for ${project}; its isolated resources remain for inspection.`,
      );
      process.exitCode = 1;
    });
  }
}
