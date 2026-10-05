import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
