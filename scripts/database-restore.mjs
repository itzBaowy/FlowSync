import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  archiveHash,
  backupDatabase,
  backupRoot,
  connection,
  inspectDatabase,
  postgresTool,
} from './database-backup.mjs';

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    createdAt: z.iso.datetime(),
    postgresMajor: z.literal(17),
    archive: z.literal('database.dump'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(5),
    tables: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
            rows: z.number().int().min(0).max(100000),
            checksum: z.string().regex(/^[a-f0-9]{32}$/),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine((value) => new Set(value.tables.map((table) => table.name)).size === value.tables.length);

async function checkedBackup(input) {
  const root = await realpath(backupRoot);
  const directory = await realpath(resolve(input));
  const offset = relative(root, directory);
  if (!offset || offset.startsWith('..') || isAbsolute(offset))
    throw new Error('Backup must be inside the local backup directory');
  const manifestPath = resolve(directory, 'manifest.json');
  if ((await stat(manifestPath)).size > 100000) throw new Error('Oversized manifest');
  if (relative(directory, await realpath(manifestPath)) !== 'manifest.json')
    throw new Error('Manifest must be inside the backup directory');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const archive = await realpath(resolve(directory, manifest.archive));
  if (relative(directory, archive) !== 'database.dump') throw new Error('Unexpected archive path');
  if (
    (await stat(archive)).size !== manifest.bytes ||
    (await archiveHash(archive)) !== manifest.sha256
  )
    throw new Error('Archive checksum mismatch');
  return { directory, archive, manifest };
}

async function rehearseRestore(input) {
  const startedAt = Date.now();
  // All validation precedes creating a database. No caller-supplied target database is accepted.
  const { directory, archive, manifest } = await checkedBackup(input);
  const temporaryDatabase = `flowsync_restore_${randomUUID().replaceAll('-', '')}`;
  if (
    !/^flowsync_restore_[a-f0-9]{32}$/.test(temporaryDatabase) ||
    temporaryDatabase === process.env.POSTGRES_DB
  )
    throw new Error('Unsafe rehearsal database');
  const admin = connection();
  const restored = connection(temporaryDatabase);
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0`);
    created = true;
    await postgresTool(
      'pg_restore',
      [
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--single-transaction',
        '--dbname',
        temporaryDatabase,
      ],
      archive,
    );
    await restored.connect();
    const actualTables = await inspectDatabase(restored);
    if (JSON.stringify(actualTables) !== JSON.stringify(manifest.tables))
      throw new Error('Restored table contents differ from snapshot');
    const constraints = await restored.query(
      "SELECT count(*)::int AS invalid FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated",
    );
    if (constraints.rows[0].invalid !== 0)
      throw new Error('Restored constraints are not validated');
    const migrations = await restored.query(
      'SELECT count(*)::int AS applied FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    if (!migrations.rows[0].applied) throw new Error('Missing restored migration history');
  } finally {
    await restored.end();
    try {
      if (created) await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
  const result = {
    event: 'database.restore_verified',
    verifiedAt: new Date().toISOString(),
    archiveSha256: manifest.sha256,
    tables: manifest.tables.length,
    rows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
    temporaryDatabaseRemoved: true,
    elapsedMs: Date.now() - startedAt,
  };
  await writeFile(
    resolve(directory, `restore-${randomUUID()}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  console.log(JSON.stringify(result));
}

if (process.argv.length > 3) {
  console.error('Usage: npm run verify:backup -- [backup-directory]');
  process.exitCode = 1;
} else {
  try {
    await rehearseRestore(process.argv[2] ?? (await backupDatabase()));
  } catch {
    console.error(
      'Restore rehearsal failed: verify backup integrity, local PostgreSQL/Docker and database-create privileges.',
    );
    process.exitCode = 1;
  }
}
