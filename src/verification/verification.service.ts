import { Injectable, Logger } from '@nestjs/common';
import { Prisma, VerificationRequest } from '@prisma/client';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreditsService } from '../credits/credits.service';
import { ProviderCallError } from '../providers/slip-provider.interface';
import { ProviderChainService } from '../providers/provider-chain.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { decodeMiniQr, InvalidQrError } from './mini-qr';

export interface VerifyInput {
  payload: string;
  idempotencyKey: string;
  expectedAmount?: number;
  expectedReceiver?: string;
}

const VERIFY_COST = 1n; // 1 credit = 1 verification (CLAUDE.md §4)

/**
 * The §7 pipeline:
 * validate+idempotency → decode QR → duplicate check → atomic reserve →
 * provider chain → (refund on total failure) → persist → webhook.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly chain: ProviderChainService,
    private readonly webhooks: WebhooksService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async verify(input: VerifyInput): Promise<VerificationRequest> {
    const tenantId = this.prisma.tenantId();
    const apiKeyId = this.currentApiKeyId();

    // 1. Idempotency: same key ⇒ same stored response, no double charge.
    const existing = await this.prisma.verificationRequest.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return existing;

    // 2. Decode mini-QR — failure ends here: no provider call, no charge.
    let decoded;
    try {
      decoded = decodeMiniQr(input.payload);
    } catch (err) {
      if (err instanceof InvalidQrError) {
        return this.persistTerminal({
          tenantId, apiKeyId, input,
          status: 'invalid', errorCode: 'invalid_qr',
        });
      }
      throw err;
    }

    // 3. Duplicate check — a chargeable, successful business result (§7).
    const priorVerified = await this.prisma.verificationRequest.findFirst({
      where: { tenantId, transRef: decoded.transRef, status: { in: ['verified', 'duplicate'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (priorVerified) {
      await this.credits.debit(VERIFY_COST, 'verify', { refType: 'verification', refId: input.idempotencyKey });
      const dup = await this.persistTerminal({
        tenantId, apiKeyId, input,
        status: 'duplicate', errorCode: 'duplicate_slip',
        transRef: decoded.transRef, sendingBank: decoded.sendingBank,
        duplicateOfId: priorVerified.duplicateOfId ?? priorVerified.id,
      });
      this.fireWebhook(dup);
      return dup;
    }

    // 4. Atomic credit reservation (402 inside if balance insufficient).
    const reservation = await this.credits.debit(VERIFY_COST, 'verify', {
      refType: 'verification',
      refId: input.idempotencyKey,
    });

    // 5–6. Provider chain with refund-on-total-failure.
    try {
      const { result, providerUsed, latencyMs } = await this.chain.verify({
        payload: input.payload,
        transRef: decoded.transRef,
        sendingBank: decoded.sendingBank,
        amount: input.expectedAmount,
      });

      const checks = await this.buildChecks(result, input);
      const record = await this.persistTerminal({
        tenantId, apiKeyId, input,
        status: result.verified ? 'verified' : 'failed',
        errorCode: result.verified ? null : (result.failureCode ?? 'slip_not_found'),
        transRef: decoded.transRef,
        sendingBank: result.sendingBank ?? decoded.sendingBank,
        amount: result.amount,
        receiverAccountMasked: result.receiver?.accountMasked ?? null,
        receiverName: result.receiver?.name ?? null,
        checks,
        providerUsed,
        providerLatencyMs: latencyMs,
        raw: result.raw,
      });
      this.fireWebhook(record);
      return record;
    } catch (err) {
      if (err instanceof ProviderCallError) {
        // 6. Total provider failure ⇒ compensating refund, 503 out.
        await this.credits.credit(VERIFY_COST, 'refund', {
          refType: 'verification_refund',
          refId: reservation.ledgerId,
        });
        await this.persistTerminal({
          tenantId, apiKeyId, input,
          status: 'failed', errorCode: 'provider_unavailable',
          transRef: decoded.transRef, sendingBank: decoded.sendingBank,
        });
        throw ApiError.providerUnavailable();
      }
      throw err;
    }
  }

  async getById(id: string): Promise<VerificationRequest> {
    const record = await this.prisma.verificationRequest.findFirst({
      where: { id, ...this.prisma.tenantWhere() },
    });
    if (!record) throw ApiError.notFound('Verification not found');
    return record;
  }

  /** GET /v1/usage — daily aggregates (§6). */
  async usage(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; total: bigint; verified: bigint; duplicates: bigint }>>(
      Prisma.sql`
        SELECT date_trunc('day', created_at) AS day,
               count(*)::bigint AS total,
               count(*) FILTER (WHERE status = 'verified')::bigint AS verified,
               count(*) FILTER (WHERE status = 'duplicate')::bigint AS duplicates
        FROM verification_requests
        WHERE tenant_id = ${this.prisma.tenantId()}::uuid
          AND created_at >= ${from} AND created_at < ${to}
        GROUP BY 1 ORDER BY 1`,
    );
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      total: Number(r.total),
      verified: Number(r.verified),
      duplicates: Number(r.duplicates),
    }));
  }

  // ---- helpers ----

  /** §6 checks: expected values from the request, else the shop's registered bank accounts. */
  private async buildChecks(
    result: { amount?: number; receiver?: { accountMasked?: string; name?: string } },
    input: VerifyInput,
  ): Promise<Prisma.JsonObject> {
    const checks: Prisma.JsonObject = {};
    if (input.expectedAmount !== undefined) {
      checks.amount_match = result.amount !== undefined && Math.abs(result.amount - input.expectedAmount) < 0.005;
    }
    if (input.expectedReceiver) {
      checks.receiver_match = this.accountMatches(input.expectedReceiver, result.receiver?.accountMasked);
    } else {
      const accounts = await this.prisma.bankAccount.findMany({
        where: { ...this.prisma.tenantWhere(), active: true },
      });
      if (accounts.length > 0) {
        checks.receiver_match = accounts.some((acc) => {
          const numberOk = this.accountMatches(acc.accountNumber, result.receiver?.accountMasked);
          const nameOk = this.nameMatches(result.receiver?.name, acc.accountNameTh, acc.accountNameEn);
          if (acc.verifyMode === 'number') return numberOk;
          if (acc.verifyMode === 'name') return nameOk;
          return numberOk && nameOk;
        });
      }
    }
    return checks;
  }

  /** Compare a full/expected account number against the masked value from the bank (x/X = wildcard). */
  private accountMatches(expected: string, masked?: string): boolean {
    if (!masked) return false;
    const exp = expected.replace(/[^0-9]/g, '');
    const mask = masked.replace(/[^0-9xX]/g, '');
    if (!exp || !mask || exp.length < mask.length) return false;
    const tail = exp.slice(-mask.length);
    for (let i = 0; i < mask.length; i++) {
      const m = mask[i];
      if (m !== 'x' && m !== 'X' && m !== tail[i]) return false;
    }
    return true;
  }

  private nameMatches(actual: string | undefined, nameTh: string, nameEn?: string | null): boolean {
    if (!actual) return false;
    const clean = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const a = clean(actual);
    // Bank names are often masked/truncated — prefix match on the cleaned form.
    return [nameTh, nameEn ?? ''].filter(Boolean).some((n) => {
      const c = clean(n);
      return c.startsWith(a.slice(0, 4)) || a.startsWith(c.slice(0, 4));
    });
  }

  private currentApiKeyId(): string | null {
    const actor = this.tenantContext.require().actor;
    return actor.type === 'api_key' ? actor.apiKeyId : null;
  }

  private fireWebhook(record: VerificationRequest): void {
    // §7 step 7 — must never block or fail the request path.
    void this.webhooks
      .dispatch('verification.completed', {
        id: record.id,
        status: record.status,
        trans_ref: record.transRef,
        amount: record.amount?.toString() ?? null,
        checks: record.checks,
      })
      .catch((err) => this.logger.error({ err: String(err) }, 'webhook dispatch failed'));
  }

  private async persistTerminal(args: {
    tenantId: string;
    apiKeyId: string | null;
    input: VerifyInput;
    status: 'verified' | 'failed' | 'invalid' | 'duplicate';
    errorCode?: string | null;
    transRef?: string;
    sendingBank?: string;
    amount?: number;
    receiverAccountMasked?: string | null;
    receiverName?: string | null;
    checks?: Prisma.JsonObject;
    providerUsed?: string;
    providerLatencyMs?: number;
    raw?: unknown;
    duplicateOfId?: string;
  }): Promise<VerificationRequest> {
    return this.prisma.verificationRequest.create({
      data: {
        id: newId(),
        tenantId: args.tenantId,
        apiKeyId: args.apiKeyId,
        idempotencyKey: args.input.idempotencyKey,
        status: args.status,
        errorCode: args.errorCode ?? null,
        transRef: args.transRef,
        sendingBank: args.sendingBank,
        amount: args.amount !== undefined ? new Prisma.Decimal(args.amount) : undefined,
        receiverAccountMasked: args.receiverAccountMasked,
        receiverName: args.receiverName,
        checks: args.checks,
        providerUsed: args.providerUsed,
        providerLatencyMs: args.providerLatencyMs,
        rawProviderResponse: args.raw === undefined ? undefined : (args.raw as Prisma.InputJsonValue),
        duplicateOfId: args.duplicateOfId,
      },
    });
  }
}
