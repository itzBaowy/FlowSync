import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/access.guard';
import { PermissionService } from './permission.service';
import type { OrganizationPermission } from './organization.policy';

const KEY = 'organization:permission';
export const RequireOrganizationPermission = (permission: OrganizationPermission) =>
  SetMetadata(KEY, permission);
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<OrganizationPermission | undefined>(KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const parsed = z.string().uuid().safeParse(request.params.organizationId);
    if (!parsed.success) throw new BadRequestException('Invalid organization ID');
    await this.permissions.requireOrganization(request.userId, parsed.data, permission);
    return true;
  }
}
