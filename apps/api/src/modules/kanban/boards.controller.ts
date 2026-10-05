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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  boardInputSchema,
  boardListSchema,
  boardUpdateSchema,
  columnInputSchema,
  columnUpdateSchema,
  reorderColumnsSchema,
  type BoardInput,
} from '@flowsync/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ApiZodBody } from '../../common/api-zod-body';
import { AccessGuard, type AuthenticatedRequest } from '../auth/access.guard';
import { BoardsService } from './boards.service';
const uuid = new ZodValidationPipe(z.string().uuid());
@ApiTags('Kanban boards')
@ApiBearerAuth()
@Controller('boards')
@UseGuards(AccessGuard)
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}
  @Post()
  @ApiZodBody(boardInputSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(boardInputSchema)) body: BoardInput,
  ) {
    return this.boards.create(req.userId, body);
  }
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(boardListSchema)) query: z.infer<typeof boardListSchema>,
  ) {
    return this.boards.list(req.userId, query);
  }
  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', uuid) id: string) {
    return this.boards.snapshot(req.userId, id);
  }
  @Patch(':id')
  @ApiZodBody(boardUpdateSchema)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(boardUpdateSchema)) body: z.infer<typeof boardUpdateSchema>,
  ) {
    return this.boards.update(req.userId, id, body.name);
  }
  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id', uuid) id: string) {
    return this.boards.remove(req.userId, id);
  }
  @Post(':id/columns')
  @ApiZodBody(columnInputSchema)
  addColumn(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(columnInputSchema)) body: z.infer<typeof columnInputSchema>,
  ) {
    return this.boards.addColumn(req.userId, id, body);
  }
  @Patch(':id/columns/order')
  @ApiZodBody(reorderColumnsSchema)
  reorder(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(reorderColumnsSchema)) body: z.infer<typeof reorderColumnsSchema>,
  ) {
    return this.boards.reorderColumns(req.userId, id, body);
  }
  @Patch(':id/columns/:columnId')
  @ApiZodBody(columnUpdateSchema)
  updateColumn(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Param('columnId', uuid) columnId: string,
    @Body(new ZodValidationPipe(columnUpdateSchema)) body: z.infer<typeof columnUpdateSchema>,
  ) {
    return this.boards.updateColumn(req.userId, id, columnId, body);
  }
  @Delete(':id/columns/:columnId')
  removeColumn(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Param('columnId', uuid) columnId: string,
  ) {
    return this.boards.removeColumn(req.userId, id, columnId);
  }
}
