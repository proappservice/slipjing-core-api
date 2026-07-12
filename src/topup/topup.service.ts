import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';

/**
 * PromptPay top-up flow (CLAUDE.md §9).
 * Phase 1 slice: pick package → order created (pending) → user transfers and
 * uploads the slip → the slip is verified by OUR OWN pipeline and credits are
 * added. The self-verify call + PromptPay QR generation (possibly via
 * Slip2Go's QR API) are the next iteration; until then orders are approved
 * from the admin console, which credits the ledger.
 */
@Injectable()
export class TopupService {
  constructor(private readonly prisma: PrismaService) {}

  async listPackages() {
    const packages = await this.prisma.creditPackage.findMany({ where: { active: true }, orderBy: { priceThb: 'asc' } });
    // BigInt fields must be stringified before JSON serialization
    return packages.map((p) => ({ id: p.id, name: p.name, credits: p.credits.toString(), price_thb: p.priceThb.toString() }));
  }

  async createOrder(packageId: string) {
    const pkg = await this.prisma.creditPackage.findFirst({ where: { id: packageId, active: true } });
    if (!pkg) throw ApiError.notFound('Credit package not found');
    const order = await this.prisma.topupOrder.create({
      data: {
        id: newId(),
        tenantId: this.prisma.tenantId(),
        packageId: pkg.id,
        amountThb: pkg.priceThb,
        credits: pkg.credits,
        paymentRef: `TP-${Date.now().toString(36).toUpperCase()}`,
      },
    });
    return {
      id: order.id,
      payment_ref: order.paymentRef,
      amount_thb: order.amountThb.toString(),
      credits: order.credits.toString(),
      status: order.status,
      // TODO: PromptPay QR payload for the owner's receiving account
    };
  }

  async listOrders() {
    const orders = await this.prisma.topupOrder.findMany({
      where: this.prisma.tenantWhere(),
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return orders.map((o) => ({
      id: o.id,
      payment_ref: o.paymentRef,
      amount_thb: o.amountThb.toString(),
      credits: o.credits.toString(),
      status: o.status,
      created_at: o.createdAt.toISOString(),
    }));
  }
}
