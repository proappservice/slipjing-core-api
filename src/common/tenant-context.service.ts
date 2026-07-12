import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  /** What authenticated this request. */
  actor: { type: 'api_key'; apiKeyId: string } | { type: 'user'; userId: string } | { type: 'admin' } | { type: 'system' };
  requestId: string;
}

/** Mutable holder: the scope is entered by middleware (before auth), values are filled by guards. */
interface ContextHolder {
  ctx?: TenantContext;
}

/**
 * Carries tenant context through the request lifecycle via AsyncLocalStorage
 * (CLAUDE.md §3). A middleware enters the scope for every request by wrapping
 * `next()`; auth guards then `set()` the resolved tenant into the same store.
 * Any tenant-scoped access with no context MUST throw — never silently
 * fall through to all rows.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<ContextHolder>();

  /** Enter an (empty) context scope for the duration of `fn` — call once per request. */
  runWithScope<T>(fn: () => T): T {
    return this.als.run({}, fn);
  }

  /** Enter a fully-populated scope (jobs, tests, top-up self-verify). */
  runWith<T>(context: TenantContext, fn: () => T): T {
    return this.als.run({ ctx: context }, fn);
  }

  /** Fill in the tenant identity after authentication (guards only). */
  set(context: TenantContext): void {
    const holder = this.als.getStore();
    if (!holder) {
      throw new Error('Tenant context scope was not entered — is the context middleware registered?');
    }
    holder.ctx = context;
  }

  /** Returns the context or undefined (for code paths that are legitimately tenant-less). */
  maybe(): TenantContext | undefined {
    return this.als.getStore()?.ctx;
  }

  /** Returns the current tenant id or throws — the §3 safety net. */
  requireTenantId(): string {
    return this.require().tenantId;
  }

  require(): TenantContext {
    const ctx = this.als.getStore()?.ctx;
    if (!ctx) {
      throw new Error('Tenant context is missing — refusing to run a tenant-scoped operation without it');
    }
    return ctx;
  }
}
