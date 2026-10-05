import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
const LEASE = 45000;
@Injectable()
export class PresenceService {
  private readonly prefix: string;
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.prefix = `flowsync:${config.get('NODE_ENV', { infer: true })}:presence`;
  }
  async reserve(userId: string, socketId: string) {
    const now = Date.now();
    return (
      Number(
        await this.redis.client.eval(
          "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1])>=10 then return 0 end; redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('EXPIRE',KEYS[1],60); return 1",
          1,
          `${this.prefix}:connections:${userId}`,
          now,
          now + LEASE,
          socketId,
        ),
      ) === 1
    );
  }
  async touch(userId: string, socketId: string, boardIds: string[]) {
    const transaction = this.redis.client.multi();
    transaction
      .zadd(`${this.prefix}:connections:${userId}`, Date.now() + LEASE, socketId)
      .expire(`${this.prefix}:connections:${userId}`, 60);
    for (const id of boardIds)
      transaction
        .zadd(`${this.prefix}:board:${id}`, Date.now() + LEASE, `${userId}:${socketId}`)
        .expire(`${this.prefix}:board:${id}`, 60);
    await transaction.exec();
  }
  async leave(userId: string, socketId: string, boardId: string) {
    await this.redis.client.zrem(`${this.prefix}:board:${boardId}`, `${userId}:${socketId}`);
  }
  async disconnect(userId: string, socketId: string, boardIds: string[]) {
    const transaction = this.redis.client
      .multi()
      .zrem(`${this.prefix}:connections:${userId}`, socketId);
    for (const id of boardIds)
      transaction.zrem(`${this.prefix}:board:${id}`, `${userId}:${socketId}`);
    await transaction.exec();
  }
  async snapshot(boardId: string) {
    const key = `${this.prefix}:board:${boardId}`;
    await this.redis.client.zremrangebyscore(key, '-inf', Date.now());
    const leases = await this.redis.client.zrange(key, 0, -1);
    const ids = [...new Set(leases.map((entry) => entry.split(':')[0]!))];
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      include: {
        project: { select: { workspaceId: true, workspace: { select: { organizationId: true } } } },
      },
    });
    if (!board || !ids.length) return { boardId, members: [], totalOnline: 0 };
    const where = {
      id: { in: ids },
      organizations: { some: { organizationId: board.project.workspace.organizationId } },
      OR: [
        {
          organizations: {
            some: {
              organizationId: board.project.workspace.organizationId,
              role: { in: ['OWNER', 'ADMIN'] as ('OWNER' | 'ADMIN')[] },
            },
          },
        },
        {
          workspaces: { some: { workspaceId: board.project.workspaceId } },
          projects: { some: { projectId: board.projectId } },
        },
      ],
    };
    const [members, totalOnline] = await this.prisma.$transaction(
      [
        this.prisma.user.findMany({
          where,
          take: 200,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, avatarUrl: true },
        }),
        this.prisma.user.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { boardId, members, totalOnline };
  }
}
