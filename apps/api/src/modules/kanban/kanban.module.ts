import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { KanbanAccessService } from './kanban-access.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskExtrasController } from './task-extras.controller';
import { TaskExtrasService } from './task-extras.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [AuthModule, AuthorizationModule, RealtimeModule, NotificationsModule],
  controllers: [BoardsController, TasksController, TaskExtrasController],
  providers: [BoardsService, KanbanAccessService, TasksService, TaskExtrasService],
})
export class KanbanModule {}
