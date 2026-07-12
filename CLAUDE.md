# CLAUDE.md — SlipJing (slipjing.com): Payment Slip Verification SaaS

> Purpose of this file: design spec + implementation rules for Claude Code.
> All architectural decisions below are FINAL unless the owner explicitly changes them.
> Do not redesign; implement according to this spec. Ask before deviating.
>
> **Owner update 2026-07-11**: auth is social-login-only (Google / Facebook / LINE —
> no password, no phone/SMS in Phase 1); a tenant IS a shop (ร้านค้า) and one user can
> own several shops; each shop registers its own receiving bank accounts (≥1).
> Details merged into §3, §4, §5, §6, §9, §10 below.

## 1. What this project is

A multi-tenant SaaS that verifies Thai bank-transfer payment slips (สลิปโอนเงิน) as genuine,
by decoding the slip's mini-QR and querying upstream slip-verification providers.

Two goals, in priority order:
1. **Learning vehicle**: exercise the full SaaS lifecycle end-to-end (tenancy, API keys,
   metering, billing, ops) in production with real users.
2. **Reusable chassis**: the skeleton (tenant/auth/api-key/credit/metering/admin modules)
   will be reused for a future, larger AI-agent product. Keep domain logic (slip
   verification) cleanly separated from the chassis.

Primary customers: Thai online merchants / developers. Channel: REST API first;
LINE OA bot is Phase 2.

## 2. Tech stack (fixed)

- **Runtime**: Node.js LTS, TypeScript strict mode
- **Framework**: NestJS (modular monolith — do NOT split into microservices)
- **DB**: PostgreSQL (Cloud SQL). ORM: Prisma (preferred) or TypeORM — pick one, stay consistent
- **Deploy**: GCP Cloud Run (scale-to-zero), region asia-southeast1
- **Async jobs / retries**: Cloud Tasks (verification retries, webhook delivery)
- **Object storage**: GCS bucket for slip images, with lifecycle rule (see §8 PDPA)
- **Secrets**: GCP Secret Manager. Never commit secrets. `.env` for local dev only
- **No Redis in Phase 1.** Rate limiting and counters use Postgres. Add Redis only when measured load demands it

## 3. Multi-tenancy model (fixed decision)

- **A tenant IS a shop (ร้านค้า)** — Slip2Go-style. A user account can own/join multiple
  shops; each shop has its own credit balance, API keys, bank accounts, webhooks, and usage.
  Users link to tenants via `tenant_members` (many-to-many, with role). After signup the
  user MUST create a shop before anything else works (onboarding gate).
- Shared database, shared schema. Every tenant-owned table has a non-null `tenant_id`.
- **Isolation is enforced by the framework, not by developer discipline:**
  - Resolve tenant from the API key (public API). On the dashboard, resolve from the JWT
    **plus the currently selected shop** (claim or `X-Shop-Id` header) — the guard must
    verify membership via `tenant_members` before setting tenant context.
  - Carry tenant context via `AsyncLocalStorage` (a `TenantContextService`).
  - All repository/Prisma access to tenant-owned tables goes through a thin data-access
    layer that injects `tenant_id` automatically. Direct access that bypasses it should
    fail code review — add an ESLint rule or naming convention to catch it.
  - Any query path where tenant context is missing must throw, not silently return all rows.
- Admin (owner) endpoints live under a separate `/admin` module with its own auth; they are
  the only code allowed to query across tenants.

## 4. Database schema (Phase 1)

Conventions: `id` = UUID v7 PK; `created_at`/`updated_at` timestamptz on every table;
money/credits are `BIGINT` integer units (1 credit = 1 verification), never floats.

- **tenants** (= shops): id, name, logo_gcs_path (nullable), status(active|suspended), plan metadata
- **users**: id, email (unique, provided by the social provider), display_name, avatar_url
  - No password column — social login only in Phase 1 (no phone/SMS: no SMS sender yet)
- **auth_identities**: id, user_id, provider(google|facebook|line), provider_user_id,
  email_at_link — unique (provider, provider_user_id); one user may link several providers
- **tenant_members**: id, tenant_id, user_id, role(owner|member) — unique (tenant_id, user_id)
- **bank_accounts**: id, tenant_id, bank_code, account_number, account_name_th,
  account_name_en, verify_mode(number|name|both), active
  - The shop's own receiving accounts (merchant-provided with consent, stored in full —
    required for §7 receiver matching). One shop can register many accounts (1:N)
- **api_keys**: id, tenant_id, name, key_prefix (first 8 chars, for display),
  key_hash (SHA-256 of full key), last_used_at, revoked_at
  - Full key format: `sj_live_<32 random bytes base62>` (test keys: `sj_test_`); shown to the user exactly once at creation
