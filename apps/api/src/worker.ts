import 'reflect-metadata';
import { config } from 'dotenv';
import { validateEnvironment } from './config/environment';
import { startEmailWorker } from './modules/queue/email-worker';
import { startBackgroundWorker } from './modules/queue/background-worker';
config({ path: '../../.env', quiet: true });
async function bootstrap() {
  const env = validateEnvironment(process.env);
  const worker = await startEmailWorker(env);
  const background = await startBackgroundWorker(env).catch(async (error: unknown) => {
    await worker.stop();
    throw error;
  });
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      void Promise.all([worker.stop(), background.stop()]).then(() => process.exit(0));
    });
}
bootstrap().catch(() => {
  console.error('Worker startup failed; check environment and infrastructure.');
  process.exit(1);
});
