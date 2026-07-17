# SlipJing — สรุปส่งต่อ conversation ใหม่ (17 ก.ค. 2026)

> สำหรับ Claude session ใหม่: อ่านไฟล์นี้ + CLAUDE.md ของ repo ที่กำลังทำงาน แล้วทำงานต่อได้เลย
> ตอบเจ้าของ (คุณป้อม pakpoom@proapps.co.th) **เป็นภาษาไทยเสมอ** ศัพท์เทคนิคคงอังกฤษ

## 1. โปรเจกต์คืออะไร

**SlipJing (slipjing.com)** — SaaS ตรวจสอบสลิปโอนเงินธนาคารไทยสำหรับร้านค้าออนไลน์
โมเดลธุรกิจ: reseller — ลูกค้ายิง API เรา (จ่ายเครดิต) → เราตรวจผ่าน upstream provider (จ่ายโทเคน) → กิน margin
คู่แข่ง/ต้นแบบ UX: slip2go.com · มูลค่าเพิ่มของเรา: จับสลิปซ้ำใน DB ตัวเอง (ไม่เสียโทเคนซ้ำ),
เช็คผู้รับกับบัญชีร้านอัตโนมัติ, idempotency, failover หลาย provider

## 2. โครงสร้าง (2 repos ใน ~/proapps/ProappProjects/)

| repo | stack | GitHub |
|---|---|---|
| `slipjing-core-api` | NestJS modular monolith + Prisma + Postgres (docker :5433) — API :3000 | proappservice/slipjing-core-api |
| `slipjing-web` | Next.js 16 App Router + Tailwind v4 — เว็บ :3001 (`npm run dev` ตั้งพอร์ตให้แล้ว) | proappservice/slipjing-web |

- push ผ่าน ssh alias `github-proapp` (key `~/.ssh/id_ed25519_proapp`, passphrase ใน macOS Keychain แล้ว)
- สเปกธุรกิจฉบับเต็ม: `slipjing-core-api/CLAUDE.md` (ไทย: CLAUDE.th.md) · บริบท frontend: `slipjing-web/CLAUDE.md`
- คู่มือรัน local + deploy Cloud Run: `slipjing-core-api/docs/deployment.md` · frontend: `slipjing-web/README.md`

## 3. การตัดสินใจที่ FINAL แล้ว (ห้ามรื้อโดยไม่ถาม)

- **tenant = ร้านค้า** (1 ผู้ใช้หลายร้านผ่าน `tenant_members`) · dashboard ส่ง header `X-Shop-Id` ทุก request
- **Social login เท่านั้น** (Google/Facebook/LINE) — ไม่มี password/เบอร์โทร · หน้า login/register แยกกัน
- เครดิต prepaid, ledger append-only + advisory lock ต่อ tenant · **ฟรี 20 เครดิตเฉพาะร้านแรกของผู้ใช้**
- **Provider chain: Thunder (หลัก) → Slip2Go (fallback)** — ลำดับตั้งผ่าน env `PROVIDER_CHAIN`
- แบรนด์: โลโก้ **ริบบิ้นเครื่องหมายถูก (แบบ D — ไม่มีตัวอักษร)** · สี navy #14213D / blue #2C5FBE /
  sky #6D9BE8 / green #1E9E5A · wordmark "SlipJing" ติดกัน · ไฟล์โลโก้ครบใน `slipjing-web/brand/`
- Dashboard sidebar = **โทนอ่อนแบบ A** (พื้นขาว) ห้ามกลับไปพื้นเข้ม · เมนูจัดหมวดแบบ slip2go ไม่มี E-Catalog
- Next.js เพราะ SEO หน้า public (เจ้าของเคยลังเล Vite แล้วเคาะแล้ว)

## 4. สถานะที่ทดสอบจริงผ่านแล้ว

**Backend ครบและพิสูจน์กับธุรกรรมจริง:** `/v1/verify` pipeline เต็ม (idempotency, ถอด mini-QR TLV,
จับสลิปซ้ำ=คิดเครดิต, จอง/คืนเครดิต atomic, ตรวจยอด+ผู้รับ — matcher รองรับคำนำหน้าชื่อ+นามสกุลย่อ),
สลิปจริง KBank→SCB 125 บาท: verified + checks ผ่านหมด, duplicate ตรวจจับได้, Thunder ~170ms ·
tests 22/22 · Dockerfile ทดสอบ build+run แล้ว · seed dev: `npm run db:seed` →
API key ทดสอบ `sj_test_LocalDevOnlyKey00000000000000001` (ร้านทดสอบ local)

