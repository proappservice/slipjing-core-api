# การรันและ Deploy — SlipJing Core API

> อ้างอิงสเปก: [CLAUDE.md](../CLAUDE.md) §2 — Deploy บน GCP Cloud Run (scale-to-zero), region `asia-southeast1`,
> DB คือ Cloud SQL (PostgreSQL), secrets เก็บใน GCP Secret Manager เท่านั้น

---

## 1. รันบนเครื่อง local

### สิ่งที่ต้องมี

| เครื่องมือ | เวอร์ชัน | หมายเหตุ |
|---|---|---|
| Node.js | ≥ 22 (LTS) | ตรวจ: `node --version` |
| Docker Desktop | ล่าสุด | ใช้รัน Postgres — ต้องเปิดแอปก่อน (`open -a Docker`) |

### ครั้งแรก (setup)

```bash
cd slipjing-core-api
npm install                # ติดตั้ง dependencies
cp .env.example .env       # ⚠️ ถ้ามี .env อยู่แล้ว (มี SLIP2GO_API_KEY) ห้ามทับ — ข้ามขั้นนี้
npm run db:up              # Postgres 16 ใน docker ที่ localhost:5433
npx prisma migrate dev     # สร้างตารางทั้งหมด
npm run db:seed            # ข้อมูลทดสอบ: ผู้ใช้ + ร้าน + เครดิต 100 + API key ทดสอบ
```

> พอร์ต DB คือ **5433** (ไม่ใช่ 5432) เพราะเครื่อง dev มี Postgres ของโปรเจกต์อื่นอยู่แล้ว
> ต่อด้วย DB client: `localhost:5433` · user/password/db = `slipjing` หรือใช้ `npx prisma studio`

### รันทุกวัน

```bash
npm run db:up              # ถ้า container ยังไม่รัน
npm run start:dev          # http://localhost:3000 (watch mode — แก้โค้ดแล้ว reload เอง)
```

### ทดสอบว่าใช้งานได้

```bash
curl http://localhost:3000/healthz    # → {"status":"ok"}
curl http://localhost:3000/readyz     # → {"status":"ready"} = ต่อ DB สำเร็จ

KEY="Authorization: Bearer sj_test_LocalDevOnlyKey00000000000000001"   # จาก db:seed
curl http://localhost:3000/v1/credits/balance -H "$KEY"

# ตรวจสลิป (ต้องมี SLIP2GO_API_KEY ใน .env — ทุก call มีต้นทุนโทเคนของ Slip2Go)
curl -X POST http://localhost:3000/v1/verify -H "$KEY" \
  -H 'content-type: application/json' -H 'Idempotency-Key: t1' \
  -d '{"payload":"<mini-QR string จากสลิปจริง>"}'
```

### คำสั่งอื่นที่ใช้บ่อย

```bash
npm run build        # typecheck + compile
npm test             # unit tests
npx prisma migrate dev --name <ชื่อ>   # สร้าง migration ใหม่หลังแก้ schema.prisma
docker compose down                     # ปิด Postgres (ข้อมูลอยู่ใน volume ไม่หาย)
```

### ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop ยังไม่เปิด → `open -a Docker` รอ ~20 วิ |
| `P1001: Can't reach database server` | Postgres ยังไม่รัน → `npm run db:up` |
| `port is already allocated` | มี process อื่นใช้พอร์ต → เช็ค `docker ps` / แก้พอร์ตใน docker-compose.yml + .env |
| ทุก endpoint ตอบ `unauthorized` | ลืม header `Authorization: Bearer sj_...` หรือยังไม่ได้ `npm run db:seed` |

---

## 2. Deploy ขึ้น Production (GCP Cloud Run)

สถาปัตยกรรม production ตามสเปก:

```
api.slipjing.com → Cloud Run (asia-southeast1, scale-to-zero)
                     ├── Cloud SQL PostgreSQL (private connector)
                     ├── Secret Manager (ทุก secret)
                     └── Slip2Go (upstream)
```

### 2.1 เตรียมครั้งเดียว (bootstrap โปรเจกต์ GCP)

```bash
gcloud auth login
gcloud projects create slipjing-prod --name="SlipJing"      # หรือใช้โปรเจกต์เดิม
gcloud config set project slipjing-prod

# เปิด API ที่ต้องใช้
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com cloudtasks.googleapis.com

# ที่เก็บ container image
gcloud artifacts repositories create slipjing \
  --repository-format=docker --location=asia-southeast1
```

### 2.2 Cloud SQL (PostgreSQL)

```bash
gcloud sql instances create slipjing-pg \
  --database-version=POSTGRES_16 --region=asia-southeast1 \
  --tier=db-f1-micro                # เริ่มเล็กสุด ค่อย scale ตามโหลดจริง

gcloud sql databases create slipjing --instance=slipjing-pg
gcloud sql users create slipjing --instance=slipjing-pg --password='<รหัสที่สุ่มยาวๆ>'
```

`DATABASE_URL` สำหรับ Cloud Run (ต่อผ่าน unix socket ของ Cloud SQL connector):

