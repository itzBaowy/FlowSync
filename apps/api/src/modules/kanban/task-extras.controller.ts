import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  checklistInputSchema,
  checklistItemInputSchema,
  checklistItemUpdateSchema,
  labelInputSchema,
  taskVersionSchema,
} from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ApiZodBody } from '../../common/api-zod-body';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { TaskExtrasService } from './task-extras.service';
const uuid = new ZodValidationPipe(z.string().uuid());
@ApiTags('Labels and checklists')
@ApiBearerAuth()
@Controller()
@UseGuards(AccessGuard)
export class TaskExtrasController {
  constructor(private readonly extras: TaskExtrasService) {}
  @Get('projects/:projectId/labels')
  labels(@Req() req: AuthenticatedRequest, @Param('projectId', uuid) projectId: string) {
    return this.extras.labels(req.userId, projectId);
  }
  @Post('projects/:projectId/labels')
  @ApiZodBody(labelInputSchema)
  addLabel(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) projectId: string,
    @Body(new ZodValidationPipe(labelInputSchema)) body: z.infer<typeof labelInputSchema>,
  ) {
    return this.extras.addLabel(req.userId, projectId, body);
  }
  @Patch('projects/:projectId/labels/:id')
  @ApiZodBody(labelInputSchema)
  updateLabel(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) projectId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(labelInputSchema)) body: z.infer<typeof labelInputSchema>,
  ) {
    return this.extras.updateLabel(req.userId, projectId, id, body);
  }
  @Delete('projects/:projectId/labels/:id')
  removeLabel(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) projectId: string,
    @Param('id', uuid) id: string,
  ) {
    return this.extras.removeLabel(req.userId, projectId, id);
  }
  @Post('tasks/:taskId/checklists')
  @ApiZodBody(checklistInputSchema)
  addChecklist(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(checklistInputSchema)) body: z.infer<typeof checklistInputSchema>,
  ) {
    return this.extras.addChecklist(req.userId, taskId, body.title, body.expectedVersion);
  }
  @Delete('tasks/:taskId/checklists/:id')
  @ApiZodBody(taskVersionSchema)
  removeChecklist(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(taskVersionSchema)) body: z.infer<typeof taskVersionSchema>,
  ) {
    return this.extras.removeChecklist(req.userId, taskId, id, body.expectedVersion);
  }
  @Post('tasks/:taskId/checklists/:id/items')
  @ApiZodBody(checklistItemInputSchema)
  addItem(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(checklistItemInputSchema))
    body: z.infer<typeof checklistItemInputSchema>,
  ) {
    return this.extras.addItem(req.userId, taskId, id, body.text, body.expectedVersion);
  }
  @Patch('tasks/:taskId/checklist-items/:id')
  @ApiZodBody(checklistItemUpdateSchema)
  updateItem(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(checklistItemUpdateSchema))
    body: z.infer<typeof checklistItemUpdateSchema>,
  ) {
    const { expectedVersion, ...fields } = body;
    return this.extras.changeItem(req.userId, taskId, id, expectedVersion, fields);
  }
  @Delete('tasks/:taskId/checklist-items/:id')
  @ApiZodBody(taskVersionSchema)
  removeItem(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(taskVersionSchema)) body: z.infer<typeof taskVersionSchema>,
  ) {
    return this.extras.changeItem(req.userId, taskId, id, body.expectedVersion, null);
  }
}
