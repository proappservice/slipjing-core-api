# CLAUDE.md — SlipJing (slipjing.com): SaaS ตรวจสอบสลิปโอนเงิน

> วัตถุประสงค์ของไฟล์นี้: สเปกการออกแบบ + กฎการ implement สำหรับ Claude Code
> การตัดสินใจเชิงสถาปัตยกรรมทั้งหมดด้านล่างถือเป็น "ข้อสรุปสุดท้าย" (FINAL) เว้นแต่เจ้าของโปรเจกต์จะเปลี่ยนแปลงอย่างชัดเจน
> ห้ามออกแบบใหม่ ให้ implement ตามสเปกนี้ หากจะเบี่ยงเบนจากสเปกต้องถามก่อน
>
> **เจ้าของอัปเดต 11 ก.ค. 2026**: auth เป็น social login เท่านั้น (Google / Facebook / LINE —
> ไม่มีรหัสผ่าน ไม่มีเบอร์โทร/SMS ใน Phase 1); tenant คือ "ร้านค้า" และ 1 ผู้ใช้มีได้หลายร้าน;
> แต่ละร้านลงทะเบียนบัญชีธนาคารรับเงินของตัวเอง (≥1 บัญชี) — รายละเอียดถูกรวมเข้า §3, §4, §5, §6, §9, §10 แล้ว

## 1. โปรเจกต์นี้คืออะไร

SaaS แบบ multi-tenant สำหรับตรวจสอบว่าสลิปโอนเงินของธนาคารไทย (สลิปโอนเงิน) เป็นของจริง
โดยถอดรหัส mini-QR บนสลิปแล้วสอบถามไปยังผู้ให้บริการตรวจสอบสลิป (upstream provider)

เป้าหมายมี 2 ข้อ เรียงตามลำดับความสำคัญ:
1. **เครื่องมือเรียนรู้ (Learning vehicle)**: ฝึกทำวงจรชีวิต SaaS แบบครบวงจร (tenancy, API keys,
   metering, billing, ops) ใน production กับผู้ใช้จริง
2. **โครงสร้างที่นำกลับมาใช้ใหม่ได้ (Reusable chassis)**: โครงกระดูกของระบบ (โมดูล tenant/auth/api-key/credit/metering/admin)
   จะถูกนำไปใช้ต่อกับผลิตภัณฑ์ AI-agent ที่ใหญ่กว่าในอนาคต — ต้องแยก domain logic
   (การตรวจสอบสลิป) ออกจาก chassis ให้ชัดเจน

ลูกค้าหลัก: ร้านค้าออนไลน์ / นักพัฒนาชาวไทย ช่องทางหลัก: REST API ก่อน
ส่วน LINE OA bot อยู่ใน Phase 2

## 2. Tech stack (กำหนดตายตัว)

- **Runtime**: Node.js LTS, TypeScript strict mode
- **Framework**: NestJS (modular monolith — ห้ามแตกเป็น microservices)
- **DB**: PostgreSQL (Cloud SQL) ORM: Prisma (แนะนำ) หรือ TypeORM — เลือกอย่างใดอย่างหนึ่งแล้วใช้ให้สม่ำเสมอ
- **Deploy**: GCP Cloud Run (scale-to-zero), region asia-southeast1
- **Async jobs / retries**: Cloud Tasks (retry การตรวจสอบ, การส่ง webhook)
- **Object storage**: GCS bucket สำหรับรูปสลิป พร้อม lifecycle rule (ดู §8 PDPA)
- **Secrets**: GCP Secret Manager ห้าม commit secret เด็ดขาด ใช้ `.env` เฉพาะ local dev เท่านั้น
- **ไม่ใช้ Redis ใน Phase 1** — rate limiting และ counter ใช้ Postgres จะเพิ่ม Redis เมื่อวัดโหลดจริงแล้วจำเป็นเท่านั้น

## 3. โมเดล Multi-tenancy (ตัดสินใจแล้ว — ตายตัว)

