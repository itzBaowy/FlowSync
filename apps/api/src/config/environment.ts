import { z } from 'zod';

const secret = z
  .string()
  .min(32)
  .refine((value) => !value.startsWith('CHANGE_ME'), 'Generate a real secret with npm run setup');
export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_URL: z.url(),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_PASSWORD: z
      .string()
      .min(1)
      .refine((value) => value !== 'CHANGE_ME'),
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    JWT_ISSUER: z.string().min(1).default('flowsync-api'),
    JWT_AUDIENCE: z.string().min(1).default('flowsync-web'),
    MINIO_ENDPOINT: z.url(),
    MINIO_PUBLIC_ENDPOINT: z.url().optional(),
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z
      .string()
      .min(8)
      .refine((value) => !value.startsWith('CHANGE_ME')),
    MINIO_BUCKET: z.string().min(3),
    S3_REGION: z.string().default('us-east-1'),
    EMAIL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
    EMAIL_FROM: z.string().email().default('no-reply@flowsync.local'),
    SMTP_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .url()
        .regex(/^smtps?:\/\//)
        .default('smtp://localhost:1025'),
    ),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    AI_PROVIDER: z.enum(['disabled', 'openai', 'gemini']).default('disabled'),
    AI_MODEL: z.string().max(100).default(''),
    OPENAI_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(8).optional(),
    ),
    GEMINI_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(8).optional(),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.AI_PROVIDER !== 'disabled') {
      if (!value.AI_MODEL.trim())
        ctx.addIssue({ code: 'custom', path: ['AI_MODEL'], message: 'Choose a provider model' });
      const field = value.AI_PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
      if (!value[field])
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Selected AI provider requires an API key',
        });
    }
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Token secrets must be different',
      });
    }
    if (value.NODE_ENV === 'production' && !value.WEB_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['WEB_URL'], message: 'Production requires HTTPS' });
    }
    if (URL.canParse(value.WEB_URL) && new URL(value.WEB_URL).origin !== value.WEB_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_URL'],
        message: 'WEB_URL must be an origin without a path or trailing slash',
      });
    }
  });
export type Environment = z.infer<typeof environmentSchema>;
export function validateEnvironment(input: Record<string, unknown>): Environment {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    // Never include input values (which may contain credentials) in startup errors.
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}
