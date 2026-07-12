import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { ApiError } from '../common/errors';

/**
 * Owner console auth (CLAUDE.md §3/§5): completely separate from tenant auth.
 * Phase 1: a single ADMIN_TOKEN from Secret Manager; upgrade to real accounts
 * when there is more than one operator.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly token: string;

  constructor(config: ConfigService) {
    this.token = config.getOrThrow<string>('ADMIN_TOKEN');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header('x-admin-token') ?? '';
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw ApiError.unauthorized('Admin token is invalid');
    }
    return true;
  }
}
