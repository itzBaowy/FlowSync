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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  listQuerySchema,
  organizationInputSchema,
  updateOrganizationSchema,
} from '@flowsync/contracts';
import type { ListQuery, OrganizationInput, OrganizationUpdate } from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import {
  OrganizationGuard,
  RequireOrganizationPermission,
} from '../authorization/organization.guard';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(AccessGuard, OrganizationGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}
  @Post()
  @ApiOperation({ summary: 'Create organization and OWNER membership atomically' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'slug'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 120 },
        slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        allowAdminInvites: { type: 'boolean', default: true },
      },
    },
  })
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(organizationInputSchema)) body: OrganizationInput,
  ) {
    return this.organizations.create(request.userId, body);
  }
  @Get()
  @ApiOperation({ summary: 'List organizations visible to current user' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['name', 'createdAt'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.organizations.list(request.userId, query);
  }
  @Get(':organizationId')
  @RequireOrganizationPermission('read')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ZodValidationPipe(z.string().uuid())) id: string,
  ) {
    return this.organizations.get(request.userId, id);
  }
  @Patch(':organizationId')
  @RequireOrganizationPermission('update')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        allowAdminInvites: { type: 'boolean' },
      },
    },
  })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: OrganizationUpdate,
  ) {
    return this.organizations.update(request.userId, id, body);
  }
  @Delete(':organizationId')
  @RequireOrganizationPermission('delete')
  remove(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string) {
    return this.organizations.remove(request.userId, id);
  }
}
