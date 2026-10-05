import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { PermissionService, type OrganizationDb } from '../authorization/permission.service';

export type BoardActor = Awaited<ReturnType<KanbanAccessService['board']>>;
@Injectable()
export class KanbanAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}
  async board(
    userId: string,
    id: string,
    permission: 'read' | 'manage',
    db: OrganizationDb = this.prisma,
  ) {
    const board = await db.board.findUnique({ where: { id } });
    if (!board) throw new NotFoundException('Board not found');
    const actor = await this.permissions
      .requireProject(userId, board.projectId, permission, db)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) throw new NotFoundException('Board not found');
        throw error;
      });
    return { ...actor, board };
  }
  async column(userId: string, id: string) {
    const column = await this.prisma.column.findUnique({ where: { id } });
    if (!column) throw new NotFoundException('Column not found');
    await this.board(userId, column.boardId, 'read');
    return column;
  }
  async mutate<T>(
    userId: string,
    id: string,
    permission: 'read' | 'manage',
    run: (tx: Prisma.TransactionClient, actor: BoardActor) => Promise<T>,
    options: { expectedRevision?: number; bump?: boolean } = {},
  ) {
    // Check visibility before taking locks, then repeat authorization under the tenant lock.
    const initial = await this.board(userId, id, permission);
    return this.prisma.$transaction(
      async (tx) => {
        await this.permissions.lockProject(tx, initial.board.projectId);
        await tx.$queryRaw`SELECT id FROM "Board" WHERE id = ${id}::uuid FOR UPDATE`;
        const actor = await this.board(userId, id, permission, tx);
        if (
          options.expectedRevision !== undefined &&
          actor.board.revision !== options.expectedRevision
        )
          throw new ConflictException('Board changed. Reload and try again');
        await tx.$executeRaw`SET CONSTRAINTS "Column_boardId_position_key", "Task_columnId_position_key" DEFERRED`;
        if (options.bump !== false) {
          actor.board = await tx.board.update({
            where: { id },
            data: { revision: { increment: 1 } },
          });
        }
        return run(tx, actor);
      },
      { timeout: 15000 },
    );
  }
}
