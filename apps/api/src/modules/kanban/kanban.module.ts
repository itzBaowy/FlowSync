import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { KanbanAccessService } from './kanban-access.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [BoardsController, TasksController],
  providers: [BoardsService, KanbanAccessService, TasksService],
})
export class KanbanModule {}
