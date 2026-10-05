import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { ListQuery, OrganizationInput, OrganizationUpdate } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type Organization } from '../../generated/prisma/client';
import { PermissionService } from '../authorization/permission.service';
import type { OrganizationRole } from '@flowsync/contracts';
import { PaginatedResult } from '../../common/pagination';
import { OBJECT_STORAGE, type ObjectStorage } from '../files/storage.module';

export const organizationView = (organization: Organization, role: OrganizationRole) => ({
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  ownerId: organization.ownerId,
  allowAdminInvites: organization.allowAdminInvites,
  logoUrl: null as string | null,
  role,
  createdAt: organization.createdAt.toISOString(),
  updatedAt: organization.updatedAt.toISOString(),
});
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  async create(userId: string, input: OrganizationInput) {
    try {
      const organization = await this.prisma.organization.create({
        data: { ...input, ownerId: userId, members: { create: { userId, role: 'OWNER' } } },
      });
      return this.present(organization, 'OWNER');
    } catch (error) {
      this.conflict(error);
    }
  }
  async list(userId: string, query: ListQuery) {
    const where: Prisma.OrganizationWhereInput = {
      members: { some: { userId } },
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.organization.findMany({
          where,
          include: { members: { where: { userId }, select: { role: true } } },
          orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.organization.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(
      await Promise.all(rows.map((row) => this.present(row, row.members[0]!.role))),
      query.page,
      query.limit,
      total,
    );
  }
  async get(userId: string, id: string) {
    const member = await this.permissions.requireOrganization(userId, id, 'read');
    return this.present(member.organization, member.role);
  }
  async update(userId: string, id: string, input: OrganizationUpdate) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.permissions.lockOrganization(tx, id);
        const member = await this.permissions.requireOrganization(userId, id, 'update', tx);
        const organization = await tx.organization.update({ where: { id }, data: input });
        return this.present(organization, member.role);
      });
    } catch (error) {
      this.conflict(error);
    }
  }
  async remove(userId: string, id: string) {
    try {
      const logoKey = await this.prisma.$transaction(async (tx) => {
        await this.permissions.lockOrganization(tx, id);
        const actor = await this.permissions.requireOrganization(userId, id, 'delete', tx);
        const workspaces = await tx.workspace.count({ where: { organizationId: id } });
        const activities = await tx.activity.count({ where: { organizationId: id } });
        if (workspaces || activities)
          throw new ConflictException(
            'Remove workspaces and handle retained activity before deleting this organization',
          );
        await tx.organization.delete({ where: { id } });
        return actor.organization.logoKey;
      });
      if (logoKey) await this.storage.discard(logoKey);
      return { success: true };
    } catch (error) {
      this.conflict(error);
    }
  }
  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        throw new ConflictException('This organization slug is already in use');
      if (error.code === 'P2003')
        throw new ConflictException('Organization still has related resources');
    }
    throw error;
  }
  private async present(organization: Organization, role: OrganizationRole) {
    return {
      ...organizationView(organization, role),
      logoUrl: organization.logoKey ? await this.storage.signedUrl(organization.logoKey) : null,
    };
  }
}