- **credit_ledger** (append-only; the source of truth for balances):
  id, tenant_id, delta (BIGINT, + for top-up / - for usage), reason(topup|verify|refund|adjust),
  ref_type, ref_id, balance_after
  - Balance = latest `balance_after`. Never store balance as a mutable column on `tenants`
- **topup_orders**: id, tenant_id, package_id, amount_thb, credits, status(pending|paid|expired),
  payment_method(promptpay), payment_ref, verified_slip_id (nullable)
  - Dogfooding: PromptPay top-up slips are verified by our own verification pipeline
- **credit_packages**: id, name, credits, price_thb, active
- **verification_requests**: id, tenant_id, api_key_id, idempotency_key (unique per tenant),
  status(pending|verified|failed|invalid|duplicate), trans_ref, sending_bank, amount,
  receiver_account_masked, receiver_name, provider_used, provider_latency_ms,
  raw_provider_response (jsonb), image_gcs_path (nullable), error_code
  - Unique index on (tenant_id, trans_ref) — this powers duplicate-slip detection (§7)
- **providers**: id, code(slipok|easyslip|...), priority, status(up|down|degraded), config (jsonb)
- **webhook_endpoints**: id, tenant_id, url, secret, events, active
- **webhook_deliveries**: id, endpoint_id, event, payload, status, attempts, next_retry_at
- **audit_logs**: id, tenant_id (nullable for system), actor_type(user|api_key|system|admin),
  actor_id, action, target_type, target_id, metadata (jsonb)

## 5. NestJS module structure

```
src/
  common/            # TenantContextService (AsyncLocalStorage), guards, interceptors,
                     # exception filters, idempotency interceptor, pagination utils
  auth/              # social OAuth (Google/Facebook/LINE) -> our JWT; account linking; no passwords
  tenants/           # shop lifecycle (create/switch/suspend), tenant_members, bank_accounts CRUD
  api-keys/          # issue / rotate / revoke; ApiKeyGuard for /v1 routes
  credits/           # ledger service (atomic debit/credit), balance queries
  topup/             # packages, PromptPay top-up flow, self-verify of top-up slips
  verification/      # core domain: POST /v1/verify pipeline, duplicate detection
  providers/         # ProviderAdapter interface + one adapter per upstream + failover
  webhooks/          # endpoint CRUD, signed delivery, retries via Cloud Tasks
  admin/             # cross-tenant owner console (separate auth)
  audit/             # audit log writer (async, must never block the request path)
  health/            # /healthz, /readyz
```

Rule: `verification/` and `providers/` are the only slip-domain modules. Everything else
is the reusable chassis — keep zero slip-specific logic in chassis modules.

## 6. Public API (Phase 1)

Base path `/v1`, auth: `Authorization: Bearer <api_key>`.

- `POST /v1/verify`
  - Body: either `{ "payload": "<raw mini-QR string>" }` or multipart image upload
    (server decodes QR from the image)
  - Headers: `Idempotency-Key` (required). Same key ⇒ same stored response, no double charge
  - Optional expected-values check: `{ "expected_amount": 1500.00, "expected_receiver": "xxx-x-x1234-x" }`
    → response includes `checks: { amount_match, receiver_match }`
  - If `expected_receiver` is omitted and the shop has registered `bank_accounts`, the
    pipeline matches the slip's receiver against those accounts (per each account's
    `verify_mode`) and reports `checks.receiver_match`. A mismatch never changes the
    charge — it is informational in the result
  - Deducts 1 credit only on a completed provider call (verified OR invalid).
    Internal errors / provider outage = no charge
- `GET /v1/verify/{id}` — fetch a past result
- `GET /v1/credits/balance`
- `GET /v1/usage?from=&to=` — daily usage aggregates
- Standard error envelope: `{ error: { code, message } }`; machine-readable `code` values
  (e.g. `insufficient_credits`, `duplicate_slip`, `invalid_qr`, `provider_unavailable`)
- Rate limit per API key (default 10 req/s, configurable per tenant). Postgres-based
  fixed-window counter is acceptable in Phase 1

## 7. Verification pipeline (core domain rules)

1. Validate + idempotency check.
2. Decode mini-QR → extract `transRef`, sending bank code. Invalid/undecodable QR ⇒
   `invalid_qr`, no provider call, no charge.