- **tenant คือ "ร้านค้า"** — แบบเดียวกับ Slip2Go: 1 บัญชีผู้ใช้เป็นเจ้าของ/สมาชิกได้หลายร้าน
  แต่ละร้านมีเครดิต, API key, บัญชีธนาคาร, webhook และการใช้งานแยกกันทั้งหมด
  ผู้ใช้เชื่อมกับ tenant ผ่านตาราง `tenant_members` (many-to-many พร้อม role)
  หลังสมัครสมาชิก ผู้ใช้**ต้องสร้างร้านก่อน**จึงจะใช้งานอย่างอื่นได้ (onboarding gate)
- ใช้ database เดียว schema เดียวร่วมกัน ทุกตารางที่เป็นของ tenant ต้องมี `tenant_id` แบบ non-null
- **การแยกข้อมูล (isolation) ต้องถูกบังคับโดย framework ไม่ใช่พึ่งวินัยของนักพัฒนา:**
  - Resolve tenant จาก API key (public API) ส่วนฝั่ง dashboard ใช้ JWT **บวกกับร้านที่เลือกอยู่**
    (claim หรือ header `X-Shop-Id`) — guard ต้องตรวจความเป็นสมาชิกจาก `tenant_members`
    ก่อน set tenant context เสมอ
  - ส่งต่อ tenant context ผ่าน `AsyncLocalStorage` (ผ่าน `TenantContextService`)
  - การเข้าถึงตารางของ tenant ผ่าน repository/Prisma ทั้งหมด ต้องผ่าน data-access layer
    ชั้นบางๆ ที่ inject `tenant_id` ให้อัตโนมัติ การเข้าถึงตรงๆ ที่ข้าม layer นี้ต้องไม่ผ่าน
    code review — ให้เพิ่ม ESLint rule หรือ naming convention เพื่อจับกรณีนี้
  - ทุก query path ที่ไม่มี tenant context ต้อง throw error ห้าม return ข้อมูลทุก tenant เงียบๆ เด็ดขาด
- Endpoint ของ Admin (เจ้าของระบบ) อยู่ในโมดูล `/admin` แยกต่างหากพร้อม auth ของตัวเอง
  และเป็นโค้ดเดียวที่อนุญาตให้ query ข้าม tenant ได้

## 4. Database schema (Phase 1)

ข้อตกลง: `id` = UUID v7 PK; ทุกตารางมี `created_at`/`updated_at` เป็น timestamptz;
เงิน/เครดิตเป็น `BIGINT` หน่วยจำนวนเต็ม (1 เครดิต = 1 การตรวจสอบ) ห้ามใช้ float เด็ดขาด

- **tenants** (= ร้านค้า): id, name, logo_gcs_path (nullable), status(active|suspended), plan metadata
- **users**: id, email (unique — ได้จาก social provider), display_name, avatar_url
  - ไม่มี column รหัสผ่าน — Phase 1 เป็น social login เท่านั้น (ยังไม่มีเบอร์โทร/SMS เพราะยังส่ง SMS ไม่ได้)
- **auth_identities**: id, user_id, provider(google|facebook|line), provider_user_id,
  email_at_link — unique (provider, provider_user_id); ผู้ใช้ 1 คน link ได้หลาย provider
- **tenant_members**: id, tenant_id, user_id, role(owner|member) — unique (tenant_id, user_id)
- **bank_accounts**: id, tenant_id, bank_code, account_number, account_name_th,
  account_name_en, verify_mode(number|name|both), active
  - บัญชีรับเงินของร้านเอง (ร้านกรอกให้เองโดยยินยอม เก็บเลขเต็ม — จำเป็นสำหรับการ match
    ผู้รับใน §7) · 1 ร้านลงทะเบียนได้หลายบัญชี (1:N)
