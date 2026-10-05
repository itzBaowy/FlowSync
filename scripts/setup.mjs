import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const envFile = new URL('.env', root);
if (existsSync(envFile)) {
  console.log('.env already exists; keeping your configuration.');
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
    .replace('MINIO_SECRET_KEY=CHANGE_ME_MINIMUM_8_CHARACTERS', `MINIO_SECRET_KEY=${secret()}`);
  writeFileSync(envFile, config, { mode: 0o600, flag: 'wx' });
  console.log(`Created ${fileURLToPath(envFile)} with random local secrets.`);
}
