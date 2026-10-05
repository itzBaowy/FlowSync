import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Environment } from '../config/environment';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Environment, true>) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const origin = request.headers.origin;
    if (
      (origin && origin !== this.config.get('WEB_URL', { infer: true })) ||
      (!origin && request.headers['sec-fetch-site'] === 'cross-site')
    ) {
      throw new ForbiddenException('Untrusted request origin');
    }
    return true;
  }
}
