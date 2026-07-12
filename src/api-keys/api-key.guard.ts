import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { hashApiKey } from './api-keys.service';

/**
 * Auth for public /v1 routes (CLAUDE.md §6): `Authorization: Bearer <api_key>`.
 * Resolves the tenant from the key hash and enters tenant context.
 * Never logs the full key anywhere (§13).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { apiKeyId?: string }>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer sj_')) throw ApiError.unauthorized('API key is required');

    const fullKey = header.slice('Bearer '.length);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(fullKey) },
      include: { tenant: true },
    });
    if (!apiKey || apiKey.revokedAt) throw ApiError.unauthorized('API key is invalid or revoked');
    if (apiKey.tenant.status === 'suspended') throw new ApiError('tenant_suspended', 'This shop is suspended', 403);

    req.apiKeyId = apiKey.id;
    // fire-and-forget; last_used_at freshness is best-effort
    void this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

    this.tenantContext.set({
      tenantId: apiKey.tenantId,
      actor: { type: 'api_key', apiKeyId: apiKey.id },
      requestId: (req.header('x-request-id') as string | undefined) ?? newId(),
    });
    return true;
  }
}
