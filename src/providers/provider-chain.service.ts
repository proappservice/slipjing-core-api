import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderCallError, ProviderResult, SlipProviderAdapter } from './slip-provider.interface';
import { Slip2GoAdapter } from './slip2go.adapter';
import { ThunderAdapter } from './thunder.adapter';

const BREAKER_THRESHOLD = 5; // consecutive failures → degraded
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  consecutiveFailures: number;
  degradedUntil: number;
}

/**
 * Failover chain + simple in-memory circuit breaker (CLAUDE.md §7 step 5).
 * Order comes from env `PROVIDER_CHAIN` (comma-separated adapter codes) —
 * default "thunder,slip2go" per the 2026-07-16 owner decision to make
 * Thunder primary. An adapter with a missing key throws retryable and the
 * chain falls through to the next one.
 */
@Injectable()
export class ProviderChainService {
  private readonly logger = new Logger(ProviderChainService.name);
  private readonly adapters: SlipProviderAdapter[];
  private readonly breakers = new Map<string, BreakerState>();

  constructor(thunder: ThunderAdapter, slip2go: Slip2GoAdapter, config: ConfigService) {
    const registry: Record<string, SlipProviderAdapter> = { thunder, slip2go };
    const order = (config.get<string>('PROVIDER_CHAIN') ?? 'thunder,slip2go')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.adapters = order.map((code) => registry[code]).filter((a): a is SlipProviderAdapter => Boolean(a));
    if (this.adapters.length === 0) {
      throw new Error(`PROVIDER_CHAIN "${order.join(',')}" matches no known adapter (${Object.keys(registry).join(', ')})`);
    }
    this.logger.log(`provider chain: ${this.adapters.map((a) => a.code).join(' → ')}`);
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
