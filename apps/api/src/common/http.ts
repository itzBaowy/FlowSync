import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { map } from 'rxjs/operators';
import { PaginatedResult } from './pagination';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        map((data: unknown) =>
          data instanceof PaginatedResult
            ? { data: data.data, meta: data.meta }
            : { data, meta: {} },
        ),
      );
  }
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const payload = error instanceof HttpException ? error.getResponse() : undefined;
    const detail =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const defaults: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE',
    };
    if (status >= 500) {
      // ORM errors may embed query parameters in their message. Keep stack frames, not values.
      this.logger.error(
        {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          stack:
            process.env.NODE_ENV === 'development' && error instanceof Error
              ? error.stack
                  ?.split('\n')
                  .filter((line) => line.trim().startsWith('at '))
                  .join('\n')
              : undefined,
          requestId: request.id,
        },
        'Request failed',
      );
    }
    response.status(status).json({
      statusCode: status,
      code: typeof detail.code === 'string' ? detail.code : (defaults[status] ?? 'INTERNAL_ERROR'),
      message:
        status >= 500
          ? 'Service temporarily unavailable'
          : typeof detail.message === 'string'
            ? detail.message
            : typeof payload === 'string'
              ? payload
              : 'Request failed',
      errors: Array.isArray(detail.errors) ? detail.errors : [],
      requestId: String(request.id),
    });
  }
}
