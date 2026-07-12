import { HttpException, HttpStatus } from '@nestjs/common';

/** Machine-readable error codes exposed in the public error envelope (CLAUDE.md §6). */
export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'insufficient_credits'
  | 'duplicate_slip'
  | 'invalid_qr'
  | 'provider_unavailable'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'tenant_suspended'
  | 'internal_error';

export class ApiError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ error: { code, message } }, status);
  }

  static insufficientCredits(): ApiError {
    return new ApiError('insufficient_credits', 'Credit balance is not enough for this verification', HttpStatus.PAYMENT_REQUIRED);
  }

  static invalidQr(message = 'The QR payload could not be decoded'): ApiError {
    return new ApiError('invalid_qr', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  static providerUnavailable(): ApiError {
    return new ApiError('provider_unavailable', 'All upstream verification providers are unavailable; the reserved credit has been refunded', HttpStatus.SERVICE_UNAVAILABLE);
  }

  static unauthorized(message = 'Missing or invalid credentials'): ApiError {
    return new ApiError('unauthorized', message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = 'You do not have access to this resource'): ApiError {
    return new ApiError('forbidden', message, HttpStatus.FORBIDDEN);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError('not_found', message, HttpStatus.NOT_FOUND);
  }

  static invalidRequest(message: string): ApiError {
    return new ApiError('invalid_request', message, HttpStatus.BAD_REQUEST);
  }
}
