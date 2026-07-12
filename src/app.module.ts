import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { TenantContextService } from './common/tenant-context.service';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CreditsModule } from './credits/credits.module';
import { HealthModule } from './health/health.module';
import { ProvidersModule } from './providers/providers.module';
import { TenantsModule } from './tenants/tenants.module';
import { TopupModule } from './topup/topup.module';
import { VerificationModule } from './verification/verification.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        // §11: structured JSON logs; request id on every line. tenant_id is
        // added by services via child loggers where relevant.
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
        redact: ['req.headers.authorization', 'req.headers["x-admin-token"]'],
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
      },
    }),
    CommonModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    ApiKeysModule,
    CreditsModule,
    TopupModule,
    VerificationModule,
    ProvidersModule,
    WebhooksModule,
    AdminModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly tenantContext: TenantContextService) {}

  configure(consumer: MiddlewareConsumer): void {
    // Enter an AsyncLocalStorage scope for EVERY request; auth guards fill in
    // the tenant identity afterwards (see TenantContextService).
    consumer
      .apply((_req: Request, _res: Response, next: NextFunction) => this.tenantContext.runWithScope(next))
      .forRoutes('*path');
  }
}
