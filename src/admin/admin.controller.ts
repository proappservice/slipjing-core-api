import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard } from './admin.guard';

class SetTenantStatusDto {
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';
}

/**
 * Cross-tenant owner console (CLAUDE.md §5) — the ONLY module allowed to
 * query across tenants, hence direct prisma access without tenant context.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('tenants')
  listTenants() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { verificationRequests: true, members: true } } },
    });
  }

  @Post('tenants/:id/status')
  async setTenantStatus(@Param('id') id: string, @Body() dto: SetTenantStatusDto) {
    await this.prisma.tenant.update({ where: { id }, data: { status: dto.status } });
    return { id, status: dto.status };
  }

  /** PDPA erasure (§8): hard-delete the tenant; FK cascades remove owned rows. */
  @Delete('tenants/:id')
  async deleteTenant(@Param('id') id: string) {
    await this.prisma.tenant.delete({ where: { id } });
    return { deleted: true };
  }

  @Get('topup-orders/pending')
  pendingTopups() {
    return this.prisma.topupOrder.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: { tenant: { select: { name: true } }, package: { select: { name: true } } },
    });
  }

  /** Manual approval fallback (§9): mark paid + credit the ledger atomically-enough. */
  @Post('topup-orders/:id/approve')
  async approveTopup(@Param('id') id: string) {
    const order = await this.prisma.topupOrder.findUnique({ where: { id } });
    if (!order) throw ApiError.notFound('Top-up order not found');
    if (order.status !== 'pending') throw ApiError.invalidRequest(`Order is already ${order.status}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${order.tenantId}, 42))`;
      const latest = await tx.creditLedger.findFirst({
        where: { tenantId: order.tenantId },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfter: true },
      });
      await tx.creditLedger.create({
        data: {
          id: newId(),
          tenantId: order.tenantId,
          delta: order.credits,
          reason: 'topup',
          refType: 'topup_order',
          refId: order.id,
          balanceAfter: (latest?.balanceAfter ?? 0n) + order.credits,
        },
      });
      await tx.topupOrder.update({ where: { id: order.id }, data: { status: 'paid' } });
    });
    return { approved: true };
  }
}
