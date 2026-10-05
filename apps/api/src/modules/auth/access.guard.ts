import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from './token.service';
import { PinoLogger } from 'nestjs-pino';

export type AuthenticatedRequest = Request & { userId: string };
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly logger: PinoLogger,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('Authentication required');
    const claims = await this.tokens.verifyAccess(authorization.slice(7));
    request.userId = claims.sub;
    this.logger.assign({ userId: claims.sub });
    return true;
  }
}
