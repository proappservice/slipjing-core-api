/** Normalized result every adapter must return (raw response preserved separately). */
export interface ProviderResult {
  /** Did the upstream confirm this is a real transfer? */
  verified: boolean;
  /** Machine-readable reason when verified=false (e.g. slip_not_found, slip_fraud). */
  failureCode?: string;
  transRef: string;
  sendingBank?: string;
  amount?: number;
  transTimestamp?: string;
  receiver?: {
    bankCode?: string;
    accountMasked?: string;
    /** Display name as returned by the bank (may be masked). */
    name?: string;
  };
  sender?: {
    bankCode?: string;
    accountMasked?: string;
    name?: string;
  };
  /** Untouched upstream body — persisted to raw_provider_response, purged after 90 days (§8). */
  raw: unknown;
}

/** Adapter contract (CLAUDE.md §7). One implementation per upstream provider. */
export interface SlipProviderAdapter {
  readonly code: string;
  verify(input: { payload: string; transRef: string; sendingBank?: string; amount?: number }): Promise<ProviderResult>;
}

/** Thrown by adapters for retryable failures (timeout / 5xx) → failover to next provider. */
export class ProviderCallError extends Error {
  constructor(
    public readonly providerCode: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(`[${providerCode}] ${message}`);
  }
}
