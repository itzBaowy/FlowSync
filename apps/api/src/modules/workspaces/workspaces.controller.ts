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
  scopeMemberInputSchema,
  workspaceInputSchema,
  workspaceListSchema,
  workspaceUpdateSchema,
  type ListQuery,
  type WorkspaceInput,
  type WorkspaceList,
  type WorkspaceUpdate,
} from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { RequireScope, ScopeGuard } from '../authorization/scope.guard';
import { WorkspacesService } from './workspaces.service';
const uuid = new ZodValidationPipe(z.string().uuid());
@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller('workspaces')
@UseGuards(AccessGuard, ScopeGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}
  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      required: ['organizationId', 'name', 'slug'],
      properties: {
        organizationId: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string', nullable: true },
        icon: { type: 'string', nullable: true },
      },
    },
  })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(workspaceInputSchema)) body: WorkspaceInput,
  ) {
    return this.workspaces.create(req.userId, body);
  }
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(workspaceListSchema)) query: WorkspaceList,
  ) {
    return this.workspaces.list(req.userId, query);
  }
  @Get(':workspaceId')
  @RequireScope('workspace', 'read')
  get(@Req() req: AuthenticatedRequest, @Param('workspaceId', uuid) id: string) {
    return this.workspaces.get(req.userId, id);
  }
  @Patch(':workspaceId')
  @RequireScope('workspace', 'manage')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string', nullable: true },
        icon: { type: 'string', nullable: true },
      },
    },
  })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', uuid) id: string,
    @Body(new ZodValidationPipe(workspaceUpdateSchema)) body: WorkspaceUpdate,
  ) {
    return this.workspaces.update(req.userId, id, body);
  }
  @Delete(':workspaceId')
  @RequireScope('workspace', 'manage')
  remove(@Req() req: AuthenticatedRequest, @Param('workspaceId', uuid) id: string) {
    return this.workspaces.remove(req.userId, id);
  }
  @Get(':workspaceId/members')
  @RequireScope('workspace', 'read')
  members(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', uuid) id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.workspaces.members(req.userId, id, query);
  }
  @Post(':workspaceId/members')
  @RequireScope('workspace', 'manage')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string', format: 'uuid' } },
    },
  })
  addMember(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', uuid) id: string,
    @Body(new ZodValidationPipe(scopeMemberInputSchema)) body: { userId: string },
  ) {
    return this.workspaces.addMember(req.userId, id, body.userId);
  }
  @Delete(':workspaceId/members/:userId')
  @RequireScope('workspace', 'manage')
  removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ) {
    return this.workspaces.removeMember(req.userId, id, userId);
  }
}
