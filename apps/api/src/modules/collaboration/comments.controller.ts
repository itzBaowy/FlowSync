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
  commentInputSchema,
  commentUpdateSchema,
  commentVersionSchema,
  commentListSchema,
  type CommentList,
} from '@flowsync/contracts';
import { z } from 'zod';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ApiZodBody } from '../../common/api-zod-body';
import { CommentsService } from './comments.service';
const uuid = new ZodValidationPipe(z.string().uuid());
@ApiTags('Comments')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('tasks/:taskId/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(commentListSchema)) query: CommentList,
  ) {
    return this.comments.list(req.userId, taskId, query);
  }
  @Post()
  @ApiZodBody(commentInputSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(commentInputSchema)) body: { text: string },
  ) {
    return this.comments.create(req.userId, taskId, body.text);
  }
  @Patch(':id')
  @ApiZodBody(commentUpdateSchema)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(commentUpdateSchema))
    body: { text: string; expectedVersion: number },
  ) {
    return this.comments.update(req.userId, taskId, id, body.text, body.expectedVersion);
  }
  @Delete(':id')
  @ApiZodBody(commentVersionSchema)
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(commentVersionSchema)) body: { expectedVersion: number },
  ) {
    return this.comments.remove(req.userId, taskId, id, body.expectedVersion);
  }
}
