import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BankVerifyMode } from '@prisma/client';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';
import { CreditsService } from '../credits/credits.service';

@Injectable()
export class TenantsService {
  private readonly freeCreditsFirstShop: bigint;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    config: ConfigService,
  ) {
    this.freeCreditsFirstShop = BigInt(config.get<string>('FREE_CREDITS_FIRST_SHOP') ?? '20');
  }

  /** Shops the user belongs to (pre-tenant route — session only). */
  async listMyShops(userId: string) {
    const memberships = await this.prisma.tenantMember.findMany({
      where: { userId },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      memberships.map(async (m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        status: m.tenant.status,
        role: m.role,
        balance: (await this.credits.balance(m.tenant.id)).toString(),
      })),
    );
  }

  /**
   * Create a shop (tenant) owned by the user. Free credits are granted only
   * on the user's FIRST shop (CLAUDE.md §9 — no multi-shop credit farming).
   */
  async createShop(userId: string, name: string) {
    const priorShops = await this.prisma.tenantMember.count({ where: { userId } });

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({ data: { id: newId(), name } });
      await tx.tenantMember.create({
        data: { id: newId(), tenantId: created.id, userId, role: 'owner' },
      });
      return created;
    });

    if (priorShops === 0 && this.freeCreditsFirstShop > 0n) {
      await this.credits.credit(
        this.freeCreditsFirstShop,
        'topup',
        { refType: 'signup_grant', refId: tenant.id },
        tenant.id,
      );
    }

    return { id: tenant.id, name: tenant.name, status: tenant.status, free_credits_granted: priorShops === 0 };
  }

  // ---- bank accounts (per current shop context) ----

  async listBankAccounts() {
    return this.prisma.bankAccount.findMany({
      where: this.prisma.tenantWhere(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async addBankAccount(input: {
    bankCode: string;
    accountNumber: string;
    accountNameTh: string;
    accountNameEn?: string;
    verifyMode?: BankVerifyMode;
  }) {
    return this.prisma.bankAccount.create({
      data: {
        id: newId(),
        tenantId: this.prisma.tenantId(),
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountNameTh: input.accountNameTh,
        accountNameEn: input.accountNameEn,
        verifyMode: input.verifyMode ?? 'both',
      },
    });
  }

  async removeBankAccount(id: string): Promise<void> {
    const { count } = await this.prisma.bankAccount.updateMany({
      where: { id, ...this.prisma.tenantWhere(), active: true },
      data: { active: false },
    });
    if (count === 0) throw ApiError.notFound('Bank account not found');
  }
}
