import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { InvitationsService } from './invitations.service';
import { InvitationsController, OrganizationInvitationsController } from './invitations.controller';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
    OrganizationInvitationsController,
  ],
  providers: [OrganizationsService, MembersService, InvitationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
