import { Injectable } from '@nestjs/common';
import { LedgerReason, Prisma } from '@prisma/client';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';

export interface LedgerRef {
  refType: string;
  refId: string;
}

/**
 * Append-only credit ledger (CLAUDE.md §4/§7 step 4).
 * Balance = latest balance_after — never a mutable column.
 *
 * Concurrency: every mutation runs inside a transaction holding the
 * per-tenant advisory lock, so concurrent debits serialize and can
 * never oversell.
 */
@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async balance(tenantId?: string): Promise<bigint> {
    const tid = tenantId ?? this.prisma.tenantId();
    const latest = await this.prisma.creditLedger.findFirst({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });
    return latest?.balanceAfter ?? 0n;
  }

  /** Reserve (debit) credits; throws 402 when balance is insufficient. */
  async debit(amount: bigint, reason: LedgerReason, ref: LedgerRef, tenantId?: string): Promise<{ ledgerId: string; balanceAfter: bigint }> {
    const entry = await this.append(-amount, reason, ref, tenantId);
    return { ledgerId: entry.id, balanceAfter: entry.balanceAfter };
  }

  /** Add credits (top-up, refund, manual adjust). */
  async credit(amount: bigint, reason: LedgerReason, ref: LedgerRef, tenantId?: string): Promise<{ ledgerId: string; balanceAfter: bigint }> {
    const entry = await this.append(amount, reason, ref, tenantId);
    return { ledgerId: entry.id, balanceAfter: entry.balanceAfter };
  }

  private async append(delta: bigint, reason: LedgerReason, ref: LedgerRef, tenantId?: string) {
    const tid = tenantId ?? this.prisma.tenantId();

    return this.prisma.$transaction(async (tx) => {
      // Per-tenant advisory lock (§7 step 4) — serializes all ledger writes
      // for this tenant for the duration of the transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tid}, 42))`;

      const latest = await tx.creditLedger.findFirst({
        where: { tenantId: tid },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfter: true },
      });
      const current = latest?.balanceAfter ?? 0n;
      const next = current + delta;
      if (next < 0n) throw ApiError.insufficientCredits();

      return tx.creditLedger.create({
        data: {
          id: newId(),
          tenantId: tid,
          delta,
          reason,
          refType: ref.refType,
          refId: ref.refId,
          balanceAfter: next,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
