import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
requireWeb('dotenv').config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});
const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') throw new Error('Expected dev or start');
const child = spawn(
  process.execPath,
  [requireWeb.resolve('next/dist/bin/next'), mode, '--port', process.env.WEB_PORT ?? '3000'],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production' },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
