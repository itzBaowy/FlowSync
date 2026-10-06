import { config } from 'dotenv';
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: '.env', quiet: true });
export const backupRoot = resolve('.local/backups');
export function connection(database) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.protocol !== 'postgresql:' ||
    decodeURIComponent(url.pathname.slice(1)) !== (process.env.POSTGRES_DB ?? 'flowsync') ||
    Number(url.port || 5432) !== Number(process.env.POSTGRES_PORT ?? 5432)
  )
    throw new Error('Backup tools require the local Compose PostgreSQL connection');
  if (database) url.pathname = `/${database}`;
  return new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
    query_timeout: 30000,
  });
}
export async function inspectDatabase(client) {
  const tables = await client.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  if (tables.rows.length > 100) throw new Error('Rehearsal supports at most 100 public tables');
  const results = [];
  for (const { name } of tables.rows) {
    const identifier = `"${name.replaceAll('"', '""')}"`;
    const count = await client.query(`SELECT count(*)::text AS rows FROM public.${identifier}`);
    const rows = Number(count.rows[0].rows);
    if (rows > 100000) throw new Error('Rehearsal supports at most 100000 rows per table');
    const checksum = await client.query(
      `SELECT md5(coalesce(string_agg(hash, '' ORDER BY hash), '')) AS checksum FROM (SELECT md5(to_jsonb(record)::text) AS hash FROM public.${identifier} record) hashes`,
    );
    results.push({ name, rows, checksum: checksum.rows[0].checksum });
  }
  return results;
}
export async function archiveHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function postgresTool(tool, args, input, output) {
  if (!['pg_dump', 'pg_restore'].includes(tool)) throw new Error('Unsupported database tool');
  // Fixed shell code reads credentials inside the container; variable arguments stay positional.
  const child = spawn(
    'docker',
    [
      'compose',
      '-f',
      'compose.yaml',
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'exec "$@" -U "$POSTGRES_USER"',
      'flowsync-db-tool',
      tool,
      ...args,
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], timeout: 120000, windowsHide: true },
  );
  const completion = new Promise((resolveExit, reject) => {
    child.once('error', () => reject(new Error(`${tool} could not start`)));
    child.once('exit', (code) =>
      code === 0 ? resolveExit() : reject(new Error(`${tool} failed`)),
    );
  });
  const transfers = [completion];
  if (input) transfers.push(pipeline(createReadStream(input), child.stdin));
  else child.stdin.end();
  if (output)
    transfers.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 })));
  else child.stdout.resume();
  try {
    await Promise.all(transfers);
  } catch (error) {
    child.kill();
    throw error;
  }
}
export async function backupDatabase() {
  const directory = resolve(backupRoot, randomUUID());
  const client = connection();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const exported = await client.query('SELECT pg_export_snapshot() AS snapshot');
    const version = await client.query('SHOW server_version_num');
    const majorVersion = Math.floor(Number(version.rows[0].server_version_num) / 10000);
    if (majorVersion !== 17) throw new Error('Local backup requires PostgreSQL 17');
    const tables = await inspectDatabase(client);
    const archive = resolve(directory, 'database.dump');
    await postgresTool(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--lock-wait-timeout=10s',
        `--snapshot=${exported.rows[0].snapshot}`,
        '--dbname',
        process.env.POSTGRES_DB ?? 'flowsync',
      ],
      undefined,
      archive,
    );
    await client.query('COMMIT');
    const bytes = (await stat(archive)).size;
    if (bytes < 5) throw new Error('Empty database archive');
    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      postgresMajor: majorVersion,
      archive: 'database.dump',
      sha256: await archiveHash(archive),
      bytes,
      tables,
    };
    await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        event: 'database.backup_completed',
        directory,
        bytes,
        tables: tables.length,
      }),
    );
    return directory;
  } finally {
    await client.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: npm run backup:database');
    process.exitCode = 1;
  } else
    await backupDatabase().catch(() => {
      console.error('Database backup failed; inspect local PostgreSQL/Docker and disk capacity.');
      process.exitCode = 1;
    });
}