- **api_keys**: id, tenant_id, name, key_prefix (8 ตัวอักษรแรก สำหรับแสดงผล),
  key_hash (SHA-256 ของ key เต็ม), last_used_at, revoked_at
  - รูปแบบ key เต็ม: `sj_live_<32 random bytes base62>` (test key: `sj_test_`); แสดงให้ผู้ใช้เห็นครั้งเดียวตอนสร้างเท่านั้น
- **credit_ledger** (append-only; เป็น source of truth ของยอดคงเหลือ):
  id, tenant_id, delta (BIGINT, + สำหรับเติมเงิน / - สำหรับใช้งาน), reason(topup|verify|refund|adjust),
  ref_type, ref_id, balance_after
  - ยอดคงเหลือ = `balance_after` ล่าสุด ห้ามเก็บ balance เป็น column ที่แก้ไขได้บนตาราง `tenants` เด็ดขาด
- **topup_orders**: id, tenant_id, package_id, amount_thb, credits, status(pending|paid|expired),
  payment_method(promptpay), payment_ref, verified_slip_id (nullable)
  - Dogfooding: สลิปเติมเงิน PromptPay ถูกตรวจสอบด้วย pipeline ตรวจสอบของเราเอง
- **credit_packages**: id, name, credits, price_thb, active
- **verification_requests**: id, tenant_id, api_key_id, idempotency_key (unique ต่อ tenant),
  status(pending|verified|failed|invalid|duplicate), trans_ref, sending_bank, amount,
  receiver_account_masked, receiver_name, provider_used, provider_latency_ms,
  raw_provider_response (jsonb), image_gcs_path (nullable), error_code
  - Unique index บน (tenant_id, trans_ref) — ใช้ขับเคลื่อนการตรวจจับสลิปซ้ำ (§7)
- **providers**: id, code(slipok|easyslip|...), priority, status(up|down|degraded), config (jsonb)
- **webhook_endpoints**: id, tenant_id, url, secret, events, active
- **webhook_deliveries**: id, endpoint_id, event, payload, status, attempts, next_retry_at
- **audit_logs**: id, tenant_id (nullable สำหรับ system), actor_type(user|api_key|system|admin),
  actor_id, action, target_type, target_id, metadata (jsonb)

## 5. โครงสร้างโมดูล NestJS

```
src/
  common/            # TenantContextService (AsyncLocalStorage), guards, interceptors,
                     # exception filters, idempotency interceptor, pagination utils
  auth/              # social OAuth (Google/Facebook/LINE) -> JWT ของเรา; link บัญชี; ไม่มีรหัสผ่าน
  tenants/           # วงจรชีวิตร้านค้า (สร้าง/สลับ/ระงับ), tenant_members, CRUD บัญชีธนาคาร
  api-keys/          # ออก / rotate / เพิกถอน key; ApiKeyGuard สำหรับ route /v1
  credits/           # ledger service (debit/credit แบบ atomic), การดูยอดคงเหลือ
  topup/             # แพ็กเกจ, flow เติมเงิน PromptPay, ตรวจสอบสลิปเติมเงินด้วยตัวเอง
  verification/      # core domain: pipeline ของ POST /v1/verify, การตรวจจับสลิปซ้ำ
  providers/         # ProviderAdapter interface + adapter ต่อ upstream แต่ละราย + failover
  webhooks/          # CRUD ของ endpoint, การส่งแบบ signed, retry ผ่าน Cloud Tasks
  admin/             # console ของเจ้าของระบบ ข้าม tenant ได้ (auth แยกต่างหาก)
  audit/             # ตัวเขียน audit log (async ห้าม block request path เด็ดขาด)
  health/            # /healthz, /readyz
```

กฎ: `verification/` และ `providers/` เป็นโมดูล slip-domain เพียงสองโมดูลเท่านั้น ที่เหลือทั้งหมด
คือ chassis ที่นำกลับมาใช้ใหม่ได้ — ห้ามมี logic เกี่ยวกับสลิปในโมดูล chassis เด็ดขาด

## 6. Public API (Phase 1)

Base path `/v1`, auth: `Authorization: Bearer <api_key>`

