import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { BoardChanged } from '@flowsync/contracts';
import { PinoLogger } from 'nestjs-pino';
@Injectable()
export class RealtimeEventsService {
  private namespace?: Namespace;
  private deliver?: (event: BoardChanged) => Promise<void>;
  constructor(private readonly logger: PinoLogger) {}
  attach(namespace: Namespace, deliver: (event: BoardChanged) => Promise<void>) {
    this.namespace = namespace;
    this.deliver = deliver;
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
}
