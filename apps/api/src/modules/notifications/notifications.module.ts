import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
@Module({
  imports: [AuthModule, AuthorizationModule, RealtimeModule],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
