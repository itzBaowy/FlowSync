import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { attachmentListSchema, type AttachmentList } from '@flowsync/contracts';
import { z } from 'zod';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AttachmentsService } from './attachments.service';
import { MAX_ATTACHMENT_SIZE } from './attachment-validation';
const uuid = new ZodValidationPipe(z.string().uuid());
@ApiTags('Attachments')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('tasks/:taskId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(attachmentListSchema)) query: AttachmentList,
  ) {
    return this.attachments.list(req.userId, taskId, query);
  }
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1, fields: 0, parts: 1 },
    }),
  )
  upload(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.attachments.upload(req.userId, taskId, file);
  }
  @Get(':id/download')
  download(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
  ) {
    return this.attachments.download(req.userId, taskId, id);
  }
  @Delete(':id')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('taskId', uuid) taskId: string,
    @Param('id', uuid) id: string,
  ) {
    return this.attachments.remove(req.userId, taskId, id);
  }
}
