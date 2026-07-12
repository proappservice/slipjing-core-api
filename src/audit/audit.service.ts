import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';
import { TenantContextService } from '../common/tenant-context.service';

/**
 * Async audit writer (CLAUDE.md §5) — MUST never block or fail the request
 * path, so every write is fire-and-forget with error swallowing + log.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  record(action: string, target?: { type: string; id: string }, metadata?: Record<string, unknown>): void {
    const ctx = this.tenantContext.maybe();
    const actor = ctx?.actor;
    const actorType: ActorType =
      actor?.type === 'api_key' ? 'api_key' : actor?.type === 'user' ? 'user' : actor?.type === 'admin' ? 'admin' : 'system';
    const actorId = actor?.type === 'api_key' ? actor.apiKeyId : actor?.type === 'user' ? actor.userId : null;

    void this.prisma.auditLog
      .create({
        data: {
          id: newId(),
          tenantId: ctx?.tenantId ?? null,
          actorType,
          actorId,
          action,
          targetType: target?.type,
          targetId: target?.id,
          metadata: metadata as object | undefined,
        },
      })
      .catch((err) => this.logger.error({ err: String(err) }, 'audit write failed'));
  }
}
