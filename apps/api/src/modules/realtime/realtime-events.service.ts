import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { BoardChanged } from '@flowsync/contracts';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
@Injectable()
export class RealtimeEventsService {
  private namespace?: Namespace;
  private deliver?: (event: BoardChanged) => Promise<void>;
  private notify?: (userIds: string[]) => void;
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
  ) {}
  attach(
    namespace: Namespace,
    deliver: (event: BoardChanged) => Promise<void>,
    notify: (userIds: string[]) => void,
  ) {
    this.namespace = namespace;
    this.deliver = deliver;
    this.notify = notify;
  }
  async boardChanged(event: BoardChanged) {
    if (!this.namespace || !this.deliver) return;
    // Only committed mutations call this method. Remote nodes recheck their own local sockets.
    try {
      this.namespace.serverSideEmit('internal:board', event);
      await this.deliver(event);
    } catch {
      this.logger.warn('Realtime delivery unavailable; clients recover by snapshot');
    }
  }
  async boardsChanged(where: Prisma.BoardWhereInput) {
    try {
      const boards = await this.prisma.board.findMany({
        where,
        select: { id: true, revision: true },
      });
      await Promise.all(
        boards.map((board) => this.boardChanged({ boardId: board.id, revision: board.revision })),
      );
    } catch {
      this.logger.warn('Realtime snapshot recovery required');
    }
  }
  async notificationsChanged(userIds: string[]) {
    if (!userIds.length || !this.namespace || !this.notify) return;
    try {
      this.namespace.serverSideEmit('internal:notifications', userIds);
      this.notify(userIds);
    } catch {
      this.logger.warn('Notification delivery deferred to inbox recovery');
    }
  }
}
