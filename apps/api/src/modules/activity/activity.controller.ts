import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { activityListSchema, type ActivityList } from '@flowsync/contracts';
import { z } from 'zod';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ActivityService } from './activity.service';
const uuid = new ZodValidationPipe(z.string().uuid());
@ApiTags('Activity')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}
  @Get('projects/:id/activities')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(activityListSchema)) query: ActivityList,
  ) {
    return this.activity.list(req.userId, id, query);
  }
  @Get('tasks/:id/activities')
  task(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(activityListSchema)) query: ActivityList,
  ) {
    return this.activity.task(req.userId, id, query);
  }
}
