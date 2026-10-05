import 'reflect-metadata';
import { config } from 'dotenv';
import { validateEnvironment } from './config/environment';
import { startEmailWorker } from './modules/queue/email-worker';
config({ path: '../../.env', quiet: true });
async function bootstrap() {
  const worker = await startEmailWorker(validateEnvironment(process.env));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      void worker.stop().then(() => process.exit(0));
    });
}
bootstrap().catch(() => {
  console.error('Email worker startup failed; check environment and infrastructure.');
  process.exit(1);
});
