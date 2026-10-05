import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { RealtimeEventsService } from './realtime-events.service';
import { RealtimeGateway } from './realtime.gateway';
@Module({
  imports: [AuthModule, AuthorizationModule],
  providers: [RealtimeEventsService, RealtimeGateway],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}
