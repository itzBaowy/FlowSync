import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  aiRequestSchema,
  aiConfirmSchema,
  type AIConfirm,
  listQuerySchema,
  type AIRequest,
  type ListQuery,
} from '@flowsync/contracts';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ApiZodBody } from '../../common/api-zod-body';
import { AIService } from './ai.service';
@ApiTags('Project assistant')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('projects/:projectId/ai')
export class AIController {
  constructor(private readonly ai: AIService) {}
  @Get('availability')
  availability(
    @Req() request: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.ai.availability(request.userId!, projectId);
  }
  @Post('requests')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiZodBody(aiRequestSchema)
  create(
    @Req() request: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(aiRequestSchema)) input: AIRequest,
  ) {
    return this.ai.request(request.userId!, projectId, input);
  }
  @Get('requests')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.ai.list(request.userId!, projectId, query);
  }
  @Get('requests/:id')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ai.get(request.userId!, projectId, id);
  }
  @Post('requests/:id/confirm')
  @ApiZodBody(aiConfirmSchema)
  confirm(
    @Req() request: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(aiConfirmSchema)) input: AIConfirm,
  ) {
    return this.ai.confirm(request.userId, projectId, id, input);
  }
}
