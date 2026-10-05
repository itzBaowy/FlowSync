import { ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { LoginInput, RegisterInput, PublicUser } from '@flowsync/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ACCESS_TTL, TokenService } from './token.service';

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
type SelectedUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
const toPublicUser = (user: SelectedUser): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt.toISOString(),
});

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}
  async onModuleInit() {
    this.dummyHash = await argon2.hash('timing-equalization-only', { type: argon2.argon2id });
  }
  async register(input: RegisterInput) {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { name: input.name, email: input.email, passwordHash },
          select: publicUserSelect,
        });
        const issued = await this.tokens.issue(user.id);
        await tx.refreshToken.create({ data: issued.record });
        return {
          session: {
            accessToken: issued.accessToken,
            expiresIn: ACCESS_TTL,
            user: toPublicUser(user),
          },
          refreshToken: issued.refreshToken,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('An account with this email already exists');
      throw error;
    }
  }
  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = await argon2.verify(user?.passwordHash ?? this.dummyHash, input.password);
    if (!user?.passwordHash || !valid) throw new UnauthorizedException('Invalid email or password');
    const issued = await this.tokens.issue(user.id);
    await this.prisma.refreshToken.create({ data: issued.record });
    return {
      session: { accessToken: issued.accessToken, expiresIn: ACCESS_TTL, user: toPublicUser(user) },
      refreshToken: issued.refreshToken,
    };
  }
  async refresh(token: string | undefined) {
    if (!token) throw new UnauthorizedException('Session cookie required');
    const claims = await this.tokens.verifyRefresh(token);
    const hash = this.tokens.hash(token);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshToken.updateMany({
        where: {
          id: claims.jti,
          userId: claims.sub,
          familyId: claims.sid,
          tokenHash: hash,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (consumed.count !== 1) {
        // Return failure instead of throwing inside the transaction: revocation must commit.
        await tx.refreshToken.updateMany({
          where: { userId: claims.sub, familyId: claims.sid, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return null;
      }
      const user = await tx.user.findUnique({
        where: { id: claims.sub },
        select: publicUserSelect,
      });
      if (!user) return null;
      const issued = await this.tokens.issue(user.id, claims.sid);
      await tx.refreshToken.create({ data: issued.record });
      return {
        session: {
          accessToken: issued.accessToken,
          expiresIn: ACCESS_TTL,
          user: toPublicUser(user),
        },
        refreshToken: issued.refreshToken,
      };
    });
    if (!outcome) throw new UnauthorizedException('Session expired or reused; sign in again');
    return outcome;
  }
  async logout(token: string | undefined) {
    if (!token) return;
    try {
      const claims = await this.tokens.verifyRefresh(token);
      await this.prisma.refreshToken.updateMany({
        where: { userId: claims.sub, familyId: claims.sid, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
  }
  async me(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return toPublicUser(user);
  }
}
