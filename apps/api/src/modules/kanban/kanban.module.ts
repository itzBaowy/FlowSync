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
import { ActivityModule } from '../activity/activity.module';
import { CommentsController } from '../collaboration/comments.controller';
import { CommentsService } from '../collaboration/comments.service';
import { AttachmentsController } from '../files/attachments.controller';
import { AttachmentsService } from '../files/attachments.service';
import { FileCleanupModule } from '../files/file-cleanup.module';
import { StorageModule } from '../files/storage.module';
@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    RealtimeModule,
    NotificationsModule,
    ActivityModule,
    StorageModule,
    FileCleanupModule,
  ],
  controllers: [
    BoardsController,
    TasksController,
    TaskExtrasController,
    CommentsController,
    AttachmentsController,
  ],
  providers: [
    BoardsService,
    KanbanAccessService,
    TasksService,
    TaskExtrasService,
    CommentsService,
    AttachmentsService,
  ],
})
export class KanbanModule {}
