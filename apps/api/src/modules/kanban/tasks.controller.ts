import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  taskArchiveSchema,
  taskInputSchema,
  taskListSchema,
  taskMoveSchema,
  taskUpdateSchema,
  taskVersionSchema,
  type TaskInput,
  type TaskList,
  type TaskMove,
  type TaskUpdate,
} from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ApiZodBody } from '../../common/api-zod-body';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { TasksService } from './tasks.service';
const uuid = new ZodValidationPipe(z.string().uuid());
@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
@UseGuards(AccessGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Post()
  @ApiZodBody(taskInputSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(taskInputSchema)) body: TaskInput,
  ) {
    return this.tasks.create(req.userId, body);
  }
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(taskListSchema)) query: TaskList,
  ) {
    return this.tasks.list(req.userId, query);
  }
  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', uuid) id: string) {
    return this.tasks.get(req.userId, id);
  }
  @Patch(':id')
  @ApiZodBody(taskUpdateSchema)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(taskUpdateSchema)) body: TaskUpdate,
  ) {
    return this.tasks.update(req.userId, id, body);
  }
  @Patch(':id/move')
  @ApiZodBody(taskMoveSchema)
  move(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(taskMoveSchema)) body: TaskMove,
  ) {
    return this.tasks.move(req.userId, id, body);
  }
  @Patch(':id/archive')
  @ApiZodBody(taskArchiveSchema)
  archive(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(taskArchiveSchema)) body: z.infer<typeof taskArchiveSchema>,
  ) {
    return this.tasks.archive(req.userId, id, body.archived, body.expectedVersion);
  }
  @Delete(':id')
  @ApiZodBody(taskVersionSchema)
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(taskVersionSchema)) body: z.infer<typeof taskVersionSchema>,
  ) {
    return this.tasks.remove(req.userId, id, body.expectedVersion);
  }
}
