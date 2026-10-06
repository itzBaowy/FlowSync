import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
export async function startTestApi(overrides: Record<string, string> = {}) {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const processHandle: ChildProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, ...overrides, NODE_ENV: 'test', API_PORT: String(port) },
    stdio: 'ignore',
  });
  for (let index = 0; index < 150; index++) {
    if (processHandle.exitCode !== null)
      throw new Error('Test API exited; check infrastructure and environment');
    try {
      if ((await fetch(`${baseUrl}/health/live`)).ok)
        return { baseUrl, stop: () => processHandle.kill() };
    } catch {
      /* startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  processHandle.kill();
  throw new Error('Test API startup timed out');
}
