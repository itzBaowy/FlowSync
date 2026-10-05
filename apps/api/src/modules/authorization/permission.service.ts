import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { canAccessOrganization, type OrganizationPermission } from './organization.policy';

export type OrganizationDb = PrismaService | Prisma.TransactionClient;
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}
  async requireOrganization(
    userId: string,
    organizationId: string,
    permission: OrganizationPermission,
    db: OrganizationDb = this.prisma,
  ) {
    const membership = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { organization: true },
    });
    // Missing resource and missing membership share the same response to prevent tenant enumeration.
    if (!membership) throw new NotFoundException('Organization not found');
    const allowed = canAccessOrganization(
      membership.role,
      permission,
      membership.organization.allowAdminInvites,
    );
    if (!allowed) throw new ForbiddenException('You do not have permission for this action');
    return membership;
  }
  async lockOrganization(db: Prisma.TransactionClient, id: string) {
    await db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${id}::uuid FOR UPDATE`;
  }
}
