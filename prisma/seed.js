/**
 * Local-dev seed (npm run db:seed) — creates a test user, shop, 100 credits,
 * credit packages, and a FIXED test API key so curl examples are copy-paste:
 *
 *   API key: sj_test_LocalDevOnlyKey00000000000000001
 *
 * Idempotent: safe to run repeatedly. NEVER run against production.
 */
const { PrismaClient } = require('@prisma/client');
const { createHash, randomUUID } = require('node:crypto');

const prisma = new PrismaClient();
const DEV_API_KEY = 'sj_test_LocalDevOnlyKey00000000000000001';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'dev@slipjing.local' },
    update: {},
    create: { id: randomUUID(), email: 'dev@slipjing.local', displayName: 'Dev ทดสอบ' },
  });

  let member = await prisma.tenantMember.findFirst({ where: { userId: user.id }, include: { tenant: true } });
  if (!member) {
    const tenant = await prisma.tenant.create({ data: { id: randomUUID(), name: 'ร้านทดสอบ (local)' } });
    member = await prisma.tenantMember.create({
      data: { id: randomUUID(), tenantId: tenant.id, userId: user.id, role: 'owner' },
      include: { tenant: true },
    });
    await prisma.creditLedger.create({
      data: {
        id: randomUUID(), tenantId: tenant.id, delta: 100n, reason: 'topup',
        refType: 'seed', refId: 'local-dev', balanceAfter: 100n,
      },
    });
  }
  const tenantId = member.tenantId;

  await prisma.apiKey.upsert({
    where: { keyHash: sha256(DEV_API_KEY) },
    update: { revokedAt: null },
    create: {
      id: randomUUID(), tenantId, name: 'Local dev key',
      keyPrefix: DEV_API_KEY.slice(0, 8), keyHash: sha256(DEV_API_KEY),
    },
  });

  for (const [name, credits, priceThb] of [['เริ่มต้น', 100n, 150n], ['ร้านค้า', 500n, 600n], ['ธุรกิจ', 2000n, 2000n]]) {
    const existing = await prisma.creditPackage.findFirst({ where: { name } });
    if (!existing) {
      await prisma.creditPackage.create({ data: { id: randomUUID(), name, credits, priceThb } });
    }
  }

  console.log('Seed complete.');
  console.log('  shop (tenant) id :', tenantId);
  console.log('  API key          :', DEV_API_KEY);
}

main().finally(() => prisma.$disconnect());
