import { Injectable, Logger } from '@nestjs/common';
import { ProviderCallError, ProviderResult, SlipProviderAdapter } from './slip-provider.interface';
import { Slip2GoAdapter } from './slip2go.adapter';

const BREAKER_THRESHOLD = 5; // consecutive failures → degraded
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  consecutiveFailures: number;
  degradedUntil: number;
}

/**
 * Failover chain + simple in-memory circuit breaker (CLAUDE.md §7 step 5).
 * Adapters are tried in priority order; timeout/5xx moves to the next one.
 * Phase 1: priorities are code-declared; the `providers` table drives status
 * reporting and will drive ordering once a second adapter exists.
 */
@Injectable()
export class ProviderChainService {
  private readonly logger = new Logger(ProviderChainService.name);
  private readonly adapters: SlipProviderAdapter[];
  private readonly breakers = new Map<string, BreakerState>();

  constructor(slip2go: Slip2GoAdapter) {
    this.adapters = [slip2go]; // add adapter #2 here in Phase 2
  }

  /**
   * Runs the chain. Returns the first definitive answer.
   * Throws ProviderCallError('all', …) when every provider is down → caller refunds (§7 step 6).
   */
  async verify(input: { payload: string; transRef: string; sendingBank?: string; amount?: number }): Promise<{
    result: ProviderResult;
    providerUsed: string;
    latencyMs: number;
  }> {
    let lastError: unknown = null;

    for (const adapter of this.adapters) {
      if (this.isDegraded(adapter.code)) {
        this.logger.warn({ provider: adapter.code }, 'skipping degraded provider');
        continue;
      }
      const startedAt = Date.now();
      try {
        const result = await adapter.verify(input);
        this.recordSuccess(adapter.code);
        return { result, providerUsed: adapter.code, latencyMs: Date.now() - startedAt };
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderCallError && err.retryable) {
          this.recordFailure(adapter.code);
          continue; // failover to next provider
        }
        throw err;
      }
    }

    this.logger.error({ lastError: String(lastError) }, 'all providers failed');
    throw new ProviderCallError('all', 'every provider in the chain failed or is degraded', true);
  }

  private isDegraded(code: string): boolean {
    const state = this.breakers.get(code);
    return !!state && state.degradedUntil > Date.now();
  }

  private recordFailure(code: string): void {
    const state = this.breakers.get(code) ?? { consecutiveFailures: 0, degradedUntil: 0 };
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= BREAKER_THRESHOLD) {
      state.degradedUntil = Date.now() + BREAKER_COOLDOWN_MS;
      state.consecutiveFailures = 0;
      this.logger.warn({ provider: code }, 'circuit breaker opened (degraded)');
    }
    this.breakers.set(code, state);
  }

  private recordSuccess(code: string): void {
    this.breakers.set(code, { consecutiveFailures: 0, degradedUntil: 0 });
  }
}
