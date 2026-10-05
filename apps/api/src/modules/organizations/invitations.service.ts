import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { InvitationInput, ListQuery } from '@flowsync/contracts';
import type { Environment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type Invitation } from '../../generated/prisma/client';
import { PaginatedResult } from '../../common/pagination';
import { PermissionService } from '../authorization/permission.service';
import { canAccessOrganization } from '../authorization/organization.policy';
import { encryptInvitation } from '../queue/invitation-payload';
import { organizationView } from './organizations.service';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const view = (invite: Invitation) => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  status: invite.status === 'PENDING' && invite.expiresAt <= new Date() ? 'EXPIRED' : invite.status,
  expiresAt: invite.expiresAt.toISOString(),
  createdAt: invite.createdAt.toISOString(),
});
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  async create(actorId: string, organizationId: string, input: InvitationInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.permissions.lockOrganization(tx, organizationId);
        const actor = await this.permissions.requireOrganization(
          actorId,
          organizationId,
          'invite',
          tx,
        );
        if (actor.role !== 'OWNER' && input.role === 'ADMIN')
          throw new ForbiddenException('Only the owner can invite an admin');
        const user = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (
          user &&
          (await tx.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId: user.id } },
          }))
        )
          throw new ConflictException('This user is already a member');
        await tx.invitation.updateMany({
          where: {
            organizationId,
            email: input.email,
            status: 'PENDING',
            expiresAt: { lte: new Date() },
          },
          data: { status: 'EXPIRED' },
        });
        const token = randomBytes(32).toString('hex');
        const inviter = await tx.user.findUniqueOrThrow({
          where: { id: actorId },
          select: { name: true },
        });
        const payload = encryptInvitation(
          {
            token,
            email: input.email,
            organizationName: actor.organization.name,
            inviterName: inviter.name,
          },
          this.config.get('EMAIL_ENCRYPTION_KEY', { infer: true }),
        );
        const invite = await tx.invitation.create({
          data: {
            organizationId,
            email: input.email,
            role: input.role ?? 'MEMBER',
            tokenHash: hashToken(token),
            invitedById: actorId,
            expiresAt: new Date(Date.now() + 7 * 86400000),
            delivery: { create: { encryptedPayload: payload } },
          },
        });
        return view(invite);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('A pending invitation already exists for this email');
      throw error;
    }
  }
  async list(actorId: string, organizationId: string, query: ListQuery) {
    await this.permissions.requireOrganization(actorId, organizationId, 'invite');
    const where: Prisma.InvitationWhereInput = {
      organizationId,
      ...(query.search ? { email: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.invitation.findMany({
          where,
          orderBy: [
            { [query.sort === 'name' ? 'email' : 'createdAt']: query.order },
            { id: 'asc' },
          ],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.invitation.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PaginatedResult(rows.map(view), query.page, query.limit, total);
  }
  async revoke(actorId: string, organizationId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.lockOrganization(tx, organizationId);
      await this.permissions.requireOrganization(actorId, organizationId, 'invite', tx);
      const invite = await tx.invitation.findUnique({ where: { id } });
      if (!invite || invite.organizationId !== organizationId)
        throw new NotFoundException('Invitation not found');
      if (invite.status !== 'PENDING')
        throw new ConflictException('This invitation is no longer pending');
      await tx.invitation.update({ where: { id }, data: { status: 'REVOKED' } });
      await tx.emailOutbox.updateMany({
        where: { invitationId: id },
        data: { encryptedPayload: null },
      });
      return { success: true };
    });
  }
  async preview(actorId: string, token: string) {
    const invite = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: { select: { name: true } } },
    });
    if (!invite) throw new NotFoundException('Invitation not found');
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { email: true },
    });
    if (actor?.email !== invite.email)
      throw new ForbiddenException('Sign in with the invited email');
    if (invite.status !== 'PENDING')
      throw new ConflictException('This invitation is no longer pending');
    if (invite.expiresAt <= new Date()) throw new GoneException('Invitation expired');
    return {
      organizationName: invite.organization.name,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }
  async accept(actorId: string, token: string) {
    const tokenHash = hashToken(token);
    const initial = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      select: { organizationId: true },
    });
    if (!initial) throw new NotFoundException('Invitation not found');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.permissions.lockOrganization(tx, initial.organizationId);
      const invite = await tx.invitation.findUnique({
        where: { tokenHash },
        include: { organization: true },
      });
      if (!invite) throw new NotFoundException('Invitation not found');
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { email: true } });
      if (actor?.email !== invite.email)
        throw new ForbiddenException('Sign in with the invited email');
      if (invite.status !== 'PENDING')
        throw new ConflictException('This invitation is no longer pending');
      const sender = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invite.organizationId,
            userId: invite.invitedById,
          },
        },
      });
      const expired = invite.expiresAt <= new Date();
      const validSender =
        sender &&
        canAccessOrganization(sender.role, 'invite', invite.organization.allowAdminInvites) &&
        (invite.role !== 'ADMIN' || sender.role === 'OWNER');
      if (expired || !validSender) {
        await tx.invitation.update({
          where: { id: invite.id },
          data: { status: expired ? 'EXPIRED' : 'REVOKED' },
        });
        await tx.emailOutbox.updateMany({
          where: { invitationId: invite.id },
          data: { encryptedPayload: null },
        });
        return { invalid: true as const };
      }
      if (
        await tx.organizationMember.findUnique({
          where: {
            organizationId_userId: { organizationId: invite.organizationId, userId: actorId },
          },
        })
      )
        throw new ConflictException('You are already a member');
      await tx.organizationMember.create({
        data: { organizationId: invite.organizationId, userId: actorId, role: invite.role },
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      await tx.emailOutbox.updateMany({
        where: { invitationId: invite.id },
        data: { encryptedPayload: null },
      });
      return {
        invalid: false as const,
        organization: organizationView(invite.organization, invite.role),
      };
    });
    if (result.invalid)
      throw new GoneException('Invitation expired or sender no longer has permission');
    return result.organization;
  }
}
