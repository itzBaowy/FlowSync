import {
  BadRequestException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/access.guard';
import { PermissionService } from './permission.service';
const SCOPE = Symbol('scope-permission');
type Scope = { kind: 'workspace' | 'project'; permission: 'read' | 'manage' };
export const RequireScope = (kind: Scope['kind'], permission: Scope['permission']) =>
  SetMetadata(SCOPE, { kind, permission });
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const scope = this.reflector.getAllAndOverride<Scope | undefined>(SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = request.params[`${scope.kind}Id`];
    if (!z.string().uuid().safeParse(id).success)
      throw new BadRequestException('Invalid resource ID');
    if (scope.kind === 'workspace')
      await this.permissions.requireWorkspace(request.userId, id as string, scope.permission);
    else await this.permissions.requireProject(request.userId, id as string, scope.permission);
    return true;
  }
}
