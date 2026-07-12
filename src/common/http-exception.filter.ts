import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

/**
 * Normalizes every error to the public envelope `{ error: { code, message } }`
 * (CLAUDE.md §6). ApiError already carries the envelope; other HttpExceptions
 * and unknown errors are mapped here.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        res.status(status).json(body);
        return;
      }
      const message =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message as string | string[] | undefined) ?? exception.message;
      const code =
        status === HttpStatus.UNAUTHORIZED ? 'unauthorized'
        : status === HttpStatus.FORBIDDEN ? 'forbidden'
        : status === HttpStatus.NOT_FOUND ? 'not_found'
        : status < 500 ? 'invalid_request'
        : 'internal_error';
      res.status(status).json({ error: { code, message: Array.isArray(message) ? message.join('; ') : message } });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'internal_error', message: 'Unexpected error' } });
  }
}