```
postgresql://slipjing:<รหัส>@localhost/slipjing?host=/cloudsql/slipjing-prod:asia-southeast1:slipjing-pg
```

### 2.3 Secrets → Secret Manager (ห้ามใช้ .env บน prod เด็ดขาด)

```bash
printf '%s' '<ค่า>' | gcloud secrets create DATABASE_URL      --data-file=-
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create JWT_SECRET --data-file=-
printf '%s' '<key จริงจาก Slip2Go — rotate จาก key ทดลองก่อน>' | gcloud secrets create SLIP2GO_API_KEY --data-file=-
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets create ADMIN_TOKEN --data-file=-
# + GOOGLE_CLIENT_ID / FACEBOOK_APP_ID / FACEBOOK_APP_SECRET / LINE_CHANNEL_ID เมื่อตั้งค่า OAuth เสร็จ
```

### 2.4 Build image แล้ว push

```bash
gcloud builds submit \
  --tag asia-southeast1-docker.pkg.dev/slipjing-prod/slipjing/core-api:$(git rev-parse --short HEAD)
```

(ใช้ [Dockerfile](../Dockerfile) ที่ root ของโปรเจกต์ — multi-stage, รันด้วย non-dev dependencies เท่านั้น)

### 2.5 รัน database migration

ครั้งแรกและทุกครั้งที่ schema เปลี่ยน — ใช้ Cloud SQL Auth Proxy จากเครื่องเรา:

```bash
# terminal 1: เปิด proxy
cloud-sql-proxy slipjing-prod:asia-southeast1:slipjing-pg --port 5434

# terminal 2: migrate ด้วย URL ชี้ผ่าน proxy
DATABASE_URL="postgresql://slipjing:<รหัส>@localhost:5434/slipjing" npx prisma migrate deploy
```

> ใช้ `migrate deploy` (apply เฉพาะ migration ที่ commit แล้ว) — **ห้ามใช้ `migrate dev` กับ prod**

### 2.6 Deploy Cloud Run

```bash
gcloud run deploy slipjing-core-api \
  --image asia-southeast1-docker.pkg.dev/slipjing-prod/slipjing/core-api:<tag> \
  --region asia-southeast1 \
  --add-cloudsql-instances slipjing-prod:asia-southeast1:slipjing-pg \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,SLIP2GO_API_KEY=SLIP2GO_API_KEY:latest,ADMIN_TOKEN=ADMIN_TOKEN:latest" \
  --set-env-vars "NODE_ENV=production,FREE_CREDITS_FIRST_SHOP=20" \
  --min-instances 0 --max-instances 3 \
  --memory 512Mi --cpu 1 \
  --allow-unauthenticated
```

- `--min-instances 0` = scale-to-zero ตามสเปก (ประหยัดสุด แลกกับ cold start ~2-3 วิ)
- `--allow-unauthenticated` จำเป็น เพราะเราทำ auth เองด้วย API key / JWT

### 2.7 ผูกโดเมน

```bash
gcloud beta run domain-mappings create \
  --service slipjing-core-api --domain api.slipjing.com --region asia-southeast1
# แล้วเพิ่ม DNS record (CNAME → ghs.googlehosted.com) ตามที่คำสั่งบอก
```

### 2.8 ตรวจหลัง deploy ทุกครั้ง

```bash
URL=$(gcloud run services describe slipjing-core-api --region asia-southeast1 --format='value(status.url)')
curl $URL/healthz    # → {"status":"ok"}
curl $URL/readyz     # → {"status":"ready"} — ถ้า fail = ปัญหา DATABASE_URL/Cloud SQL connector
```

### ลำดับการ deploy รอบถัดไป (สรุปสั้น)

```bash
npm test && npm run build                      # 1. เทสผ่านก่อนเสมอ (สเปก §11)
gcloud builds submit --tag ...:<git-sha>       # 2. build image
npx prisma migrate deploy                      # 3. ถ้ามี migration ใหม่ (ผ่าน proxy)
gcloud run deploy ... --image ...:<git-sha>    # 4. deploy
curl $URL/readyz                               # 5. ตรวจ
```

---

## 3. สิ่งที่ยังไม่ได้ทำ (ก่อน production จริง)

- [ ] CI (GitHub Actions): lint + typecheck + test ต้องผ่านก่อน deploy — สเปก §11 บังคับ
- [ ] GCS bucket สำหรับรูปสลิป + lifecycle rule ลบ 7 วัน (PDPA §8)
- [ ] Cloud Scheduler job ล้าง `raw_provider_response` หลัง 90 วัน (PDPA §8)
- [ ] Cloud Tasks สำหรับ retry webhook
- [ ] Rate limit ต่อ API key
- [ ] ตั้งค่า OAuth apps จริง (Google / Facebook / LINE) + ใส่ secret
- [ ] Rotate SLIP2GO_API_KEY จาก key ทดลอง และเปลี่ยนรหัสผ่าน Slip2Go (เคยถูกแชร์ในแชท)
