# slipjing-core-api

Backend ของ SlipJing (slipjing.com) — SaaS ตรวจสอบสลิปโอนเงินธนาคารไทย
สเปกฉบับเต็มอยู่ที่ [CLAUDE.md](CLAUDE.md) (ภาษาไทย: [CLAUDE.th.md](CLAUDE.th.md))

NestJS modular monolith · PostgreSQL (Prisma) · Cloud Run · social login เท่านั้น (Google/Facebook/LINE)

## เริ่มพัฒนา

```bash
cp .env.example .env        # ตั้งค่า secrets สำหรับ local
npm install
npm run db:up               # Postgres 16 บน localhost:5433 (docker)
npx prisma migrate dev      # สร้าง schema
npm run db:seed             # ผู้ใช้ + ร้าน + เครดิต 100 + API key ทดสอบ
npm run start:dev           # http://localhost:3000
```

ตรวจสุขภาพ: `GET /healthz`, `GET /readyz`

## ทดสอบในเครื่อง

seed สร้าง API key ค่าคงที่สำหรับ dev: `sj_test_LocalDevOnlyKey00000000000000001`

```bash
KEY="Authorization: Bearer sj_test_LocalDevOnlyKey00000000000000001"

# ยอดเครดิต
curl http://localhost:3000/v1/credits/balance -H "$KEY"

# QR เสีย → invalid_qr, ไม่หักเครดิต (ยิงซ้ำ Idempotency-Key เดิม = ได้ผลเดิม)
curl -X POST http://localhost:3000/v1/verify -H "$KEY" \
  -H 'content-type: application/json' -H 'Idempotency-Key: t1' \
  -d '{"payload":"not-a-qr"}'

# TLV ถูกต้อง: ถ้ายังไม่ใส่ SLIP2GO_API_KEY จะได้ provider_unavailable + คืนเครดิตอัตโนมัติ
curl -X POST http://localhost:3000/v1/verify -H "$KEY" \
  -H 'content-type: application/json' -H 'Idempotency-Key: t2' \
  -d '{"payload":"0031000201010301402140141A2K9X4TQ88"}'

# สรุปการใช้งานรายวัน
curl "http://localhost:3000/v1/usage" -H "$KEY"
```

เทสเส้นทาง "สลิปจริง + สลิปซ้ำ" ครบวงจร: สมัคร free trial ที่ slip2go.com (ฟรี 100 สลิป)
→ ใส่ `SLIP2GO_API_KEY` ใน `.env` → สแกน mini-QR จากสลิปจริง (แอปธนาคาร) เอา payload
มายิง `/v1/verify` — ยิงใบเดิมซ้ำ (คนละ Idempotency-Key) จะได้ `duplicate_slip`

## โครงโมดูล (CLAUDE.md §5)

`common/` tenant context (AsyncLocalStorage) + Prisma + error envelope ·
`auth/` social OAuth → JWT ·
`tenants/` ร้านค้า + สมาชิก + บัญชีธนาคาร ·
`api-keys/` ออก/เพิกถอน key + guard ของ `/v1` ·
`credits/` ledger แบบ append-only (atomic ด้วย advisory lock) ·
`verification/` pipeline ตรวจสลิป + ตรวจสลิปซ้ำ ·
`providers/` Slip2Go adapter + failover chain ·
`webhooks/` ส่ง event พร้อมลายเซ็น HMAC ·
`topup/` เติมเครดิตผ่าน PromptPay ·
`admin/` console ข้าม tenant (auth แยก) ·
`audit/` audit log แบบ async ·
`health/`

## คำสั่งที่ใช้บ่อย

```bash
npm run build        # typecheck + compile
npm test             # unit tests
npm run lint         # eslint (ยังไม่ตั้งค่า — TODO)
npx prisma studio    # ดูข้อมูลใน DB
```

## สถานะ / งานถัดไป

- [x] โครงโมดูลครบ + build/tests ผ่าน + boot ได้จริง
- [x] เชื่อม Slip2Go จริงแล้ว (base: `connect.slip2go.com/api` · body: `{"payload":{"qrCode":…}}` ·
      ตอบ HTTP 200 เสมอ + `code` string: `200000` = พบสลิป, 200401/402/403/404, 200500 fraud → map ใน adapter ·
      โครง `data` ยืนยันจากเอกสารทางการแล้ว (transRef, dateTime, amount, receiver/sender.account.bank.account) ·
      ⚠️ ทุก call หักโทเคนแม้ผลคือสลิปปลอม) — เหลือ sanity check กับสลิปจริง 1 ใบ
- [ ] ยืนยันโครง TLV ของ mini-QR กับสลิปจริง (`src/verification/mini-qr.ts`)
- [ ] อัปโหลดรูปสลิป (multipart + ถอด QR จากรูป + GCS 7-day lifecycle)
- [ ] Rate limit ต่อ API key (Postgres fixed-window)
- [ ] Top-up self-verify ด้วย pipeline ตัวเอง + PromptPay QR
- [ ] Retry webhook ผ่าน Cloud Tasks · scheduled purge `raw_provider_response` (90 วัน)
- [ ] ESLint config + CI + e2e tests + Dockerfile/Cloud Run deploy
