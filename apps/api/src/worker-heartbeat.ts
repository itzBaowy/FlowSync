import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const workerHeartbeatFile = join(tmpdir(), 'flowsync-worker-heartbeat');
export function startWorkerHeartbeat() {
  const beat = () => writeFileSync(workerHeartbeatFile, String(Date.now()), { mode: 0o600 });
  beat();
  const timer = setInterval(() => {
    try {
      beat();
    } catch {
      console.error(JSON.stringify({ event: 'jobs.heartbeat_failed' }));
      process.kill(process.pid, 'SIGTERM');
    }
  }, 10000);
  timer.unref();
  return () => {
    clearInterval(timer);
    rmSync(workerHeartbeatFile, { force: true });
  };
}
