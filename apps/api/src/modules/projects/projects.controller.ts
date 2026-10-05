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
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import {
  listQuerySchema,
  projectInputSchema,
  projectUpdateSchema,
  projectListSchema,
  scopeMemberInputSchema,
  type ListQuery,
  type ProjectInput,
  type ProjectList,
  type ProjectUpdate,
} from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { RequireScope, ScopeGuard } from '../authorization/scope.guard';
import { ProjectsService } from './projects.service';
const uuid = new ZodValidationPipe(z.string().uuid());
const fields = {
  name: { type: 'string' },
  description: { type: 'string', nullable: true },
  status: {
    type: 'string',
    enum: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as string[],
  },
  startDate: { type: 'string', format: 'date-time', nullable: true },
  dueDate: { type: 'string', format: 'date-time', nullable: true },
} as const;
@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(AccessGuard, ScopeGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      required: ['workspaceId', 'name'],
      properties: { workspaceId: { type: 'string', format: 'uuid' }, ...fields },
    },
  })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(projectInputSchema)) body: ProjectInput,
  ) {
    return this.projects.create(req.userId, body);
  }
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(projectListSchema)) query: ProjectList,
  ) {
    return this.projects.list(req.userId, query);
  }
  @Get(':projectId')
  @RequireScope('project', 'read')
  get(@Req() req: AuthenticatedRequest, @Param('projectId', uuid) id: string) {
    return this.projects.get(req.userId, id);
  }
  @Patch(':projectId')
  @RequireScope('project', 'manage')
  @ApiBody({ schema: { type: 'object', properties: fields } })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) id: string,
    @Body(new ZodValidationPipe(projectUpdateSchema)) body: ProjectUpdate,
  ) {
    return this.projects.update(req.userId, id, body);
  }
  @Delete(':projectId')
  @RequireScope('project', 'manage')
  remove(@Req() req: AuthenticatedRequest, @Param('projectId', uuid) id: string) {
    return this.projects.remove(req.userId, id);
  }
  @Get(':projectId/overview')
  @RequireScope('project', 'read')
  overview(@Req() req: AuthenticatedRequest, @Param('projectId', uuid) id: string) {
    return this.projects.overview(req.userId, id);
  }
  @Get(':projectId/members')
  @RequireScope('project', 'read')
  members(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.projects.members(req.userId, id, query);
  }
  @Post(':projectId/members')
  @RequireScope('project', 'manage')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string', format: 'uuid' } },
    },
  })
  addMember(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) id: string,
    @Body(new ZodValidationPipe(scopeMemberInputSchema)) body: { userId: string },
  ) {
    return this.projects.addMember(req.userId, id, body.userId);
  }
  @Delete(':projectId/members/:userId')
  @RequireScope('project', 'manage')
  removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ) {
    return this.projects.removeMember(req.userId, id, userId);
  }
  @Post(':projectId/transfer-ownership')
  @RequireScope('project', 'manage')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string', format: 'uuid' } },
    },
  })
  transfer(
    @Req() req: AuthenticatedRequest,
    @Param('projectId', uuid) id: string,
    @Body(new ZodValidationPipe(scopeMemberInputSchema)) body: { userId: string },
  ) {
    return this.projects.transfer(req.userId, id, body.userId);
  }
}