- `POST /v1/verify`
  - Body: `{ "payload": "<raw mini-QR string>" }` หรืออัปโหลดรูปแบบ multipart
    (เซิร์ฟเวอร์ถอดรหัส QR จากรูปเอง)
  - Headers: `Idempotency-Key` (บังคับ) key เดิม ⇒ ได้ response เดิมที่เก็บไว้ ไม่หักเครดิตซ้ำ
  - ตรวจสอบค่าที่คาดหวังได้ (optional): `{ "expected_amount": 1500.00, "expected_receiver": "xxx-x-x1234-x" }`
    → response จะมี `checks: { amount_match, receiver_match }`
  - ถ้าไม่ส่ง `expected_receiver` มา และร้านลงทะเบียน `bank_accounts` ไว้ pipeline จะ match
    ผู้รับเงินบนสลิปกับบัญชีของร้าน (ตาม `verify_mode` ของแต่ละบัญชี) แล้วรายงานใน
    `checks.receiver_match` — ไม่ตรงก็ไม่กระทบการหักเครดิต เป็นข้อมูลแจ้งในผลลัพธ์เท่านั้น
  - หัก 1 เครดิตเฉพาะเมื่อการเรียก provider เสร็จสมบูรณ์เท่านั้น (verified หรือ invalid ก็ตาม)
    Internal error / provider ล่ม = ไม่หักเครดิต
- `GET /v1/verify/{id}` — ดึงผลลัพธ์ที่เคยตรวจสอบไปแล้ว
- `GET /v1/credits/balance`
- `GET /v1/usage?from=&to=` — สรุปการใช้งานรายวัน
- Error envelope มาตรฐาน: `{ error: { code, message } }`; ค่า `code` ต้องอ่านได้ด้วยเครื่อง
  (เช่น `insufficient_credits`, `duplicate_slip`, `invalid_qr`, `provider_unavailable`)
- Rate limit ต่อ API key (ค่าเริ่มต้น 10 req/s ปรับได้ต่อ tenant) — fixed-window counter
  ที่ใช้ Postgres ถือว่ายอมรับได้ใน Phase 1

## 7. Pipeline การตรวจสอบ (กฎของ core domain)

1. Validate + ตรวจ idempotency
2. ถอดรหัส mini-QR → ดึง `transRef` และรหัสธนาคารต้นทาง QR ไม่ถูกต้อง/ถอดรหัสไม่ได้ ⇒
   `invalid_qr` ไม่เรียก provider ไม่หักเครดิต
3. **ตรวจสลิปซ้ำ**: (tenant_id, trans_ref) เดิมเคยตรวจสอบแล้ว ⇒ return
   `duplicate_slip` พร้อมอ้างอิงถึงการตรวจสอบครั้งก่อน กรณีนี้ **ถือเป็น** ผลลัพธ์ทางธุรกิจ
   ที่สำเร็จและคิดเครดิตได้ (การนำสลิปเก่ามาใช้ซ้ำคือรูปแบบการโกงอันดับ 1)
4. จองเครดิตแบบ atomic: ภายใน Postgres transaction เดียว อ่านยอดล่าสุดจาก ledger
   ด้วย `FOR UPDATE` (หรือใช้ advisory lock ต่อ tenant) แล้ว insert แถว debit จากนั้นจึงดำเนินการต่อ
   ยอดไม่พอ ⇒ `insufficient_credits` (HTTP 402)
5. เรียก provider ผ่าน failover chain: เรียงตาม `priority`; timeout ต่อการเรียก 8 วินาที;
   ถ้า timeout/5xx ให้ข้ามไป provider ถัดไป; มี circuit breaker แบบง่าย (ตั้งสถานะ provider
   เป็น `degraded` หลังล้มเหลวติดต่อกัน N ครั้ง แล้วข้ามไปช่วง cooldown)
