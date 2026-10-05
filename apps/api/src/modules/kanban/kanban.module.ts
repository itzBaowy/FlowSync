import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { KanbanAccessService } from './kanban-access.service';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [BoardsController],
  providers: [BoardsService, KanbanAccessService],
})
export class KanbanModule {}
