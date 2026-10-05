import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  searchQuerySchema,
  myTasksQuerySchema,
  type SearchQuery,
  type MyTasksQuery,
} from '@flowsync/contracts';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { DiscoveryService } from './discovery.service';
@ApiTags('Search and dashboard')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}
  @Get('search')
  search(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ) {
    return this.discovery.search(req.userId, query);
  }
  @Get('me/tasks')
  tasks(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(myTasksQuerySchema)) query: MyTasksQuery,
  ) {
    return this.discovery.myTasks(req.userId, query);
  }
  @Get('dashboard')
  dashboard(@Req() req: AuthenticatedRequest) {
    return this.discovery.dashboard(req.userId);
  }
}