6. Provider ล้มเหลวทั้งหมด ⇒ คืนเครดิตที่จองไว้ (บันทึก ledger entry ชดเชย),
   return `provider_unavailable` (HTTP 503) อาจ enqueue retry ผ่าน Cloud Tasks
   ถ้า client ขอโหมด async (Phase 1: ทำแค่ sync ก็เพียงพอ)
7. บันทึกผลลัพธ์ แล้วยิง webhook event `verification.completed` (ลงลายเซ็น HMAC-SHA256,
   retry แบบ exponential backoff ผ่าน Cloud Tasks)

สัญญา (contract) ของ provider adapter:

```ts
interface SlipProviderAdapter {
  readonly code: string;
  verify(input: { transRef: string; sendingBank?: string; amount?: number }):
    Promise<ProviderResult>; // รูปแบบ normalized, raw response เก็บแยกต่างหาก
}
```

⚠️ ก่อน implement adapter แต่ละตัว: เจ้าของโปรเจกต์ต้องยืนยันก่อนว่า ToS ของ provider ต้นทาง
อนุญาตให้ resell/aggregate ได้ — ห้ามสันนิษฐานเอง

**Adapter #1: Slip2Go (slip2go.com)** — เลือกเป็น upstream provider รายแรก
- Endpoint ที่ทราบ (ตรวจสอบเอกสารหลัง login ที่ slip2go.com/guide ก่อนเขียนโค้ด):
  `api/verify-slip/qr-code/info` (QR payload) และ `api/verify-slip/qr-image/info` (รูปภาพ);
  มีแบบ Base64 และ image-URL ด้วย endpoint `/info` คืนข้อมูลสลิปโดยตรง;
  การจัดการสลิปซ้ำเป็นความรับผิดชอบของฝั่งผู้เรียกอย่างชัดเจน — §7 ข้อ 3 ของเราครอบคลุมเรื่องนี้แล้ว
- ระบบคิดเงินของ Slip2Go เป็นแบบ token ต่อการเรียก (เรตอาจต่างกันตาม endpoint/ช่องทาง) — ให้บันทึก
  ต้นทุน token จริงต่อประเภทการตรวจสอบไว้ใน config เพื่อติดตาม margin
- โบนัส: Slip2Go มี API สร้าง PromptPay QR ด้วย — flow เติมเงินใน §9 อาจใช้ได้ทั้ง
  การสร้าง QR และการตรวจสอบสลิปเติมเงิน
- มี Queue API แยกต่างหากสำหรับงาน async ปริมาณสูง (เป็น optimization ภายหลัง ไม่ใช่ Phase 1)
- มีเครดิตทดลองใช้ฟรี (100 สลิป) เมื่อสมัคร — ใช้สำหรับ dev/test

## 8. PDPA / การเก็บรักษาข้อมูล (ต่อรองไม่ได้)

- รูปสลิป: เก็บใน GCS เฉพาะกรณีที่มีการอัปโหลดเท่านั้น; lifecycle rule ของ bucket ลบ object
  หลัง **7 วัน** DB เก็บเพียง `image_gcs_path` (จะกลายเป็น dangling หลังถูกลบ — ต้อง handle อย่างเหมาะสม)
- ข้อมูลที่เก็บระยะยาว: transRef, จำนวนเงิน, รหัสธนาคาร, เลขบัญชีแบบ masked, ผลการตรวจสอบ
  เรา **ไม่เก็บ** เลขบัญชีเต็มหรือชื่อผู้รับเต็มนอกเหนือจาก raw provider response
  และ `raw_provider_response` จะถูกล้าง (set เป็น null) โดย scheduled job หลัง **90 วัน**
- การลบข้อมูล tenant: implement admin action `DELETE tenant` ที่ hard-delete หรือ
  anonymize ทุกแถวของ tenant นั้น (รองรับคำขอลบข้อมูลตาม PDPA)
- หน้า Terms of Service + Privacy Policy อยู่ในขอบเขตของ Phase 1 (หน้า static)

## 9. โมเดลการคิดเงิน (ตัดสินใจแล้ว — ตายตัว)

