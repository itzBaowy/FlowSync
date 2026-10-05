import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  notificationListSchema,
  notificationReadSchema,
  type NotificationList,
} from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ApiZodBody } from '../../common/api-zod-body';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { NotificationsService } from './notifications.service';
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AccessGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(notificationListSchema)) query: NotificationList,
  ) {
    return this.notifications.list(req.userId, query);
  }
  @Get('unread-count')
  count(@Req() req: AuthenticatedRequest) {
    return this.notifications.count(req.userId);
  }
  @Post('read-all')
  readAll(@Req() req: AuthenticatedRequest) {
    return this.notifications.markAll(req.userId);
  }
  @Patch(':id/read')
  @ApiZodBody(notificationReadSchema)
  read(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ZodValidationPipe(z.string().uuid())) id: string,
    @Body(new ZodValidationPipe(notificationReadSchema)) body: { read: boolean },
  ) {
    return this.notifications.mark(req.userId, id, body.read);
  }
}
