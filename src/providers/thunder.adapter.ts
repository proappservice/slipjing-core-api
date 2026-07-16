import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderCallError, ProviderResult, SlipProviderAdapter } from './slip-provider.interface';

const CALL_TIMEOUT_MS = 8_000; // §7: per-call timeout 8s

/**
 * Adapter #2: Thunder (thunder.in.th) — verified against the live API (2026-07-16):
 *
 *   POST {base}/verify/bank
 *   headers: Authorization: Bearer <api key>
 *   body:    { "payload": "<raw mini-QR string>" }
 *
 * Success: HTTP 200 `{success:true, data:{amountInSlip, rawSlip:{transRef, date,
 * amount.amount, sender/receiver:{bank:{id,name,short}, account:{name:{th,en},
 * bank:{type,account(masked)}, proxy?}}}}}`.
 * Failure: `{success:false, error:{code,message}}` — SLIP_NOT_FOUND,
 * VALIDATION_ERROR, QUOTA_EXCEEDED (→ retryable, fail over).
 * Free check: GET {base}/info (quota/credit) · GET {base}/health.
 */
@Injectable()
export class ThunderAdapter implements SlipProviderAdapter {
  readonly code = 'thunder';
  private readonly logger = new Logger(ThunderAdapter.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('THUNDER_BASE_URL') ?? 'https://api.thunder.in.th/v2';
    this.apiKey = config.get<string>('THUNDER_API_KEY') ?? '';
  }

  async verify(input: { payload: string; transRef: string }): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderCallError(this.code, 'THUNDER_API_KEY is not configured', true);
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/verify/bank`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ payload: input.payload }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ProviderCallError(this.code, err instanceof Error ? err.message : 'network error', true);
    }

    if (res.status >= 500) throw new ProviderCallError(this.code, `upstream ${res.status}`, true);
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      // key/quota problem is OUR problem, not the customer's slip → fail over
      throw new ProviderCallError(this.code, `auth/quota rejected (${res.status})`, true);
    }

    const body: unknown = await res.json().catch(() => null);
    const errCode = (body as { error?: { code?: string } } | null)?.error?.code;
    if (errCode === 'QUOTA_EXCEEDED') {
      throw new ProviderCallError(this.code, 'quota exceeded', true);
    }
    return this.normalize(body, input.transRef);
  }

  /** Public for unit tests — mapping is pinned by a spec using a real captured response. */
  normalize(body: unknown, fallbackTransRef: string): ProviderResult {
    const b = (body ?? {}) as Record<string, any>;
    const raw = (b.data?.rawSlip ?? {}) as Record<string, any>;
    const verified = b.success === true;

    const party = (p: Record<string, any> | undefined) => ({
      bankCode: p?.bank?.id,
      accountMasked: p?.account?.bank?.account ?? p?.account?.proxy?.account,
      name: p?.account?.name?.th ?? p?.account?.name?.en,
    });

    return {
      verified,
      failureCode: verified ? undefined : THUNDER_FAILURE_CODES[String(errCodeOf(b))] ?? 'slip_not_found',
      transRef: String(raw.transRef ?? fallbackTransRef),
      sendingBank: raw.sender?.bank?.id,
      amount: typeof b.data?.amountInSlip === 'number' ? b.data.amountInSlip : raw.amount?.amount,
      transTimestamp: raw.date,
      receiver: party(raw.receiver),
      sender: party(raw.sender),
      raw: body,
    };
  }
}

const errCodeOf = (b: Record<string, any>): string | undefined => b.error?.code;

/** Thunder error codes → our machine-readable failure codes. */
const THUNDER_FAILURE_CODES: Record<string, string> = {
  SLIP_NOT_FOUND: 'slip_not_found',
  VALIDATION_ERROR: 'invalid_payload',
};
