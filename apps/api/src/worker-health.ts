import { readFileSync } from 'node:fs';
import { workerHeartbeatFile } from './worker-heartbeat';

try {
  const timestamp = Number(readFileSync(workerHeartbeatFile, 'utf8'));
  const age = Date.now() - timestamp;
  process.exitCode = Number.isFinite(timestamp) && age >= 0 && age < 30000 ? 0 : 1;
} catch {
  process.exitCode = 1;
}
