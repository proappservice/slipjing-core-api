import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';

const DELIVERY_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- endpoint CRUD (dashboard) ----

  async listEndpoints() {
    return this.prisma.webhookEndpoint.findMany({
      where: this.prisma.tenantWhere(),
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
  }

  async createEndpoint(url: string, events: string[]) {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { id: newId(), tenantId: this.prisma.tenantId(), url, secret, events },
    });
    // Secret is shown once at creation, like API keys.
    return { id: endpoint.id, url: endpoint.url, events: endpoint.events, secret };
  }

  async deleteEndpoint(id: string): Promise<void> {
    const { count } = await this.prisma.webhookEndpoint.deleteMany({
      where: { id, ...this.prisma.tenantWhere() },
    });
    if (count === 0) throw ApiError.notFound('Webhook endpoint not found');
  }

  // ---- delivery (§7 step 7) ----

  /**
   * Signs and delivers `event` to every matching endpoint of the current tenant.
   * Phase 1: one immediate attempt, failures recorded with next_retry_at for a
   * scheduled retry job (Cloud Tasks wiring comes with deployment).
   */
  async dispatch(event: string, payload: Record<string, unknown>): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { ...this.prisma.tenantWhere(), active: true, events: { has: event } },
    });

    await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        const delivery = await this.prisma.webhookDelivery.create({
          data: { id: newId(), endpointId: endpoint.id, event, payload: payload as object, attempts: 1 },
        });
        const body = JSON.stringify({ event, data: payload, delivery_id: delivery.id });
        const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');

        try {
          const res = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-slipjing-signature': signature,
              'x-slipjing-event': event,
            },
            body,
            signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
          });
          await this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: res.ok
              ? { status: 'delivered' }
              : { status: 'failed', nextRetryAt: this.backoff(1) },
          });
        } catch (err) {
          this.logger.warn({ endpoint: endpoint.url, err: String(err) }, 'webhook delivery failed');
          await this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: 'failed', nextRetryAt: this.backoff(1) },
          });
        }
      }),
    );
  }

  private backoff(attempt: number): Date {
    // 1m, 5m, 30m, 2h, 12h — capped exponential-ish schedule
    const minutes = [1, 5, 30, 120, 720][Math.min(attempt - 1, 4)];
    return new Date(Date.now() + minutes * 60_000);
  }
}
