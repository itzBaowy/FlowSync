import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { InvitationsService } from './invitations.service';
import { InvitationsController, OrganizationInvitationsController } from './invitations.controller';
import { StorageModule } from '../files/storage.module';
import { LogoController } from './logo.controller';
import { LogoService } from './logo.service';
import { RealtimeModule } from '../realtime/realtime.module';
@Module({
  imports: [AuthModule, AuthorizationModule, StorageModule, RealtimeModule],
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
    OrganizationInvitationsController,
    LogoController,
  ],
  providers: [OrganizationsService, MembersService, InvitationsService, LogoService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
