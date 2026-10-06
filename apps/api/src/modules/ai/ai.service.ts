import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { aiOutputSchema, type AIRequest, type ListQuery } from '@flowsync/contracts';
import type { Environment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { PermissionService } from '../authorization/permission.service';
import type { Prisma } from '../../generated/prisma/client';
import { PaginatedResult } from '../../common/pagination';
export const aiRunInclude = {
  conversation: {
    include: {
      messages: {
        where: { role: 'USER' as const },
        orderBy: { createdAt: 'asc' as const },
        take: 1,
      },
    },
  },
} as const;
export function aiRunView(row: Prisma.AIRunGetPayload<{ include: typeof aiRunInclude }>) {
  return {
    id: row.id,
    projectId: row.conversation.projectId,
    kind: row.kind,
    prompt: row.conversation.messages[0]?.content ?? '',
    status: row.status,
    output: row.output ? aiOutputSchema.parse(row.output) : null,
    error:
      row.status === 'FAILED' ? 'The assistant could not complete this request. Try again.' : null,
    confirmedTaskIds: Array.isArray(row.confirmedTaskIds) ? row.confirmedTaskIds : [],
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
@Injectable()
export class AIService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  async availability(userId: string, projectId: string) {
    await this.permissions.requireProject(userId, projectId, 'read');
    return { enabled: this.config.get('AI_PROVIDER', { infer: true }) !== 'disabled' };
  }
  async request(userId: string, projectId: string, input: AIRequest) {
    await this.permissions.requireProject(userId, projectId, 'read');
    if (this.config.get('AI_PROVIDER', { infer: true }) === 'disabled')
      throw new ServiceUnavailableException('The project assistant is not configured');
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProject(tx, projectId);
      await this.permissions.requireProject(userId, projectId, 'read', tx);
      const where = { conversation: { userId, projectId } };
      if (
        (await tx.aIRun.count({ where: { ...where, status: { in: ['PENDING', 'RUNNING'] } } })) >= 3
      )
        throw new ConflictException('Wait for your pending assistant requests');
      if (
        (await tx.aIRun.count({
          where: { ...where, createdAt: { gte: new Date(Date.now() - 86400000) } },
        })) >= 100
      )
        throw new ConflictException('Daily assistant request limit reached');
      const row = await tx.aIRun.create({
        data: {
          kind: input.kind,
          environment: this.config.get('NODE_ENV', { infer: true }),
          conversation: {
            create: {
              projectId,
              userId,
              title: input.prompt.slice(0, 120),
              messages: { create: { role: 'USER', content: input.prompt } },
            },
          },
        },
        include: aiRunInclude,
      });
      return aiRunView(row);
    });
  }
  async get(userId: string, projectId: string, id: string) {
    await this.permissions.requireProject(userId, projectId, 'read');
    const row = await this.prisma.aIRun.findFirst({
      where: { id, conversation: { userId, projectId } },
      include: aiRunInclude,
    });
    if (!row) throw new NotFoundException('Assistant request not found');
    return aiRunView(row);
  }
  async list(userId: string, projectId: string, query: ListQuery) {
    await this.permissions.requireProject(userId, projectId, 'read');
    const where = { conversation: { userId, projectId } };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.aIRun.findMany({
          where,
          include: aiRunInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        this.prisma.aIRun.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(rows.map(aiRunView), query.page, query.limit, total);
  }
}
