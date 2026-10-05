import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { invitationInputSchema, invitationTokenSchema, listQuerySchema } from '@flowsync/contracts';
import type { InvitationInput, ListQuery } from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import {
  OrganizationGuard,
  RequireOrganizationPermission,
} from '../authorization/organization.guard';
import { InvitationsService } from './invitations.service';

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(AccessGuard, OrganizationGuard)
@Controller('organizations/:organizationId/invitations')
export class OrganizationInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}
  @Post()
  @RequireOrganizationPermission('invite')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
        role: { type: 'string', enum: ['ADMIN', 'MEMBER'], default: 'MEMBER' },
      },
    },
  })
  create(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @Body(new ZodValidationPipe(invitationInputSchema)) body: InvitationInput,
  ) {
    return this.invitations.create(request.userId, id, body);
  }
  @Get()
  @RequireOrganizationPermission('invite')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.invitations.list(request.userId, id, query);
  }
  @Post(':invitationId/revoke')
  @HttpCode(200)
  @RequireOrganizationPermission('invite')
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('invitationId', new ZodValidationPipe(z.string().uuid())) id: string,
  ) {
    return this.invitations.revoke(request.userId, organizationId, id);
  }
}

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}
  @Post('preview')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token'],
      properties: { token: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    },
  })
  preview(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(invitationTokenSchema)) body: { token: string },
  ) {
    return this.invitations.preview(request.userId, body.token);
  }
  @Post('accept')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token'],
      properties: { token: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    },
  })
  accept(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(invitationTokenSchema)) body: { token: string },
  ) {
    return this.invitations.accept(request.userId, body.token);
  }
}