**Frontend ครบ:** landing (ตาม mockup ที่ approve), /pricing, /login, /register ·
dashboard 8 หน้า: เลือก/สร้างร้าน, ภาพรวม (tiles+กราф 7 วัน), **ตรวจสลิป** (อัปโหลดรูป → ถอด QR
ในเบราว์เซอร์ด้วย jsQR → ยิง `POST /shops/verifications`), บัญชีธนาคาร, API keys (key โชว์ครั้งเดียว),
เติมเครดิต (มี modal ยืนยัน — เจ้าของเข้มเรื่องต้อง confirm ก่อน action), ประวัติตรวจ, webhooks ·
การ์ดร้าน+เครดิตคงเหลือมุมซ้ายบน sidebar

**Auth:** Google OAuth ใช้จริงได้ (ปุ่ม GIS — เคยลองเปลี่ยนเป็น custom code flow แล้วเจ้าของสั่ง revert
อย่าเสนอใหม่) · **LINE Login โค้ดครบทั้งสองฝั่ง** (ปุ่ม → authorize → /auth/line/callback →
backend POST /auth/line แลก code) channel 2010729577 Published, callback localhost:3001 ลงทะเบียนแล้ว,
config ทดสอบกับ LINE จริงผ่าน — **เหลือแค่เจ้าของกดทดสอบรอบสุดท้าย (backend ต้องรันอยู่)** ·
Facebook = ปุ่ม disabled "เร็วๆ นี้" · ปุ่ม social: ไอคอน LINE ใช้ PNG ทางการ `public/icons/line.png` 25px,
hover เป็นพื้นฟ้าอ่อนแบบ GIS ทุกปุ่ม

## 5. บัญชี/คีย์ภายนอก (ค่าจริงอยู่ใน .env / .env.local — ไม่อยู่ใน git)

| บริการ | รายละเอียด | หมดอายุ |
|---|---|---|
| Thunder (provider หลัก) | api.thunder.in.th/v2 · app "ProappSecure" · quota trial ~97/100 | **30 ก.ค. 2026** |
| Slip2Go (fallback) | connect.slip2go.com/api · ร้าน ProService · ~47 โทเคน | **~18-19 ก.ค. 2026** |
| Google OAuth | GCP project `proapp-slipjing` | — |
| LINE Login | channel 2010729577 (Published) | — |
| ⚠️ ทุก key + รหัสผ่านบางตัวเคยถูกแชร์ในแชท | **ต้อง rotate ทั้งหมดก่อน production** | |

ผู้ใช้ทดสอบจริงใน DB: bomkuber@gmail.com (Google) ร้าน "My Friend Bakery" และ "ลุงบอมน้ำเต้าหู้"
(มีบัญชี SCB 1062346113 + API key production ที่ใช้เทสสลิปจริง)

## 6. งานที่เหลือ (เรียงตามที่คุยกันไว้)

1. **ยืนยัน LINE login รอบสุดท้าย** (กดปุ่มเมื่อ backend รัน)
2. **Deploy Cloud Run** (docs/deployment.md พร้อม) — ปลดล็อก LIFF/LINE OA rich menu ด้วย
   (สถาปัตยกรรมสรุปแล้ว: สร้าง OA + จด LIFF ใน LINE Login channel เดิม + หน้า /liff ใช้ /auth/social เดิม)
3. PromptPay QR + self-verify สลิปเติมเงิน (ตอนนี้ order = รอ admin อนุมัติผ่าน /admin)
4. หน้า ToS/PDPA (บังคับ Phase 1) · เอกสาร API ลูกค้า · หน้าแอดมินร้าน (invite via tenant_members) · Facebook login
5. Rate limit ต่อ key · CI · GCS รูปสลิป (ลบ 7 วัน) · purge raw_response 90 วัน · Cloud Tasks webhook retry
6. ราคาแพ็กเกจยังเป็นตัวเลขสมมติ — เจ้าของยังไม่เคาะ

## 7. วิธีทำงานที่เจ้าของต้องการ

- **commit + push ก่อนแก้ใหญ่ทุกครั้ง** (ต้อง rollback ได้) · conventional commits
- อย่าเปิด server แข่งพอร์ตกับ terminal ของเจ้าของ — เช็คก่อน (`lsof -ti :3000`) แจ้งชัดถ้าเปิดให้
- UI ต้องมี confirm ก่อน action ที่สร้างข้อมูล/เสียเงิน
- ถ้าเปลี่ยนแปลงขัดสเปก/mockup ให้ถามก่อน · อย่า gold-plate
- Artifacts (mockup/โลโก้) อยู่ในบัญชี claude.ai ของเจ้าของ — mockups: artifact 561c2b01… ·
  โลโก้: f5d4ccd3… · sidebar options: 8eb4b11e…
