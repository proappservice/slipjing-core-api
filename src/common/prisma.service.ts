import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from './tenant-context.service';

/**
 * Thin data-access layer over Prisma (CLAUDE.md §3).
 *
 * Rule for feature code: use `forTenant()` for tenant-owned tables so the
 * tenant_id filter/injection can never be forgotten; raw `client` access is
 * reserved for the admin module, auth (pre-tenant), and migrations-adjacent
 * jobs — anything else should fail code review.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly tenantContext: TenantContextService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Current tenant id, or throw. All tenant-scoped queries start here. */
  tenantId(): string {
    return this.tenantContext.requireTenantId();
  }

  /** Convenience: `{ tenantId }` where-fragment that throws when context is absent. */
  tenantWhere(): { tenantId: string } {
    return { tenantId: this.tenantId() };
  }
}
