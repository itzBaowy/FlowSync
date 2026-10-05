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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { listQuerySchema, memberRoleSchema, transferOwnerSchema } from '@flowsync/contracts';
import type { ListQuery } from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import {
  OrganizationGuard,
  RequireOrganizationPermission,
} from '../authorization/organization.guard';
import { MembersService } from './members.service';

@ApiTags('Organization members')
@ApiBearerAuth()
@UseGuards(AccessGuard, OrganizationGuard)
@Controller('organizations/:organizationId')
export class MembersController {
  constructor(private readonly members: MembersService) {}
  @Get('members')
  @RequireOrganizationPermission('read')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.members.list(request.userId, id, query);
  }
  @Patch('members/:userId')
  @RequireOrganizationPermission('manage_members')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['role'],
      properties: { role: { type: 'string', enum: ['ADMIN', 'MEMBER'] } },
    },
  })
  updateRole(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @Param('userId', new ZodValidationPipe(z.string().uuid())) userId: string,
    @Body(new ZodValidationPipe(memberRoleSchema)) body: { role: 'ADMIN' | 'MEMBER' },
  ) {
    return this.members.updateRole(request.userId, id, userId, body.role);
  }
  @Delete('members/:userId')
  @RequireOrganizationPermission('manage_members')
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @Param('userId', new ZodValidationPipe(z.string().uuid())) userId: string,
  ) {
    return this.members.remove(request.userId, id, userId);
  }
  @Post('transfer-ownership')
  @RequireOrganizationPermission('transfer_owner')
  @ApiOperation({
    summary: 'Atomically transfer ownership to an existing member; old owner becomes ADMIN',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string', format: 'uuid' } },
    },
  })
  transfer(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @Body(new ZodValidationPipe(transferOwnerSchema)) body: { userId: string },
  ) {
    return this.members.transferOwner(request.userId, id, body.userId);
  }
}
