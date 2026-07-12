import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CreditsModule } from '../credits/credits.module';
import { ProvidersModule } from '../providers/providers.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ShopVerificationsController, VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [ApiKeysModule, CreditsModule, ProvidersModule, WebhooksModule],
  controllers: [VerificationController, ShopVerificationsController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
