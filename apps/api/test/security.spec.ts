import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { loginSchema, registerSchema } from '@flowsync/contracts';
import { OriginGuard } from '../src/common/origin.guard';
import { TokenService } from '../src/modules/auth/token.service';
import { validateEnvironment, type Environment } from '../src/config/environment';

const base: Environment = {
  AI_PROVIDER: 'disabled',
  AI_MODEL: '',
  EMAIL_ENCRYPTION_KEY: 'c'.repeat(64),
  EMAIL_FROM: 'no-reply@flowsync.local',
  SMTP_URL: 'smtp://localhost:1025',
  NODE_ENV: 'test',
  API_PORT: 4010,
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/flowsync',
  REDIS_HOST: 'localhost',
  REDIS_PORT: 6379,
  REDIS_PASSWORD: 'test-only',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  JWT_ISSUER: 'flowsync-api',
  JWT_AUDIENCE: 'flowsync-web',
  MINIO_ENDPOINT: 'http://localhost:9000',
  MINIO_ACCESS_KEY: 'local-test',
  MINIO_SECRET_KEY: 'local-test-secret',
  MINIO_BUCKET: 'flowsync',
  S3_REGION: 'us-east-1',
  TRUST_PROXY_HOPS: 0,
};

describe('input contracts', () => {
  it('normalizes email and rejects weak passwords/unknown fields', () => {
    expect(
      registerSchema.parse({
        name: ' Long ',
        email: 'LONG@EXAMPLE.COM ',
        password: 'correct horse battery',
      }).email,
    ).toBe('long@example.com');
    expect(
      registerSchema.safeParse({ name: 'Long', email: 'long@example.com', password: 'short' })
        .success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({ email: 'long@example.com', password: 'valid', role: 'OWNER' })
        .success,
    ).toBe(false);
  });
});
describe('environment validation', () => {
  it('rejects placeholders, shared secrets, and insecure production origins', () => {
    expect(validateEnvironment(base).API_PORT).toBe(4010);
    expect(() =>
      validateEnvironment({ ...base, JWT_ACCESS_SECRET: 'CHANGE_ME'.repeat(8) }),
    ).toThrow('Invalid environment');
    expect(() =>
      validateEnvironment({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET }),
    ).toThrow('Token secrets must be different');
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'production' })).toThrow(
      'Production requires HTTPS',
    );
    expect(() => validateEnvironment({ ...base, WEB_URL: 'http://localhost:3000/path' })).toThrow(
      'must be an origin',
    );
    expect(() => validateEnvironment({ ...base, WEB_URL: 'not-a-url' })).toThrow(
      'Invalid environment: WEB_URL',
    );
  });
  it('never includes submitted secrets in validation errors', () => {
    const secret = 'SENSITIVE_SHORT_VALUE';
    try {
      validateEnvironment({ ...base, JWT_ACCESS_SECRET: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
describe('JWT boundaries', () => {
  const config = new ConfigService<Environment, true>(base);
  const jwt = new JwtService();
  const tokens = new TokenService(jwt, config);
  const userId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  it('separates access and refresh and hashes the persisted token', async () => {
    const issued = await tokens.issue(userId);
    expect((await tokens.verifyAccess(issued.accessToken)).sub).toBe(userId);
    expect((await tokens.verifyRefresh(issued.refreshToken)).jti).toBe(issued.record.id);
    expect(issued.record.tokenHash).toHaveLength(64);
    expect(issued.record.tokenHash).not.toBe(issued.refreshToken);
    await expect(tokens.verifyAccess(issued.refreshToken)).rejects.toThrow();
    await expect(tokens.verifyRefresh(issued.accessToken)).rejects.toThrow();
  });
  it('rejects expired, wrong audience, and wrong token types', async () => {
    const options = {
      secret: base.JWT_ACCESS_SECRET,
      issuer: base.JWT_ISSUER,
      audience: base.JWT_AUDIENCE,
    };
    await expect(
      tokens.verifyAccess(
        await jwt.signAsync({ sub: userId, type: 'access' }, { ...options, expiresIn: -1 }),
      ),
    ).rejects.toThrow();
    await expect(
      tokens.verifyAccess(
        await jwt.signAsync(
          { sub: userId, type: 'access' },
          { ...options, audience: 'other-app', expiresIn: 100 },
        ),
      ),
    ).rejects.toThrow();
    await expect(
      tokens.verifyAccess(
        await jwt.signAsync({ sub: userId, type: 'refresh' }, { ...options, expiresIn: 100 }),
      ),
    ).rejects.toThrow();
  });
});
describe('cookie endpoint origin protection', () => {
  const guard = new OriginGuard(new ConfigService<Environment, true>(base));
  const context = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', headers }) }),
    }) as unknown as ExecutionContext;
  it('allows configured origin and rejects hostile browser origins', () => {
    expect(guard.canActivate(context({ origin: base.WEB_URL }))).toBe(true);
    expect(() => guard.canActivate(context({ origin: 'https://attacker.example' }))).toThrow(
      'Untrusted',
    );
    expect(() => guard.canActivate(context({ 'sec-fetch-site': 'cross-site' }))).toThrow(
      'Untrusted',
    );
  });
});
