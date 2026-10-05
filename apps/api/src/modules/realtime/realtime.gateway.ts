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
type SocketData = {
  userId: string;
  expiresAt: number;
  boardIds: string[];
  windowAt: number;
  packets: number;
};
type Client = Socket<
  Record<string, (...args: unknown[]) => void>,
  Record<string, (...args: unknown[]) => void>,
  Record<string, (...args: unknown[]) => void>,
  SocketData
>;
type Ack = (response: BoardJoined) => void;
@Injectable()
@WebSocketGateway({ namespace: '/realtime', transports: ['websocket'], maxHttpBufferSize: 8192 })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private namespace?: Namespace;
  private pub?: Redis;
  private sub?: Redis;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly prefix: string;
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionService,
    private readonly events: RealtimeEventsService,
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
        } satisfies SocketData;
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
    namespace.on('internal:board', (input: unknown) => {
      const event = boardChangedSchema.safeParse(input);
      if (event.success) void this.deliver(event.data);
    });
    this.events.attach(namespace, (event) => this.deliver(event));
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
      void this.join(socket, input, typeof callback === 'function' ? (callback as Ack) : () => {});
    });
    socket.on('board:leave', (input: unknown, callback: unknown) => {
      const room = boardRoomSchema.safeParse(input);
      if (!room.success) return;
      socket.data.boardIds = socket.data.boardIds.filter((id) => id !== room.data.boardId);
      void socket.leave(`board:${room.data.boardId}`);
      if (typeof callback === 'function') callback({ ok: true });
    });
  }
  handleDisconnect(socket: Client) {
    const timer = this.timers.get(socket.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(socket.id);
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
      ack({ ok: true, boardId: board.id, revision: board.revision });
    } catch (error) {
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
          }
        }),
    );
  }
  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.pub?.disconnect();
    this.sub?.disconnect();
  }
}
