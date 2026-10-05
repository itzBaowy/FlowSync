import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const envFile = new URL('.env', root);
if (existsSync(envFile)) {
  let current = readFileSync(envFile, 'utf8');
  if (!/^MINIO_PUBLIC_ENDPOINT=/m.test(current)) {
    const endpoint = current.match(/^MINIO_ENDPOINT=(.+)$/m)?.[1]?.trim();
    if (endpoint) {
      current = `${current.trimEnd()}\nMINIO_PUBLIC_ENDPOINT=${endpoint}\n`;
      writeFileSync(envFile, current);
    }
  }
  if (!/^EMAIL_ENCRYPTION_KEY=/m.test(current)) {
    writeFileSync(
      envFile,
      `${current.trimEnd()}\nEMAIL_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nEMAIL_FROM=no-reply@flowsync.local\nMAILPIT_SMTP_PORT=1025\nMAILPIT_HTTP_PORT=8025\n`,
    );
    console.log('Added invitation delivery configuration; existing credentials are unchanged.');
  } else console.log('.env already exists; keeping your configuration.');
} else {
  const secret = () => randomBytes(32).toString('hex');
  const password = secret();
  const config = readFileSync(new URL('.env.example', root), 'utf8')
    .replace('flowsync:CHANGE_ME@', `flowsync:${password}@`)
    .replace('POSTGRES_PASSWORD=CHANGE_ME', `POSTGRES_PASSWORD=${password}`)
    .replace('REDIS_PASSWORD=CHANGE_ME', `REDIS_PASSWORD=${secret()}`)
    .replace('JWT_ACCESS_SECRET=CHANGE_ME_MINIMUM_32_CHARACTERS', `JWT_ACCESS_SECRET=${secret()}`)
    .replace(
      'JWT_REFRESH_SECRET=CHANGE_ME_DIFFERENT_MINIMUM_32_CHARACTERS',
      `JWT_REFRESH_SECRET=${secret()}`,
    )
    .replace('MINIO_SECRET_KEY=CHANGE_ME_MINIMUM_8_CHARACTERS', `MINIO_SECRET_KEY=${secret()}`)
    .replace(
      'EMAIL_ENCRYPTION_KEY=CHANGE_ME_64_HEX_CHARACTERS',
      `EMAIL_ENCRYPTION_KEY=${secret()}`,
    );
  writeFileSync(envFile, config, { mode: 0o600, flag: 'wx' });
  console.log(`Created ${fileURLToPath(envFile)} with random local secrets.`);
}
