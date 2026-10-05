import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { OrganizationGuard } from './organization.guard';
@Module({
  providers: [PermissionService, OrganizationGuard],
  exports: [PermissionService, OrganizationGuard],
})
export class AuthorizationModule {}
