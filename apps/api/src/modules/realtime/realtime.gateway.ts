import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Namespace, Socket } from 'socket.io';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  boardChangedSchema,
  boardRoomSchema,
  type BoardChanged,
  type BoardJoined,
} from '@flowsync/contracts';
import type { Environment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { TokenService } from '../auth/token.service';
import { PermissionService } from '../authorization/permission.service';
import { RealtimeEventsService } from './realtime-events.service';
import { PresenceService } from './presence.service';
type SocketData = {
  userId: string;
  expiresAt: number;
  boardIds: string[];
  windowAt: number;
  packets: number;
  joining: boolean;
};
type Client = Socket<
  Record<string, (...args: unknown[]) => void>,
  Record<string, (...args: unknown[]) => void>,
  Record<string, (...args: unknown[]) => void>,
  SocketData
>;
type Ack = (response: BoardJoined) => void;
@Injectable()
@WebSocketGateway({
  namespace: '/realtime',
  transports: ['websocket'],
  maxHttpBufferSize: 8192,
  pingInterval: 10000,
  pingTimeout: 5000,
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private namespace?: Namespace;
  private pub?: Redis;
  private sub?: Redis;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly prefix: string;
  private pulse?: ReturnType<typeof setInterval>;
  private pulsing = false;
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionService,
    private readonly events: RealtimeEventsService,
    private readonly presence: PresenceService,
  ) {
    this.prefix = `flowsync:${config.get('NODE_ENV', { infer: true })}:realtime`;
  }
  afterInit(namespace: Namespace) {
    this.namespace = namespace;
    this.pub = this.redis.client.duplicate();
    this.sub = this.redis.client.duplicate();
    this.pub.on('error', () => {});
    this.sub.on('error', () => {});
    namespace.server.adapter(createAdapter(this.pub, this.sub, { key: `${this.prefix}:adapter` }));
    namespace.use(async (socket, next) => {
      try {
        const origin = socket.handshake.headers.origin;
        if (origin && origin !== this.config.get('WEB_URL', { infer: true })) throw new Error();
        const ip = createHash('sha256').update(socket.handshake.address).digest('hex');
        const count = await this.redis.client.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
          1,
          `${this.prefix}:connect:${ip}`,
        );
        if (Number(count) > 60) return next(new Error('RATE_LIMITED'));
        const token: unknown = socket.handshake.auth.token;
        if (typeof token !== 'string' || token.length > 4096) throw new Error();
        const claims = await this.tokens.verifyAccess(token);
        if (
          !(await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true } }))
        )
          throw new Error();
        socket.data = {
          userId: claims.sub,
          expiresAt: claims.exp * 1000,
          boardIds: [],
          windowAt: Date.now(),
          packets: 0,
          joining: false,
        } satisfies SocketData;
        if (!(await this.presence.reserve(claims.sub, socket.id)))
          return next(new Error('RATE_LIMITED'));
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
    namespace.on('internal:board', (input: unknown) => {
      const event = boardChangedSchema.safeParse(input);
      if (event.success) void this.deliver(event.data);
    });
    const notify = (userIds: string[]) => {
      for (const socket of namespace.sockets.values() as Iterable<Client>)
        if (userIds.includes(socket.data.userId) && socket.data.expiresAt > Date.now())
          socket.emit('notification:changed', {});
    };
    const channel = `${this.prefix}:notifications`;
    this.sub.on('message', (received: string, message: string) => {
      if (received !== channel || message.length > 20000) return;
      try {
        const ids = z.array(z.string().uuid()).max(500).safeParse(JSON.parse(message));
        if (ids.success) notify(ids.data);
      } catch {
        // Only validated recipient IDs from workers reach connected clients.
      }
    });
    void this.sub.subscribe(channel).catch(() => {});
    namespace.on('internal:notifications', (input: unknown) => {
      const ids = z.array(z.string().uuid()).max(500).safeParse(input);
      if (ids.success) notify(ids.data);
    });
    this.events.attach(namespace, (event) => this.deliver(event), notify);
    namespace.on('internal:presence', (input: unknown) => {
      const parsed = boardRoomSchema.safeParse(input);
      if (parsed.success) void this.deliverPresence(parsed.data.boardId);
    });
    this.pulse = setInterval(() => {
      void this.heartbeat();
    }, 15000);
  }
  handleConnection(socket: Client) {
    this.timers.set(
      socket.id,
      setTimeout(
        () => {
          socket.emit('session:expired');
          socket.disconnect(true);
        },
        Math.max(0, socket.data.expiresAt - Date.now()),
      ),
    );
    // REST global guards/filters are HTTP-specific. Socket handlers validate/auth/rate-limit here.
    socket.on('board:join', (input: unknown, callback: unknown) => {
      const ack = typeof callback === 'function' ? (callback as Ack) : () => {};
      if (socket.data.joining)
        return ack({
          ok: false,
          code: 'RATE_LIMITED',
          message: 'Wait for the previous subscription',
        });
      socket.data.joining = true;
      void this.join(socket, input, ack).finally(() => {
        socket.data.joining = false;
      });
    });
    socket.on('board:leave', (input: unknown, callback: unknown) => {
      if (!this.allowed(socket)) return;
      const room = boardRoomSchema.safeParse(input);
      if (!room.success) return;
      socket.data.boardIds = socket.data.boardIds.filter((id) => id !== room.data.boardId);
      void socket.leave(`board:${room.data.boardId}`);
      void this.presence
        .leave(socket.data.userId, socket.id, room.data.boardId)
        .then(() => this.publishPresence(room.data.boardId))
        .catch(() => {});
      if (typeof callback === 'function') callback({ ok: true });
    });
  }
  handleDisconnect(socket: Client) {
    const timer = this.timers.get(socket.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(socket.id);
    if (socket.data.userId)
      void this.presence
        .disconnect(socket.data.userId, socket.id, socket.data.boardIds)
        .then(() => Promise.all(socket.data.boardIds.map((id) => this.publishPresence(id))))
        .catch(() => {});
  }
  private async board(userId: string, id: string) {
    const board = await this.prisma.board.findUnique({ where: { id } });
    if (!board) throw new NotFoundException();
    await this.permissions.requireProject(userId, board.projectId, 'read');
    return board;
  }
  private allowed(socket: Client) {
    if (socket.data.expiresAt <= Date.now()) {
      socket.disconnect(true);
      return false;
    }
    if (Date.now() - socket.data.windowAt >= 60000) {
      socket.data.windowAt = Date.now();
      socket.data.packets = 0;
    }
    socket.data.packets += 1;
    return socket.data.packets <= 120;
  }
  private async join(socket: Client, input: unknown, ack: Ack) {
    if (!this.allowed(socket))
      return ack({ ok: false, code: 'RATE_LIMITED', message: 'Too many realtime requests' });
    const parsed = boardRoomSchema.safeParse(input);
    if (
      !parsed.success ||
      (!socket.data.boardIds.includes(parsed.data.boardId) && socket.data.boardIds.length >= 5)
    )
      return ack({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'Choose a valid board; at most five boards per connection',
      });
    try {
      const board = await this.board(socket.data.userId, parsed.data.boardId);
      await socket.join(`board:${board.id}`);
      if (!socket.data.boardIds.includes(board.id)) socket.data.boardIds.push(board.id);
      await this.presence.touch(socket.data.userId, socket.id, socket.data.boardIds);
      ack({ ok: true, boardId: board.id, revision: board.revision });
      void this.publishPresence(board.id);
    } catch (error) {
      // A failed presence write must not leave a partial room subscription behind.
      socket.data.boardIds = socket.data.boardIds.filter((id) => id !== parsed.data.boardId);
      await socket.leave(`board:${parsed.data.boardId}`);
      await this.presence.leave(socket.data.userId, socket.id, parsed.data.boardId).catch(() => {});
      ack({
        ok: false,
        code: error instanceof NotFoundException ? 'NOT_FOUND' : 'UNAVAILABLE',
        message: 'Board unavailable',
      });
    }
  }
  private async deliver(event: BoardChanged) {
    if (!this.namespace) return;
    const recipients = [...this.namespace.sockets.values()] as Client[];
    await Promise.all(
      recipients
        .filter((socket) => socket.data.boardIds.includes(event.boardId))
        .map(async (socket) => {
          try {
            if (socket.data.expiresAt <= Date.now()) {
              socket.disconnect(true);
              return;
            }
            await this.board(socket.data.userId, event.boardId);
            if (socket.connected) socket.emit('board:changed', event);
          } catch {
            socket.data.boardIds = socket.data.boardIds.filter((id) => id !== event.boardId);
            await socket.leave(`board:${event.boardId}`);
            socket.emit('board:revoked', { boardId: event.boardId });
            await this.presence.leave(socket.data.userId, socket.id, event.boardId);
          }
        }),
    );
    await this.publishPresence(event.boardId);
  }
  private async publishPresence(boardId: string) {
    try {
      this.namespace?.serverSideEmit('internal:presence', { boardId });
      await this.deliverPresence(boardId);
    } catch {
      /* Redis leases expire if a node or transport fails. */
    }
  }
  private async deliverPresence(boardId: string) {
    try {
      const snapshot = await this.presence.snapshot(boardId);
      const clients = [...(this.namespace?.sockets.values() ?? [])] as Client[];
      await Promise.all(
        clients
          .filter((socket) => socket.data.boardIds.includes(boardId))
          .map(async (socket) => {
            try {
              await this.board(socket.data.userId, boardId);
              if (socket.connected && socket.data.expiresAt > Date.now())
                socket.emit('presence:changed', snapshot);
            } catch {
              socket.data.boardIds = socket.data.boardIds.filter((id) => id !== boardId);
              await socket.leave(`board:${boardId}`);
              await this.presence.leave(socket.data.userId, socket.id, boardId);
              socket.emit('board:revoked', { boardId });
            }
          }),
      );
    } catch {
      /* A later heartbeat replaces the presence snapshot. */
    }
  }
  private async heartbeat() {
    if (this.pulsing || !this.namespace) return;
    this.pulsing = true;
    try {
      const clients = [...this.namespace.sockets.values()] as Client[];
      for (const socket of clients)
        if (socket.connected)
          await this.presence.touch(socket.data.userId, socket.id, socket.data.boardIds);
      const boards = [...new Set(clients.flatMap((socket) => socket.data.boardIds))];
      await Promise.all(boards.map((id) => this.publishPresence(id)));
    } catch {
      /* Preserve DB access control; presence recovers after Redis reconnects. */
    } finally {
      this.pulsing = false;
    }
  }
  onModuleDestroy() {
    if (this.pulse) clearInterval(this.pulse);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.pub?.disconnect();
    this.sub?.disconnect();
  }
}
