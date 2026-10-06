import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { KanbanModule } from '../kanban/kanban.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityModule } from '../activity/activity.module';
@Module({
  imports: [AuthModule, AuthorizationModule, KanbanModule, NotificationsModule, ActivityModule],
  controllers: [AIController],
  providers: [AIService],
})
export class AIModule {}
