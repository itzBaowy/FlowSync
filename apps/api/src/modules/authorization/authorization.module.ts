import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { OrganizationGuard } from './organization.guard';
import { ScopeGuard } from './scope.guard';
@Module({
  providers: [PermissionService, OrganizationGuard, ScopeGuard],
  exports: [PermissionService, OrganizationGuard, ScopeGuard],
})
export class AuthorizationModule {}