3. **Duplicate check**: same (tenant_id, trans_ref) already verified ⇒ return
   `duplicate_slip` with reference to the earlier verification. This IS a chargeable,
   successful business result (reusing an old slip is the #1 fraud pattern).
4. Atomic credit reservation: inside a single Postgres transaction, read latest ledger
   balance `FOR UPDATE` (or use a per-tenant advisory lock), insert the debit row, then
   proceed. Insufficient balance ⇒ `insufficient_credits` (HTTP 402).
5. Call provider via failover chain: providers ordered by `priority`; per-call timeout 8s;
   on timeout/5xx move to next provider; simple circuit breaker (mark provider `degraded`
   after N consecutive failures, skip for cooldown period).
6. All providers failed ⇒ refund the reserved credit (compensating ledger entry),
   return `provider_unavailable` (HTTP 503). Optionally enqueue retry via Cloud Tasks
   if the client asked for async mode (Phase 1: sync only is fine).
7. Persist result, fire webhook event `verification.completed` (signed HMAC-SHA256,
   retries with exponential backoff via Cloud Tasks).

Provider adapter contract:

```ts
interface SlipProviderAdapter {
  readonly code: string;
  verify(input: { transRef: string; sendingBank?: string; amount?: number }):
    Promise<ProviderResult>; // normalized shape, raw response preserved separately
}
```

⚠️ Before implementing each adapter: the owner must confirm the upstream provider's ToS
permits resale/aggregation. Do not assume.

**Adapter #1: Slip2Go (slip2go.com)** — chosen as the first upstream provider.
- Known endpoints (verify docs behind login at slip2go.com/guide before coding):
  `api/verify-slip/qr-code/info` (QR payload) and `api/verify-slip/qr-image/info` (image);
  Base64 and image-URL variants also exist. `/info` endpoints return slip data directly;
  duplicate-slip handling is explicitly the caller's responsibility — our §7 step 3 covers this.
- Slip2Go billing is token-based per call (rates may differ per endpoint/channel) — record
  the actual token cost per verification type in config for margin tracking.
- Bonus: Slip2Go also offers PromptPay QR generation APIs — the §9 top-up flow may use it
  for both QR creation and top-up slip verification.
- A separate Queue API exists for high-volume async use (later optimization, not Phase 1).
- Free trial credit (100 slips) available on signup — use for dev/test.

## 8. PDPA / data retention (non-negotiable)

- Slip images: stored in GCS only if uploaded; bucket lifecycle rule deletes objects
  after **7 days**. DB keeps only `image_gcs_path` (becomes dangling after deletion — handle gracefully).
- Long-term we keep: transRef, amounts, bank codes, masked account numbers, verification
  result. We do NOT keep full account numbers or full receiver names beyond the raw
  provider response, and `raw_provider_response` is purged (set to null) by a scheduled
  job after **90 days**.
- Tenant data deletion: implement a `DELETE tenant` admin action that hard-deletes or
  anonymizes all tenant rows (PDPA erasure request support).
- Terms of Service + Privacy Policy pages are part of Phase 1 scope (static pages).

## 9. Billing model (fixed decision)

- Prepaid credits only. No recurring card billing in Phase 1.
- Top-up flow: user picks a package → system shows PromptPay QR (owner's receiving
  account) → user transfers → user uploads the transfer slip → **our own pipeline
  verifies it** (amount match + duplicate check) → credits added via ledger. Manual
  admin approval fallback for edge cases.
- Onboarding flow (fixed): social login → create first shop → add ≥1 bank account → verify slips.
- Free tier: small credit grant (e.g. 20 credits) on the user's FIRST shop only — never per
  shop, or multi-shop creation becomes a free-credit farm.

## 10. Dashboard (Phase 1, keep minimal)

Simple server-rendered or lightweight SPA (owner's choice; do not gold-plate):
social login, shop creation + shop switcher, bank account management (per shop),
API key management, balance + top-up, usage table, verification log with filters,
webhook endpoint config. Thai language UI.

## 11. Testing & quality bar

- Unit tests for: credit ledger atomicity (concurrent debits must not oversell),
  tenant isolation (cross-tenant access attempts must fail), idempotency, duplicate
  detection, provider failover.
- One e2e happy-path test per public endpoint (Nest testing module + test Postgres).
- CI: lint + typecheck + tests must pass before deploy.
- Structured JSON logging (pino); include tenant_id + request_id in every log line.

## 12. Phasing

- **Phase 1 (MVP)**: everything above. Sync verification only. One provider adapter
  live + adapter interface ready for a second.
- **Phase 2**: LINE OA channel (merchant forwards slip image to LINE bot → verify →
  reply result), second provider adapter, async mode.
- **Phase 3**: extract the chassis modules into a template/workspace package for the
  next product (AI employee agent).

## 13. Conventions for Claude Code

- Small, reviewable commits; conventional commit messages.
- When a decision is ambiguous or conflicts with this spec, STOP and ask the owner —
  do not invent new architecture.
- Never log full API keys, full slip payloads, or full account numbers.
- All new tenant-owned tables MUST include `tenant_id` + FK + composite index
  `(tenant_id, created_at)` by default.
