import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Environment } from '../../config/environment';

const accessClaims = z.object({
  sub: z.string().uuid(),
  type: z.literal('access'),
  exp: z.number().int().positive(),
});
const refreshClaims = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  jti: z.string().uuid(),
  type: z.literal('refresh'),
});
export const ACCESS_TTL = 15 * 60;
export const REFRESH_TTL = 7 * 24 * 60 * 60;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  async issue(userId: string, familyId: string = randomUUID()) {
    const id = randomUUID();
    const common = {
      issuer: this.config.get('JWT_ISSUER', { infer: true }),
      audience: this.config.get('JWT_AUDIENCE', { infer: true }),
      algorithm: 'HS256' as const,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, type: 'access' },
        {
          ...common,
          secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
          expiresIn: ACCESS_TTL,
        },
      ),
      this.jwt.signAsync(
        { sub: userId, sid: familyId, jti: id, type: 'refresh' },
        {
          ...common,
          secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
          expiresIn: REFRESH_TTL,
        },
      ),
    ]);
    return {
      accessToken,
      refreshToken,
      record: {
        id,
        familyId,
        userId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
      },
    };
  }
  private async verify(token: string, refresh: boolean): Promise<unknown> {
    try {
      return await this.jwt.verifyAsync(token, {
        secret: this.config.get(refresh ? 'JWT_REFRESH_SECRET' : 'JWT_ACCESS_SECRET', {
          infer: true,
        }),
        issuer: this.config.get('JWT_ISSUER', { infer: true }),
        audience: this.config.get('JWT_AUDIENCE', { infer: true }),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
  async verifyAccess(token: string) {
    const parsed = accessClaims.safeParse(await this.verify(token, false));
    if (!parsed.success) throw new UnauthorizedException('Invalid access token');
    return parsed.data;
  }
  async verifyRefresh(token: string) {
    const parsed = refreshClaims.safeParse(await this.verify(token, true));
    if (!parsed.success) throw new UnauthorizedException('Invalid refresh token');
    return parsed.data;
  }
}
