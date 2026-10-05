import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, registerSchema } from '@flowsync/contracts';
import type { LoginInput, RegisterInput } from '@flowsync/contracts';
import type { Request, Response, CookieOptions } from 'express';
import type { Environment } from '../../config/environment';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccessGuard } from './access.guard';
import type { AuthenticatedRequest } from './access.guard';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, SessionResponseDto, UserResponseDto } from './auth.dto';
import { PinoLogger } from 'nestjs-pino';
import { REFRESH_TTL } from './token.service';

const COOKIE = 'flowsync_refresh';
function cookieToken(request: Request): string | undefined {
  const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[COOKIE];
  return typeof value === 'string' ? value : undefined;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>,
    private readonly logger: PinoLogger,
  ) {}
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: '/api/auth',
    };
  }
  private setCookie(response: Response, token: string) {
    response.cookie(COOKIE, token, { ...this.cookieOptions(), maxAge: REFRESH_TTL * 1000 });
  }
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Create an account and session' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: SessionResponseDto })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(body);
    this.setCookie(response, result.refreshToken);
    this.logger.assign({ userId: result.session.user.id });
    return result.session;
  }
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: LoginDto })
  @ApiOperation({ summary: 'Sign in and issue a rotated session cookie' })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body);
    this.setCookie(response, result.refreshToken);
    this.logger.assign({ userId: result.session.user.id });
    return result.session;
  }
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Consume refresh token once and issue its successor' })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, or reused session' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      const result = await this.auth.refresh(cookieToken(request));
      this.setCookie(response, result.refreshToken);
      this.logger.assign({ userId: result.session.user.id });
      return result.session;
    } catch (error) {
      response.clearCookie(COOKIE, this.cookieOptions());
      throw error;
    }
  }
  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke the current session family' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(cookieToken(request));
    response.clearCookie(COOKIE, this.cookieOptions());
    return { success: true };
  }
  @Get('me')
  @UseGuards(AccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get public profile of current user' })
  @ApiOkResponse({ type: UserResponseDto })
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.userId);
  }
}
