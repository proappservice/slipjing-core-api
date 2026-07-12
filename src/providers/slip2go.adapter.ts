import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderCallError, ProviderResult, SlipProviderAdapter } from './slip-provider.interface';

const CALL_TIMEOUT_MS = 8_000; // §7: per-call timeout 8s

/**
 * Adapter #1: Slip2Go — verified against the live API (2026-07-12):
 *
 *   POST {base}/verify-slip/qr-code/info
 *   headers: Authorization: Bearer <secretKey>
 *   body:    { "payload": { "qrCode": "<raw mini-QR string>" } }
 *
 * Responses are ALWAYS HTTP 200 with a string `code`:
 *   200000* success (slip data in `data`)   *confirm exact code with a real slip
 *   200401  recipient account not match     200402 transfer amount not match
 *   200403  transfer date not match         200404 slip not found
 *   200500  slip is fraud
 * Every verify call costs tokens (even fraud results) — billing per §7 note.
 * Account check (free): GET {base}/account/info → code 200001.
 */
@Injectable()
export class Slip2GoAdapter implements SlipProviderAdapter {
  readonly code = 'slip2go';
  private readonly logger = new Logger(Slip2GoAdapter.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('SLIP2GO_BASE_URL') ?? 'https://connect.slip2go.com/api';
    this.apiKey = config.get<string>('SLIP2GO_API_KEY') ?? '';
  }

  async verify(input: { payload: string; transRef: string }): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderCallError(this.code, 'SLIP2GO_API_KEY is not configured', true);
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/verify-slip/qr-code/info`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ payload: { qrCode: input.payload } }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      // network error / timeout → retryable, move to next provider
      throw new ProviderCallError(this.code, err instanceof Error ? err.message : 'network error', true);
    }

    if (res.status >= 500) throw new ProviderCallError(this.code, `upstream ${res.status}`, true);
    if (res.status === 401 || res.status === 403) {
      throw new ProviderCallError(this.code, `auth rejected (${res.status})`, true);
    }

    const body: unknown = await res.json().catch(() => null);
    return this.normalize(body, input.transRef);
  }

  /**
   * Response schema per the official docs (extracted from the app bundle, 2026-07-12):
   *   code "200000" message "Slip found" · data.decode · data.transRef ·
   *   data.dateTime (ISO) · data.amount (Number) · data.ref1..3 ·
   *   data.{receiver,sender}.bank.{id,name} ·
   *   data.{receiver,sender}.account.bank.account (masked, e.g. xxx-x-x5366-x) ·
   *   data.{receiver,sender}.account.proxy.{type,account} (PromptPay proxy, nullable)
   */
  private normalize(body: unknown, fallbackTransRef: string): ProviderResult {
    const b = (body ?? {}) as Record<string, any>;
    const code = String(b.code ?? '');
    const data = (b.data ?? {}) as Record<string, any>;
    const verified = code === '200000';

    return {
      verified,
      failureCode: verified ? undefined : SLIP2GO_FAILURE_CODES[code] ?? 'slip_not_found',
      transRef: String(data.transRef ?? fallbackTransRef),
      sendingBank: data.sender?.bank?.id,
      amount: typeof data.amount === 'number' ? data.amount : undefined,
      transTimestamp: data.dateTime,
      receiver: {
        bankCode: data.receiver?.bank?.id,
        accountMasked: data.receiver?.account?.bank?.account ?? data.receiver?.account?.proxy?.account,
        name: data.receiver?.account?.name,
      },
      sender: {
        bankCode: data.sender?.bank?.id,
        accountMasked: data.sender?.account?.bank?.account ?? data.sender?.account?.proxy?.account,
        name: data.sender?.account?.name,
      },
      raw: body,
    };
  }
}

/** Slip2Go result codes → our machine-readable failure codes. */
const SLIP2GO_FAILURE_CODES: Record<string, string> = {
  '200401': 'receiver_mismatch',
  '200402': 'amount_mismatch',
  '200403': 'date_mismatch',
  '200404': 'slip_not_found',
  '200500': 'slip_fraud',
};
