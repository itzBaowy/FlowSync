import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
