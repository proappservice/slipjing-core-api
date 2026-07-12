import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { newId } from '../common/ids';
import { ApiError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { AuthService } from './auth.service';

/**
 * Dashboard guard (CLAUDE.md §3): JWT identifies the user; the selected shop
 * comes from the `X-Shop-Id` header. Membership is verified against
 * tenant_members BEFORE tenant context is set — a valid session for shop A
 * must never reach shop B's data.
 */
@Injectable()
export class ShopGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const claims = await this.authenticate(req);
    req.userId = claims.sub;

    const shopId = req.header('x-shop-id');
    if (!shopId) throw ApiError.invalidRequest('X-Shop-Id header is required');

    const membership = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: shopId, userId: claims.sub } },
      include: { tenant: true },
    });
    if (!membership) throw ApiError.forbidden('You are not a member of this shop');
    if (membership.tenant.status === 'suspended') {
      throw new ApiError('tenant_suspended', 'This shop is suspended', 403);
    }

    this.tenantContext.set({
      tenantId: shopId,
      actor: { type: 'user', userId: claims.sub },
      requestId: (req.header('x-request-id') as string | undefined) ?? newId(),
    });
    return true;
  }

  private async authenticate(req: Request): Promise<{ sub: string; email: string }> {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized();
    try {
      return await this.auth.verifySession(header.slice('Bearer '.length));
    } catch {
      throw ApiError.unauthorized('Session token is invalid or expired');
    }
  }
}

/** JWT-only guard for pre-shop routes (list my shops, create first shop). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized();
    try {
      const claims = await this.auth.verifySession(header.slice('Bearer '.length));
      req.userId = claims.sub;
      return true;
    } catch {
      throw ApiError.unauthorized('Session token is invalid or expired');
    }
  }
}
