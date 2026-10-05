import {
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import {
  OrganizationGuard,
  RequireOrganizationPermission,
} from '../authorization/organization.guard';
import { LogoService } from './logo.service';
@ApiTags('Organization logo')
@ApiBearerAuth()
@Controller('organizations/:organizationId/logo')
@UseGuards(AccessGuard, OrganizationGuard)
export class LogoController {
  constructor(private readonly logos: LogoService) {}
  @Post()
  @RequireOrganizationPermission('update')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } }),
  )
  upload(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.logos.upload(request.userId, id, file);
  }
}
