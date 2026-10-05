import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation/validation do not connect; migrations require a real DATABASE_URL.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://localhost/flowsync' },
});