- เครดิตแบบเติมเงินล่วงหน้า (prepaid) เท่านั้น ไม่มีการตัดบัตรรายเดือนใน Phase 1
- Flow เติมเงิน: ผู้ใช้เลือกแพ็กเกจ → ระบบแสดง PromptPay QR (บัญชีรับเงินของเจ้าของระบบ)
  → ผู้ใช้โอนเงิน → ผู้ใช้อัปโหลดสลิปโอน → **pipeline ของเราเองตรวจสอบสลิป**
  (ตรวจจำนวนเงินตรงกัน + ตรวจสลิปซ้ำ) → เพิ่มเครดิตผ่าน ledger
  มีช่องทางให้ admin อนุมัติเองสำหรับกรณี edge case
- Onboarding flow (ตายตัว): social login → สร้างร้านแรก → เพิ่มบัญชีธนาคาร ≥1 บัญชี → เริ่มตรวจสลิป
- Free tier: ให้เครดิตเล็กน้อย (เช่น 20 เครดิต) เฉพาะ**ร้านแรกของผู้ใช้เท่านั้น** — ห้ามให้ต่อร้าน
  ไม่งั้นการสร้างหลายร้านจะกลายเป็นช่องฟาร์มเครดิตฟรี

## 10. Dashboard (Phase 1 — ทำให้เรียบง่ายที่สุด)

Server-rendered แบบง่ายๆ หรือ SPA ขนาดเบา (เจ้าของโปรเจกต์เลือกได้; อย่าทำเกินความจำเป็น):
social login, สร้างร้าน + สลับร้าน, จัดการบัญชีธนาคาร (ต่อร้าน), จัดการ API key,
ยอดคงเหลือ + เติมเงิน, ตารางการใช้งาน, log การตรวจสอบพร้อม filter,
ตั้งค่า webhook endpoint — UI เป็นภาษาไทย

## 11. การทดสอบ & มาตรฐานคุณภาพ

- Unit test สำหรับ: ความ atomic ของ credit ledger (การ debit พร้อมกันต้องไม่ขายเกินยอด),
  tenant isolation (ความพยายามเข้าถึงข้าม tenant ต้องล้มเหลว), idempotency,
  การตรวจจับสลิปซ้ำ, provider failover
- E2e happy-path test อย่างน้อย 1 เคสต่อ public endpoint (Nest testing module + test Postgres)
- CI: lint + typecheck + tests ต้องผ่านก่อน deploy
- Structured JSON logging (pino); ทุก log line ต้องมี tenant_id + request_id

## 12. การแบ่ง Phase

- **Phase 1 (MVP)**: ทุกอย่างข้างต้น ตรวจสอบแบบ sync เท่านั้น มี provider adapter
  ใช้งานจริง 1 ตัว + adapter interface พร้อมสำหรับตัวที่สอง
- **Phase 2**: ช่องทาง LINE OA (ร้านค้า forward รูปสลิปมาที่ LINE bot → ตรวจสอบ →
  ตอบผลกลับ), provider adapter ตัวที่สอง, โหมด async
- **Phase 3**: แยกโมดูล chassis ออกมาเป็น template/workspace package สำหรับ
  ผลิตภัณฑ์ถัดไป (AI employee agent)

## 13. ข้อตกลงสำหรับ Claude Code

- Commit ขนาดเล็ก review ง่าย; ใช้ conventional commit messages
- เมื่อการตัดสินใจใดกำกวมหรือขัดแย้งกับสเปกนี้ ให้ **หยุด** แล้วถามเจ้าของโปรเจกต์ —
  ห้ามคิดค้นสถาปัตยกรรมใหม่เอง
- ห้าม log API key เต็ม, slip payload เต็ม, หรือเลขบัญชีเต็ม เด็ดขาด
- ตารางใหม่ทุกตารางที่เป็นของ tenant **ต้อง** มี `tenant_id` + FK + composite index
  `(tenant_id, created_at)` เป็นค่าเริ่มต้นเสมอ
